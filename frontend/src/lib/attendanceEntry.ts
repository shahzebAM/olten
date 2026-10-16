import { attendanceSessionKey, parseTimeToMinutes, toAttendanceDateYMD } from '../../../backend/src/employees/attendance-calculator';
import type { AttendanceCalcResult } from '../../../backend/src/employees/attendance-calculator';

export interface AttendanceEntryEmployee {
  id: number;
  employeeId?: string | null;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  company: string;
}

export interface AttendanceEntryRecord {
  id: number;
  employeeId: number;
  date: string;
  timeIn: string;
  timeOut: string;
  hours: number;
  reason?: string | null;
  shiftStart?: string | null;
  shiftEnd?: string | null;
  lunchStart?: string | null;
  lunchEnd?: string | null;
  breakOut?: string | null;
  breakIn?: string | null;
  lunchOverrideMinutes?: number | null;
  metrics?: AttendanceCalcResult;
}

export interface CutoffSelection {
  month: string;
  period: '26-10' | '11-25';
}

export type EntryKind = 'work' | 'paid' | 'unpaid';
export type Punches = { timeIn: string; timeOut: string; reason: string | null };
export type EntryRow = {
  key: string;
  date: string;
  source?: AttendanceEntryRecord;
  kind: EntryKind;
  timeIn: string;
  timeOut: string;
  reason: string;
  error?: string;
  unconfirmed?: Punches;
};

const cutoffMonthDate = (month: string): Date | null => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const date = new Date(`${month}-01T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

export function getInitialCutoff(now: Date = new Date()): CutoffSelection {
  const today = toAttendanceDateYMD(now);
  const selection: CutoffSelection = {
    month: today.slice(0, 7),
    period: Number(today.slice(8, 10)) <= 10 ? '26-10' : '11-25',
  };
  return Number(today.slice(8, 10)) >= 26 ? moveCutoff(selection, 1) : selection;
}

export function getCutoffDates(selection: CutoffSelection): string[] {
  const start = cutoffMonthDate(selection.month);
  if (!start) return [];
  const end = new Date(start);
  if (selection.period === '26-10') {
    start.setUTCMonth(start.getUTCMonth() - 1);
    start.setUTCDate(26);
    end.setUTCDate(10);
  } else {
    start.setUTCDate(11);
    end.setUTCDate(25);
  }
  const dates: string[] = [];
  while (start <= end) {
    dates.push(start.toISOString().slice(0, 10));
    start.setUTCDate(start.getUTCDate() + 1);
  }
  return dates;
}

export function moveCutoff(selection: CutoffSelection, direction: -1 | 1): CutoffSelection {
  const month = cutoffMonthDate(selection.month);
  if (!month) return selection;
  if (selection.period === '26-10' && direction === -1) month.setUTCMonth(month.getUTCMonth() - 1);
  if (selection.period === '11-25' && direction === 1) month.setUTCMonth(month.getUTCMonth() + 1);
  return {
    month: month.toISOString().slice(0, 7),
    period: selection.period === '26-10' ? '11-25' : '26-10',
  };
}

export function normalizeEntryTime(value: string): string | null {
  const minutes = parseTimeToMinutes(value);
  return minutes === null ? null : `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function displayEntryTime(value: string): string {
  const normalized = normalizeEntryTime(value);
  if (normalized === null) return value;
  const hour = Number(normalized.slice(0, 2));
  return `${hour % 12 || 12}:${normalized.slice(3)} ${hour >= 12 ? 'PM' : 'AM'}`;
}

export function entrySessionKey(record: Pick<AttendanceEntryRecord, 'employeeId' | 'date' | 'timeIn' | 'timeOut'>): string {
  return attendanceSessionKey(record);
}

export const sourcePunches = (record: AttendanceEntryRecord): Punches => ({ timeIn: normalizeEntryTime(record.timeIn) ?? record.timeIn, timeOut: normalizeEntryTime(record.timeOut) ?? record.timeOut, reason: record.reason || null });
export const rowPunches = (row: EntryRow): Punches => row.kind === 'work'
  ? { timeIn: normalizeEntryTime(row.timeIn) ?? row.timeIn.trim(), timeOut: normalizeEntryTime(row.timeOut) ?? row.timeOut.trim(), reason: row.reason || null }
  : { timeIn: 'LEAVE', timeOut: row.kind === 'paid' ? 'PAID' : 'UNPAID', reason: row.reason || null };
export const samePunches = (a: Punches, b: Punches) => a.timeIn === b.timeIn && a.timeOut === b.timeOut && a.reason === b.reason;
export const isChanged = (row: EntryRow) => !!row.unconfirmed || (row.source
  ? !samePunches(rowPunches(row), sourcePunches(row.source))
  : row.kind !== 'work' || !!(row.timeIn.trim() || row.timeOut.trim() || row.reason.trim()));
export const fromRecord = (record: AttendanceEntryRecord): EntryRow => ({
  key: `saved-${record.id}`, date: toAttendanceDateYMD(record.date), source: record,
  kind: record.timeIn === 'LEAVE' ? record.timeOut === 'PAID' ? 'paid' : 'unpaid' : 'work',
  timeIn: record.timeIn === 'LEAVE' ? '' : displayEntryTime(record.timeIn),
  timeOut: record.timeIn === 'LEAVE' ? '' : displayEntryTime(record.timeOut), reason: record.reason ?? '',
});
export const sameSource = (a: AttendanceEntryRecord, b: AttendanceEntryRecord) => (
  ['employeeId', 'date', 'timeIn', 'timeOut', 'reason', 'shiftStart', 'shiftEnd', 'lunchStart', 'lunchEnd', 'breakOut', 'breakIn', 'lunchOverrideMinutes'] as const
).every(field => (a[field] ?? null) === (b[field] ?? null));

// Keep every source ID. Only overlay drafts that have not been confirmed saved.
export function mergeRows(records: AttendanceEntryRecord[], dates: string[], employeeId: number, drafts: EntryRow[] = []): EntryRow[] {
  const saved = records.filter(record => record.employeeId === employeeId && dates.includes(toAttendanceDateYMD(record.date)));
  const rows = saved.map(fromRecord);
  for (const draft of drafts.filter(isChanged)) {
    const confirmed = draft.unconfirmed && saved.find(record => (
      !draft.source || record.id === draft.source.id
    ) && entrySessionKey(record) === entrySessionKey({ employeeId, date: draft.date, ...draft.unconfirmed! }) && samePunches(sourcePunches(record), draft.unconfirmed!));
    if (confirmed) continue;
    const index = draft.source ? rows.findIndex(row => row.source?.id === draft.source?.id) : -1;
    if (index >= 0) rows[index] = draft;
    else rows.push(draft);
  }
  return dates.flatMap(date => {
    const sessions = rows.filter(row => row.date === date);
    return sessions.length ? sessions : [{ key: `blank-${date}`, date, kind: 'work' as const, timeIn: '', timeOut: '', reason: '' }];
  });
}
