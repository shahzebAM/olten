jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn() }));

import {
  aggregateAttendanceRecords,
  calculateAttendancePayroll,
  type AttendancePayrollOptions,
  type AttendanceRecordInput,
} from './attendance-calculator';
import { calculatePhilippinePayrollTax } from './employees.service';

const row = (
  id: number,
  date: string,
  timeIn: string,
  timeOut: string,
): AttendanceRecordInput => ({ id, employeeId: 1, date, timeIn, timeOut });

// The user requested minute-only entry. These are the supplied Excel punches
// with seconds removed, so their total differs from Excel's 114.605 hours.
const excelMinuteRows = [
  row(1, '2026-08-11', '07:34', '18:31'),
  row(2, '2026-08-12', '09:41', '18:18'),
  row(3, '2026-08-13', '09:35', '19:13'),
  row(4, '2026-08-14', '08:49', '18:38'),
  row(5, '2026-08-15', '09:02', '20:04'),
  row(6, '2026-08-17', '09:17', '20:22'),
  row(7, '2026-08-18', '08:52', '17:53'),
  row(8, '2026-08-19', '09:10', '18:15'),
  row(9, '2026-08-20', '06:30', '18:07'),
  row(10, '2026-08-21', '09:22', '18:36'),
  row(11, '2026-08-22', '09:20', '16:11'),
  row(12, '2026-08-24', '09:11', '20:04'),
  row(13, '2026-08-25', '08:29', '18:20'),
];

// The separate app example contains 14 sessions across 13 attendance dates.
const appRows = [
  row(1, '2026-09-26', '09:14', '20:01'),
  row(2, '2026-09-28', '08:28', '22:06'),
  row(3, '2026-09-29', '08:47', '22:06'),
  row(4, '2026-09-30', '09:04', '17:39'),
  row(5, '2026-10-01', '09:08', '18:13'),
  row(6, '2026-10-02', '09:21', '22:27'),
  row(7, '2026-10-03', '09:44', '18:33'),
  row(8, '2026-10-05', '09:03', '23:59'),
  row(9, '2026-10-06', '09:32', '18:13'),
  row(10, '2026-10-06', '00:00', '00:38'),
  row(11, '2026-10-07', '07:25', '16:03'),
  row(12, '2026-10-08', '09:08', '18:05'),
  row(13, '2026-10-09', '09:21', '19:14'),
  row(14, '2026-10-10', '09:12', '18:16'),
];

const options: AttendancePayrollOptions = {
  employeeId: 1,
  startDate: '2026-08-11',
  endDate: '2026-08-25',
  daysWorked: 14,
  basicSalary: 10570,
  ratePerDay: 755,
  shiftStart: '08:30',
  shiftEnd: '17:30',
  lunchStart: '12:00',
  lunchEnd: '13:00',
};

