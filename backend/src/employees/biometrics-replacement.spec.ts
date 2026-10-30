import { normalizeBiometricPunches } from './biometrics-import';
import { planBiometricReplacement } from './biometrics-replacement';
import type { BiometricExistingAttendance } from './biometrics-replacement';

const employees = [{ id: 10, employeeId: '007' }];
const range = { startDate: '2026-10-11', endDate: '2026-10-25' };
const punches = (date = '2026-10-12', timeIn = '08:00', timeOut = '17:00') => [
  { personnelId: '7', date, time: timeIn, direction: 'IN' },
  { personnelId: '7', date, time: timeOut, direction: 'OUT' },
];
const saved = (
  change: Partial<BiometricExistingAttendance> = {},
): BiometricExistingAttendance => ({
  id: 1,
  employeeId: 10,
  date: '2026-10-12',
  timeIn: '08:00',
  timeOut: '17:00',
  ...change,
});
const plan = (existing: BiometricExistingAttendance[] = [], rows = punches()) =>
  planBiometricReplacement(
    normalizeBiometricPunches(rows),
    employees,
    existing,
    range,
  );

describe('biometrics replacement planning', () => {
  it('replaces changed punches only for represented employee/date groups', () => {
    const before = [
      saved({ timeOut: '16:00' }),
      saved({ id: 2, date: '2026-10-13' }),
      saved({ id: 3, employeeId: 20 }),
    ];
    const result = plan(before);
    expect(result.replacementDays).toHaveLength(1);
    expect(result.replacementDays[0]).toMatchObject({
      status: 'replace',
      before: [before[0]],
      keepIds: [],
      removeIds: [1],
    });
    expect(result.summary).toMatchObject({
      newSessions: 0,
      replacementDays: 1,
      replacedSessions: 1,
      removedSessions: 1,
    });
    expect(result.sessions[0]).toMatchObject({
      status: 'new',
      timeIn: '08:00',
      timeOut: '17:00',
    });
  });

  it('retains exact source rows and all metadata including zero-break overrides', () => {
    const row = saved({
      hours: 9,
      reason: 'Approved exception',
      lunchOverrideMinutes: 0,
      shiftStart: '08:30',
      breakOut: null,
    });
    const result = plan([row]);
    expect(result.replacementDays[0]).toMatchObject({
      status: 'unchanged',
      keepIds: [1],
      removeIds: [],
      before: [row],
    });
    expect(result.summary).toMatchObject({
      newSessions: 0,
      replacedSessions: 0,
      removedSessions: 0,
      duplicateSessions: 1,
    });
  });

  it('keeps exact sessions and replaces the remaining split sessions without losing extra removals', () => {
    const rows = [
      ...punches('2026-10-12', '08:00', '11:00'),
      ...punches('2026-10-12', '12:00', '17:00'),
    ];
    const result = plan(
      [
        saved({ id: 3, timeIn: '12:00', timeOut: '16:00' }),
        saved({ id: 2, timeOut: '11:00' }),
        saved({ id: 4, timeIn: '18:00', timeOut: '19:00' }),
      ],
      rows,
    );
    expect(result.replacementDays[0]).toMatchObject({
      keepIds: [2],
      removeIds: [3, 4],
    });
    expect(result.replacementDays[0].before.map((row) => row.id)).toEqual([
      2, 3, 4,
    ]);
    expect(result.summary).toMatchObject({
      duplicateSessions: 1,
      replacedSessions: 1,
      removedSessions: 2,
    });
  });

  it('removes duplicate exact saved copies while preferring the protected copy', () => {
    const result = plan([saved(), saved({ id: 2, lunchOverrideMinutes: 0 })]);
    expect(result.replacementDays[0]).toMatchObject({
      status: 'replace',
      keepIds: [2],
      removeIds: [1],
    });
    expect(result.summary).toMatchObject({
      duplicateSessions: 1,
      replacedSessions: 0,
      removedSessions: 1,
    });
  });

  it.each([
    { lunchOverrideMinutes: 0 },
    { lunchOverrideMinutes: 30 },
    { breakOut: '12:00' },
    { breakIn: '13:00' },
  ])(
    'holds a changed session with a protected break exception %j',
    (exception) => {
      const result = plan([saved({ timeOut: '16:00', ...exception })]);
      expect(result.replacementDays[0]).toMatchObject({
        status: 'blocked',
        removeIds: [],
      });
      expect(result.sessions[0].status).toBe('conflict');
      expect(result.issues).toContainEqual(
        expect.objectContaining({ code: 'protected-break-exception' }),
      );
      expect(result.summary).toMatchObject({
        replacementDays: 0,
        replacedSessions: 0,
        removedSessions: 0,
        conflictSessions: 1,
      });
    },
  );

  it('does not discard an extra protected exact duplicate', () => {
    const result = plan([
      saved({ lunchOverrideMinutes: 0 }),
      saved({ id: 2, lunchOverrideMinutes: 30 }),
    ]);
    expect(result.replacementDays[0].status).toBe('blocked');
    expect(result.replacementDays[0].removeIds).toEqual([]);
  });

  it('holds saved paid or unpaid leave instead of deleting it', () => {
    for (const timeOut of ['PAID', 'UNPAID']) {
      const result = plan([saved({ timeIn: 'LEAVE', timeOut })]);
      expect(result.replacementDays[0].status).toBe('blocked');
      expect(result.issues).toContainEqual(
        expect.objectContaining({ code: 'existing-leave-conflict' }),
      );
    }
  });

  it('replaces incomplete existing punches and preserves missing source sides as blank', () => {
    const repaired = plan([saved({ timeOut: '' })]);
    expect(repaired.replacementDays[0]).toMatchObject({
      status: 'replace',
      removeIds: [1],
    });
    const incomplete = plan([saved()], punches().slice(0, 1));
    expect(incomplete.sessions[0]).toMatchObject({
      timeIn: '08:00',
      timeOut: '',
      complete: false,
      status: 'new',
    });
    expect(incomplete.summary.incompleteSessions).toBe(1);
  });

  it('does not touch invalid source groups, ambiguous IDs, unmatched IDs or absent dates', () => {
    const malformed = [
      ...punches(),
      { personnelId: '7', date: '2026-10-12', time: 'bad', direction: 'OUT' },
    ];
    expect(plan([saved()], malformed).replacementDays).toEqual([]);
    expect(
      planBiometricReplacement(
        normalizeBiometricPunches(punches()),
        [...employees, { id: 11, employeeId: '0007' }],
        [saved()],
        range,
      ).replacementDays,
    ).toEqual([]);
    expect(
      planBiometricReplacement(
        normalizeBiometricPunches(punches()),
        [],
        [saved()],
        range,
      ).replacementDays,
    ).toEqual([]);
    expect(plan([saved()], punches('2026-10-26')).replacementDays).toEqual([]);
  });

  it('blocks source punches overlapping an untouched neighboring overnight session', () => {
    const result = plan([
      saved({ date: '2026-10-11', timeIn: '23:00', timeOut: '09:00' }),
    ]);
    expect(result.replacementDays[0]).toMatchObject({
      status: 'blocked',
      removeIds: [],
    });
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'neighboring-session-conflict' }),
    );
  });

  it('allows replacing the neighboring overnight source when both dates are represented', () => {
    const result = plan(
      [saved({ date: '2026-10-11', timeIn: '23:00', timeOut: '09:00' })],
      [...punches('2026-10-11'), ...punches()],
    );
    expect(result.replacementDays.map((day) => day.status)).toEqual([
      'replace',
      'replace',
    ]);
    expect(result.summary).toMatchObject({
      newSessions: 1,
      replacedSessions: 1,
      removedSessions: 1,
      conflictSessions: 0,
    });
  });

  it('cascades blocking when an overnight neighboring replacement must be retained', () => {
    const result = plan(
      [
        saved({
          date: '2026-10-11',
          timeIn: '23:00',
          timeOut: '09:00',
          lunchOverrideMinutes: 0,
        }),
      ],
      [...punches(), ...punches('2026-10-11')],
    );
    expect(
      result.replacementDays.every((day) => day.status === 'blocked'),
    ).toBe(true);
    expect(result.summary).toMatchObject({
      newSessions: 0,
      replacedSessions: 0,
      removedSessions: 0,
      conflictSessions: 2,
    });
  });

  it('rechecks earlier days after a later replacement is blocked by another untouched neighbor', () => {
    const existing = [
      saved({ id: 1, date: '2026-10-10', timeIn: '23:00', timeOut: '01:00' }),
      saved({ id: 2, date: '2026-10-11', timeIn: '23:00', timeOut: '09:00' }),
    ];
    const result = plan(existing, [
      ...punches(),
      ...punches('2026-10-11', '00:00', '08:00'),
    ]);
    expect(
      result.replacementDays.every((day) => day.status === 'blocked'),
    ).toBe(true);
    expect(
      result.issues.filter(
        (issue) => issue.code === 'neighboring-session-conflict',
      ),
    ).toHaveLength(2);
    expect(result.summary.removedSessions).toBe(0);
  });

  it('normalizes legacy date strings and punch formats for exact matching without changing raw metadata', () => {
    const old = saved({
      date: '2026-10-12T00:00:00',
      timeIn: '8:00 AM',
      timeOut: '5:00 PM',
    });
    const result = plan([old]);
    expect(result.replacementDays[0]).toMatchObject({
      date: '2026-10-12',
      status: 'unchanged',
      before: [old],
      keepIds: [1],
    });
  });

  it('does not mutate source normalization, employees or existing records', () => {
    const normalized = normalizeBiometricPunches(punches());
    const existing = [saved({ timeOut: '16:00' })];
    const before = JSON.stringify({ normalized, employees, existing });
    planBiometricReplacement(normalized, employees, existing, range);
    expect(JSON.stringify({ normalized, employees, existing })).toBe(before);
  });

  it('caps the number of saved rows removed in one replacement transaction', () => {
    const existing = Array.from({ length: 2002 }, (_, index) =>
      saved({ id: index + 1 }),
    );
    expect(() => plan(existing)).toThrow(/at most 2000 saved attendance rows/);
  });
});
