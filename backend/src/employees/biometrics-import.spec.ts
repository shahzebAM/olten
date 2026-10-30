import {
  biometricDate,
  biometricTime,
  normalizeBiometricPunches,
  planBiometricImport,
} from './biometrics-import';
import { planBiometricReplacement } from './biometrics-replacement';

const employees = [
  { id: 90, employeeId: '007' },
  { id: 91, employeeId: 'TEST-002' },
];
const range = { startDate: '2026-10-11', endDate: '2026-10-25' };
const punch = (
  time: string,
  direction: string,
  personnelId = '7',
  date = '10-12-2026',
) => ({ personnelId, date, time, direction });
const plan = (
  rows: unknown[],
  existing: Parameters<typeof planBiometricImport>[2] = [],
  staff = employees,
) =>
  planBiometricImport(normalizeBiometricPunches(rows), staff, existing, range);

describe('biometrics source normalization', () => {
  it.each(['', '  ', null, undefined])(
    'recognizes missing clock %p without inventing midnight or rejecting its date',
    (time) => {
      const result = normalizeBiometricPunches([{ ...punch('', 'IN'), time }]);
      expect(result.issues).toEqual([]);
      expect(result.punches).toEqual([]);
      expect(result.blankPunches).toEqual([
        {
          personnelId: '7',
          date: '2026-10-12',
          direction: 'IN',
          rowNumber: 2,
        },
      ]);
      expect(result.blankPunches[0]).not.toHaveProperty('secondsOfDay');
      expect(result.blankPunches[0]).not.toHaveProperty('time');
    },
  );
  it('deduplicates blank markers separately from a genuine midnight punch', () => {
    const normalized = normalizeBiometricPunches([
      punch('', 'IN'),
      punch(' ', 'IN'),
      punch('00:00', 'IN'),
    ]);
    expect(normalized.blankPunches).toHaveLength(1);
    expect(normalized.punches).toHaveLength(1);
    expect(normalized.punches[0].secondsOfDay).toBe(0);
    expect(normalized.duplicatePunches).toBe(1);
    expect(
      planBiometricImport(normalized, employees, [], range).sessions,
    ).toMatchObject([{ timeIn: '00:00', timeOut: '', complete: false }]);
  });
  it('still requires the employee, date and direction when the time is blank', () => {
    const result = normalizeBiometricPunches([
      { ...punch('', 'IN'), personnelId: '' },
      { ...punch('', 'OUT'), date: 'invalid' },
      punch('', ''),
    ]);
    expect(result.blankPunches).toEqual([]);
    expect(result.issues).toHaveLength(3);
  });
  it.each([
    ['10-12-2026', '2026-10-12'],
    ['10/12/2026', '2026-10-12'],
    ['2024-02-29', '2024-02-29'],
  ])('reads %s without timezone conversion', (input, expected) =>
    expect(biometricDate(input)).toBe(expected),
  );
  it.each([
    '2026-02-29',
    '13-01-2026',
    '2026-04-31',
    '2026-10-12T00:00:00Z',
    '',
    46300,
  ])('rejects invalid or ambiguous date %s', (input) =>
    expect(biometricDate(input)).toBeNull(),
  );
  it.each([
    ['11:31:59 AM', '11:31', 41519],
    ['08:27:55 PM', '20:27', 73675],
    ['12:00:59 AM', '00:00', 59],
    ['12:00 PM', '12:00', 43200],
    ['23:59:59', '23:59', 86399],
  ])('drops seconds without rounding %s', (input, time, secondsOfDay) =>
    expect(biometricTime(input)).toEqual({ time, secondsOfDay }),
  );
  it.each(['20:26 PM', '24:00', '12:60', '00:30 AM', '08:01:60', '08:1'])(
    'rejects invalid punch %s',
    (input) => expect(biometricTime(input)).toBeNull(),
  );
  it('reports malformed rows and ignores names, department and claimed hours', () => {
    const result = normalizeBiometricPunches([
      {
        ...punch('08:00', 'IN'),
        firstName: 'Wrong name',
        department: 'Different company',
        hours: 999,
      },
      {},
      null,
      punch('17:00', 'UNKNOWN'),
    ]);
    expect(result.punches).toHaveLength(1);
    expect(result.issues).toHaveLength(3);
    expect(result.punches[0]).not.toHaveProperty('department');
    expect(result.punches[0]).not.toHaveProperty('hours');
  });
  it('rejects an oversized request instead of truncating it', () =>
    expect(() => normalizeBiometricPunches(Array(10001).fill({}))).toThrow(
      /10000/,
    ));
});

