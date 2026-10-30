import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import {
  APP_ATTENDANCE_POLICY,
  calculateAttendanceMetrics,
} from './attendance-calculator';
import {
  biometricDate,
  normalizeBiometricPunches,
  planBiometricImport,
} from './biometrics-import';

export async function importBiometricAttendance(
  db: PrismaClient,
  input: Record<string, unknown>,
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
