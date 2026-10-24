import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BooksService } from './books.service';
import { DEFAULT_ACCOUNTS } from './phase3.shared';
import type { Actor } from './phase3.shared';

function mockDatabase() {
  return {
    company: { findUnique: jest.fn() },
    ledgerAccount: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
    },
    product: { findFirst: jest.fn(), findMany: jest.fn() },
    customer: { findFirst: jest.fn(), findMany: jest.fn() },
    supplier: { findFirst: jest.fn(), findMany: jest.fn() },
    accountingJournal: { findMany: jest.fn() },
    accountingMapping: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    bankReconciliation: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    bankStatementLine: { update: jest.fn() },
    ledgerEntry: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      aggregate: jest.fn(),
      groupBy: jest.fn(),
    },
    erpAuditLog: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    importSequence: { upsert: jest.fn() },
    $transaction: jest.fn(),
    $disconnect: jest.fn(),
  };
}
jest.mock('@prisma/client', () => {
  const actual =
    jest.requireActual<typeof import('@prisma/client')>('@prisma/client');
  const mockClient = mockDatabase();
  return { ...actual, PrismaClient: jest.fn(() => mockClient), mockClient };
});
const { mockClient } = jest.requireMock<{
  mockClient: ReturnType<typeof mockDatabase>;
}>('@prisma/client');
const containing = (value: Record<string, unknown>): unknown =>
  expect.objectContaining(value);
const amount = (value: string) => new Prisma.Decimal(value);
const finance: Actor = {
  id: 1,
  username: 'finance',
  role: 'Admin',
  modules: {
    erpRoles: ['Finance'],
    books: true,
    approvalLimits: { Surgicom: '1000.00' },
  },
};
const superAdmin: Actor = { ...finance, role: 'Super Admin' };
const line = { id: 'line-1', amount: amount('100'), ledgerEntryId: null };
const bank = { id: 'bank-1', company: 'Surgicom', type: 'ASSET', active: true };
const reconciliation = {
  id: 'rec-1',
  company: 'Surgicom',
  accountId: bank.id,
  status: 'DRAFT',
  statementDate: new Date('2026-10-10'),
  openingBalance: amount('0'),
  closingBalance: amount('100'),
  lines: [line],
};
const entry = {
  id: 'entry-1',
  accountId: bank.id,
  account: bank,
  debit: amount('100'),
  credit: amount('0'),
  journal: {
    date: new Date('2026-10-09'),
    status: 'POSTED',
    company: 'Surgicom',
  },
  statementLine: null,
};

