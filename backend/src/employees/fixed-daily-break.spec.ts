import {
  APP_ATTENDANCE_POLICY,
  aggregateAttendanceRecords,
  calculateAttendanceMetrics,
  calculateAttendancePayroll,
  type AttendanceRecordInput,
} from './attendance-calculator';

const record = (
  id: number,
  timeIn: string,
  timeOut: string,
  extra: Partial<AttendanceRecordInput> = {},
): AttendanceRecordInput => ({
  id,
  employeeId: 1,
  date: '2026-10-20',
  timeIn,
  timeOut,
  ...extra,
});

const policy = {
  ...APP_ATTENDANCE_POLICY,
  shiftStart: '08:30',
  shiftEnd: '17:30',
  lunchStart: '12:00',
  lunchEnd: '13:00',
};

describe('explicit Excel fixed daily break policy', () => {
  it('deducts a full hour from the reference late-start workday', () => {
    const result = calculateAttendanceMetrics({
      ...policy,
      timeIn: '12:48',
      timeOut: '19:48',
    });
    expect(result).toMatchObject({
      grossMinutes: 420,
      lunchDeductionMinutes: 60,
      netMinutes: 360,
      decimalHours: '6.00',
    });
  });

  it('retains selectable legacy overlap semantics', () => {
    const times = { timeIn: '12:48', timeOut: '19:48' };
    expect(calculateAttendanceMetrics(times).netMinutes).toBe(408);
    expect(
      calculateAttendanceMetrics({ ...times, lunchPolicy: 'SCHEDULED_OVERLAP' })
        .netMinutes,
    ).toBe(408);
  });

  it('deducts the fixed hour even when the entire shift starts after lunch', () => {
    expect(
      calculateAttendanceMetrics({
        ...policy,
        timeIn: '14:00',
        timeOut: '22:00',
      }),
    ).toMatchObject({
      grossMinutes: 480,
      lunchDeductionMinutes: 60,
      netMinutes: 420,
    });
  });

  it.each([
    ['00:00', '00:38', 38],
    ['10:00', '11:00', 60],
  ])(
    'keeps a short workday %s–%s paid without inferring a meal break',
    (timeIn, timeOut, netMinutes) => {
      expect(
        calculateAttendanceMetrics({ ...policy, timeIn, timeOut }),
      ).toMatchObject({
        grossMinutes: netMinutes,
        lunchDeductionMinutes: 0,
        netMinutes,
      });
    },
  );

  it('recognizes a whole hour already excluded by split lunch punches', () => {
    const rows = [record(1, '08:00', '12:00'), record(2, '13:00', '17:00')];
    expect(aggregateAttendanceRecords(rows, policy)).toMatchObject({
      grossMinutes: 480,
      lunchDeductionMinutes: 0,
      netMinutes: 480,
      daysWorked: 1,
    });
  });

  it('deducts only the missing half hour after a partial lunch gap', () => {
    const rows = [record(1, '08:00', '12:00'), record(2, '12:30', '17:00')];
    expect(aggregateAttendanceRecords(rows, policy)).toMatchObject({
      grossMinutes: 510,
      lunchDeductionMinutes: 30,
      netMinutes: 480,
    });
  });

  it('does not treat the overnight-to-morning gap as a lunch break', () => {
    const rows = [record(1, '00:00', '00:38'), record(2, '09:32', '18:13')];
    const result = aggregateAttendanceRecords(rows, policy);
    expect(result).toMatchObject({
      grossMinutes: 559,
      lunchDeductionMinutes: 60,
      netMinutes: 499,
    });
    expect(result.records[0].metrics.netMinutes).toBe(38);
  });

  it('does not credit a pre-shift gap as lunch when the daytime shift starts at 12:48', () => {
    const rows = [record(1, '00:00', '00:38'), record(2, '12:48', '19:48')];
    const result = aggregateAttendanceRecords(rows, policy);
    expect(result).toMatchObject({
      grossMinutes: 458,
      lunchDeductionMinutes: 60,
      netMinutes: 398,
    });
    expect(result.records[0].metrics.netMinutes).toBe(38);
  });

  it('deducts once across overlapping and duplicate sessions, independent of order', () => {
    const rows = [
      record(1, '08:00', '14:00'),
      record(2, '11:00', '17:00'),
      record(3, '08:00', '14:00'),
    ];
    const input = structuredClone(rows);
    const result = aggregateAttendanceRecords(rows, policy);
    const reversed = aggregateAttendanceRecords(rows.slice().reverse(), policy);
    expect(result).toMatchObject({
      grossMinutes: 540,
      lunchDeductionMinutes: 60,
      netMinutes: 480,
    });
    expect(reversed.netMinutes).toBe(result.netMinutes);
    expect(rows).toEqual(input);
    expect(result.duplicateRecordIds).toEqual([3]);
  });

  it('keeps a zero-break short session separate from the daytime automatic break', () => {
    const rows = [
      record(1, '00:00', '00:38', { lunchOverrideMinutes: 0 }),
      record(2, '09:32', '18:13'),
    ];
    const result = aggregateAttendanceRecords(rows, policy);
    expect(result).toMatchObject({
      grossMinutes: 559,
      lunchDeductionMinutes: 60,
      netMinutes: 499,
    });
    expect(result.records[0].metrics.netMinutes).toBe(38);
  });

  it('keeps explicit zero-break sessions paid without charging a short continuation', () => {
    const rows = [
      record(1, '08:00', '17:00', { lunchOverrideMinutes: 0 }),
      record(2, '18:00', '18:38'),
    ];
    expect(aggregateAttendanceRecords(rows, policy)).toMatchObject({
      lunchDeductionMinutes: 0,
      netMinutes: 578,
    });
    expect(
      aggregateAttendanceRecords(rows.slice(0, 1), policy).netMinutes,
    ).toBe(540);
  });

  it('preserves separate explicit durations instead of taking their daily maximum', () => {
    const rows = [
      record(1, '08:00', '12:00', { lunchOverrideMinutes: 30 }),
      record(2, '13:00', '17:00', { lunchOverrideMinutes: 60 }),
    ];
    expect(aggregateAttendanceRecords(rows, policy)).toMatchObject({
      grossMinutes: 480,
      lunchDeductionMinutes: 90,
      netMinutes: 390,
    });
  });

  it('tops up a recorded half-hour break once on the unmarked session', () => {
    const rows = [
      record(1, '08:00', '12:30', { lunchOverrideMinutes: 30 }),
      record(2, '12:30', '17:00'),
    ];
    const result = aggregateAttendanceRecords(rows, policy);
    expect(result).toMatchObject({
      lunchDeductionMinutes: 60,
      netMinutes: 480,
    });
    expect(
      result.records.map((row) => row.metrics.lunchDeductionMinutes),
    ).toEqual([30, 30]);
  });

  it('protects explicitly paid overlap while deducting the automatic break once elsewhere', () => {
    const rows = [
      record(1, '08:00', '14:00', { lunchOverrideMinutes: 0 }),
      record(2, '11:00', '17:00'),
    ];
    const result = aggregateAttendanceRecords(rows, policy);
    expect(result).toMatchObject({
      grossMinutes: 540,
      lunchDeductionMinutes: 60,
      netMinutes: 480,
    });
    expect(result.records[0].metrics.netMinutes).toBe(360);
    expect(
      aggregateAttendanceRecords(rows.slice().reverse(), policy).netMinutes,
    ).toBe(result.netMinutes);
  });

  it('unions conflicting explicit overlap using paid evidence without double deduction', () => {
    const rows = [
      record(1, '08:00', '14:00', { lunchOverrideMinutes: 30 }),
      record(2, '11:00', '17:00', { lunchOverrideMinutes: 0 }),
    ];
    expect(aggregateAttendanceRecords(rows, policy)).toMatchObject({
      grossMinutes: 540,
      lunchDeductionMinutes: 0,
      netMinutes: 540,
    });
    expect(
      aggregateAttendanceRecords(rows.slice().reverse(), policy).netMinutes,
    ).toBe(540);
  });

  it('does not move an actual break outside its source session onto another row', () => {
    const rows = [
      record(1, '08:00', '12:00', { breakOut: '14:00', breakIn: '14:20' }),
      record(2, '13:00', '17:00'),
    ];
    expect(aggregateAttendanceRecords(rows, policy)).toMatchObject({
      grossMinutes: 480,
      lunchDeductionMinutes: 0,
      netMinutes: 480,
    });
  });

  it('uses recorded actual break intervals instead of inferring another hour', () => {
    const rows = [
      record(1, '08:00', '17:00', { breakOut: '14:00', breakIn: '14:20' }),
    ];
    expect(aggregateAttendanceRecords(rows, policy)).toMatchObject({
      lunchDeductionMinutes: 20,
      netMinutes: 520,
    });
    expect(
      aggregateAttendanceRecords(
        [{ ...rows[0], lunchOverrideMinutes: 0 }],
        policy,
      ).netMinutes,
    ).toBe(540);
  });

  it('caps an explicit duration at recorded work, preventing negative hours', () => {
    expect(
      aggregateAttendanceRecords(
        [record(1, '10:00', '10:38', { lunchOverrideMinutes: 90 })],
        policy,
      ),
    ).toMatchObject({
      grossMinutes: 38,
      lunchDeductionMinutes: 38,
      netMinutes: 0,
    });
  });

  it('deducts only once for contiguous split midnight sessions', () => {
    const rows = [
      record(1, '20:00', '23:59', { date: '2026-10-20' }),
      record(2, '00:00', '02:00', { date: '2026-10-21' }),
    ];
    const result = aggregateAttendanceRecords(rows, policy);
    expect(result).toMatchObject({
      grossMinutes: 359,
      lunchDeductionMinutes: 60,
      netMinutes: 299,
      daysWorked: 1,
    });
    expect(result.records[0].metrics.netMinutes).toBe(179);
    expect(result.records[1].metrics.netMinutes).toBe(120);
    const first = aggregateAttendanceRecords(rows, {
      ...policy,
      startDate: '2026-10-20',
      endDate: '2026-10-20',
    });
    const second = aggregateAttendanceRecords(rows, {
      ...policy,
      startDate: '2026-10-21',
      endDate: '2026-10-21',
    });
    expect(first.netMinutes + second.netMinutes).toBe(result.netMinutes);
    expect(
      aggregateAttendanceRecords(rows.slice().reverse(), policy).netMinutes,
    ).toBe(result.netMinutes);
  });

  it('keeps the next daytime session separate from a midnight continuation', () => {
    const rows = [
      record(1, '20:00', '23:59', { date: '2026-10-20' }),
      record(2, '00:00', '02:00', { date: '2026-10-21' }),
      record(3, '08:00', '17:00', { date: '2026-10-21' }),
    ];
    expect(aggregateAttendanceRecords(rows, policy)).toMatchObject({
      lunchDeductionMinutes: 120,
      netMinutes: 779,
      daysWorked: 2,
    });
  });

  it('handles an overnight shift and its post-midnight continuation as one workday', () => {
    const rows = [
      record(1, '22:00', '23:59'),
      record(2, '00:00', '06:00', { date: '2026-10-21' }),
    ];
    expect(
      aggregateAttendanceRecords(rows, {
        ...policy,
        shiftStart: '22:00',
        shiftEnd: '06:00',
        lunchStart: '02:00',
        lunchEnd: '03:00',
      }),
    ).toMatchObject({
      lunchDeductionMinutes: 60,
      netMinutes: 419,
      daysWorked: 1,
    });
  });

  it('keeps employees and paid leave independent of the daily break', () => {
    const rows = [
      record(1, '08:00', '17:00'),
      record(2, '08:00', '17:00', { employeeId: 2 }),
      record(3, 'LEAVE', 'PAID', { employeeId: 3 }),
    ];
    expect(aggregateAttendanceRecords(rows, policy)).toMatchObject({
      lunchDeductionMinutes: 120,
      netMinutes: 1440,
      daysWorked: 3,
    });
  });

  it('reproduces the reference cutoff total and overtime without personal fixture data', () => {
    const dates = [
      '12',
      '13',
      '14',
      '15',
      '16',
      '17',
      '19',
      '21',
      '22',
      '23',
      '24',
    ];
    const rows = dates.map((day, index) =>
      record(index + 1, '08:00', index === 10 ? '20:07' : '18:00', {
        date: `2026-10-${day}`,
      }),
    );
    rows.push(record(12, '12:48', '19:48'));
    const result = calculateAttendancePayroll(rows, {
      ...policy,
      employeeId: 1,
      startDate: '2026-10-11',
      endDate: '2026-10-25',
      daysWorked: 12,
      basicSalary: 9060,
      ratePerDay: 755,
      overtimeBasis: 'CUTOFF_NET',
    });
    expect(result).toMatchObject({
      totalMinutes: 6427,
      requiredMinutes: 5760,
      overtimeMinutes: 667,
      otPay: 1311.42,
      grossPay: 10371.42,
    });
    expect(Math.round((result.grossPay - 981.5) * 100) / 100).toBe(9389.92);
  });
});