describe('biometric employee matching and session planning', () => {
  it('represents an explicitly empty IN/OUT export date as one blank session', () => {
    const result = plan([punch('', 'IN'), punch('', 'OUT')]);
    expect(result.sessions).toMatchObject([
      {
        employeeId: 90,
        date: '2026-10-12',
        timeIn: '',
        timeOut: '',
        rowNumbers: [2, 3],
        complete: false,
        status: 'new',
      },
    ]);
    expect(result.sessions).toHaveLength(1);
    expect(result.summary).toMatchObject({
      punchCount: 2,
      matchedPunches: 2,
      invalidPunches: 0,
      blockedPunches: 0,
      incompleteSessions: 1,
    });
  });
  it.each([
    ['', '17:00', '', '17:00'],
    ['08:00', '', '08:00', ''],
  ])(
    'keeps a blank counterpart for IN %s / OUT %s',
    (timeIn, timeOut, expectedIn, expectedOut) => {
      const result = plan([punch(timeIn, 'IN'), punch(timeOut, 'OUT')]);
      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0]).toMatchObject({
        timeIn: expectedIn,
        timeOut: expectedOut,
        complete: false,
      });
      expect(result.summary).toMatchObject({
        punchCount: 2,
        matchedPunches: 2,
        invalidPunches: 0,
      });
    },
  );
  it('does not create extra empty sessions for placeholders beside actual punches', () => {
    const result = plan([
      punch('', 'IN'),
      punch('', 'OUT'),
      punch('08:00', 'IN'),
      punch('17:00', 'OUT'),
    ]);
    expect(result.sessions).toMatchObject([
      { timeIn: '08:00', timeOut: '17:00', complete: true },
    ]);
    expect(result.sessions).toHaveLength(1);
    expect(result.summary).toMatchObject({
      punchCount: 4,
      matchedPunches: 4,
      incompleteSessions: 0,
    });
  });
  it('creates separate same-day sessions from two real IN/OUT pairs beside blank markers', () => {
    const result = plan([
      punch('17:00:59', 'OUT'),
      punch('', 'IN'),
      punch('13:00:30', 'IN'),
      punch('12:00:30', 'OUT'),
      punch('', 'OUT'),
      punch('08:00:15', 'IN'),
    ]);
    expect(
      result.sessions.map((row) => [row.date, row.timeIn, row.timeOut]),
    ).toEqual([
      ['2026-10-12', '08:00', '12:00'],
      ['2026-10-12', '13:00', '17:00'],
    ]);
    expect(result.summary).toMatchObject({
      punchCount: 6,
      matchedPunches: 6,
      newSessions: 2,
      incompleteSessions: 0,
    });
  });
  it('counts blank markers in unmatched, ambiguous and outside-range results', () => {
    expect(plan([punch('', 'IN', 'unknown')]).summary.unmatchedPunches).toBe(1);
    expect(
      plan([punch('', 'IN')], [], [...employees, { id: 92, employeeId: '7' }])
        .summary.unmatchedPunches,
    ).toBe(1);
    const result = plan([punch('', 'IN', '7', '10-10-2026')]);
    expect(result.sessions).toEqual([]);
    expect(result.summary.outsideRangePunches).toBe(1);
  });
  it('holds blank and real punches when a nonempty malformed time makes that date invalid', () => {
    const result = plan([
      punch('', 'IN'),
      punch('invalid', 'OUT'),
      punch('08:00', 'IN'),
    ]);
    expect(result.sessions).toEqual([]);
    expect(result.summary).toMatchObject({
      invalidPunches: 1,
      blockedPunches: 2,
    });
  });
  it('replans blank-to-partial-to-complete uploads and adds a second session without duplicates', () => {
    const rows = (timeIn: string, timeOut: string) => [
      punch(timeIn, 'IN'),
      punch(timeOut, 'OUT'),
    ];
    const replacement = (
      source: unknown[],
      existing: Parameters<typeof planBiometricReplacement>[2],
    ) =>
      planBiometricReplacement(
        normalizeBiometricPunches(source),
        employees,
        existing,
        range,
      );
    const blank = replacement(rows('', ''), []);
    const existingBlank = { id: 1, ...blank.sessions[0] };
    const partial = replacement(rows('08:00', ''), [existingBlank]);
    expect(partial.sessions).toMatchObject([
      { timeIn: '08:00', timeOut: '', complete: false },
    ]);
    expect(partial.replacementDays[0].removeIds).toEqual([1]);
    const complete = replacement(rows('08:00', '12:00'), [
      { id: 2, ...partial.sessions[0] },
    ]);
    expect(complete.sessions).toMatchObject([
      { timeIn: '08:00', timeOut: '12:00', complete: true },
    ]);
    const two = replacement(
      [...rows('08:00', '12:00'), ...rows('13:00', '17:00')],
      [{ id: 3, ...complete.sessions[0] }],
    );
    expect(two.sessions.map((row) => [row.timeIn, row.timeOut])).toEqual([
      ['08:00', '12:00'],
      ['13:00', '17:00'],
    ]);
    expect(two.replacementDays[0].keepIds).toEqual([3]);
    expect(two.summary).toMatchObject({
      duplicateSessions: 1,
      replacedSessions: 1,
    });
  });
  it('does not bridge a session around a malformed punch on the same employee/date', () => {
    const result = plan([
      punch('08:00', 'IN'),
      punch('bad time', 'OUT'),
      punch('17:00', 'OUT'),
    ]);
    expect(result.sessions).toEqual([]);
    expect(result.summary.invalidPunches).toBe(1);
    expect(result.summary.blockedPunches).toBe(2);
  });
  it('recognizes existing Manila dates stored as legacy UTC timestamps', () => {
    const result = plan(
      [punch('08:00', 'IN'), punch('17:00', 'OUT')],
      [
        {
          employeeId: 90,
          date: '2026-10-11T16:00:00Z',
          timeIn: '08:00',
          timeOut: '17:00',
        },
      ],
    );
    expect(result.sessions[0].status).toBe('duplicate');
  });
  it('matches a unique numeric business ID with leading zeros, never the database primary ID', () => {
    const result = plan([
      punch('08:00:40', 'IN'),
      punch('17:00:59', 'OUT'),
      punch('08:00', 'IN', '90'),
    ]);
    expect(result.sessions).toMatchObject([
      {
        employeeId: 90,
        timeIn: '08:00',
        timeOut: '17:00',
        complete: true,
        status: 'new',
      },
    ]);
    expect(result.summary.unmatchedPunches).toBe(1);
  });
  it('keeps alphanumeric IDs intact and matches case-insensitively', () =>
    expect(
      plan([
        punch('08:00', 'IN', ' test-002 '),
        punch('17:00', 'OUT', 'TEST-002'),
      ]).sessions[0].employeeId,
    ).toBe(91));
  it('does not guess when company IDs normalize to more than one employee', () => {
    const result = plan(
      [punch('08:00', 'IN')],
      [],
      [...employees, { id: 92, employeeId: '7' }],
    );
    expect(result.sessions).toEqual([]);
    expect(result.issues[0].code).toBe('ambiguous-id');
  });
  it('pairs multiple chronological sessions even when source rows are unsorted', () => {
    const result = plan([
      punch('17:00:09', 'OUT'),
      punch('13:00:59', 'IN'),
      punch('12:00:59', 'OUT'),
      punch('08:00:30', 'IN'),
    ]);
    expect(result.sessions.map((row) => [row.timeIn, row.timeOut])).toEqual([
      ['08:00', '12:00'],
      ['13:00', '17:00'],
    ]);
    expect(result.summary.newSessions).toBe(2);
  });
  it('leaves missing sides blank and never pairs punches across different dates', () => {
    const result = plan([
      punch('08:00', 'IN'),
      punch('17:00', 'OUT', '7', '10-13-2026'),
    ]);
    expect(
      result.sessions.map((row) => [row.date, row.timeIn, row.timeOut]),
    ).toEqual([
      ['2026-10-12', '08:00', ''],
      ['2026-10-13', '', '17:00'],
    ]);
    expect(result.summary.incompleteSessions).toBe(2);
    expect(result.summary.newSessions).toBe(2);
  });
  it('retains an unmatched IN instead of making up its OUT', () => {
    const result = plan([
      punch('08:00', 'IN'),
      punch('09:00', 'IN'),
      punch('17:00', 'OUT'),
    ]);
    expect(result.sessions.map((row) => [row.timeIn, row.timeOut])).toEqual([
      ['08:00', ''],
      ['09:00', '17:00'],
    ]);
  });
  it('deduplicates repeated exact punches before pairing', () => {
    const result = plan([
      punch('08:00:15', 'IN'),
      punch('08:00:15', 'IN'),
      punch('17:00:59', 'OUT'),
      punch('17:00:59', 'OUT'),
    ]);
    expect(result.sessions).toHaveLength(1);
    expect(result.summary.duplicatePunches).toBe(2);
  });
  it('keeps second ordering until pairing and deduplicates identical final minute sessions', () => {
    const result = plan([
      punch('08:00:40', 'IN'),
      punch('08:00:50', 'OUT'),
      punch('08:00:10', 'IN'),
      punch('08:00:20', 'OUT'),
    ]);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({
      timeIn: '08:00',
      timeOut: '08:00',
      complete: true,
    });
  });
  it('excludes dates outside the selected import range', () => {
    const result = plan([
      punch('08:00', 'IN', '7', '10-10-2026'),
      punch('08:00', 'IN'),
    ]);
    expect(result.summary.outsideRangePunches).toBe(1);
    expect(result.sessions).toHaveLength(1);
  });
  it('skips exact saved complete and incomplete sessions', () => {
    const rows = [
      punch('08:00', 'IN'),
      punch('17:00', 'OUT'),
      punch('09:00', 'IN', '7', '10-13-2026'),
    ];
    const initial = plan(rows);
    const result = plan(rows, initial.sessions);
    expect(result.summary.newSessions).toBe(0);
    expect(result.summary.duplicateSessions).toBe(2);
  });
  it('preserves existing overlap, partial and leave records while allowing disjoint sessions', () => {
    const saved = [
      { employeeId: 90, date: '2026-10-12', timeIn: '08:00', timeOut: '12:00' },
    ];
    expect(
      plan([punch('11:00', 'IN'), punch('17:00', 'OUT')], saved).sessions[0]
        .status,
    ).toBe('conflict');
    expect(
      plan([punch('13:00', 'IN'), punch('17:00', 'OUT')], saved).sessions[0]
        .status,
    ).toBe('new');
    for (const savedPunches of [
      { timeIn: '08:00', timeOut: '' },
      { timeIn: 'LEAVE', timeOut: 'PAID' },
    ]) {
      expect(
        plan(
          [punch('13:00', 'IN'), punch('17:00', 'OUT')],
          [{ ...saved[0], ...savedPunches }],
        ).sessions[0].status,
      ).toBe('conflict');
    }
    expect(saved[0].timeOut).toBe('12:00');
  });
  it('detects an existing overnight overlap from the preceding date', () => {
    const result = plan(
      [punch('00:30', 'IN'), punch('02:00', 'OUT')],
      [
        {
          employeeId: 90,
          date: '2026-10-11',
          timeIn: '23:00',
          timeOut: '01:00',
        },
      ],
    );
    expect(result.sessions[0].status).toBe('conflict');
  });
  it('rejects invalid date ranges', () =>
    expect(() =>
      planBiometricImport(normalizeBiometricPunches([]), employees, [], {
        startDate: '2026-02-30',
        endDate: range.endDate,
      }),
    ).toThrow(/date range/));
});