describe('Internal Books accounting safeguards', () => {
  let service: BooksService;
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.company.findUnique.mockResolvedValue({ id: 'company' });
    mockClient.$transaction.mockImplementation(
      async (work: (tx: unknown) => Promise<unknown>) => work(mockClient),
    );
    mockClient.bankReconciliation.findFirst.mockResolvedValue(reconciliation);
    mockClient.ledgerAccount.findFirst.mockResolvedValue(bank);
    mockClient.accountingMapping.findFirst.mockResolvedValue(null);
    mockClient.ledgerEntry.findFirst.mockResolvedValue(entry);
    mockClient.ledgerEntry.aggregate.mockResolvedValue({
      _sum: { debit: amount('100'), credit: amount('0') },
    });
    mockClient.bankStatementLine.update.mockResolvedValue({
      ...line,
      ledgerEntryId: 'entry-1',
    });
    mockClient.bankReconciliation.update.mockResolvedValue({
      ...reconciliation,
      status: 'COMPLETED',
    });
    mockClient.importSequence.upsert.mockResolvedValue({ value: 1 });
    service = new BooksService();
  });
  it('rejects all writes for an Auditor before opening a transaction', async () => {
    await expect(
      service.initialize('Surgicom', {
        ...finance,
        modules: { erpRoles: ['Auditor'], books: true },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockClient.$transaction).not.toHaveBeenCalled();
  });
  it('rechecks workspace existence inside Books write transactions', async () => {
    mockClient.company.findUnique.mockResolvedValue(null);
    await expect(
      service.initialize('Surgicom', finance),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mockClient.ledgerAccount.findUnique).not.toHaveBeenCalled();
    expect(mockClient.ledgerAccount.create).not.toHaveBeenCalled();
    expect(mockClient.erpAuditLog.create).not.toHaveBeenCalled();
  });
  it('prevents custom chart setup from misclassifying reserved automatic-posting accounts', async () => {
    await expect(
      service.createAccount('Surgicom', finance, {
        code: '1300',
        name: 'Bad receivables',
        type: 'EXPENSE',
      }),
    ).rejects.toThrow('requires the ASSET account type');
    await expect(
      service.createAccount('Surgicom', finance, {
        code: '2100',
        name: 'Bad payables',
        type: 'REVENUE',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockClient.$transaction).not.toHaveBeenCalled();
    expect(mockClient.ledgerAccount.create).not.toHaveBeenCalled();
  });
  describe('chart of accounts deletion', () => {
    const unused = {
      id: 'custom-account',
      company: 'Surgicom',
      code: '6100',
      name: 'Unused office supplies',
      type: 'EXPENSE',
      active: true,
      _count: { entries: 0, mappings: 0, reconciliations: 0 },
    };
    beforeEach(() => {
      mockClient.ledgerAccount.findFirst.mockResolvedValue(unused);
      mockClient.ledgerAccount.delete.mockResolvedValue(unused);
    });
    it('deletes an unused account and retains its identity in the audit log', async () => {
      await expect(
        service.deleteAccount('Surgicom', superAdmin, unused.id),
      ).resolves.toEqual({ id: unused.id, deleted: true });
      expect(mockClient.ledgerAccount.findFirst).toHaveBeenCalledWith(
        containing({ where: { id: unused.id, company: 'Surgicom' } }),
      );
      expect(mockClient.accountingMapping.findFirst).toHaveBeenCalledWith({
        where: { company: 'Surgicom', kind: 'ACCOUNT', sourceId: unused.id },
        select: { id: true },
      });
      expect(mockClient.ledgerAccount.delete).toHaveBeenCalledWith({
        where: { id: unused.id },
      });
      expect(mockClient.erpAuditLog.create).toHaveBeenCalledWith(
        containing({
          data: containing({
            company: 'Surgicom',
            action: 'DELETE',
            entityType: 'LedgerAccount',
            entityId: unused.id,
            details: {
              code: unused.code,
              name: unused.name,
              type: unused.type,
            },
          }),
        }),
      );
      expect(mockClient.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        containing({ isolationLevel: 'Serializable' }),
      );
    });
    it.each(DEFAULT_ACCOUNTS)(
      'permits deleting unused standard account %s',
      async (code, name, type) => {
        mockClient.ledgerAccount.findFirst.mockResolvedValue({
          ...unused,
          code,
          name,
          type,
        });
        await expect(
          service.deleteAccount('Surgicom', superAdmin, unused.id),
        ).resolves.toEqual({ id: unused.id, deleted: true });
        expect(mockClient.ledgerAccount.delete).toHaveBeenCalledWith({
          where: { id: unused.id },
        });
        expect(mockClient.ledgerAccount.update).not.toHaveBeenCalled();
      },
    );
    it.each(['entries', 'mappings', 'reconciliations'] as const)(
      'archives an account referenced by %s without removing history',
      async (relation) => {
        mockClient.ledgerAccount.findFirst.mockResolvedValue({
          ...unused,
          _count: { ...unused._count, [relation]: 1 },
        });
        await expect(
          service.deleteAccount('Surgicom', superAdmin, unused.id),
        ).resolves.toEqual({ id: unused.id, deleted: false, archived: true });
        expect(mockClient.ledgerAccount.delete).not.toHaveBeenCalled();
        expect(mockClient.ledgerAccount.update).toHaveBeenCalledWith({
          where: { id: unused.id },
          data: { active: false },
        });
        expect(mockClient.erpAuditLog.create).toHaveBeenCalledWith(
          containing({
            data: containing({ action: 'ARCHIVE', entityId: unused.id }),
          }),
        );
      },
    );
    it('archives an account used as an ACCOUNT reference mapping source', async () => {
      mockClient.accountingMapping.findFirst.mockResolvedValue({
        id: 'mapping-source',
      });
      await expect(
        service.deleteAccount('Surgicom', superAdmin, unused.id),
      ).resolves.toEqual({ id: unused.id, deleted: false, archived: true });
      expect(mockClient.ledgerAccount.delete).not.toHaveBeenCalled();
      expect(mockClient.ledgerAccount.update).toHaveBeenCalledWith({
        where: { id: unused.id },
        data: { active: false },
      });
    });
    it('does not delete missing or foreign-workspace accounts', async () => {
      mockClient.ledgerAccount.findFirst.mockResolvedValue(null);
      await expect(
        service.deleteAccount('Surgicom', superAdmin, 'foreign-account'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockClient.ledgerAccount.findFirst).toHaveBeenCalledWith(
        containing({ where: { id: 'foreign-account', company: 'Surgicom' } }),
      );
      expect(mockClient.ledgerAccount.delete).not.toHaveBeenCalled();
      expect(mockClient.erpAuditLog.create).not.toHaveBeenCalled();
    });
    it.each(['Finance', 'Management', 'Auditor', 'Sales'])(
      'rejects deletion by a global Admin with ERP %s before opening a transaction',
      async (role) => {
        await expect(
          service.deleteAccount(
            'Surgicom',
            {
              ...finance,
              modules: { books: true, erpRoles: [role] },
            },
            unused.id,
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(mockClient.$transaction).not.toHaveBeenCalled();
        expect(mockClient.ledgerAccount.delete).not.toHaveBeenCalled();
      },
    );
    it('reports a concurrent foreign-key reference as an account-in-use conflict', async () => {
      mockClient.ledgerAccount.delete.mockRejectedValueOnce({ code: 'P2003' });
      await expect(
        service.deleteAccount('Surgicom', superAdmin, unused.id),
      ).rejects.toThrow('This account is now in use');
      expect(mockClient.erpAuditLog.create).not.toHaveBeenCalled();
    });
    it('rejects an empty account ID before opening a transaction', async () => {
      await expect(
        service.deleteAccount('Surgicom', superAdmin, '  '),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockClient.$transaction).not.toHaveBeenCalled();
    });
    it('archives a used standard account instead of deleting its history', async () => {
      mockClient.ledgerAccount.findFirst.mockResolvedValue({
        ...unused,
        code: '1300',
        _count: { ...unused._count, entries: 2 },
      });
      await expect(
        service.deleteAccount('Surgicom', superAdmin, unused.id),
      ).resolves.toEqual({ id: unused.id, deleted: false, archived: true });
      expect(mockClient.ledgerAccount.delete).not.toHaveBeenCalled();
      expect(mockClient.erpAuditLog.create).toHaveBeenCalledWith(
        containing({ data: containing({ action: 'ARCHIVE' }) }),
      );
    });
    it('keeps repeated deletion of an archived account idempotent', async () => {
      mockClient.ledgerAccount.findFirst.mockResolvedValue({
        ...unused,
        active: false,
      });
      await expect(
        service.deleteAccount('Surgicom', superAdmin, unused.id),
      ).resolves.toEqual({ id: unused.id, deleted: false, archived: true });
      expect(mockClient.ledgerAccount.delete).not.toHaveBeenCalled();
      expect(mockClient.ledgerAccount.update).not.toHaveBeenCalled();
      expect(mockClient.erpAuditLog.create).not.toHaveBeenCalled();
    });
    it.each(['DELETE', 'ARCHIVE'])(
      'rejects the transaction when the %s audit cannot be recorded',
      async (action) => {
        if (action === 'ARCHIVE')
          mockClient.ledgerAccount.findFirst.mockResolvedValue({
            ...unused,
            _count: { ...unused._count, entries: 1 },
          });
        mockClient.erpAuditLog.create.mockRejectedValueOnce(
          new Error('Audit unavailable'),
        );
        await expect(
          service.deleteAccount('Surgicom', superAdmin, unused.id),
        ).rejects.toThrow('Audit unavailable');
        expect(mockClient.$transaction).toHaveBeenCalledWith(
          expect.any(Function),
          containing({ isolationLevel: 'Serializable' }),
        );
      },
    );
    it('restores an archived account with the original identity and a RESTORE audit', async () => {
      mockClient.ledgerAccount.findFirst.mockResolvedValue({
        ...unused,
        active: false,
      });
      await expect(
        service.restoreAccount('Surgicom', superAdmin, unused.id),
      ).resolves.toEqual({ id: unused.id, active: true });
      expect(mockClient.ledgerAccount.findFirst).toHaveBeenCalledWith({
        where: { id: unused.id, company: 'Surgicom' },
      });
      expect(mockClient.ledgerAccount.update).toHaveBeenCalledWith({
        where: { id: unused.id },
        data: { active: true },
      });
      expect(mockClient.erpAuditLog.create).toHaveBeenCalledWith(
        containing({
          data: containing({
            action: 'RESTORE',
            entityId: unused.id,
            details: {
              code: unused.code,
              name: unused.name,
              type: unused.type,
              previousActive: false,
              active: true,
            },
          }),
        }),
      );
    });
    it('keeps restoring an active account idempotent', async () => {
      await expect(
        service.restoreAccount('Surgicom', superAdmin, unused.id),
      ).resolves.toEqual({ id: unused.id, active: true });
      expect(mockClient.ledgerAccount.update).not.toHaveBeenCalled();
      expect(mockClient.erpAuditLog.create).not.toHaveBeenCalled();
    });
    it.each(['Finance', 'Management', 'Auditor', 'Sales'])(
      'rejects restoration by a global Admin with ERP %s before opening a transaction',
      async (role) => {
        await expect(
          service.restoreAccount(
            'Surgicom',
            {
              ...finance,
              modules: { books: true, erpRoles: [role] },
            },
            unused.id,
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(mockClient.$transaction).not.toHaveBeenCalled();
        expect(mockClient.ledgerAccount.update).not.toHaveBeenCalled();
      },
    );
    it('does not restore missing or foreign-workspace accounts', async () => {
      mockClient.ledgerAccount.findFirst.mockResolvedValue(null);
      await expect(
        service.restoreAccount('Surgicom', superAdmin, 'foreign-account'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockClient.ledgerAccount.findFirst).toHaveBeenCalledWith({
        where: { id: 'foreign-account', company: 'Surgicom' },
      });
      expect(mockClient.ledgerAccount.update).not.toHaveBeenCalled();
      expect(mockClient.erpAuditLog.create).not.toHaveBeenCalled();
    });
    it('rejects an empty restoration account ID before opening a transaction', async () => {
      await expect(
        service.restoreAccount('Surgicom', superAdmin, '  '),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockClient.$transaction).not.toHaveBeenCalled();
    });
    it('rejects the transaction when the RESTORE audit cannot be recorded', async () => {
      mockClient.ledgerAccount.findFirst.mockResolvedValue({
        ...unused,
        active: false,
      });
      mockClient.erpAuditLog.create.mockRejectedValueOnce(
        new Error('Audit unavailable'),
      );
      await expect(
        service.restoreAccount('Surgicom', superAdmin, unused.id),
      ).rejects.toThrow('Audit unavailable');
      expect(mockClient.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        containing({ isolationLevel: 'Serializable' }),
      );
    });
  });
  it('retains archived balances and history while excluding archived ACCOUNT mapping sources', async () => {
    const activeAccount = {
      ...bank,
      code: '1000',
      name: 'Bank and cash',
      _count: { entries: 0, mappings: 0, reconciliations: 0 },
    };
    const archivedAccount = {
      ...activeAccount,
      id: 'archived-account',
      code: '1300',
      name: 'Accounts receivable',
      active: false,
      _count: { entries: 1, mappings: 1, reconciliations: 0 },
    };
    const mappedSource = {
      ...activeAccount,
      id: 'mapped-source',
      code: '6200',
    };
    const journal = {
      id: 'journal-1',
      entries: [{ account: archivedAccount }],
    };
    const mapping = { id: 'mapping-1', account: archivedAccount };
    mockClient.ledgerAccount.findMany.mockResolvedValue([
      activeAccount,
      archivedAccount,
      mappedSource,
    ]);
    mockClient.accountingJournal.findMany.mockResolvedValue([journal]);
    mockClient.accountingMapping.findMany
      .mockResolvedValueOnce([mapping])
      .mockResolvedValueOnce([{ sourceId: mappedSource.id }]);
    mockClient.bankReconciliation.findMany.mockResolvedValue([reconciliation]);
    mockClient.ledgerEntry.groupBy.mockResolvedValue([
      {
        accountId: archivedAccount.id,
        _sum: { debit: amount('125'), credit: amount('25') },
      },
    ]);
    mockClient.product.findMany.mockResolvedValue([]);
    mockClient.customer.findMany.mockResolvedValue([]);
    mockClient.supplier.findMany.mockResolvedValue([]);
    const result = await service.overview('Surgicom');
    expect(mockClient.ledgerAccount.findMany).toHaveBeenCalledWith(
      containing({ where: { company: 'Surgicom' } }),
    );
    expect(result.accounts).toEqual([
      containing({ id: bank.id, active: true, deleteAction: 'DELETE' }),
      containing({
        id: archivedAccount.id,
        active: false,
        deleteAction: 'ARCHIVE',
      }),
      containing({ id: mappedSource.id, deleteAction: 'ARCHIVE' }),
    ]);
    expect(result.trialBalance).toContainEqual(
      containing({
        accountId: archivedAccount.id,
        debit: '125.00',
        credit: '25.00',
        balance: '100.00',
      }),
    );
    expect(result.journals).toEqual([journal]);
    expect(result.mappings).toEqual([mapping]);
    expect(result.reconciliations).toEqual([reconciliation]);
    expect(result.mappingSources.ACCOUNT).toEqual([
      {
        id: activeAccount.id,
        code: activeAccount.code,
        name: activeAccount.name,
      },
      { id: mappedSource.id, code: mappedSource.code, name: mappedSource.name },
    ]);
  });
  it('matches a statement line only to a posted ledger entry from the same workspace/account/signed amount', async () => {
    await expect(
      service.matchStatementLine('Surgicom', finance, 'rec-1', {
        lineId: 'line-1',
        ledgerEntryId: 'entry-1',
      }),
    ).resolves.toMatchObject({ ledgerEntryId: 'entry-1' });
    expect(mockClient.ledgerEntry.findFirst).toHaveBeenCalledWith(
      containing({
        where: {
          id: 'entry-1',
          accountId: bank.id,
          account: { company: 'Surgicom' },
          journal: { company: 'Surgicom', status: 'POSTED' },
        },
      }),
    );
    expect(mockClient.erpAuditLog.create).toHaveBeenCalledWith(
      containing({
        data: containing({ company: 'Surgicom', action: 'MATCH' }),
      }),
    );
    expect(mockClient.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      containing({ isolationLevel: 'Serializable' }),
    );
  });
  it('rejects a transaction with the opposite sign', async () => {
    mockClient.ledgerEntry.findFirst.mockResolvedValue({
      ...entry,
      debit: amount('0'),
      credit: amount('100'),
    });
    await expect(
      service.matchStatementLine('Surgicom', finance, 'rec-1', {
        lineId: 'line-1',
        ledgerEntryId: 'entry-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockClient.bankStatementLine.update).not.toHaveBeenCalled();
  });
  it('uses the Manila statement date at the midnight boundary', async () => {
    mockClient.ledgerEntry.findFirst.mockResolvedValue({
      ...entry,
      journal: { ...entry.journal, date: new Date('2026-10-10T23:30:00Z') },
    });
    await expect(
      service.matchStatementLine('Surgicom', finance, 'rec-1', {
        lineId: 'line-1',
        ledgerEntryId: 'entry-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockClient.bankStatementLine.update).not.toHaveBeenCalled();
  });
  it('rejects a missing or foreign-workspace reconciliation', async () => {
    mockClient.bankReconciliation.findFirst.mockResolvedValue(null);
    await expect(
      service.matchStatementLine('Surgicom', finance, 'foreign', {
        lineId: 'line-1',
        ledgerEntryId: 'entry-1',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mockClient.bankReconciliation.findFirst).toHaveBeenCalledWith(
      containing({
        where: { id: 'foreign', company: 'Surgicom' },
      }),
    );
  });
  it('prevents one ledger transaction from being matched twice', async () => {
    mockClient.ledgerEntry.findFirst.mockResolvedValue({
      ...entry,
      statementLine: { id: 'other-line' },
    });
    await expect(
      service.matchStatementLine('Surgicom', finance, 'rec-1', {
        lineId: 'line-1',
        ledgerEntryId: 'entry-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mockClient.bankStatementLine.update).not.toHaveBeenCalled();
  });
  it('does not permit a matched statement line to be overwritten', async () => {
    mockClient.bankReconciliation.findFirst.mockResolvedValue({
      ...reconciliation,
      lines: [{ ...line, ledgerEntryId: 'old-entry' }],
    });
    await expect(
      service.matchStatementLine('Surgicom', finance, 'rec-1', {
        lineId: 'line-1',
        ledgerEntryId: 'entry-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('prevents modification after reconciliation completion', async () => {
    mockClient.bankReconciliation.findFirst.mockResolvedValue({
      ...reconciliation,
      status: 'COMPLETED',
    });
    await expect(
      service.matchStatementLine('Surgicom', finance, 'rec-1', {
        lineId: 'line-1',
        ledgerEntryId: 'entry-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockClient.bankStatementLine.update).not.toHaveBeenCalled();
  });
  it('requires every line to be matched before completing', async () => {
    mockClient.bankReconciliation.findFirst.mockResolvedValue({
      ...reconciliation,
      lines: [{ ...line, ledgerEntry: null }],
    });
    await expect(
      service.completeReconciliation('Surgicom', finance, 'rec-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockClient.bankReconciliation.update).not.toHaveBeenCalled();
  });
  it('completes and audits only a zero-difference statement and ledger', async () => {
    mockClient.bankReconciliation.findFirst.mockResolvedValue({
      ...reconciliation,
      lines: [{ ...line, ledgerEntryId: entry.id, ledgerEntry: entry }],
    });
    await expect(
      service.completeReconciliation('Surgicom', finance, 'rec-1'),
    ).resolves.toMatchObject({ status: 'COMPLETED' });
    expect(mockClient.ledgerEntry.aggregate).toHaveBeenCalledWith(
      containing({
        where: {
          accountId: bank.id,
          account: { company: 'Surgicom' },
          journal: {
            company: 'Surgicom',
            status: 'POSTED',
            date: { lt: new Date('2026-10-10T16:00:00Z') },
          },
        },
      }),
    );
    expect(mockClient.erpAuditLog.create).toHaveBeenCalledWith(
      containing({
        data: containing({
          action: 'COMPLETE',
          details: containing({ difference: '0.00' }),
        }),
      }),
    );
  });
  it('rejects an otherwise matched statement when the ledger balance differs by one cent', async () => {
    mockClient.bankReconciliation.findFirst.mockResolvedValue({
      ...reconciliation,
      lines: [{ ...line, ledgerEntryId: entry.id, ledgerEntry: entry }],
    });
    mockClient.ledgerEntry.aggregate.mockResolvedValue({
      _sum: { debit: amount('100.01'), credit: amount('0') },
    });
    await expect(
      service.completeReconciliation('Surgicom', finance, 'rec-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockClient.bankReconciliation.update).not.toHaveBeenCalled();
  });
  it('enforces Finance approval limits when completing reconciliation', async () => {
    mockClient.bankReconciliation.findFirst.mockResolvedValue({
      ...reconciliation,
      lines: [{ ...line, ledgerEntryId: entry.id, ledgerEntry: entry }],
    });
    await expect(
      service.completeReconciliation(
        'Surgicom',
        {
          ...finance,
          modules: {
            erpRoles: ['Finance'],
            books: true,
            approvalLimits: { Surgicom: '99.99' },
          },
        },
        'rec-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockClient.bankReconciliation.update).not.toHaveBeenCalled();
  });
  it('does not bypass an approval limit when large statement movements net to zero', async () => {
    const deposit = {
      ...entry,
      id: 'deposit',
      debit: amount('600'),
      credit: amount('0'),
    };
    const withdrawal = {
      ...entry,
      id: 'withdrawal',
      debit: amount('0'),
      credit: amount('600'),
    };
    mockClient.bankReconciliation.findFirst.mockResolvedValue({
      ...reconciliation,
      closingBalance: amount('0'),
      lines: [
        {
          ...line,
          id: 'deposit-line',
          amount: amount('600'),
          ledgerEntry: deposit,
        },
        {
          ...line,
          id: 'withdrawal-line',
          amount: amount('-600'),
          ledgerEntry: withdrawal,
        },
      ],
    });
    mockClient.ledgerEntry.aggregate.mockResolvedValue({
      _sum: { debit: amount('600'), credit: amount('600') },
    });
    await expect(
      service.completeReconciliation('Surgicom', finance, 'rec-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockClient.bankReconciliation.update).not.toHaveBeenCalled();
  });
  it('rejects unbalanced statements before any database write', async () => {
    await expect(
      service.createReconciliation('Surgicom', finance, {
        accountId: bank.id,
        statementDate: '2026-10-10',
        openingBalance: '0',
        closingBalance: '100.01',
        lines: [
          {
            date: '2026-10-09',
            reference: 'BANK-1',
            description: 'Deposit',
            amount: '100',
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockClient.$transaction).not.toHaveBeenCalled();
  });
  it('validates mapping sources in the same workspace instead of trusting their IDs', async () => {
    mockClient.product.findFirst.mockResolvedValue(null);
    await expect(
      service.setMapping('Surgicom', finance, {
        kind: 'ITEM',
        sourceId: '9',
        accountId: bank.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mockClient.product.findFirst).toHaveBeenCalledWith({
      where: { id: 9, company: 'Surgicom' },
      select: { id: true },
    });
    expect(mockClient.accountingMapping.upsert).not.toHaveBeenCalled();
  });
  it('rejects invalid audit page sizes and cross-workspace cursors', async () => {
    await expect(
      service.auditLog('Surgicom', undefined, '101'),
    ).rejects.toBeInstanceOf(BadRequestException);
    mockClient.erpAuditLog.findFirst.mockResolvedValue(null);
    await expect(
      service.auditLog('Surgicom', 'other-company-cursor', '20'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockClient.erpAuditLog.findMany).not.toHaveBeenCalled();
  });
  it('paginates unmatched ledger history with account and workspace scope instead of restricting it to recent journals', async () => {
    const entries = [
      { ...entry, id: 'old-entry-1' },
      { ...entry, id: 'old-entry-2' },
      { ...entry, id: 'old-entry-3' },
    ];
    mockClient.ledgerEntry.findMany.mockResolvedValue(entries);
    await expect(
      service.unmatchedEntries('Surgicom', bank.id, undefined, '2'),
    ).resolves.toMatchObject({
      entries: entries.slice(0, 2),
      nextCursor: 'old-entry-2',
    });
    expect(mockClient.ledgerEntry.findMany).toHaveBeenCalledWith(
      containing({
        where: {
          accountId: bank.id,
          account: { company: 'Surgicom' },
          journal: { company: 'Surgicom', status: 'POSTED' },
          statementLine: null,
        },
        take: 3,
      }),
    );
  });
  it('does not allow ledger candidates from a foreign account or oversized result pages', async () => {
    await expect(
      service.unmatchedEntries('Surgicom', bank.id, undefined, '101'),
    ).rejects.toBeInstanceOf(BadRequestException);
    mockClient.ledgerAccount.findFirst.mockResolvedValue(null);
    await expect(
      service.unmatchedEntries('Surgicom', 'foreign-account'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mockClient.ledgerEntry.findMany).not.toHaveBeenCalled();
  });
});
