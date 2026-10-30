import {
  APP_ATTENDANCE_POLICY,
  aggregateAttendanceRecords,
  calculateAttendancePayroll,
  type AttendancePayrollOptions,
  type AttendanceRecordInput,
} from './attendance-calculator';
import { calculatePayrollAmounts, toPayrollMoneyCents } from './payroll-money';

const options: AttendancePayrollOptions = {
  ...APP_ATTENDANCE_POLICY,
  employeeId: 1,
  startDate: '2026-10-11',
  endDate: '2026-10-25',
  daysWorked: 12,
  basicSalary: 9060,
  ratePerDay: 755,
  overtimeBasis: 'CUTOFF_NET',
  workingWeekdays: [1, 2, 3, 4, 5, 6],
  shiftStart: '08:30',
  shiftEnd: '17:30',
  lunchStart: '12:00',
  lunchEnd: '13:00',
};

const row = (
  id: number,
  date: string,
  timeIn: string,
  timeOut: string,
  extra: Partial<AttendanceRecordInput> = {},
): AttendanceRecordInput => ({
  id,
  employeeId: 1,
  date,
  timeIn,
  timeOut,
  ...extra,
});

const referenceRows = () => [
  row(1, '2026-10-12', '09:41', '18:46'),
  row(2, '2026-10-13', '08:14', '18:10'),
  row(3, '2026-10-14', '08:28', '18:00'),
  row(4, '2026-10-15', '08:24', '18:00'),
  row(5, '2026-10-16', '08:36', '18:14'),
  row(6, '2026-10-17', '08:24', '18:18'),
  row(7, '2026-10-18', '07:42', '20:08'),
  row(8, '2026-10-19', '08:47', '17:44'),
  row(9, '2026-10-20', '06:41', '19:33'),
  row(10, '2026-10-21', '09:00', '18:00'),
  row(11, '2026-10-22', '09:00', '18:00'),
  row(12, '2026-10-23', '09:00', '18:00'),
  row(13, '2026-10-24', '08:45', '18:34'),
];

