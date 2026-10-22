import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { LedgerAccount } from '@prisma/client';
import type { SessionAdmin } from '../auth/auth-session.service';

export type Actor = Omit<SessionAdmin, 'password'>;
export type Tx = Prisma.TransactionClient;
export type Phase3Scope =
  'landed' | 'finance' | 'books' | 'service' | 'executive' | 'ai';
export const ERP_ROLES = [
  'Management',
  'Purchasing',
  'Importation',
  'Warehouse',
  'QC/Regulatory',
  'Sales',
  'Delivery',
  'Finance',
  'Auditor',
  'AI',
] as const;

function permissions(actor: Actor): Record<string, unknown> {
  return actor.modules &&
    typeof actor.modules === 'object' &&
    !Array.isArray(actor.modules)
    ? (actor.modules as Record<string, unknown>)
    : {};
}

export function erpRoles(actor: Actor): string[] {
  const values = permissions(actor).erpRoles;
  return Array.isArray(values)
    ? [
        ...new Set(
          values.filter(
            (role): role is string =>
              typeof role === 'string' &&
              (ERP_ROLES as readonly string[]).includes(role),
          ),
        ),
      ]
    : [];
}

export function hasAccess(
  actor: Actor,
  scope: Phase3Scope,
  write = false,
): boolean {
  if (actor.role === 'Super Admin') return true;
  const modules = permissions(actor);
  const roles = erpRoles(actor);
  if (write && roles.includes('Auditor')) return false;
  const allowed: Record<Phase3Scope, readonly string[]> = {
    landed: [
      'Management',
      'Finance',
      'Purchasing',
      'Importation',
      ...(write ? [] : ['Auditor']),
    ],
    finance: ['Management', 'Finance', ...(write ? [] : ['Sales', 'Auditor'])],
    books: ['Management', 'Finance', ...(write ? [] : ['Auditor'])],
    service: [
      'Management',
      'Warehouse',
      'QC/Regulatory',
      'Delivery',
      ...(write ? [] : ['Sales', 'Auditor']),
    ],
    executive: write ? [] : ERP_ROLES,
    ai: write
      ? []
      : ['Management', 'AI', 'Auditor', 'Purchasing', 'Importation', 'Finance'],
  };
  const enabled =
    scope === 'landed'
      ? ['finance', 'purchasing', 'importation'].some(
          (key) => modules[key] === true,
        )
      : modules[scope === 'ai' ? 'ai_assistant' : scope] === true;
  return enabled && roles.some((role) => allowed[scope].includes(role));
}

/** Reject implicit rounding and non-decimal input before it reaches financial storage. */
export function money(
  value: unknown,
  field: string,
  signed = false,
): Prisma.Decimal {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'number' && !Number.isFinite(value)) ||
    (typeof value === 'number' && Math.abs(value) > Number.MAX_SAFE_INTEGER) ||
    !/^-?\d{1,16}(?:\.\d{1,2})?$/.test(String(value))
  ) {
    throw new BadRequestException(
      `${field} must be an exact amount with at most two decimal places.`,
    );
  }
  const result = new Prisma.Decimal(String(value));
  if (
    (!signed && result.isNegative()) ||
    result.abs().gte('10000000000000000')
  ) {
    throw new BadRequestException(
      `${field} is outside the allowed amount range.`,
    );
  }
  return result;
}

