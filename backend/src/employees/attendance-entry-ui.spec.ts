import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import * as ts from 'typescript';
import * as calculator from './attendance-calculator';
import type * as EntryHelpers from '../../../frontend/src/lib/attendanceEntry';
import type {
  AttendanceEntryRecord,
  CutoffSelection,
  EntryRow,
} from '../../../frontend/src/lib/attendanceEntry';

// Jest runs in CommonJS while the frontend package is ESM. Compile the actual
// pure helper source with the installed TypeScript compiler for this test only.
const helperSource = readFileSync(
  resolve(__dirname, '../../../frontend/src/lib/attendanceEntry.ts'),
  'utf8',
);
const compiledHelper = ts.transpileModule(helperSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const loadEntryHelpers = () => {
  const exports = {} as typeof EntryHelpers;
  runInNewContext(compiledHelper, {
    Date,
    exports,
    require: (specifier: string) => {
      if (specifier === '../../../backend/src/employees/attendance-calculator')
        return calculator;
      throw new Error(`Unexpected attendance helper dependency: ${specifier}`);
    },
  });
  return exports;
};
const {
  displayEntryTime,
  entrySessionKey,
  fromRecord,
  getCutoffDates,
  getInitialCutoff,
  isChanged,
  mergeRows,
  moveCutoff,
  normalizeEntryTime,
  rowPunches,
  samePunches,
  sameSource,
  sourcePunches,
} = loadEntryHelpers();

describe('attendance entry cutoff dates', () => {
  it('includes every day from September 26 through October 10', () => {
    const dates = getCutoffDates({ month: '2026-10', period: '26-10' });
    expect(dates).toHaveLength(15);
    expect(dates[0]).toBe('2026-09-26');
    expect(dates[4]).toBe('2026-09-30');
    expect(dates[5]).toBe('2026-10-01');
    expect(dates[14]).toBe('2026-10-10');
  });

  it('includes the 11th and 25th in the selected month', () => {
    expect(getCutoffDates({ month: '2026-10', period: '11-25' })).toEqual(
      Array.from({ length: 15 }, (_, index) => `2026-10-${index + 11}`),
    );
  });

  it.each([
    ['2024-03', 14, '2024-02-29'],
    ['2026-03', 13, '2026-02-28'],
  ])('handles February for %s', (month, count, lastFebruaryDate) => {
    const dates = getCutoffDates({ month, period: '26-10' });
    expect(dates).toHaveLength(count);
    expect(dates).toContain(lastFebruaryDate);
    expect(dates).not.toContain(`${month.slice(0, 4)}-02-30`);
    expect(dates[dates.length - 1]).toBe(`${month}-10`);
  });

  it('crosses December into January', () => {
    const dates = getCutoffDates({ month: '2027-01', period: '26-10' });
    expect(dates).toHaveLength(16);
    expect(dates[0]).toBe('2026-12-26');
    expect(dates[dates.length - 1]).toBe('2027-01-10');
  });

  it.each(['', '2026-00', '2026-13', '2026-2', 'not-a-month'])(
    'returns no dates for an invalid month %s',
    (month) => expect(getCutoffDates({ month, period: '26-10' })).toEqual([]),
  );

  it('moves through adjacent cutoffs in either direction without mutating the selection', () => {
    const selection: CutoffSelection = { month: '2026-10', period: '26-10' };
    expect(moveCutoff(selection, -1)).toEqual({
      month: '2026-09',
      period: '11-25',
    });
    const next = moveCutoff(selection, 1);
    expect(next).toEqual({ month: '2026-10', period: '11-25' });
    expect(moveCutoff(next, 1)).toEqual({ month: '2026-11', period: '26-10' });
    expect(moveCutoff(next, -1)).toEqual(selection);
    expect(selection).toEqual({ month: '2026-10', period: '26-10' });
  });

  it('moves across the year boundary', () => {
    expect(moveCutoff({ month: '2026-12', period: '11-25' }, 1)).toEqual({
      month: '2027-01',
      period: '26-10',
    });
    expect(moveCutoff({ month: '2027-01', period: '26-10' }, -1)).toEqual({
      month: '2026-12',
      period: '11-25',
    });
  });

  it.each([
    ['2026-10-10T15:59:59Z', { month: '2026-10', period: '26-10' }],
    ['2026-10-10T16:00:00Z', { month: '2026-10', period: '11-25' }],
    ['2026-10-25T15:59:59Z', { month: '2026-10', period: '11-25' }],
    ['2026-10-25T16:00:00Z', { month: '2026-11', period: '26-10' }],
    ['2026-12-25T16:00:00Z', { month: '2027-01', period: '26-10' }],
    ['2026-10-31T16:00:00Z', { month: '2026-11', period: '26-10' }],
  ])(
    'chooses the cutoff from Manila calendar time at %s',
    (instant, expected) => {
      expect(getInitialCutoff(new Date(instant))).toEqual(expected);
    },
  );

  it('defaults to the current Manila date', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-25T16:00:00Z'));
    try {
      expect(loadEntryHelpers().getInitialCutoff()).toEqual({
        month: '2026-11',
        period: '26-10',
      });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('attendance entry source rows and retry reconciliation', () => {
  const dates = ['2026-10-06', '2026-10-07'];
  const source = (
    overrides: Partial<AttendanceEntryRecord> = {},
  ): AttendanceEntryRecord => ({
    id: 101,
    employeeId: 7,
    date: dates[0],
    timeIn: '08:00',
    timeOut: '17:00',
    hours: 8,
    reason: null,
    shiftStart: '08:00',
    shiftEnd: '17:00',
    lunchStart: '12:00',
    lunchEnd: '13:00',
    breakOut: null,
    breakIn: null,
    lunchOverrideMinutes: null,
    ...overrides,
  });
  const newRow = (overrides: Partial<EntryRow> = {}): EntryRow => ({
    key: 'new-1',
    date: dates[0],
    kind: 'work',
    timeIn: '',
    timeOut: '',
    reason: '',
    ...overrides,
  });

  it.each(['', null, undefined])(
    'keeps a saved empty reason %s unchanged',
    (reason) => {
      const saved = source({ reason });
      const row = fromRecord(saved);
      expect(sourcePunches(saved).reason).toBeNull();
      expect(rowPunches(row).reason).toBeNull();
      expect(isChanged(row)).toBe(false);
    },
  );

  it('keeps 12-hour display formatting equivalent to saved 24-hour punches', () => {
    const saved = source();
    const row = fromRecord(saved);
    expect(row.timeIn).toBe('8:00 AM');
    expect(row.timeOut).toBe('5:00 PM');
    expect(
      samePunches(
        rowPunches({ ...row, timeIn: '08:00 AM', timeOut: '5:00 pm' }),
        sourcePunches(saved),
      ),
    ).toBe(true);
    expect(isChanged(row)).toBe(false);
  });

  it('retains separate source IDs even when their employee/date/punches duplicate', () => {
    const records = [source(), source({ id: 102, hours: 0 })];
    const rows = mergeRows(records, [dates[0]], 7);
    expect(rows.map((row) => row.source?.id)).toEqual([101, 102]);
    expect(rows.map((row) => row.key)).toEqual(['saved-101', 'saved-102']);
    expect(rows.filter(isChanged)).toHaveLength(0);
  });

  it('ignores untouched new blank rows and returns one blank placeholder per missing date', () => {
    const blank = newRow({ timeIn: ' ', timeOut: '\t', reason: ' ' });
    expect(isChanged(blank)).toBe(false);
    const rows = mergeRows([], dates, 7, [blank]);
    expect(rows.map((row) => row.key)).toEqual(
      dates.map((date) => `blank-${date}`),
    );
    expect(rows.filter(isChanged)).toHaveLength(0);
  });

  it('keeps an edited incomplete saved row dirty without losing its ID', () => {
    const saved = source();
    const draft = {
      ...fromRecord(saved),
      timeOut: '',
      error: 'Enter both valid times.',
    };
    expect(isChanged(draft)).toBe(true);
    const merged = mergeRows([saved], dates, 7, [draft]);
    expect(merged.find((row) => row.source?.id === saved.id)).toBe(draft);
    expect(rowPunches(draft)).toEqual({
      timeIn: '08:00',
      timeOut: '',
      reason: null,
    });
  });

  it.each([
    ['paid', 'PAID'],
    ['unpaid', 'UNPAID'],
  ] as const)(
    'preserves %s leave sentinels and recognizes a new leave row',
    (kind, timeOut) => {
      const saved = source({
        timeIn: 'LEAVE',
        timeOut,
        reason: 'Approved leave',
      });
      const row = fromRecord(saved);
      expect(row).toMatchObject({
        kind,
        timeIn: '',
        timeOut: '',
        reason: 'Approved leave',
      });
      expect(rowPunches(row)).toEqual({
        timeIn: 'LEAVE',
        timeOut,
        reason: 'Approved leave',
      });
      expect(isChanged(row)).toBe(false);
      expect(isChanged(newRow({ kind }))).toBe(true);
    },
  );

  it('retains only failed drafts after successful existing and new sessions acquire saved IDs', () => {
    const failedSource = source({
      id: 102,
      date: dates[1],
      timeIn: '09:00',
      timeOut: '18:00',
    });
    const failed = {
      ...fromRecord(failedSource),
      timeOut: '7:00 PM',
      error: 'Save failed',
    };
    const savedExisting = source({ timeOut: '18:00' });
    const savedCreated = source({ id: 105, timeIn: '19:00', timeOut: '20:00' });
    const merged = mergeRows(
      [savedExisting, failedSource, savedCreated],
      dates,
      7,
      [fromRecord(savedExisting), fromRecord(savedCreated), failed],
    );
    expect(merged.filter(isChanged)).toEqual([failed]);
    expect(
      merged
        .filter((row) => row.source && !isChanged(row))
        .map((row) => row.source?.id),
    ).toEqual([101, 105]);
    expect(merged.find((row) => row.source?.id === 102)).toBe(failed);
  });

  it('reconciles an unconfirmed POST only when its normalized session and reason are present', () => {
    const draft = newRow({
      timeIn: '8:00 AM',
      timeOut: '5:00 PM',
      reason: 'Approved',
    });
    draft.unconfirmed = rowPunches(draft);
    const saved = source({ id: 105, reason: 'Approved' });
    const merged = mergeRows([saved], dates, 7, [draft]);
    expect(merged.find((row) => row.source?.id === 105)).toMatchObject({
      key: 'saved-105',
      source: saved,
    });
    expect(merged.some((row) => row.key === draft.key)).toBe(false);
    expect(merged.filter(isChanged)).toHaveLength(0);
  });

  it.each([
    { employeeId: 8 },
    { date: dates[1] },
    { timeIn: '09:00' },
    { timeOut: '18:00' },
    { reason: 'Other reason' },
  ])(
    'retains an unconfirmed POST when its saved counterpart differs: %j',
    (difference) => {
      const draft = newRow({
        timeIn: '8:00 AM',
        timeOut: '5:00 PM',
        reason: 'Approved',
      });
      draft.unconfirmed = rowPunches(draft);
      const merged = mergeRows(
        [source({ id: 105, reason: 'Approved', ...difference })],
        dates,
        7,
        [draft],
      );
      expect(merged.find((row) => row.key === draft.key)).toBe(draft);
      expect(isChanged(draft)).toBe(true);
    },
  );

  it('reconciles an unconfirmed PATCH by its exact source ID and requested punches/reason', () => {
    const original = source();
    const draft = {
      ...fromRecord(original),
      timeOut: '6:00 PM',
      reason: 'Approved',
      unconfirmed: { timeIn: '08:00', timeOut: '18:00', reason: 'Approved' },
    };
    const saved = source({ timeOut: '18:00', reason: 'Approved' });
    const merged = mergeRows([saved], dates, 7, [draft]);
    const reconciled = merged.find((row) => row.source?.id === original.id);
    expect(reconciled?.source).toBe(saved);
    expect(reconciled?.unconfirmed).toBeUndefined();
    expect(merged.filter(isChanged)).toHaveLength(0);
  });

  it.each([
    { id: 102 },
    { employeeId: 8 },
    { date: dates[1] },
    { timeOut: '19:00' },
    { reason: 'Other reason' },
  ])(
    'does not confirm a PATCH against a mismatched saved row: %j',
    (difference) => {
      const original = source();
      const draft = {
        ...fromRecord(original),
        timeOut: '6:00 PM',
        reason: 'Approved',
        unconfirmed: { timeIn: '08:00', timeOut: '18:00', reason: 'Approved' },
      };
      const merged = mergeRows(
        [source({ timeOut: '18:00', reason: 'Approved', ...difference })],
        dates,
        7,
        [draft],
      );
      expect(merged.find((row) => row.key === draft.key)).toBe(draft);
      expect(isChanged(draft)).toBe(true);
    },
  );

  it('keeps an uncertain missing session dirty even when its displayed punches equal the earlier source', () => {
    const original = source();
    const draft = {
      ...fromRecord(original),
      unconfirmed: sourcePunches(original),
    };
    const merged = mergeRows([], dates, 7, [draft]);
    expect(merged.find((row) => row.key === draft.key)).toBe(draft);
    expect(isChanged(draft)).toBe(true);
  });

  it('preserves official metrics and source context without recalculating edited punches', () => {
    const metrics: calculator.AttendanceCalcResult = {
      grossMinutes: 360,
      lunchDeductionMinutes: 39,
      netMinutes: 321,
      regularMinutes: 300,
      otMinutes: 21,
      earlyOtMinutes: 0,
      lateOtMinutes: 21,
      lateMinutes: 0,
      undertimeMinutes: 0,
      reg: 5,
      ot: 0.35,
      earlyOt: 0,
      lateOt: 0.35,
      total: 5.35,
      decimalHours: '5.35',
      regularFormatted: '5h',
      actualFormatted: '6h',
    };
    const saved = source({
      hours: 5.35,
      metrics,
      shiftStart: '07:30',
      lunchStart: '11:30',
      breakOut: '12:10',
      breakIn: '12:40',
      lunchOverrideMinutes: 39,
    });
    const before = structuredClone(saved);
    const row = fromRecord(saved);
    expect(row.source).toBe(saved);
    const draft = { ...row, timeOut: '10:00 PM' };
    const merged = mergeRows([saved], dates, 7, [draft]);
    const retained = merged.find((item) => item.key === row.key);
    expect(retained?.source?.metrics).toBe(metrics);
    expect(retained?.source?.hours).toBe(5.35);
    expect(saved).toEqual(before);
    expect(rowPunches(draft)).toEqual({
      timeIn: '08:00',
      timeOut: '22:00',
      reason: null,
    });
  });

  it.each([
    { employeeId: 8 },
    { date: dates[1] },
    { timeIn: '07:00' },
    { timeOut: '18:00' },
    { reason: 'Changed' },
    { shiftStart: '07:00' },
    { shiftEnd: '18:00' },
    { lunchStart: '11:30' },
    { lunchEnd: '12:30' },
    { breakOut: '12:10' },
    { breakIn: '12:40' },
    { lunchOverrideMinutes: 30 },
  ])('recognizes a concurrent source context change: %j', (difference) => {
    const original = source();
    expect(sameSource(original, source(difference))).toBe(false);
  });

  it('does not treat refreshed derived hours as a source edit conflict', () => {
    const original = source();
    expect(sameSource(original, source({ hours: 0 }))).toBe(true);
    expect(sameSource(original, source())).toBe(true);
  });
});

describe('attendance entry punch formatting and source identity', () => {
  it.each([
    ['12:00 AM', '00:00', '12:00 AM'],
    ['12:00 PM', '12:00', '12:00 PM'],
    [' 9:05 pm ', '21:05', '9:05 PM'],
    ['00:38', '00:38', '12:38 AM'],
    ['08:00', '08:00', '8:00 AM'],
    ['23:59', '23:59', '11:59 PM'],
  ])(
    'normalizes %s without calculating attendance',
    (input, normalized, display) => {
      expect(normalizeEntryTime(input)).toBe(normalized);
      expect(displayEntryTime(input)).toBe(display);
    },
  );

  it.each([
    '',
    '24:00',
    '12:60',
    '00:30 AM',
    '13:00 PM',
    '9:3',
    'LEAVE',
    'invalid',
  ])('preserves invalid punch text %s for the UI', (input) => {
    expect(normalizeEntryTime(input)).toBeNull();
    expect(displayEntryTime(input)).toBe(input);
  });

  const record = {
    employeeId: 7,
    date: '2026-10-06',
    timeIn: '00:00',
    timeOut: '00:38',
  };

  it('uses the existing normalized source session identity', () => {
    expect(
      entrySessionKey({
        ...record,
        date: '2026-10-05T16:00:00Z',
        timeIn: '12:00 AM',
        timeOut: '12:38 AM',
      }),
    ).toBe(entrySessionKey(record));
  });

  it('keeps different sessions, employees, and dates distinct', () => {
    const keys = [
      record,
      { ...record, timeIn: '09:32', timeOut: '18:13' },
      { ...record, employeeId: 8 },
      { ...record, date: '2026-10-07' },
      { ...record, timeIn: '23:00', timeOut: '01:00' },
    ].map(entrySessionKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps an overnight source session on its recorded starting date', () => {
    const overnight = { ...record, timeIn: '23:00', timeOut: '01:00' };
    expect(entrySessionKey(overnight)).toBe(
      entrySessionKey({ ...overnight, timeIn: '11:00 PM', timeOut: '1:00 AM' }),
    );
    expect(entrySessionKey(overnight)).not.toBe(
      entrySessionKey({ ...overnight, date: '2026-10-07' }),
    );
  });
});