describe('scheduled rest-day attendance and exact pay', () => {
  it('separates the complete reference cutoff from its Sunday work', () => {
    const rows = referenceRows();
    const before = structuredClone(rows);
    const result = calculateAttendancePayroll(rows, options);
    expect(result).toMatchObject({
      totalMinutes: 6945,
      ordinaryMinutes: 6259,
      requiredMinutes: 5760,
      regularMinutes: 5760,
      overtimeMinutes: 499,
      restDayMinutes: 686,
      restDayRegularMinutes: 480,
      restDayOvertimeMinutes: 206,
      totalOvertimeMinutes: 705,
      restDayCount: 1,
      restDayDates: ['2026-10-18'],
      otPay: 981.11,
      restDayRegularPay: 981.5,
      restDayOvertimePay: 547.6,
      restDayPay: 1529.1,
      undertimeDeduction: 0,
      roundingAdjustment: -0.01,
      grossPay: 11570.2,
    });
    expect(toPayrollMoneyCents(result.grossPay) - 198150).toBe(958870);
    expect(rows).toEqual(before);
    expect(
      toPayrollMoneyCents(result.basicSalary) +
        toPayrollMoneyCents(result.otPay) +
        toPayrollMoneyCents(result.restDayPay) +
        toPayrollMoneyCents(result.roundingAdjustment),
    ).toBe(toPayrollMoneyCents(result.grossPay));
  });

  it('retains legacy inclusion when no working-weekday schedule is provided', () => {
    const result = calculateAttendancePayroll(referenceRows(), {
      ...options,
      workingWeekdays: undefined,
      daysWorked: 14,
      basicSalary: 9815,
      ratePerDay: undefined,
    });
    expect(result).toMatchObject({
      totalMinutes: 6945,
      ordinaryMinutes: 6945,
      restDayMinutes: 0,
      restDayPay: 0,
      overtimeMinutes: 225,
      otPay: 410.78,
      grossPay: 10225.78,
    });
  });

  it('pays the first eight rest-day hours at 130 percent', () => {
    const result = calculateAttendancePayroll(
      [row(1, '2026-10-18', '08:00', '17:00')],
      { ...options, daysWorked: 0, basicSalary: 0 },
    );
    expect(result).toMatchObject({
      ordinaryMinutes: 0,
      restDayMinutes: 480,
      restDayRegularMinutes: 480,
      restDayOvertimeMinutes: 0,
      restDayPay: 981.5,
      grossPay: 981.5,
    });
  });

  it('does not let rest-day work replace a missing ordinary hour', () => {
    const result = calculateAttendancePayroll(
      [
        row(1, '2026-10-12', '08:00', '16:00'),
        row(2, '2026-10-18', '08:00', '17:00'),
      ],
      { ...options, daysWorked: 1, basicSalary: 755 },
    );
    expect(result).toMatchObject({
      totalMinutes: 900,
      ordinaryMinutes: 420,
      requiredMinutes: 480,
      overtimeMinutes: 0,
      undertimeMinutes: 60,
      undertimeDeduction: 94.38,
      restDayPay: 981.5,
      roundingAdjustment: 0.01,
      grossPay: 1642.13,
    });
  });

  it('uses the configured workweek instead of treating every Sunday as a rest day', () => {
    const result = calculateAttendancePayroll(
      [
        row(1, '2026-10-17', '08:00', '17:00'),
        row(2, '2026-10-18', '08:00', '17:00'),
      ],
      { ...options, workingWeekdays: [0, 1, 2, 3, 4, 5] },
    );
    expect(result).toMatchObject({
      ordinaryMinutes: 480,
      restDayMinutes: 480,
      restDayDates: ['2026-10-17'],
      restDayPay: 981.5,
    });
  });

  it('applies an independent eight-hour rest-day cap to each workday', () => {
    const result = calculateAttendancePayroll(
      [
        row(1, '2026-10-11', '07:00', '19:27'),
        row(2, '2026-10-18', '07:00', '19:27'),
      ],
      { ...options, daysWorked: 0, basicSalary: 0 },
    );
    expect(result).toMatchObject({
      restDayCount: 2,
      restDayRegularMinutes: 960,
      restDayOvertimeMinutes: 414,
      restDayPay: 3063.51,
      grossPay: 3063.51,
    });
  });

  it('shares the rest-day cap and a recorded lunch gap across split sessions', () => {
    const result = calculateAttendancePayroll(
      [
        row(1, '2026-10-18', '08:00', '12:00'),
        row(2, '2026-10-18', '13:00', '19:00'),
      ],
      options,
    );
    expect(result).toMatchObject({
      lunchDeductionMinutes: 0,
      restDayMinutes: 600,
      restDayRegularMinutes: 480,
      restDayOvertimeMinutes: 120,
      restDayPay: 1300.49,
    });
  });

  it('does not multiply rest-day hours or premiums for overlapping duplicates', () => {
    const result = calculateAttendancePayroll(
      [
        row(1, '2026-10-18', '08:00', '17:00'),
        row(2, '2026-10-18', '11:00', '20:00'),
        row(3, '2026-10-18', '08:00', '17:00'),
      ],
      options,
    );
    expect(result).toMatchObject({
      restDayMinutes: 660,
      restDayRegularMinutes: 480,
      restDayOvertimeMinutes: 180,
      restDayPay: 1459.98,
      restDayCount: 1,
    });
  });

  it('keeps one rest-day cap across a connected midnight continuation and adjacent cutoffs', () => {
    const rows = [
      row(1, '2026-10-25', '15:00', '23:59'),
      row(2, '2026-10-26', '00:00', '02:00'),
    ];
    const full = calculateAttendancePayroll(rows, {
      ...options,
      startDate: '2026-10-25',
      endDate: '2026-10-26',
    });
    const first = calculateAttendancePayroll(rows, {
      ...options,
      startDate: '2026-10-25',
      endDate: '2026-10-25',
    });
    const second = calculateAttendancePayroll(rows, {
      ...options,
      startDate: '2026-10-26',
      endDate: '2026-10-26',
    });
    expect(full).toMatchObject({
      restDayMinutes: 599,
      restDayRegularMinutes: 480,
      restDayOvertimeMinutes: 119,
    });
    expect(first.restDayRegularMinutes + second.restDayRegularMinutes).toBe(
      480,
    );
    expect(first.restDayOvertimeMinutes + second.restDayOvertimeMinutes).toBe(
      119,
    );
    expect(first.restDayMinutes + second.restDayMinutes).toBe(
      full.restDayMinutes,
    );
  });

  it('assigns the first rest hours chronologically rather than applying ordinary early-arrival overtime', () => {
    const rows = [
      row(1, '2026-10-25', '21:00', '23:59'),
      row(2, '2026-10-26', '00:00', '10:00'),
    ];
    const overnight = {
      ...options,
      shiftStart: '22:00',
      shiftEnd: '06:00',
      lunchStart: '02:00',
      lunchEnd: '03:00',
    };
    const first = calculateAttendancePayroll(rows, {
      ...overnight,
      startDate: '2026-10-25',
      endDate: '2026-10-25',
    });
    const second = calculateAttendancePayroll(rows, {
      ...overnight,
      startDate: '2026-10-26',
      endDate: '2026-10-26',
    });
    expect(first).toMatchObject({
      restDayMinutes: 179,
      restDayRegularMinutes: 179,
      restDayOvertimeMinutes: 0,
    });
    expect(second).toMatchObject({
      restDayMinutes: 540,
      restDayRegularMinutes: 301,
      restDayOvertimeMinutes: 239,
    });
    expect(aggregateAttendanceRecords(rows, overnight).earlyOtMinutes).toBe(60);
  });

  it('retains daily ordinary overtime and separate shortfalls alongside rest-day pay', () => {
    const result = calculateAttendancePayroll(
      [
        row(1, '2026-10-12', '08:00', '18:00'),
        row(2, '2026-10-13', '08:00', '16:00'),
        row(3, '2026-10-18', '08:00', '19:00'),
      ],
      { ...options, daysWorked: 2, basicSalary: 1510, overtimeBasis: 'DAILY' },
    );
    expect(result).toMatchObject({
      ordinaryMinutes: 960,
      regularMinutes: 900,
      overtimeMinutes: 60,
      undertimeMinutes: 60,
      otPay: 117.97,
      undertimeDeduction: 94.38,
      restDayRegularMinutes: 480,
      restDayOvertimeMinutes: 120,
      totalOvertimeMinutes: 180,
      grossPay: 2834.08,
    });
  });

  it('does not pay a rest-day premium on leave while preserving its existing ordinary credit', () => {
    const result = calculateAttendancePayroll(
      [row(1, '2026-10-18', 'LEAVE', 'PAID')],
      { ...options, daysWorked: 1, basicSalary: 755 },
    );
    expect(result).toMatchObject({
      totalMinutes: 480,
      ordinaryMinutes: 480,
      restDayMinutes: 0,
      restDayCount: 0,
      restDayPay: 0,
      grossPay: 755,
    });
  });

  it('pays premiums only for actual work when a rest workday also has paid leave', () => {
    const result = calculateAttendancePayroll(
      [
        row(1, '2026-10-18', '08:00', '10:00'),
        row(2, '2026-10-18', 'LEAVE', 'PAID'),
      ],
      { ...options, daysWorked: 1, basicSalary: 755 },
    );
    expect(result).toMatchObject({
      ordinaryMinutes: 420,
      restDayMinutes: 60,
      restDayRegularMinutes: 60,
      restDayOvertimeMinutes: 0,
      restDayPay: 122.69,
    });
  });

  it('uses eight rest-day hours even when the ordinary attendance cap is customized', () => {
    const result = calculateAttendancePayroll(
      [row(1, '2026-10-18', '08:00', '17:00')],
      { ...options, maxRegularMinutes: 240 },
    );
    expect(result).toMatchObject({
      restDayMinutes: 480,
      restDayRegularMinutes: 480,
      restDayOvertimeMinutes: 0,
      restDayPay: 981.5,
    });
  });

  it('does not convert paid-leave top-ups to rest-day pay under a customized ordinary cap', () => {
    const result = calculateAttendancePayroll(
      [
        row(1, '2026-10-18', '08:00', '10:00'),
        row(2, '2026-10-18', 'LEAVE', 'PAID'),
      ],
      { ...options, maxRegularMinutes: 240 },
    );
    expect(result).toMatchObject({
      restDayMinutes: 60,
      restDayRegularMinutes: 60,
      restDayOvertimeMinutes: 0,
      restDayPay: 122.69,
    });
  });

  it.each([
    { weekdays: [] },
    { weekdays: [7] },
    { weekdays: [1, 1] },
    { weekdays: [1.5] },
  ])('rejects an invalid workweek: %j', ({ weekdays }) => {
    expect(() =>
      calculateAttendancePayroll([], { ...options, workingWeekdays: weekdays }),
    ).toThrow(RangeError);
  });

  it('keeps the exact original salary divisor through rest-day rate calculations', () => {
    const result = calculatePayrollAmounts({
      basicSalary: 1.2,
      daysWorked: 7,
      ratePerDay: 1.2 / 7,
      rateSource: { amount: 1.2, days: 7 },
      overtimeMinutes: 0,
      undertimeMinutes: 0,
      restDayRegularMinutes: 56,
      restDayOvertimeMinutes: 0,
    });
    // (1.20 / 7) * (56 / 480) * 1.30 = 0.026 exactly.
    expect(result.restDayPay).toBe(0.03);
    expect(result.grossPay).toBe(1.23);
  });
});
