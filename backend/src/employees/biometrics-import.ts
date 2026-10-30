import { toAttendanceDateYMD } from './attendance-calculator';

export const MAX_BIOMETRIC_PUNCHES = 10000;
export const MAX_BIOMETRIC_SESSIONS = 2000;

export type RawBiometricPunch = {
  personnelId: unknown;
  date: unknown;
  time: unknown;
  direction: unknown;
  rowNumber?: number;
};
export type BiometricIssue = {
  code: string;
  message: string;
  rowNumbers: number[];
  personnelId?: string;
  date?: string;
};
export type BiometricPunch = {
  personnelId: string;
  date: string;
  time: string;
  secondsOfDay: number;
  direction: 'IN' | 'OUT';
  rowNumber: number;
};
export type BiometricBlankPunch = Pick<
  BiometricPunch,
  'personnelId' | 'date' | 'direction' | 'rowNumber'
>;
export type BiometricNormalization = {
  punches: BiometricPunch[];
  blankPunches: BiometricBlankPunch[];
  issues: BiometricIssue[];
  duplicatePunches: number;
};
export type BiometricSession = {
  personnelId: string;
  employeeId: number;
  date: string;
  timeIn: string;
  timeOut: string;
  rowNumbers: number[];
  complete: boolean;
  status: 'new' | 'duplicate' | 'conflict';
};
export type BiometricImportPlan = {
  sessions: BiometricSession[];
  issues: BiometricIssue[];
  summary: {
    punchCount: number;
    matchedPunches: number;
    unmatchedPunches: number;
    outsideRangePunches: number;
    invalidPunches: number;
    blockedPunches: number;
    employeeCount: number;
    sessionCount: number;
    newSessions: number;
    duplicateSessions: number;
    conflictSessions: number;
    incompleteSessions: number;
    duplicatePunches: number;
  };
};
type ImportEmployee = { id: number; employeeId?: string | null };
type ExistingSession = {
  employeeId: number | string;
  date: string | Date;
  timeIn: string;
  timeOut: string;
};

export function biometricDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  let match: readonly string[] | null = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) {
    const us = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(text);
    if (!us) return null;
    match = [us[0], us[3], us[1].padStart(2, '0'), us[2].padStart(2, '0')];
  }
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number(match[1]) >= 1900 &&
    Number(match[1]) <= 9998 &&
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date
    ? date
    : null;
}

export function biometricTime(
  value: unknown,
): { time: string; secondsOfDay: number } | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(
    value.trim(),
  );
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]),
    second = Number(match[3] ?? 0);
  if (
    minute > 59 ||
    second > 59 ||
    (match[4] ? hour < 1 || hour > 12 : hour > 23)
  )
    return null;
  if (match[4]) hour = (hour % 12) + (match[4].toUpperCase() === 'PM' ? 12 : 0);
  return {
    time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    secondsOfDay: hour * 3600 + minute * 60 + second,
  };
}

function personnelId(value: unknown): string | null {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0))
    return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  return text &&
    text.length <= 100 &&
    !Array.from(text).some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
    ? text.toUpperCase()
    : null;
}
const numericKey = (text: string) =>
  /^\d+$/.test(text) ? text.replace(/^0+(?=\d)/, '') : null;

export function normalizeBiometricPunches(
  rows: readonly unknown[],
): BiometricNormalization {
  if (!Array.isArray(rows) || rows.length > MAX_BIOMETRIC_PUNCHES)
    throw new RangeError(
      `Use at most ${MAX_BIOMETRIC_PUNCHES} punch rows per import.`,
    );
  const result: BiometricNormalization = {
    punches: [],
    blankPunches: [],
    issues: [],
    duplicatePunches: 0,
  };
  const seen = new Set<string>();
  rows.forEach((raw, index) => {
    const row =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    const rowNumber =
      Number.isSafeInteger(row.rowNumber) && Number(row.rowNumber) > 0
        ? Number(row.rowNumber)
        : index + 2;
    const id = personnelId(row.personnelId),
      date = biometricDate(row.date),
      time = biometricTime(row.time);
    const direction =
      typeof row.direction === 'string'
        ? row.direction.trim().toUpperCase()
        : '';
    const missingTime =
      row.time === null ||
      row.time === undefined ||
      (typeof row.time === 'string' && row.time.trim() === '');
    if (
      !id ||
      !date ||
      (!time && !missingTime) ||
      !['IN', 'OUT'].includes(direction)
    ) {
      result.issues.push({
        code: 'invalid-punch',
        message:
          'A personnel ID, valid date, time and IN/OUT marker are required.',
        rowNumbers: [rowNumber],
        ...(id ? { personnelId: id } : {}),
        ...(date ? { date } : {}),
      });
      return;
    }
    // A missing punch is distinct from the real clock value 00:00.
    const key = JSON.stringify([
      id,
      date,
      time?.secondsOfDay ?? null,
      direction,
    ]);
    if (seen.has(key)) {
      result.duplicatePunches++;
      return;
    }
    seen.add(key);
    if (missingTime) {
      result.blankPunches.push({
        personnelId: id,
        date,
        direction: direction as 'IN' | 'OUT',
        rowNumber,
      });
    } else if (time) {
      result.punches.push({
        personnelId: id,
        date,
        ...time,
        direction: direction as 'IN' | 'OUT',
        rowNumber,
      });
    }
  });
  return result;
}

