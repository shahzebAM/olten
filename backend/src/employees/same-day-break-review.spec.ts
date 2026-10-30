import {
  APP_ATTENDANCE_POLICY,
  aggregateAttendanceRecords,
  type AttendanceRecordInput,
} from './attendance-calculator';

const policy = {
  ...APP_ATTENDANCE_POLICY,
  shiftStart: '08:30',
  shiftEnd: '17:30',
  lunchStart: '12:00',
  lunchEnd: '13:00',
};

const session = (
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

// These expectations credit time already excluded by daytime OUT/IN punches.
// They do not infer a zero-break exception for every multi-session workday.
describe('one daily automatic break across separate source sessions', () => {
  it('credits a recorded hour-long daytime gap before the configured noon window', () => {
    const rows = [session(1, '08:30', '11:00'), session(2, '12:00', '17:30')];
    expect(aggregateAttendanceRecords(rows, policy)).toMatchObject({
      grossMinutes: 480,
      lunchDeductionMinutes: 0,
      netMinutes: 480,
      daysWorked: 1,
    });
  });

  it('deducts only the missing half hour when the recorded daytime gap ends at noon', () => {
    const rows = [session(1, '08:30', '11:30'), session(2, '12:00', '17:30')];
    expect(aggregateAttendanceRecords(rows, policy)).toMatchObject({
      grossMinutes: 510,
      lunchDeductionMinutes: 30,
      netMinutes: 480,
    });
  });

  it('combines separate daytime off-clock gaps toward the one-hour allowance', () => {
    const rows = [
      session(1, '08:30', '10:00'),
      session(2, '10:45', '14:00'),
      session(3, '14:15', '17:30'),
    ];
    const before = structuredClone(rows);
    const result = aggregateAttendanceRecords(rows, policy);
    expect(result).toMatchObject({
      grossMinutes: 480,
      lunchDeductionMinutes: 0,
      netMinutes: 480,
    });
    expect(
      aggregateAttendanceRecords(rows.slice().reverse(), policy).netMinutes,
    ).toBe(result.netMinutes);
    expect(rows).toEqual(before);
  });

  it('still deducts once when multiple source rows contain no off-clock gap', () => {
    const rows = [session(1, '08:30', '11:00'), session(2, '11:00', '17:30')];
    expect(aggregateAttendanceRecords(rows, policy)).toMatchObject({
      grossMinutes: 540,
      lunchDeductionMinutes: 60,
      netMinutes: 480,
    });
  });

  it('unions overlapping rows and duplicates instead of treating them as break gaps', () => {
    const rows = [
      session(1, '08:30', '14:00'),
      session(2, '11:00', '17:30'),
      session(3, '08:30', '14:00'),
    ];
    const result = aggregateAttendanceRecords(rows, policy);
    expect(result).toMatchObject({
      grossMinutes: 540,
      lunchDeductionMinutes: 60,
      netMinutes: 480,
    });
    expect(result.duplicateRecordIds).toEqual([3]);
  });

  it('does not turn a pre-shift midnight extra into an inferred daytime meal gap', () => {
    const rows = [session(1, '00:00', '00:38'), session(2, '12:48', '19:48')];
    const result = aggregateAttendanceRecords(rows, policy);
    expect(result).toMatchObject({
      grossMinutes: 458,
      lunchDeductionMinutes: 60,
      netMinutes: 398,
    });
    expect(result.records[0].metrics.netMinutes).toBe(38);
  });

  it('preserves explicit no-break evidence separately on afternoon split sessions', () => {
    const rows = [
      session(1, '13:01', '15:00', { lunchOverrideMinutes: 0 }),
      session(2, '15:30', '18:20', { lunchOverrideMinutes: 0 }),
    ];
    expect(aggregateAttendanceRecords(rows, policy)).toMatchObject({
      grossMinutes: 289,
      lunchDeductionMinutes: 0,
      netMinutes: 289,
    });
  });

  it('does not erase explicit session break durations because another row has a gap', () => {
    const rows = [
      session(1, '08:30', '11:00', { lunchOverrideMinutes: 30 }),
      session(2, '12:00', '17:30', { lunchOverrideMinutes: 60 }),
    ];
    expect(aggregateAttendanceRecords(rows, policy)).toMatchObject({
      grossMinutes: 480,
      lunchDeductionMinutes: 90,
      netMinutes: 390,
    });
  });

  it('preserves a configured overnight meal gap across same-date sessions', () => {
    const rows = [session(1, '00:00', '02:00'), session(2, '03:00', '06:00')];
    expect(
      aggregateAttendanceRecords(rows, {
        ...policy,
        shiftStart: '22:00',
        shiftEnd: '06:00',
        lunchStart: '02:00',
        lunchEnd: '03:00',
      }),
    ).toMatchObject({
      grossMinutes: 300,
      lunchDeductionMinutes: 0,
      netMinutes: 300,
      daysWorked: 1,
    });
  });

  it('does not credit time off between the scheduled shift and a later extra session', () => {
    const rows = [session(1, '08:30', '17:30'), session(2, '19:00', '21:00')];
    expect(aggregateAttendanceRecords(rows, policy)).toMatchObject({
      grossMinutes: 660,
      lunchDeductionMinutes: 60,
      netMinutes: 600,
    });
  });

  it('does not credit time off between a pre-shift extra session and the scheduled shift', () => {
    const rows = [session(1, '06:00', '07:00'), session(2, '08:30', '17:30')];
    expect(aggregateAttendanceRecords(rows, policy)).toMatchObject({
      grossMinutes: 600,
      lunchDeductionMinutes: 60,
      netMinutes: 540,
    });
  });

  it('keeps break allowances separate for employees and calendar workdays', () => {
    const rows = [
      session(1, '08:30', '11:00'),
      session(2, '12:00', '17:30'),
      session(3, '08:30', '17:30', { employeeId: 2 }),
      session(4, '08:30', '17:30', { date: '2026-10-21' }),
    ];
    expect(aggregateAttendanceRecords(rows, policy)).toMatchObject({
      grossMinutes: 1560,
      lunchDeductionMinutes: 120,
      netMinutes: 1440,
      daysWorked: 3,
    });
  });
});
