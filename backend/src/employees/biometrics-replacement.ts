import { toAttendanceDateYMD } from './attendance-calculator';
import {
  biometricTime,
  MAX_BIOMETRIC_SESSIONS,
  planBiometricImport,
} from './biometrics-import';
import type {
  BiometricImportPlan,
  BiometricNormalization,
  BiometricSession,
} from './biometrics-import';

export type BiometricExistingAttendance = {
  id: number;
  employeeId: number;
  date: string;
  timeIn: string;
  timeOut: string;
  hours?: number;
  reason?: string | null;
  shiftStart?: string | null;
  shiftEnd?: string | null;
  lunchStart?: string | null;
  lunchEnd?: string | null;
  breakOut?: string | null;
  breakIn?: string | null;
  lunchOverrideMinutes?: number | null;
};

export type BiometricReplacementDay = {
  employeeId: number;
  personnelId: string;
  date: string;
  status: 'replace' | 'unchanged' | 'blocked';
  before: BiometricExistingAttendance[];
  incoming: BiometricSession[];
  keepIds: number[];
  removeIds: number[];
};

export type BiometricReplacementPlan = Omit<BiometricImportPlan, 'summary'> & {
  replacementDays: BiometricReplacementDay[];
  summary: BiometricImportPlan['summary'] & {
    replacementDays: number;
    replacedSessions: number;
    removedSessions: number;
  };
};

const hasBreakException = (row: BiometricExistingAttendance) =>
  !!row.breakOut?.trim() ||
  !!row.breakIn?.trim() ||
  (row.lunchOverrideMinutes !== undefined && row.lunchOverrideMinutes !== null);

const normalizedPunch = (value: string) =>
  biometricTime(value)?.time ?? value.trim().toUpperCase();

const punchKey = (row: { timeIn: string; timeOut: string }) =>
  JSON.stringify([normalizedPunch(row.timeIn), normalizedPunch(row.timeOut)]);

const interval = (row: { date: string; timeIn: string; timeOut: string }) => {
  const date = toAttendanceDateYMD(row.date);
  if (!date) return null;
  const start = Date.parse(`${date}T00:00:00Z`) / 60000;
  const from = biometricTime(row.timeIn),
    to = biometricTime(row.timeOut);
  if (!from || !to) return null;
  return {
    start: start + Math.floor(from.secondsOfDay / 60),
    end:
      start +
      Math.floor(to.secondsOfDay / 60) +
      (to.secondsOfDay < from.secondsOfDay ? 1440 : 0),
  };
};