export function assertApproval(
  actor: Actor,
  company: string,
  amount: Prisma.Decimal,
): void {
  if (!amount.isFinite() || amount.isNegative())
    throw new BadRequestException('Invalid approval amount.');
  if (actor.role === 'Super Admin') return;
  const roles = erpRoles(actor);
  if (
    roles.includes('Auditor') ||
    !roles.some((role) => role === 'Management' || role === 'Finance')
  ) {
    throw new ForbiddenException('Finance or Management approval is required.');
  }
  const limits = permissions(actor).approvalLimits;
  const configured =
    limits && typeof limits === 'object' && !Array.isArray(limits)
      ? (limits as Record<string, unknown>)[company]
      : undefined;
  if (configured === undefined && roles.includes('Management')) return;
  if (
    typeof configured !== 'string' ||
    !/^\d{1,16}(?:\.\d{1,2})?$/.test(configured)
  ) {
    throw new ForbiddenException(
      'A Finance approval limit must be configured for this workspace.',
    );
  }
  const limit = new Prisma.Decimal(configured);
  if (limit.lte(0) || amount.gt(limit))
    throw new ForbiddenException(
      'This amount exceeds your workspace approval limit.',
    );
}

export async function nextNumber(
  tx: Tx,
  company: string,
  prefix: string,
): Promise<string> {
  if (!company.trim() || !/^[A-Z]{2,8}$/.test(prefix))
    throw new BadRequestException('Invalid document sequence.');
  const year = new Intl.DateTimeFormat('en', {
    year: 'numeric',
    timeZone: 'Asia/Manila',
  }).format(new Date());
  const sequence = await tx.importSequence.upsert({
    // Existing document numbers are globally unique across workspaces.
    where: { key: `phase3:${prefix}:${year}` },
    create: { key: `phase3:${prefix}:${year}`, value: 1 },
    update: { value: { increment: 1 } },
  });
  return `${prefix}-${year}-${String(sequence.value).padStart(6, '0')}`;
}

export async function audit(
  tx: Tx,
  company: string,
  actor: Actor,
  action: string,
  entityType: string,
  entityId: string,
  details: Prisma.InputJsonValue = {},
): Promise<unknown> {
  return tx.erpAuditLog.create({
    data: {
      company,
      actorId: actor.id,
      actor: actor.username,
      action,
      entityType,
      entityId,
      details,
    },
  });
}

export const DEFAULT_ACCOUNTS = [
  ['1000', 'Bank and cash', 'ASSET'],
  ['1200', 'Inventory', 'ASSET'],
  ['1300', 'Accounts receivable', 'ASSET'],
  ['1400', 'Input VAT', 'ASSET'],
  ['2100', 'Accounts payable', 'LIABILITY'],
  ['2200', 'Output VAT', 'LIABILITY'],
  ['2400', 'Accrued landed costs', 'LIABILITY'],
  ['3000', 'Equity', 'EQUITY'],
  ['4000', 'Sales revenue', 'REVENUE'],
  ['5000', 'Import expense', 'EXPENSE'],
  ['5100', 'Cost of goods sold', 'EXPENSE'],
  ['6000', 'Service expense', 'EXPENSE'],
] as const;

export async function initializeAccounts(
  tx: Tx,
  company: string,
  actor: Actor,
) {
  const accounts: LedgerAccount[] = [];
  for (const [code, name, type] of DEFAULT_ACCOUNTS) {
    const existing = await tx.ledgerAccount.findUnique({
      where: { company_code: { company, code } },
    });
    if (existing) {
      if (existing.type !== type)
        throw new ConflictException(
          `System account ${code} must use the ${type} account type before posting.`,
        );
      accounts.push(existing);
      continue;
    }
    const account = await tx.ledgerAccount.create({
      data: { company, code, name, type },
    });
    await audit(tx, company, actor, 'CREATE', 'LedgerAccount', account.id, {
      code,
      name,
      type,
      initialized: true,
    });
    accounts.push(account);
  }
  return accounts;
}

export type JournalInput = {
  sourceKey: string;
  sourceType: string;
  sourceId: string;
  date: Date;
  memo: string;
  /** Trusted source document gross; manual Books input never supplies this. */
  approvalAmount?: string;
  lines: { code: string; debit: string | number; credit: string | number }[];
};

