import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as v from '../importation/importation.validation';
import {
  assertApproval,
  audit,
  money,
  type Actor,
  type Tx,
} from './phase3.shared';

const Exact = Prisma.Decimal.clone({ precision: 50 });
const D = (value: Prisma.Decimal.Value = 0) => new Exact(value);
const categories = ['operating', 'investing', 'financing', 'transfer'] as const;
function version(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new BadRequestException('A valid previous version is required.');
  return Number(value);
}

export async function cashAccounts(tx: Tx, company: string) {
  const [accounts, settings] = await Promise.all([
    tx.ledgerAccount.findMany({ where: { company }, orderBy: { code: 'asc' } }),
    tx.cashAccountSetting.findMany({
      where: { company },
      distinct: ['accountId'],
      orderBy: [{ accountId: 'asc' }, { version: 'desc' }],
    }),
  ]);
  const states = accounts.map((account) => {
    const latest = settings.find((row) => row.accountId === account.id);
    return {
      id: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      active: account.active,
      cash: latest?.active ?? account.code === '1000',
      version: latest?.version ?? 0,
    };
  });
  if (states.some((account) => account.cash && account.type !== 'ASSET'))
    throw new ConflictException(
      'A configured cash/bank account is not an asset account. Finance must review its designation.',
    );
  return states;
}

export async function designateCashAccount(
  tx: Tx,
  company: string,
  actor: Actor,
  body: unknown,
) {
  const input = v.object(body),
    accountId = v.text(input.accountId, 'Account', true, 200)!;
  const expected = version(input.expectedVersion);
  if (typeof input.active !== 'boolean')
    throw new BadRequestException(
      'Choose whether this is a cash/bank account.',
    );
  await tx.$queryRaw`SELECT id FROM "LedgerAccount" WHERE id=${accountId} AND company=${company} FOR UPDATE`;
  const account = await tx.ledgerAccount.findFirst({
    where: { id: accountId, company },
  });
  if (!account)
    throw new NotFoundException('Account not found in this workspace.');
  if (input.active && (account.type !== 'ASSET' || !account.active))
    throw new BadRequestException(
      'Only an active asset account can be designated as cash/bank.',
    );
  const latest = await tx.cashAccountSetting.findFirst({
    where: { company, accountId },
    orderBy: { version: 'desc' },
  });
  if (latest?.version === expected + 1 && latest.active === input.active)
    return latest;
  if ((latest?.version ?? 0) !== expected)
    throw new ConflictException(
      'Cash account settings changed. Refresh before saving.',
    );
  if (latest?.active === input.active) return latest;
  const record = await tx.cashAccountSetting.create({
    data: {
      company,
      accountId,
      version: expected + 1,
      active: input.active,
      actor: actor.username,
    },
  });
  await audit(
    tx,
    company,
    actor,
    'DESIGNATE_CASH_ACCOUNT',
    'CashAccountSetting',
    record.id,
    { accountId, active: input.active, previousVersion: expected },
  );
  return record;
}

export async function classifyCashEntry(
  tx: Tx,
  company: string,
  actor: Actor,
  body: unknown,
) {
  const input = v.object(body),
    ledgerEntryId = v.text(input.ledgerEntryId, 'Cash entry', true, 200)!;
  const expected = version(input.expectedVersion),
    reason = v.text(input.reason, 'Classification reason')!;
  await tx.$queryRaw`SELECT e.id FROM "LedgerEntry" e JOIN "AccountingJournal" j ON j.id=e."journalId" WHERE e.id=${ledgerEntryId} AND j.company=${company} FOR UPDATE OF e`;
  const entry = await tx.ledgerEntry.findFirst({
    where: {
      id: ledgerEntryId,
      account: { company },
      journal: { company, status: 'POSTED' },
    },
  });
  if (!entry)
    throw new NotFoundException(
      'Posted cash entry not found in this workspace.',
    );
  const accounts = await cashAccounts(tx, company);
  if (
    !accounts.some((account) => account.id === entry.accountId && account.cash)
  )
    throw new BadRequestException(
      'This entry is not in a configured cash/bank account.',
    );
  const amount = D(entry.debit).minus(entry.credit);
  const values = Object.fromEntries(
    categories.map((key) => [key, money(input[key] ?? '0', key, true)]),
  ) as Record<(typeof categories)[number], Prisma.Decimal>;
  if (
    categories.some((key) =>
      amount.gt(0) ? values[key].lt(0) : values[key].gt(0),
    ) ||
    !categories.reduce((sum, key) => sum.add(values[key]), D()).eq(amount)
  )
    throw new BadRequestException(
      'Classifications must have the entry sign and exactly equal its posted amount.',
    );
  assertApproval(actor, company, new Prisma.Decimal(amount.abs().toFixed(2)));
  const latest = await tx.cashFlowClassification.findFirst({
    where: { company, ledgerEntryId },
    orderBy: { version: 'desc' },
  });
  if (
    latest?.version === expected + 1 &&
    latest.reason === reason &&
    categories.every((key) => latest[key].eq(values[key]))
  )
    return latest;
  if ((latest?.version ?? 0) !== expected)
    throw new ConflictException(
      'This classification changed. Refresh before saving a new version.',
    );
  const record = await tx.cashFlowClassification.create({
    data: {
      company,
      ledgerEntryId,
      accountId: entry.accountId,
      version: expected + 1,
      ...values,
      reason,
      actor: actor.username,
    },
  });
  await audit(
    tx,
    company,
    actor,
    'CLASSIFY_CASH_FLOW',
    'CashFlowClassification',
    record.id,
    {
      ledgerEntryId,
      previousVersion: expected,
      reason,
      operating: values.operating.toFixed(2),
      investing: values.investing.toFixed(2),
      financing: values.financing.toFixed(2),
      transfer: values.transfer.toFixed(2),
    },
  );
  return record;
}