/** Plan replacement only for valid employee/date groups actually in the file. */
export function planBiometricReplacement(
  normalized: BiometricNormalization,
  employees: readonly { id: number; employeeId?: string | null }[],
  existing: readonly BiometricExistingAttendance[],
  range: { startDate: string; endDate: string },
): BiometricReplacementPlan {
  // Build source sessions independently of saved conflicts; replacement resolves
  // same-day changes while the safeguards below protect leave and other days.
  const base = planBiometricImport(normalized, employees, [], range);
  const issues = base.issues.slice();
  const grouped = new Map<string, BiometricSession[]>();
  for (const row of base.sessions) {
    const key = `${row.employeeId}:${row.date}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  const block = (
    day: BiometricReplacementDay,
    code: string,
    message: string,
  ) => {
    day.status = 'blocked';
    day.removeIds = [];
    for (const row of day.incoming) row.status = 'conflict';
    issues.push({
      code,
      message,
      rowNumbers: day.incoming.flatMap((row) => row.rowNumbers),
      personnelId: day.personnelId,
      date: day.date,
    });
  };
  const replacementDays: BiometricReplacementDay[] = [];
  for (const incoming of grouped.values()) {
    const first = incoming[0];
    const before = existing
      .filter(
        (row) =>
          row.employeeId === first.employeeId &&
          toAttendanceDateYMD(row.date) === first.date,
      )
      .map((row) => ({ ...row }))
      .sort((a, b) => a.id - b.id);
    const day: BiometricReplacementDay = {
      employeeId: first.employeeId,
      personnelId: first.personnelId,
      date: first.date,
      status: 'replace',
      before,
      incoming,
      keepIds: [],
      removeIds: [],
    };
    replacementDays.push(day);
    if (
      before.some(
        (row) =>
          normalizedPunch(row.timeIn) === 'LEAVE' ||
          ['PAID', 'UNPAID'].includes(normalizedPunch(row.timeOut)),
      )
    ) {
      block(
        day,
        'existing-leave-conflict',
        'This date contains saved leave. Review it manually before replacing attendance.',
      );
      continue;
    }
    // Prefer preserving an existing explicit break exception when duplicate
    // saved copies have identical punches. Never discard a protected extra.
    const candidates = before
      .slice()
      .sort(
        (a, b) =>
          Number(hasBreakException(b)) - Number(hasBreakException(a)) ||
          a.id - b.id,
      );
    for (const row of incoming) {
      const match = candidates.find(
        (saved) =>
          !day.keepIds.includes(saved.id) && punchKey(saved) === punchKey(row),
      );
      row.status = match ? 'duplicate' : 'new';
      if (match) day.keepIds.push(match.id);
    }
    day.keepIds.sort((a, b) => a - b);
    const removed = before.filter((row) => !day.keepIds.includes(row.id));
    if (removed.some(hasBreakException)) {
      block(
        day,
        'protected-break-exception',
        'A changed or extra saved session has an explicit break exception. Review that session manually; the import will not remove or transfer its exception.',
      );
      continue;
    }
    day.removeIds = removed.map((row) => row.id);
    if (
      !day.removeIds.length &&
      incoming.every((row) => row.status === 'duplicate')
    )
      day.status = 'unchanged';
  }
  // A neighboring overnight row may be removed by another valid replacement.
  // If that day is blocked, its rows remain and can block dependent days too.
  let changed = true;
  while (changed) {
    changed = false;
    const removedIds = new Set(
      replacementDays
        .filter((day) => day.status === 'replace')
        .flatMap((day) => day.removeIds),
    );
    const retained = existing.filter((row) => !removedIds.has(row.id));
    for (const day of replacementDays.filter(
      (row) => row.status === 'replace',
    )) {
      const conflict = day.incoming.some((row) => {
        const dateStart = Date.parse(`${row.date}T00:00:00Z`) / 60000;
        const from = biometricTime(row.timeIn),
          to = biometricTime(row.timeOut);
        const incomingSpan = interval(row) ?? {
          start: dateStart + (from ? Math.floor(from.secondsOfDay / 60) : 0),
          end: dateStart + (to ? Math.floor(to.secondsOfDay / 60) : 1440),
        };
        return retained.some((saved) => {
          if (
            saved.employeeId !== day.employeeId ||
            toAttendanceDateYMD(saved.date) === day.date
          )
            return false;
          const span = interval(saved);
          return (
            !!span &&
            incomingSpan.start < span.end &&
            incomingSpan.end > span.start
          );
        });
      });
      if (conflict) {
        block(
          day,
          'neighboring-session-conflict',
          'A saved session from another date overlaps these punches. Review the neighboring date; it will not be overwritten by this import.',
        );
        changed = true;
      }
    }
  }
  const removedSessions = replacementDays
    .filter((day) => day.status === 'replace')
    .reduce((sum, day) => sum + day.removeIds.length, 0);
  if (removedSessions > MAX_BIOMETRIC_SESSIONS)
    throw new RangeError(
      `Replace at most ${MAX_BIOMETRIC_SESSIONS} saved attendance rows per import. Split the file by date.`,
    );
  const sessions = base.sessions;
  const replacedSessions = replacementDays
    .filter((day) => day.status === 'replace' && day.before.length > 0)
    .reduce(
      (sum, day) =>
        sum + day.incoming.filter((row) => row.status === 'new').length,
      0,
    );
  return {
    sessions,
    issues,
    replacementDays,
    summary: {
      ...base.summary,
      newSessions:
        sessions.filter((row) => row.status === 'new').length -
        replacedSessions,
      duplicateSessions: sessions.filter((row) => row.status === 'duplicate')
        .length,
      conflictSessions: sessions.filter((row) => row.status === 'conflict')
        .length,
      replacementDays: replacementDays.filter(
        (day) => day.status === 'replace' && day.before.length > 0,
      ).length,
      replacedSessions,
      removedSessions,
    },
  };
}
