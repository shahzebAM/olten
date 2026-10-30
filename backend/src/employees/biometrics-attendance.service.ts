import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import {
  APP_ATTENDANCE_POLICY,
  calculateAttendanceMetrics,
  toAttendanceDateYMD,
} from './attendance-calculator';
import {
  biometricDate,
  normalizeBiometricPunches,
  planBiometricImport,
} from './biometrics-import';
import { planBiometricReplacement } from './biometrics-replacement';
import type { BiometricReplacementPlan } from './biometrics-replacement';

export type BiometricImportActor = { id: number; username: string };
type ReplacementResult = {
  mode: 'replace';
  dryRun: boolean;
  plan: BiometricReplacementPlan;
  imported: number;
  replacedDays: number;
  removed: number;
  previewFingerprint: string;
  replayed?: boolean;
};
const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const jsonValue = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

async function importReplacement(
  tx: Prisma.TransactionClient,
  input: Record<string, unknown>,
  normalized: ReturnType<typeof normalizeBiometricPunches>,
  company: string,
  range: { startDate: string; endDate: string },
  actor?: BiometricImportActor,
): Promise<ReplacementResult> {
  const employees = await tx.employee.findMany({
    where: { company },
    select: { id: true, employeeId: true },
    orderBy: { id: 'asc' },
  });
  if (!input.dryRun)
    await tx.$executeRaw`SELECT a."id" FROM "Attendance" a JOIN "Employee" e ON e."id" = a."employeeId" WHERE e."company" = ${company} ORDER BY a."id" FOR UPDATE OF a`;
  const existing = await tx.attendance.findMany({
    where: { employee: { company } },
    orderBy: { id: 'asc' },
  });
  const settings =
    (await tx.settings.findUnique({ where: { company } })) ??
    (await tx.settings.findUnique({ where: { company: 'Global' } }));
  const shift = {
    shiftStart: settings?.shiftStart ?? '08:00',
    shiftEnd: settings?.shiftEnd ?? '17:00',
    lunchStart: settings?.lunchStart ?? '12:00',
    lunchEnd: settings?.lunchEnd ?? '13:00',
  };
  let plan: ReturnType<typeof planBiometricReplacement>;
  try {
    plan = planBiometricReplacement(normalized, employees, existing, range);
  } catch (error) {
    throw new BadRequestException(
      error instanceof Error ? error.message : 'Invalid replacement import.',
    );
  }
  const scope = plan.replacementDays.map((day) => ({
    employeeId: day.employeeId,
    date: day.date,
  }));
  const scopeKeys = new Set(
    scope.map((day) => `${day.employeeId}:${day.date}`),
  );
  const stateInScope = (rows: typeof existing) =>
    rows
      .filter((row) =>
        scopeKeys.has(`${row.employeeId}:${toAttendanceDateYMD(row.date)}`),
      )
      .sort((a, b) => a.id - b.id);
  const sourceHash = digest({
    mode: 'replace',
    company,
    ...range,
    normalized,
  });
  const previewFingerprint = digest({
    sourceHash,
    shift,
    plan,
    // Full source rows detect reason, schedule and break edits as well as punches.
    before: stateInScope(existing),
  });
  if (input.dryRun)
    return {
      mode: 'replace',
      dryRun: true,
      plan,
      imported: 0,
      replacedDays: 0,
      removed: 0,
      previewFingerprint,
    };

  const receipt = await tx.erpAuditLog.findFirst({
    where: {
      company,
      action: 'BIOMETRIC_ATTENDANCE_IMPORT',
      entityType: 'BiometricImport',
      entityId: String(input.submissionKey),
    },
  });
  if (receipt) {
    const details = receipt.details as {
      sourceHash?: string;
      afterStateHash?: string;
      scope?: typeof scope;
      result?: ReplacementResult;
    };
    if (
      receipt.actorId !== actor!.id ||
      details.sourceHash !== sourceHash ||
      !Array.isArray(details.scope) ||
      // JSONB can reorder object keys; compare scope values rather than key order.
      digest(details.scope.map((day) => [day.employeeId, day.date])) !==
        digest(scope.map((day) => [day.employeeId, day.date])) ||
      details.afterStateHash !== digest(stateInScope(existing)) ||
      !details.result
    )
      throw new ConflictException(
        'This import was already used or attendance changed afterward. Preview again before importing.',
      );
    return { ...details.result, replayed: true };
  }
  if (input.previewFingerprint !== previewFingerprint)
    throw new ConflictException(
      'Attendance, employee IDs or shift settings changed. Preview the file again before overwriting.',
    );

  const changedDays = plan.replacementDays.filter(
    (day) => day.status === 'replace',
  );
  const removeIds = changedDays.flatMap((day) => day.removeIds);
  const removed = removeIds.length
    ? (
        await tx.attendance.deleteMany({
          where: { id: { in: removeIds }, employee: { company } },
        })
      ).count
    : 0;
  if (removed !== removeIds.length)
    throw new ConflictException(
      'Attendance changed during replacement. Preview again.',
    );
  const data = changedDays.flatMap((day) =>
    day.incoming
      .filter((row) => row.status === 'new')
      .map((row) => ({
        employeeId: row.employeeId,
        date: row.date,
        timeIn: row.timeIn,
        timeOut: row.timeOut,
        ...shift,
        reason: null,
        hours: calculateAttendanceMetrics({
          ...APP_ATTENDANCE_POLICY,
          ...shift,
          timeIn: row.timeIn,
          timeOut: row.timeOut,
        }).total,
      })),
  );
  const imported = data.length
    ? (await tx.attendance.createMany({ data })).count
    : 0;
  if (imported !== data.length)
    throw new ConflictException('The complete replacement could not be saved.');
  const after = await tx.attendance.findMany({
    where: { employee: { company } },
    orderBy: { id: 'asc' },
  });
  const result: ReplacementResult = {
    mode: 'replace',
    dryRun: false,
    plan,
    imported,
    replacedDays: plan.summary.replacementDays,
    removed,
    previewFingerprint,
  };
  await tx.erpAuditLog.create({
    data: {
      company,
      actorId: actor!.id,
      actor: actor!.username,
      action: 'BIOMETRIC_ATTENDANCE_IMPORT',
      entityType: 'BiometricImport',
      entityId: String(input.submissionKey),
      details: jsonValue({
        sourceHash,
        previewFingerprint,
        scope,
        before: stateInScope(existing),
        after: stateInScope(after),
        afterStateHash: digest(stateInScope(after)),
        result,
      }),
    },
  });
  return result;
}

