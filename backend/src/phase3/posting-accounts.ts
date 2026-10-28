import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, type FinanceDocument } from '@prisma/client';
import type { Tx } from './phase3.shared';
import * as v from '../importation/importation.validation';

export const POSTING_ROLES = [
  ['BANK_CASH', '1000', 'ASSET'],
  ['INVENTORY', '1200', 'ASSET'],
  ['AR_CONTROL', '1300', 'ASSET'],
  ['INPUT_VAT', '1400', 'ASSET'],
  ['AP_CONTROL', '2100', 'LIABILITY'],
  ['OUTPUT_VAT', '2200', 'LIABILITY'],
  ['LANDED_ACCRUAL', '2400', 'LIABILITY'],
  ['SALES_REVENUE', '4000', 'REVENUE'],
  ['IMPORT_EXPENSE', '5000', 'EXPENSE'],
  ['COGS', '5100', 'EXPENSE'],
  ['SERVICE_EXPENSE', '6000', 'EXPENSE'],
] as const;
export type PostingAccounts = Record<string, string>;
export type PostingLine = { code: string; debit: string; credit: string };
export const defaultPostingAccounts = (): PostingAccounts =>
  Object.fromEntries(POSTING_ROLES.map(([, code]) => [code, code]));

export async function postingAccounts(
  tx: Tx,
  company: string,
): Promise<PostingAccounts> {
  const result = defaultPostingAccounts();
  const mappings = await tx.accountingMapping.findMany({
    where: { company, kind: 'POSTING_ROLE' },
    include: { account: true },
  });
  for (const mapping of mappings) {
    const role = POSTING_ROLES.find(([name]) => name === mapping.sourceId);
    if (
      !role ||
      !mapping.account.active ||
      mapping.account.company !== company ||
      mapping.account.type !== role[2]
    )
      throw new ConflictException(
        'A posting role has an invalid, archived or incompatible account. Review Books settings before posting.',
      );
    result[role[1]] = mapping.account.code;
  }
  // Control accounts must retain separate balances; expense roles may share an account.
  const controls = POSTING_ROLES.filter(
    ([, , type]) => type === 'ASSET' || type === 'LIABILITY',
  ).map(([, code]) => result[code]);
  if (new Set(controls).size !== controls.length)
    throw new BadRequestException(
      'Cash, inventory, receivable, payable, VAT and accrual controls require distinct accounts.',
    );
  return result;
}

export function mappedLines(
  lines: PostingLine[],
  accounts: PostingAccounts,
): PostingLine[] {
  return lines.map((line) => ({
    ...line,
    code: accounts[line.code] ?? line.code,
  }));
}

export async function postingControlCodes(tx: Tx, company: string) {
  const configured = await postingAccounts(tx, company);
  const history = await tx.$queryRaw<{ role: string; code: string }[]>`
    SELECT DISTINCT p.key AS role, p.value AS code FROM "FinanceDocument" d
    CROSS JOIN LATERAL jsonb_each_text(CASE WHEN jsonb_typeof(d.data->'postingAccounts')='object' THEN d.data->'postingAccounts' ELSE '{}'::jsonb END) p
    WHERE d.company=${company} AND d.status='POSTED' AND d.kind IN ('INVOICE','BILL') AND p.key IN ('1200','1300','2100')`;
  return Object.fromEntries(
    ['1200', '1300', '2100'].map((code) => [
      code,
      [
        ...new Set([
          code,
          configured[code],
          ...history
            .filter((item) => item.role === code)
            .map((item) => item.code),
        ]),
      ],
    ]),
  ) as Record<string, string[]>;
}

function signature(lines: PostingLine[]) {
  const totals = new Map<
    string,
    { debit: Prisma.Decimal; credit: Prisma.Decimal }
  >();
  for (const line of lines) {
    const current = totals.get(line.code) ?? {
      debit: new Prisma.Decimal(0),
      credit: new Prisma.Decimal(0),
    };
    current.debit = current.debit.add(line.debit);
    current.credit = current.credit.add(line.credit);
    totals.set(line.code, current);
  }
  return [...totals]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([code, value]) =>
        `${code}:${value.debit.toFixed(2)}:${value.credit.toFixed(2)}`,
    )
    .join('|');
}

/** Validate the frozen source against its immutable journal; never guess from today's mapping. */
export async function sourcePostingAccounts(
  tx: Tx,
  company: string,
  document: FinanceDocument,
  standardLines: PostingLine[],
): Promise<PostingAccounts> {
  const stored = v.object(document.data).postingAccounts;
  const accounts =
    stored === undefined ? defaultPostingAccounts() : v.object(stored);
  const frozen: PostingAccounts = {};
  for (const [, code] of POSTING_ROLES)
    frozen[code] = v.text(
      accounts[code],
      'Original posting account',
      true,
      100,
    )!;
  const journal = await tx.accountingJournal.findUnique({
    where: { company_sourceKey: { company, sourceKey: `DOC:${document.id}` } },
    include: { entries: { include: { account: true } } },
  });
  if (
    !journal ||
    journal.status !== 'POSTED' ||
    journal.sourceId !== document.id ||
    journal.sourceType !== document.kind ||
    journal.entries.some((entry) => entry.account.company !== company) ||
    signature(mappedLines(standardLines, frozen)) !==
      signature(
        journal.entries.map((entry) => ({
          code: entry.account.code,
          debit: entry.debit.toFixed(2),
          credit: entry.credit.toFixed(2),
        })),
      )
  )
    throw new ConflictException(
      'The original posted accounts could not be verified. Finance must review this source before settlement or a memo.',
    );
  return frozen;
}