describe('Excel cutoff payroll calculations with minute-only attendance', () => {
  it('uses the Excel formula on minute-only punches without inventing source seconds', () => {
    const before = structuredClone(excelMinuteRows);
    const summary = calculateAttendancePayroll(excelMinuteRows, options);
    expect(summary).toMatchObject({
      overtimeBasis: 'CUTOFF_NET',
      totalMinutes: 6880,
      requiredMinutes: 6720,
      regularMinutes: 6720,
      overtimeMinutes: 160,
      basicSalary: 10570,
      ratePerDay: 755,
      ratePerHour: 94.375,
      undertimeMinutes: 0,
      undertimeDeduction: 0,
      otPay: 314.58,
      grossPay: 10884.58,
    });
    expect(
      calculatePhilippinePayrollTax({
        grossPay: summary.grossPay,
        sssDeduction: 975,
        isDeclared: false,
      }),
    ).toMatchObject({ totalDeductions: 975, netPay: 9909.58 });
    expect(excelMinuteRows).toEqual(before);
  });

  it('uses the same formula for the independently supplied app punches', () => {
    const summary = calculateAttendancePayroll(appRows, {
      ...options,
      startDate: '2026-09-26',
      endDate: '2026-10-10',
    });
    expect(summary).toMatchObject({
      overtimeBasis: 'CUTOFF_NET',
      totalMinutes: 7506,
      regularMinutes: 6720,
      overtimeMinutes: 786,
      undertimeMinutes: 0,
      otPay: 1545.39,
      grossPay: 12115.39,
    });
    expect(
      calculatePhilippinePayrollTax({
        grossPay: summary.grossPay,
        sssDeduction: 975,
        isDeclared: false,
      }).netPay,
    ).toBe(11140.39);
  });

  it('calculates 114h 36m precisely without rounding hours before pay', () => {
    const records = Array.from({ length: 12 }, (_, index) =>
      row(index + 1, `2026-08-${11 + index}`, '08:00', '18:00'),
    );
    records.push(row(13, '2026-08-25', '08:00', '15:36'));
    const summary = calculateAttendancePayroll(records, options);
    expect(summary.totalMinutes).toBe(6876);
    expect(summary.overtimeMinutes).toBe(156);
    expect(summary.otPay).toBe(306.72);
    expect(summary.grossPay).toBe(10876.72);
  });

  it('nets a nine-hour and seven-hour day while preserving explicit daily overtime', () => {
    const records = [
      row(1, '2026-08-11', '08:00', '18:00'),
      row(2, '2026-08-12', '08:00', '16:00'),
    ];
    const twoDays = { ...options, daysWorked: 2, basicSalary: 1510 };
    expect(calculateAttendancePayroll(records, twoDays)).toMatchObject({
      overtimeBasis: 'CUTOFF_NET',
      totalMinutes: 960,
      regularMinutes: 960,
      overtimeMinutes: 0,
      undertimeMinutes: 0,
      otPay: 0,
      undertimeDeduction: 0,
      grossPay: 1510,
    });
    expect(
      calculateAttendancePayroll(records, {
        ...twoDays,
        overtimeBasis: 'DAILY',
      }),
    ).toMatchObject({
      overtimeBasis: 'DAILY',
      regularMinutes: 900,
      overtimeMinutes: 60,
      undertimeMinutes: 60,
      otPay: 117.97,
      undertimeDeduction: 94.38,
      grossPay: 1533.59,
    });
    expect(aggregateAttendanceRecords(records).otMinutes).toBe(60);
  });

  it.each([
    ['16:00', 420, 60, 94.38, 660.62],
    ['17:00', 480, 0, 0, 755],
    ['18:00', 540, 0, 0, 872.97],
  ])(
    'uses normal hourly deductions and 125 percent excess pay for an end time of %s',
    (end, total, shortage, deduction, gross) => {
      const summary = calculateAttendancePayroll(
        [row(1, '2026-08-11', '08:00', end)],
        { ...options, daysWorked: 1, basicSalary: 755 },
      );
      expect(summary.totalMinutes).toBe(total);
      expect(summary.undertimeMinutes).toBe(shortage);
      expect(summary.undertimeDeduction).toBe(deduction);
      expect(summary.grossPay).toBe(gross);
    },
  );

  it('deducts a full absence at the normal rate without changing the saved basic salary', () => {
    expect(calculateAttendancePayroll([], options)).toMatchObject({
      totalMinutes: 0,
      regularMinutes: 0,
      overtimeMinutes: 0,
      undertimeMinutes: 6720,
      undertimeDeduction: 10570,
      basicSalary: 10570,
      otPay: 0,
      grossPay: 0,
    });
  });

  it('retains paid-leave credit once and does not credit unpaid leave', () => {
    const records = [
      row(1, '2026-08-11', 'LEAVE', 'PAID'),
      row(2, '2026-08-11', 'LEAVE', 'PAID'),
      row(3, '2026-08-12', 'LEAVE', 'UNPAID'),
    ];
    expect(
      calculateAttendancePayroll(records, {
        ...options,
        daysWorked: 2,
        basicSalary: 1510,
      }),
    ).toMatchObject({
      totalMinutes: 480,
      overtimeMinutes: 0,
      undertimeMinutes: 480,
      undertimeDeduction: 755,
      grossPay: 755,
    });
  });
});
