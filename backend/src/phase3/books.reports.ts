import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { parseIsoDate } from '../documentation/expiry-date.utils';
import { cashFlowReport } from './cash-flow';
import { postingControlCodes } from './posting-accounts';

export type ReportQuery = {
  from?: string;
  to?: string;
  asOf?: string;
  accountId?: string;
  page?: string;
  limit?: string;
  export?: string;
};
const Exact = Prisma.Decimal.clone({ precision: 50 });
const D = (value: Prisma.Decimal.Value = 0) => new Exact(value);
const DAY = 86400000;
const OFFSET = 8 * 3600000;

export function reportPeriod(query: ReportQuery) {
  const from = parseIsoDate(query.from ?? query.asOf);
  const to = parseIsoDate(query.to ?? query.asOf);
  if (!from || !to || to < from || from.getUTCFullYear() < 1)
    throw new BadRequestException(
      'Select valid inclusive report dates (from must not exceed to).',
    );
  return {
    from: new Date(from.getTime() - OFFSET),
    end: new Date(to.getTime() + DAY - OFFSET),
    fromDay: from.toISOString().slice(0, 10),
    toDay: to.toISOString().slice(0, 10),
  };
}

/** Approved RPT-1: complete posted-ledger aggregates, never the limited overview. */
export async function financialReport(
  db: PrismaClient,
  company: string,
  kind: string,
  query: ReportQuery,
) {
  if (
    ![
      'trial-balance',
      'profit-loss',
      'balance-sheet',
      'general-ledger',
      'financial-overview',
      'cash-flow',
    ].includes(kind)
  )
    throw new NotFoundException('Financial report not found.');
  const period = reportPeriod(query);
  const page = Number(query.page ?? 1),
    limit = Number(query.limit ?? 50);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 200 ||
    !Number.isSafeInteger((page - 1) * limit)
  )
    throw new BadRequestException('Invalid report pagination.');
  return db.$transaction(
    async (tx) => {
      const where = (date: Prisma.DateTimeFilter) => ({
        account: { company },
        journal: { company, status: 'POSTED', date },
      });
      const [accounts, opening, movement] = await Promise.all([
        tx.ledgerAccount.findMany({
          where: { company },
          orderBy: [{ code: 'asc' }, { id: 'asc' }],
        }),
        tx.ledgerEntry.groupBy({
          by: ['accountId'],
          where: where({ lt: period.from }),
          _sum: { debit: true, credit: true },
        }),
        tx.ledgerEntry.groupBy({
          by: ['accountId'],
          where: where({ gte: period.from, lt: period.end }),
          _sum: { debit: true, credit: true },
        }),
      ]);
      const before = new Map(
        opening.map((row) => [
          row.accountId,
          D(row._sum.debit ?? 0).minus(row._sum.credit ?? 0),
        ]),
      );
      const changes = new Map(movement.map((row) => [row.accountId, row._sum]));
      const rows = accounts.map((account) => {
        const start = before.get(account.id) ?? D(),
          debit = D(changes.get(account.id)?.debit ?? 0),
          credit = D(changes.get(account.id)?.credit ?? 0);
        const end = start.add(debit).minus(credit);
        return {
          accountId: account.id,
          code: account.code,
          name: account.name,
          type: account.type,
          active: account.active,
          openingDebit: Prisma.Decimal.max(start, 0).toFixed(2),
          openingCredit: Prisma.Decimal.max(start.neg(), 0).toFixed(2),
          debit: debit.toFixed(2),
          credit: credit.toFixed(2),
          closingDebit: Prisma.Decimal.max(end, 0).toFixed(2),
          closingCredit: Prisma.Decimal.max(end.neg(), 0).toFixed(2),
          openingBalance: start.toFixed(2),
          closingBalance: end.toFixed(2),
        };
      });
      const total = (
        column:
          | 'debit'
          | 'credit'
          | 'openingDebit'
          | 'openingCredit'
          | 'closingDebit'
          | 'closingCredit',
      ) => rows.reduce((sum, row) => sum.add(row[column]), D()).toFixed(2);
      const amount = (type: string, periodOnly = false) =>
        rows
          .filter((row) => row.type === type)
          .reduce(
            (sum, row) =>
              sum.add(
                periodOnly
                  ? D(row.debit).minus(row.credit)
                  : row.closingBalance,
              ),
            D(),
          );
      const revenue = amount('REVENUE', true).neg(),
        expenses = amount('EXPENSE', true),
        profit = revenue.minus(expenses);
      const assets = amount('ASSET'),
        liabilities = amount('LIABILITY').neg(),
        recordedEquity = amount('EQUITY').neg();
      const earnings = amount('REVENUE').neg().minus(amount('EXPENSE'));
      const meta = {
        kind,
        company,
        currency: 'PHP',
        timeZone: 'Asia/Manila',
        from: period.fromDay,
        to: period.toDay,
        generatedAt: new Date().toISOString(),
        complete: true,
        basis:
          'Posted journal date; archived accounts included; full ledger totals',
        note: 'Ledger-only management report. Missing opening entries and manually posted closing entries affect results. No automatic opening/closing journals, legacy balances or payroll are added.',
      };
      const allAccounts = accounts.map(({ id, code, name, active, type }) => ({
        id,
        code,
        name,
        active,
        type,
      }));
      if (kind === 'cash-flow')
        return {
          ...meta,
          ...(await cashFlowReport(tx, company, period.from, period.end)),
          accounts: allAccounts,
          note: `${meta.note} Cash uses currently designated accounts. Unclassified entries or unmatched internal transfers mean this cash-flow classification is incomplete.`,
        };
      if (kind === 'general-ledger') {
        const account = accounts.find((row) => row.id === query.accountId);
        if (!account)
          throw new NotFoundException('Select an account in this workspace.');
        const filter = {
          ...where({ gte: period.from, lt: period.end }),
          accountId: account.id,
        };
        const [entries, count] = await Promise.all([
          tx.ledgerEntry.findMany({
            where: filter,
            include: { journal: true },
            orderBy: [
              { journal: { date: 'asc' } },
              { journalId: 'asc' },
              { id: 'asc' },
            ],
            ...(query.export === 'true'
              ? {}
              : { skip: (page - 1) * limit, take: limit }),
          }),
          tx.ledgerEntry.count({ where: filter }),
        ]);
        let running = before.get(account.id) ?? D();
        if (query.export !== 'true' && page > 1 && entries.length) {
          const first = entries[0];
          const prior = await tx.ledgerEntry.aggregate({
            where: {
              ...filter,
              OR: [
                { journal: { date: { lt: first.journal.date } } },
                {
                  journal: { date: first.journal.date },
                  journalId: { lt: first.journalId },
                },
                { journalId: first.journalId, id: { lt: first.id } },
              ],
            },
            _sum: { debit: true, credit: true },
          });
          running = running
            .add(prior._sum.debit ?? 0)
            .minus(prior._sum.credit ?? 0);
        }
        const accountTotals = rows.find((row) => row.accountId === account.id)!;
        return {
          ...meta,
          accounts: allAccounts,
          account: allAccounts.find((row) => row.id === account.id),
          rows: entries.map((entry) => {
            running = running.add(entry.debit).minus(entry.credit);
            return {
              date: new Date(entry.journal.date.getTime() + OFFSET)
                .toISOString()
                .slice(0, 10),
              number: entry.journal.number,
              memo: entry.journal.memo,
              debit: entry.debit.toFixed(2),
              credit: entry.credit.toFixed(2),
              balance: running.toFixed(2),
              journalId: entry.journalId,
              entryId: entry.id,
            };
          }),
          totals: accountTotals,
          pagination: {
            page: query.export === 'true' ? 1 : page,
            limit: query.export === 'true' ? count : limit,
            count,
            pages:
              query.export === 'true'
                ? 1
                : Math.max(1, Math.ceil(count / limit)),
          },
        };
      }
      if (kind === 'profit-loss')
        return {
          ...meta,
          accounts: allAccounts,
          rows: rows
            .filter((row) => ['REVENUE', 'EXPENSE'].includes(row.type))
            .map((row) => ({
              ...row,
              amount: (row.type === 'REVENUE'
                ? D(row.credit).minus(row.debit)
                : D(row.debit).minus(row.credit)
              ).toFixed(2),
            })),
          totals: {
            revenue: revenue.toFixed(2),
            expenses: expenses.toFixed(2),
            profit: profit.toFixed(2),
          },
        };
      if (kind === 'balance-sheet')
        return {
          ...meta,
          accounts: allAccounts,
          asOf: period.toDay,
          rows: [
            ...rows
              .filter((row) =>
                ['ASSET', 'LIABILITY', 'EQUITY'].includes(row.type),
              )
              .map((row) => ({
                ...row,
                amount: (row.type === 'ASSET'
                  ? D(row.closingBalance)
                  : D(row.closingBalance).neg()
                ).toFixed(2),
              })),
            {
              code: '',
              name: 'Unclosed ledger earnings',
              type: 'EQUITY',
              amount: earnings.toFixed(2),
            },
          ],
          totals: {
            assets: assets.toFixed(2),
            liabilities: liabilities.toFixed(2),
            recordedEquity: recordedEquity.toFixed(2),
            unclosedEarnings: earnings.toFixed(2),
            equity: recordedEquity.add(earnings).toFixed(2),
            difference: assets
              .minus(liabilities)
              .minus(recordedEquity)
              .minus(earnings)
              .toFixed(2),
          },
        };
      if (kind === 'trial-balance')
        return {
          ...meta,
          accounts: allAccounts,
          rows,
          totals: {
            openingDebit: total('openingDebit'),
            openingCredit: total('openingCredit'),
            debit: total('debit'),
            credit: total('credit'),
            closingDebit: total('closingDebit'),
            closingCredit: total('closingCredit'),
            difference: D(total('closingDebit'))
              .minus(total('closingCredit'))
              .toFixed(2),
          },
        };
      const months = await tx.$queryRaw<
        { month: string; revenue: Prisma.Decimal; expenses: Prisma.Decimal }[]
      >`
      SELECT to_char(j."date" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Manila', 'YYYY-MM') AS month,
        COALESCE(SUM(CASE WHEN a.type = 'REVENUE' THEN e.credit - e.debit ELSE 0 END),0) AS revenue,
        COALESCE(SUM(CASE WHEN a.type = 'EXPENSE' THEN e.debit - e.credit ELSE 0 END),0) AS expenses
      FROM "LedgerEntry" e JOIN "AccountingJournal" j ON j.id = e."journalId" JOIN "LedgerAccount" a ON a.id = e."accountId"
      WHERE j.company = ${company} AND a.company = ${company} AND j.status = 'POSTED'
        AND j."date" >= (${period.from}::timestamptz AT TIME ZONE 'UTC')
        AND j."date" < (${period.end}::timestamptz AT TIME ZONE 'UTC')
      GROUP BY month ORDER BY month`;
      const series: {
        month: string;
        revenue: string;
        expenses: string;
        profit: string;
      }[] = [];
      const month = new Date(`${period.fromDay.slice(0, 7)}-01T00:00:00Z`);
      const monthCount =
        (Number(period.toDay.slice(0, 4)) -
          Number(period.fromDay.slice(0, 4))) *
          12 +
        Number(period.toDay.slice(5, 7)) -
        Number(period.fromDay.slice(5, 7)) +
        1;
      for (let index = 0; index < monthCount; index++) {
        const key = month.toISOString().slice(0, 7),
          actual = months.find((row) => row.month === key);
        const r = D(actual?.revenue ?? 0),
          e = D(actual?.expenses ?? 0);
        series.push({
          month: key,
          revenue: r.toFixed(2),
          expenses: e.toFixed(2),
          profit: r.minus(e).toFixed(2),
        });
        month.setUTCMonth(month.getUTCMonth() + 1);
      }
      const cash = await cashFlowReport(tx, company, period.from, period.end);
      const controls = await postingControlCodes(tx, company);
      const control = (code: string) => {
        const codes = new Set(controls[code]);
        return rows
          .filter((row) => codes.has(row.code))
          .reduce((sum, row) => sum.add(row.closingBalance), D())
          .toFixed(2);
      };
      return {
        ...meta,
        accounts: allAccounts,
        rows: series,
        totals: {
          revenue: revenue.toFixed(2),
          expenses: expenses.toFixed(2),
          profit: profit.toFixed(2),
          cash: cash.configured ? cash.totals.closing : null,
          receivables: control('1300'),
          payables: D(control('2100')).neg().toFixed(2),
          inventory: control('1200'),
        },
        controlAccountScope:
          'Cash uses currently designated cash/bank accounts. AR, AP and Inventory include standard, configured and frozen historical posting-role accounts. Subsidiary balances and reference inventory values remain separate.',
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 30000,
    },
  );
}