export function planBiometricImport(
  input: BiometricNormalization,
  employees: readonly ImportEmployee[],
  existing: readonly ExistingSession[],
  range: { startDate: string; endDate: string },
): BiometricImportPlan {
  const start = biometricDate(range.startDate),
    end = biometricDate(range.endDate);
  if (!start || !end || start > end)
    throw new RangeError('Select a valid import date range.');
  const issues = input.issues.slice();
  const summary: BiometricImportPlan['summary'] = {
    punchCount: input.punches.length + input.blankPunches.length,
    matchedPunches: 0,
    unmatchedPunches: 0,
    outsideRangePunches: 0,
    invalidPunches: input.issues.filter(
      (issue) => issue.code === 'invalid-punch',
    ).length,
    blockedPunches: 0,
    employeeCount: 0,
    sessionCount: 0,
    newSessions: 0,
    duplicateSessions: 0,
    conflictSessions: 0,
    incompleteSessions: 0,
    duplicatePunches: input.duplicatePunches,
  };
  const exact = new Map<string, ImportEmployee[]>(),
    numeric = new Map<string, ImportEmployee[]>();
  for (const employee of employees) {
    const id = personnelId(employee.employeeId);
    if (!id) continue;
    exact.set(id, [...(exact.get(id) ?? []), employee]);
    const key = numericKey(id);
    if (key !== null) numeric.set(key, [...(numeric.get(key) ?? []), employee]);
  }
  const groups = new Map<
    string,
    {
      employeeId: number;
      punches: BiometricPunch[];
      blankPunches: BiometricBlankPunch[];
    }
  >();
  const sourceKey = (id: string, date: string) =>
    JSON.stringify([numericKey(id) ?? id, date]);
  const blockedDates = new Set(
    input.issues
      .filter(
        (issue) =>
          issue.code === 'invalid-punch' && issue.personnelId && issue.date,
      )
      .map((issue) => sourceKey(issue.personnelId!, issue.date!)),
  );
  const sourcePunches = [
    ...input.punches.map((punch) => ({ kind: 'timed' as const, punch })),
    ...input.blankPunches.map((punch) => ({ kind: 'blank' as const, punch })),
  ];
  for (const entry of sourcePunches) {
    const { punch } = entry;
    if (punch.date < start || punch.date > end) {
      summary.outsideRangePunches++;
      continue;
    }
    if (blockedDates.has(sourceKey(punch.personnelId, punch.date))) {
      summary.blockedPunches++;
      issues.push({
        code: 'invalid-day',
        message:
          'This employee/date has an invalid punch row. Correct that row before importing its sessions.',
        rowNumbers: [punch.rowNumber],
        personnelId: punch.personnelId,
        date: punch.date,
      });
      continue;
    }
    const key = numericKey(punch.personnelId);
    const candidates =
      key === null
        ? (exact.get(punch.personnelId) ?? [])
        : (numeric.get(key) ?? []);
    if (candidates.length !== 1) {
      summary.unmatchedPunches++;
      issues.push({
        code: candidates.length ? 'ambiguous-id' : 'unmatched-id',
        message: candidates.length
          ? 'This personnel ID matches more than one employee. Correct the directory IDs before importing.'
          : 'Personnel ID was not found in this company. Employee names and departments are not used for matching.',
        rowNumbers: [punch.rowNumber],
        personnelId: punch.personnelId,
        date: punch.date,
      });
      continue;
    }
    summary.matchedPunches++;
    const employeeId = candidates[0].id,
      groupKey = `${employeeId}:${punch.date}`;
    const group = groups.get(groupKey) ?? {
      employeeId,
      punches: [],
      blankPunches: [],
    };
    if (entry.kind === 'timed') group.punches.push(entry.punch);
    else group.blankPunches.push(entry.punch);
    groups.set(groupKey, group);
  }
  const sessions: BiometricSession[] = [];
  const append = (
    employeeId: number,
    inputPunch?: Pick<
      BiometricPunch,
      'personnelId' | 'date' | 'time' | 'rowNumber'
    >,
    outputPunch?: Pick<
      BiometricPunch,
      'personnelId' | 'date' | 'time' | 'rowNumber'
    >,
    blankRowNumbers?: number[],
  ) => {
    const source = inputPunch ?? outputPunch!;
    const session: BiometricSession = {
      personnelId: source.personnelId,
      employeeId,
      date: source.date,
      timeIn: inputPunch?.time ?? '',
      timeOut: outputPunch?.time ?? '',
      rowNumbers:
        blankRowNumbers ??
        [inputPunch?.rowNumber, outputPunch?.rowNumber].filter(
          (row): row is number => row !== undefined,
        ),
      complete: !!inputPunch?.time && !!outputPunch?.time,
      status: 'new',
    };
    sessions.push(session);
    if (sessions.length > MAX_BIOMETRIC_SESSIONS)
      throw new RangeError(
        `Use at most ${MAX_BIOMETRIC_SESSIONS} sessions per import. Split the file by date.`,
      );
    if (!session.complete)
      issues.push({
        code: 'incomplete-session',
        message:
          'Missing IN or OUT stays blank and contributes no paid hours until completed.',
        rowNumbers: session.rowNumbers,
        personnelId: source.personnelId,
        date: source.date,
      });
  };
  for (const group of groups.values()) {
    if (!group.punches.length) {
      // The export can explicitly include IN and OUT rows with empty clocks.
      // Represent that date once without inventing a midnight punch/session.
      append(
        group.employeeId,
        { ...group.blankPunches[0], time: '' },
        undefined,
        group.blankPunches.map((punch) => punch.rowNumber),
      );
      continue;
    }
    let pending: BiometricPunch | undefined;
    const seen = new Set<string>();
    for (const punch of group.punches
      .slice()
      .sort(
        (a, b) => a.secondsOfDay - b.secondsOfDay || a.rowNumber - b.rowNumber,
      )) {
      const key = `${punch.secondsOfDay}:${punch.direction}`;
      if (seen.has(key)) {
        summary.duplicatePunches++;
        continue;
      }
      seen.add(key);
      if (punch.direction === 'IN') {
        if (pending) append(group.employeeId, pending);
        pending = punch;
      } else {
        append(group.employeeId, pending, punch);
        pending = undefined;
      }
    }
    if (pending) append(group.employeeId, pending);
  }
  const sessionKey = (
    row: Pick<BiometricSession, 'employeeId' | 'date' | 'timeIn' | 'timeOut'>,
  ) => JSON.stringify([row.employeeId, row.date, row.timeIn, row.timeOut]);
  const normalizedExisting = existing.map((row) => ({
    employeeId: Number(row.employeeId),
    date: toAttendanceDateYMD(row.date),
    timeIn: biometricTime(row.timeIn)?.time ?? row.timeIn.trim().toUpperCase(),
    timeOut:
      biometricTime(row.timeOut)?.time ?? row.timeOut.trim().toUpperCase(),
  }));
  const exactSaved = new Set(normalizedExisting.map(sessionKey));
  const unique = new Map<string, BiometricSession>();
  for (const session of sessions) {
    const key = sessionKey(session);
    const prior = unique.get(key);
    if (prior) {
      prior.rowNumbers.push(...session.rowNumbers);
      summary.duplicatePunches++;
      continue;
    }
    unique.set(key, session);
    if (exactSaved.has(key)) {
      session.status = 'duplicate';
      continue;
    }
    const dayStart = Date.parse(`${session.date}T00:00:00Z`) / 60000;
    const interval = (row: (typeof normalizedExisting)[number]) => {
      const from = biometricTime(row.timeIn),
        to = biometricTime(row.timeOut);
      if (!from || !to) return null;
      const dateStart = Date.parse(`${row.date}T00:00:00Z`) / 60000;
      return [
        dateStart + Math.floor(from.secondsOfDay / 60),
        dateStart +
          Math.floor(to.secondsOfDay / 60) +
          (to.secondsOfDay < from.secondsOfDay ? 1440 : 0),
      ];
    };
    const first = biometricTime(session.timeIn),
      last = biometricTime(session.timeOut);
    const from = dayStart + (first ? Math.floor(first.secondsOfDay / 60) : 0),
      to = dayStart + (last ? Math.floor(last.secondsOfDay / 60) : 1440);
    const conflict = normalizedExisting.some((saved) => {
      if (saved.employeeId !== session.employeeId) return false;
      const span = interval(saved);
      if (!span) return saved.date === session.date;
      if (!session.complete && saved.date === session.date) return true;
      return from < span[1] && to > span[0];
    });
    if (conflict) {
      session.status = 'conflict';
      issues.push({
        code: 'existing-session-conflict',
        message:
          'Existing attendance overlaps or needs review. Its saved punches will not be overwritten.',
        rowNumbers: session.rowNumbers,
        personnelId: session.personnelId,
        date: session.date,
      });
    }
  }
  const result = [...unique.values()].sort(
    (a, b) =>
      a.employeeId - b.employeeId ||
      a.date.localeCompare(b.date) ||
      (a.timeIn || a.timeOut).localeCompare(b.timeIn || b.timeOut),
  );
  summary.employeeCount = new Set(result.map((row) => row.employeeId)).size;
  summary.sessionCount = result.length;
  summary.newSessions = result.filter((row) => row.status === 'new').length;
  summary.duplicateSessions = result.filter(
    (row) => row.status === 'duplicate',
  ).length;
  summary.conflictSessions = result.filter(
    (row) => row.status === 'conflict',
  ).length;
  summary.incompleteSessions = result.filter((row) => !row.complete).length;
  return { sessions: result, issues, summary };
}
