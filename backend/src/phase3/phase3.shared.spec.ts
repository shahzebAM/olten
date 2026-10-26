import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma, type LedgerAccount } from '@prisma/client';
import {
  Actor,
  assertApproval,
  DEFAULT_ACCOUNTS,
  erpRoles,
  ERP_ROLES,
  hasAccess,
  initializeAccounts,
  money,
  nextNumber,
  postJournal,
  Tx,
} from './phase3.shared';
const containing = (value: Record<string, unknown>): unknown =>
  expect.objectContaining(value);
const matching = (value: RegExp): unknown => expect.stringMatching(value);

const actor = (roles: string[], modules: object = {}): Actor => ({
  id: 7,
  username: 'finance',
  role: 'Admin',
  modules: {
    erpRoles: roles,
    finance: true,
    books: true,
    service: true,
    executive: true,
    ai_assistant: true,
    ...modules,
  },
});
const finance = actor(['Finance'], { approvalLimits: { Surgicom: '1000.00' } });
const journal = {
  sourceKey: 'TEST:invoice-1',
  sourceType: 'TEST',
  sourceId: 'invoice-1',
  date: new Date('2026-10-01'),
  memo: 'Invoice',
  lines: [
    { code: '1300', debit: '0.30', credit: '0.00' },
    { code: '4000', debit: '0.00', credit: '0.30' },
  ],
};

function mockTransaction() {
  const accounts: Pick<
    LedgerAccount,
    'id' | 'company' | 'code' | 'name' | 'type' | 'active'
  >[] = DEFAULT_ACCOUNTS.map(([code, name, type]) => ({
    id: `account-${code}`,
    company: 'Surgicom',
    code,
    name,
    type,
    active: true,
  }));
  const tx = {
    ledgerAccount: {
      findUnique: jest.fn(
        ({ where }: { where: { company_code: { code: string } } }) =>
          Promise.resolve(
            accounts.find(
              (account) => account.code === where.company_code.code,
            ),
          ),
      ),
      findMany: jest.fn(({ where }: { where: { code: { in: string[] } } }) =>
        Promise.resolve(
          accounts.filter((account) => where.code.in.includes(account.code)),
        ),
      ),
      create: jest.fn(),
    },
    accountingJournal: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...data, id: 'journal-1' }),
      ),
    },
    importSequence: { upsert: jest.fn().mockResolvedValue({ value: 1 }) },
    erpAuditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
  };
  return { tx, client: tx as unknown as Tx };
}