export async function cashFlowReport(
  tx: Tx,
  company: string,
  from: Date,
  end: Date,
) {
  const accounts = await cashAccounts(tx, company),
    ids = accounts
      .filter((account) => account.cash)
      .map((account) => account.id);
  if (!ids.length)
    return {
      configured: false,
      complete: false,
      rows: [],
      totals: {
        opening: '0.00',
        operating: '0.00',
        investing: '0.00',
        financing: '0.00',
        unclassified: '0.00',
        unmatchedTransfers: '0.00',
        closing: '0.00',
        difference: '0.00',
      },
      unclassifiedCount: 0,
      transferExceptions: [],
    };
  const base = Prisma.sql`FROM "LedgerEntry" e JOIN "AccountingJournal" j ON j.id=e."journalId"
    LEFT JOIN LATERAL (SELECT c.* FROM "CashFlowClassification" c WHERE c."ledgerEntryId"=e.id AND c.company=${company} ORDER BY c.version DESC LIMIT 1) c ON true
    WHERE j.company=${company} AND j.status='POSTED' AND e."accountId" IN (${Prisma.join(ids)})`;
  const within = Prisma.sql`AND j.date>=(${from}::timestamptz AT TIME ZONE 'UTC') AND j.date<(${end}::timestamptz AT TIME ZONE 'UTC')`;
  const [movement, balances, transferExceptions] = await Promise.all([
    tx.$queryRaw<
      {
        operating: Prisma.Decimal;
        investing: Prisma.Decimal;
        financing: Prisma.Decimal;
        transfer: Prisma.Decimal;
        unclassified: Prisma.Decimal;
        count: bigint;
      }[]
    >(
      Prisma.sql`SELECT COALESCE(SUM(c.operating),0) AS operating,COALESCE(SUM(c.investing),0) AS investing,COALESCE(SUM(c.financing),0) AS financing,COALESCE(SUM(c.transfer),0) AS transfer, COALESCE(SUM(CASE WHEN c.id IS NULL THEN e.debit-e.credit ELSE 0 END),0) AS unclassified, COUNT(*) FILTER(WHERE c.id IS NULL) AS count ${base} ${within}`,
    ),
    tx.$queryRaw<{ opening: Prisma.Decimal; closing: Prisma.Decimal }[]>(
      Prisma.sql`SELECT COALESCE(SUM(CASE WHEN j.date<(${from}::timestamptz AT TIME ZONE 'UTC') THEN e.debit-e.credit ELSE 0 END),0) AS opening,COALESCE(SUM(e.debit-e.credit),0) AS closing ${base} AND j.date<(${end}::timestamptz AT TIME ZONE 'UTC')`,
    ),
    tx.$queryRaw<{ journal: string; amount: Prisma.Decimal }[]>(
      Prisma.sql`SELECT j.number AS journal, SUM(c.transfer) AS amount ${base} ${within} GROUP BY j.id,j.number HAVING SUM(c.transfer)<>0 ORDER BY j.number`,
    ),
  ]);
  const change = movement[0],
    balance = balances[0];
  const totals = {
    opening: D(balance.opening).toFixed(2),
    operating: D(change.operating).toFixed(2),
    investing: D(change.investing).toFixed(2),
    financing: D(change.financing).toFixed(2),
    unclassified: D(change.unclassified).toFixed(2),
    unmatchedTransfers: D(change.transfer).toFixed(2),
    closing: D(balance.closing).toFixed(2),
    difference: D(balance.closing)
      .minus(balance.opening)
      .minus(change.operating)
      .minus(change.investing)
      .minus(change.financing)
      .minus(change.unclassified)
      .minus(change.transfer)
      .toFixed(2),
  };
  const labels = {
    opening: 'Opening cash',
    operating: 'Operating cash flow',
    investing: 'Investing cash flow',
    financing: 'Financing cash flow',
    unclassified: 'Unclassified movements',
    unmatchedTransfers: 'Unmatched transfer movements',
    closing: 'Closing cash',
    difference: 'Reconciliation difference',
  };
  return {
    configured: true,
    complete: Number(change.count) === 0 && transferExceptions.length === 0,
    totals,
    rows: Object.entries(totals).map(([code, amount]) => ({
      code,
      name: labels[code as keyof typeof labels],
      type: 'CASH_FLOW',
      amount,
    })),
    unclassifiedCount: Number(change.count),
    transferExceptions: transferExceptions.map((row) => ({
      journal: row.journal,
      amount: row.amount.toFixed(2),
    })),
  };
}