export async function postJournal(
  tx: Tx,
  company: string,
  actor: Actor,
  input: JournalInput,
): Promise<unknown> {
  if (
    !input.sourceKey?.trim() ||
    input.sourceKey.length > 250 ||
    !input.sourceType?.trim() ||
    !input.sourceId?.trim() ||
    !input.memo?.trim() ||
    input.memo.length > 2000 ||
    !(input.date instanceof Date) ||
    !Number.isFinite(input.date.getTime()) ||
    !Array.isArray(input.lines) ||
    input.lines.length < 2 ||
    input.lines.length > 200
  ) {
    throw new BadRequestException(
      'A journal requires a valid source, date, memo, and 2 to 200 entries.',
    );
  }
  const lines = input.lines.map((line) => {
    if (
      typeof line.code !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$/.test(line.code)
    )
      throw new BadRequestException('Invalid ledger account code.');
    const debit = money(line.debit, 'Debit');
    const credit = money(line.credit, 'Credit');
    if (debit.gt(0) === credit.gt(0))
      throw new BadRequestException(
        'Each journal entry must have exactly one positive debit or credit.',
      );
    return { code: line.code, debit, credit };
  });
  const debits = lines.reduce(
    (sum, line) => sum.add(line.debit),
    new Prisma.Decimal(0),
  );
  const credits = lines.reduce(
    (sum, line) => sum.add(line.credit),
    new Prisma.Decimal(0),
  );
  if (!debits.eq(credits) || debits.lte(0))
    throw new BadRequestException(
      'Journal debits and credits must balance exactly.',
    );
  const approvalAmount =
    input.approvalAmount === undefined
      ? debits
      : money(input.approvalAmount, 'Approval amount');
  if (approvalAmount.lte(0))
    throw new BadRequestException('Approval amount must be positive.');
  assertApproval(actor, company, approvalAmount);
  const existing = await tx.accountingJournal.findUnique({
    where: { company_sourceKey: { company, sourceKey: input.sourceKey } },
    include: { entries: { include: { account: true } } },
  });
  if (existing) {
    const signatures = (
      values: { code: string; debit: Prisma.Decimal; credit: Prisma.Decimal }[],
    ) =>
      values
        .map(
          (line) =>
            `${line.code}:${line.debit.toFixed(2)}:${line.credit.toFixed(2)}`,
        )
        .sort()
        .join('|');
    if (
      existing.sourceType !== input.sourceType ||
      existing.sourceId !== input.sourceId ||
      existing.memo !== input.memo ||
      existing.date.getTime() !== input.date.getTime() ||
      existing.status !== 'POSTED' ||
      signatures(
        existing.entries.map((entry) => ({
          ...entry,
          code: entry.account.code,
        })),
      ) !== signatures(lines)
    ) {
      throw new ConflictException(
        'This source has already been posted with different journal data.',
      );
    }
    return existing;
  }
  await initializeAccounts(tx, company, actor);
  const accounts = await tx.ledgerAccount.findMany({
    where: {
      company,
      active: true,
      code: { in: [...new Set(lines.map((line) => line.code))] },
    },
  });
  if (accounts.length !== new Set(lines.map((line) => line.code)).size)
    throw new BadRequestException(
      'Every journal account must be active in this workspace.',
    );
  const accountIds = new Map(
    accounts.map((account) => [account.code, account.id]),
  );
  const journal = await tx.accountingJournal.create({
    data: {
      company,
      number: await nextNumber(tx, company, 'JRN'),
      sourceKey: input.sourceKey,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      date: input.date,
      memo: input.memo,
      postedBy: actor.username,
      entries: {
        create: lines.map((line) => ({
          accountId: accountIds.get(line.code)!,
          debit: line.debit,
          credit: line.credit,
        })),
      },
    },
    include: { entries: { include: { account: true } } },
  });
  await audit(tx, company, actor, 'POST', 'AccountingJournal', journal.id, {
    sourceKey: input.sourceKey,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    total: debits.toFixed(2),
  });
  return journal;
}