describe('Phase 3 permissions and exact journal posting', () => {
  it('requires a valid ERP role as well as a module flag; legacy Admin alone grants no access', () => {
    expect(hasAccess(actor([]), 'books')).toBe(false);
    expect(hasAccess(actor(['Finance'], { books: false }), 'books')).toBe(
      false,
    );
    expect(hasAccess(finance, 'books', true)).toBe(true);
    expect(hasAccess(actor(['Sales']), 'finance')).toBe(true);
    expect(hasAccess(actor(['Sales']), 'finance', true)).toBe(false);
    expect(erpRoles(actor(['Finance', 'Finance', 'invalid']))).toEqual([
      'Finance',
    ]);
  });
  it.each(ERP_ROLES)(
    'allows %s to see a role-filtered executive dashboard',
    (role) => {
      expect(hasAccess(actor([role]), 'executive')).toBe(true);
      expect(hasAccess(actor([role]), 'executive', true)).toBe(false);
    },
  );
  it('keeps an Auditor read-only even when another role is also assigned', () => {
    const auditor = actor(['Auditor', 'Finance']);
    expect(hasAccess(auditor, 'books')).toBe(true);
    expect(hasAccess(auditor, 'books', true)).toBe(false);
    expect(() =>
      assertApproval(auditor, 'Surgicom', new Prisma.Decimal(1)),
    ).toThrow(ForbiddenException);
  });
  it('requires Finance limits, accepts their exact boundary, and enforces configured Management limits', () => {
    expect(() =>
      assertApproval(actor(['Finance']), 'Surgicom', new Prisma.Decimal(1)),
    ).toThrow(ForbiddenException);
    expect(() =>
      assertApproval(finance, 'Surgicom', new Prisma.Decimal('1000')),
    ).not.toThrow();
    expect(() =>
      assertApproval(finance, 'Surgicom', new Prisma.Decimal('1000.01')),
    ).toThrow(ForbiddenException);
    expect(() =>
      assertApproval(
        actor(['Management']),
        'Surgicom',
        new Prisma.Decimal('1000000'),
      ),
    ).not.toThrow();
    expect(() =>
      assertApproval(
        actor(['Management'], { approvalLimits: { Surgicom: '20.00' } }),
        'Surgicom',
        new Prisma.Decimal('20.01'),
      ),
    ).toThrow(ForbiddenException);
  });
  it.each([
    'NaN',
    'Infinity',
    '1e3',
    '1.001',
    '-0.01',
    '',
    ' 1.00 ',
    0.1 + 0.2,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects invalid or implicitly rounded money %s', (value) => {
    expect(() => money(value, 'Amount')).toThrow(BadRequestException);
  });
  it('handles signed statement values without changing financial precision', () => {
    expect(money('-0.30', 'Amount', true).toFixed(2)).toBe('-0.30');
    expect(
      money('0.30', 'Amount').eq(new Prisma.Decimal('0.1').add('0.2')),
    ).toBe(true);
  });
  it('generates globally unique phase-3 document counters without a database connection', async () => {
    const { client, tx } = mockTransaction();
    expect(await nextNumber(client, 'Surgicom', 'INV')).toMatch(
      /^INV-\d{4}-000001$/,
    );
    expect(tx.importSequence.upsert).toHaveBeenCalledWith(
      containing({
        where: { key: matching(/^phase3:INV:\d{4}$/) },
      }),
    );
  });
  it('posts balanced exact cents with active scoped accounts and an audit inside the caller transaction', async () => {
    const { client, tx } = mockTransaction();
    await expect(
      postJournal(client, 'Surgicom', finance, journal),
    ).resolves.toMatchObject({
      id: 'journal-1',
      company: 'Surgicom',
      sourceKey: journal.sourceKey,
    });
    expect(tx.ledgerAccount.findMany).toHaveBeenCalledWith({
      where: {
        company: 'Surgicom',
        active: true,
        code: { in: ['1300', '4000'] },
      },
    });
    expect(tx.erpAuditLog.create).toHaveBeenCalledWith(
      containing({
        data: containing({
          company: 'Surgicom',
          actorId: 7,
          action: 'POST',
          details: containing({ total: '0.30' }),
        }),
      }),
    );
  });
  it.each([
    [
      { code: '1300', debit: '0.30', credit: '0.01' },
      { code: '4000', debit: '0.00', credit: '0.29' },
    ],
    [
      { code: '1300', debit: '0.30', credit: '0.00' },
      { code: '4000', debit: '0.00', credit: '0.31' },
    ],
    [
      { code: '1300', debit: '0.00', credit: '0.00' },
      { code: '4000', debit: '0.00', credit: '0.00' },
    ],
  ])(
    'rejects malformed or unbalanced entries before writing',
    async (...lines) => {
      const { client, tx } = mockTransaction();
      await expect(
        postJournal(client, 'Surgicom', finance, { ...journal, lines }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.accountingJournal.create).not.toHaveBeenCalled();
    },
  );
  it('returns the original journal on an identical source retry and rejects changed amounts', async () => {
    const { client, tx } = mockTransaction();
    const existing = {
      ...journal,
      id: 'existing',
      status: 'POSTED',
      entries: journal.lines.map((line) => ({
        account: { code: line.code },
        debit: new Prisma.Decimal(line.debit),
        credit: new Prisma.Decimal(line.credit),
      })),
    };
    tx.accountingJournal.findUnique.mockResolvedValue(existing);
    expect(await postJournal(client, 'Surgicom', finance, journal)).toBe(
      existing,
    );
    await expect(
      postJournal(client, 'Surgicom', finance, { ...journal, memo: 'Changed' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.accountingJournal.create).not.toHaveBeenCalled();
    expect(tx.importSequence.upsert).not.toHaveBeenCalled();
  });
  it('rejects inactive or missing accounts without creating a journal', async () => {
    const { client, tx } = mockTransaction();
    tx.ledgerAccount.findMany.mockResolvedValue([]);
    await expect(
      postJournal(client, 'Surgicom', finance, journal),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.accountingJournal.create).not.toHaveBeenCalled();
  });
  it('rejects misclassified existing control accounts before initialization or posting', async () => {
    for (const action of ['initialize', 'post']) {
      const { client, tx } = mockTransaction();
      tx.ledgerAccount.findUnique.mockResolvedValueOnce({
        id: 'bad-bank',
        company: 'Surgicom',
        code: '1000',
        name: 'Wrong type',
        type: 'EXPENSE',
        active: true,
      });
      const result =
        action === 'initialize'
          ? initializeAccounts(client, 'Surgicom', finance)
          : postJournal(client, 'Surgicom', finance, journal);
      await expect(result).rejects.toThrow(
        'System account 1000 must use the ASSET',
      );
      expect(tx.accountingJournal.create).not.toHaveBeenCalled();
      expect(tx.ledgerAccount.create).not.toHaveBeenCalled();
    }
  });
  it('approves invoice gross without counting a separate COGS debit twice', async () => {
    const { client, tx } = mockTransaction();
    const input = {
      ...journal,
      approvalAmount: '1120.00',
      lines: [
        { code: '1300', debit: '1120', credit: '0' },
        { code: '4000', debit: '0', credit: '1000' },
        { code: '2200', debit: '0', credit: '120' },
        { code: '5100', debit: '500', credit: '0' },
        { code: '1200', debit: '0', credit: '500' },
      ],
    };
    const approved = actor(['Finance'], {
      approvalLimits: { Surgicom: '1120.00' },
    });
    await expect(
      postJournal(client, 'Surgicom', approved, input),
    ).resolves.toMatchObject({ id: 'journal-1' });
    await expect(
      postJournal(client, 'Surgicom', approved, {
        ...input,
        approvalAmount: undefined,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.accountingJournal.create).toHaveBeenCalledTimes(1);
  });
});