export async function importBiometricAttendance(
  db: PrismaClient,
  input: Record<string, unknown>,
  actor?: BiometricImportActor,
) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (key) =>
        ![
          'company',
          'rows',
          'startDate',
          'endDate',
          'dryRun',
          'previewFingerprint',
          'mode',
          'submissionKey',
        ].includes(key),
    ) ||
    typeof input.company !== 'string' ||
    !input.company.trim() ||
    typeof input.dryRun !== 'boolean' ||
    !Array.isArray(input.rows) ||
    !input.rows.length
  ) {
    throw new BadRequestException(
      'Supply punch rows, company, date range and a preview/import action.',
    );
  }
  const company = input.company.trim();
  const mode = input.mode ?? 'append';
  if (mode !== 'append' && mode !== 'replace')
    throw new BadRequestException('Choose append or replace import mode.');
  if (
    mode === 'replace' &&
    !input.dryRun &&
    (!actor ||
      !Number.isSafeInteger(actor.id) ||
      actor.id < 1 ||
      !actor.username ||
      typeof input.submissionKey !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        input.submissionKey,
      ))
  )
    throw new BadRequestException(
      'Preview replacement with a valid submission key and signed-in user.',
    );
  const startDate = biometricDate(input.startDate),
    endDate = biometricDate(input.endDate);
  if (!startDate || !endDate || startDate > endDate)
    throw new BadRequestException('Select a valid import date range.');
  if (
    !input.dryRun &&
    (typeof input.previewFingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(input.previewFingerprint))
  ) {
    throw new BadRequestException('Preview this file before importing.');
  }
  let normalized: ReturnType<typeof normalizeBiometricPunches>;
  try {
    normalized = normalizeBiometricPunches(input.rows);
  } catch (error) {
    throw new BadRequestException(
      error instanceof Error ? error.message : 'Invalid punch rows.',
    );
  }
  return db.$transaction(
    async (tx) => {
      // Import retries serialize within their company and always re-read saved rows.
      if (!input.dryRun)
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`biometrics:${company}`}))`;
      if (!input.dryRun)
        await tx.$executeRaw`SELECT "id" FROM "Employee" WHERE "company" = ${company} ORDER BY "id" FOR UPDATE`;
      if (mode === 'replace')
        return importReplacement(
          tx,
          input,
          normalized,
          company,
          { startDate, endDate },
          actor,
        );
      const employees = await tx.employee.findMany({
        where: { company },
        select: { id: true, employeeId: true },
      });
      const existing = await tx.attendance.findMany({
        where: { employee: { company } },
        select: { employeeId: true, date: true, timeIn: true, timeOut: true },
      });
      let plan: ReturnType<typeof planBiometricImport>;
      try {
        plan = planBiometricImport(normalized, employees, existing, {
          startDate,
          endDate,
        });
      } catch (error) {
        throw new BadRequestException(
          error instanceof Error ? error.message : 'Invalid import.',
        );
      }
      const previewFingerprint = createHash('sha256')
        .update(
          JSON.stringify({
            company,
            startDate,
            endDate,
            plan: {
              ...plan,
              sessions: plan.sessions.map((row) => ({
                ...row,
                status: row.status === 'duplicate' ? 'new' : row.status,
              })),
              summary: {
                ...plan.summary,
                newSessions: 0,
                duplicateSessions: 0,
              },
            },
          }),
        )
        .digest('hex');
      if (input.dryRun)
        return { dryRun: true, plan, imported: 0, previewFingerprint };
      // Exact sessions becoming duplicates do not invalidate the preview. This
      // makes a lost successful reply retryable; mapping/conflict changes do not.
      if (input.previewFingerprint !== previewFingerprint) {
        throw new ConflictException(
          'Attendance or employee IDs changed. Preview the file again before importing.',
        );
      }
      const settings =
        (await tx.settings.findUnique({ where: { company } })) ??
        (await tx.settings.findUnique({ where: { company: 'Global' } }));
      const shift = {
        shiftStart: settings?.shiftStart ?? '08:00',
        shiftEnd: settings?.shiftEnd ?? '17:00',
        lunchStart: settings?.lunchStart ?? '12:00',
        lunchEnd: settings?.lunchEnd ?? '13:00',
      };
      const data = plan.sessions
        .filter((row) => row.status === 'new')
        .map((row) => ({
          employeeId: row.employeeId,
          date: row.date,
          timeIn: row.timeIn,
          timeOut: row.timeOut,
          ...shift,
          reason: null,
          hours: calculateAttendanceMetrics({
            ...APP_ATTENDANCE_POLICY,
            ...shift,
            timeIn: row.timeIn,
            timeOut: row.timeOut,
          }).total,
        }));
      const imported = data.length
        ? (await tx.attendance.createMany({ data })).count
        : 0;
      return { dryRun: false, plan, imported, previewFingerprint };
    },
    { maxWait: 15000, timeout: 30000 },
  );
}
