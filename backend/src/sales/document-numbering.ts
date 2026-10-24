import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';

export type DocumentKind = 'OS' | 'FO' | 'PO' | 'QT' | 'PL';
type NumberClient = Pick<
  Prisma.TransactionClient,
  'orderSlip' | 'purchaseOrder' | 'quotation' | 'packingList'
>;

const fields = {
  OS: 'osNumber',
  FO: 'osNumber',
  PO: 'poNumber',
  QT: 'qtNumber',
  PL: 'plNumber',
} as const;

async function readNumbers(
  client: NumberClient,
  kind: DocumentKind,
  company?: string,
  prefix?: string,
): Promise<string[]> {
  const orderBy = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];
  const scope = company ? { company } : {};
  switch (kind) {
    case 'OS':
    case 'FO':
      return (
        await client.orderSlip.findMany({
          where: {
            ...scope,
            ...(prefix ? { osNumber: { startsWith: prefix } } : {}),
          },
          select: { osNumber: true },
          ...(company ? { orderBy } : {}),
        })
      ).map((row) => row.osNumber);
    case 'PO':
      return (
        await client.purchaseOrder.findMany({
          where: {
            ...scope,
            ...(prefix ? { poNumber: { startsWith: prefix } } : {}),
          },
          select: { poNumber: true },
          ...(company ? { orderBy } : {}),
        })
      ).map((row) => row.poNumber);
    case 'QT':
      return (
        await client.quotation.findMany({
          where: {
            ...scope,
            ...(prefix ? { qtNumber: { startsWith: prefix } } : {}),
          },
          select: { qtNumber: true },
          ...(company ? { orderBy } : {}),
        })
      ).map((row) => row.qtNumber);
    case 'PL':
      return (
        await client.packingList.findMany({
          where: {
            ...scope,
            ...(prefix ? { plNumber: { startsWith: prefix } } : {}),
          },
          select: { plNumber: true },
          ...(company ? { orderBy } : {}),
        })
      ).map((row) => row.plNumber);
  }
}

// Read-only suggestions are not reservations. Creation calls this again while
// holding the table's transaction lock, including globally unique cross-company numbers.
export async function nextDocumentNumber(
  client: NumberClient,
  kind: DocumentKind,
  company: string,
  requested?: unknown,
): Promise<string> {
  if (!company?.trim() || !Object.hasOwn(fields, kind))
    throw new BadRequestException(
      'A valid company and document type are required.',
    );
  if (requested !== undefined && typeof requested !== 'string')
    throw new BadRequestException('The document number must be text.');
  let seed = typeof requested === 'string' ? requested.trim() : '';
  if (!seed) {
    const history = await readNumbers(
      client,
      kind,
      company,
      kind === 'PO' ? undefined : kind,
    );
    const parsed = history
      .map((number) => number.trim().match(/^(.*?)(\d+)$/))
      .filter((match) => match !== null);
    // P.O.s continue the latest manually chosen seed, even when it is lower.
    // Other documents keep their existing highest-suffix progression.
    const latest =
      kind === 'PO'
        ? parsed[0]
        : parsed.reduce<(typeof parsed)[number] | undefined>(
            (highest, match) =>
              !highest || BigInt(match[2]) > BigInt(highest[2])
                ? match
                : highest,
            undefined,
          );
    seed = latest
      ? `${latest[1]}${String(BigInt(latest[2]) + 1n).padStart(latest[2].length, '0')}`
      : `${kind}-000001`;
  }
  const match = seed.match(/^(.*?)(\d+)$/);
  const used = new Set(
    await readNumbers(client, kind, undefined, match?.[1] || undefined),
  );
  if (!match) {
    if (used.has(seed))
      throw new ConflictException(
        'This document number is already in use. Enter a number ending in digits to increment automatically.',
      );
    return seed;
  }
  let suffix = BigInt(match[2]);
  let number = seed;
  while (used.has(number)) {
    number = `${match[1]}${String(++suffix).padStart(match[2].length, '0')}`;
  }
  return number;
}

export async function createNumberedDocument<T>(
  prisma: PrismaClient,
  kind: DocumentKind,
  company: string,
  requested: unknown,
  work: (tx: Prisma.TransactionClient, number: string) => Promise<T>,
): Promise<T> {
  return numberedDocumentTransaction(prisma, kind, async (tx) => {
    const number = await nextDocumentNumber(tx, kind, company, requested);
    return work(tx, number);
  });
}

export async function numberedDocumentTransaction<T>(
  prisma: PrismaClient,
  kind: DocumentKind,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (!Object.hasOwn(fields, kind))
    throw new BadRequestException('Select a valid document type.');
  const attempts = 12;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // OS/FO share a unique column. PL shares their lock too because both
          // outbound paths create deliveries and touch the same reservations.
          const lock = `sales-document-number:${kind === 'PL' ? fields.FO : fields[kind]}`;
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lock}))`;
          return work(tx);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5000,
          timeout: 20000,
        },
      );
    } catch (error: unknown) {
      const failure = error as {
        code?: string;
        meta?: { target?: string | string[]; code?: string };
      };
      const target = failure?.meta?.target;
      const numberCollision =
        failure?.code === 'P2002' &&
        (target === undefined ||
          (Array.isArray(target) ? target : [target]).some((name) =>
            name.includes(fields[kind]),
          ));
      const retryable =
        failure?.code === 'P2034' ||
        numberCollision ||
        (failure?.code === 'P2010' &&
          ['40001', '40P01'].includes(failure.meta?.code ?? ''));
      if (!retryable) throw error;
      if (attempt === attempts - 1)
        throw new ConflictException(
          'Document numbering is busy. Please try saving again.',
        );
      // A fresh serializable snapshot is required after waiting on another save.
      await new Promise((resolve) =>
        setTimeout(resolve, 20 + Math.floor(Math.random() * 80)),
      );
    }
  }
  throw new ConflictException('Could not assign a document number.');
}
