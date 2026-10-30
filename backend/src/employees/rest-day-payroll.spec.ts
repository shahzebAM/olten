jest.mock('@prisma/client', () => {
  const actual =
    jest.requireActual<typeof import('@prisma/client')>('@prisma/client');
  const mockDatabase = {
    employee: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    settings: { findUnique: jest.fn() },
    attendance: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    payroll: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  return {
    PrismaClient: jest.fn(() => mockDatabase),
    Prisma: actual.Prisma,
    mockDatabase,
  };
});

import { ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { APP_ATTENDANCE_POLICY } from './attendance-calculator';
import {
  EmployeesService,
  PAYROLL_CALCULATION_VERSION,
} from './employees.service';
import { validatePayrollProfile } from './payroll-profile';
import type { PayrollProfile } from './payroll-profile';

const profile: PayrollProfile = {
  version: 1,
  basis: 'DAILY',
  dailyRate: 755,
  paidDayBasis: 'SCHEDULED',
  overtimeBasis: 'CUTOFF_NET',
  workingWeekdays: [1, 2, 3, 4, 5, 6],
};
const employee = {
  id: 1,
  firstName: 'Reference',
  lastName: 'Employee',
  company: 'Example Company',
  baseRate: 9815,
  payrollProfile: profile,
  cashAdvanceBalance: 3000,
  cashAdvanceInstallment: 1000,
  loanBalance: 0,
  loanInstallment: 0,
};
const settings = {
  id: 1,
  company: employee.company,
  shiftStart: '08:30',
  shiftEnd: '17:30',
  lunchStart: '12:00',
  lunchEnd: '13:00',
};
interface SourceRow {
  id: number;
  employeeId: number;
  date: string;
  timeIn: string;
  timeOut: string;
  hours: number;
  shiftStart: string;
  shiftEnd: string;
  lunchStart: string;
  lunchEnd: string;
  breakOut: null;
  breakIn: null;
  lunchOverrideMinutes: null;
}
type SavedPayroll = Record<string, unknown>;
interface MockDatabase {
  employee: {
    findUnique: jest.Mock<Promise<typeof employee>>;
    findMany: jest.Mock<Promise<Array<typeof employee>>>;
    update: jest.Mock;
  };
  settings: { findUnique: jest.Mock<Promise<typeof settings>> };
  attendance: {
    findMany: jest.Mock<Promise<SourceRow[]>>;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  payroll: {
    findMany: jest.Mock<Promise<SavedPayroll[]>>;
    create: jest.Mock<Promise<SavedPayroll>, [{ data: SavedPayroll }]>;
    update: jest.Mock;
    delete: jest.Mock;
  };
  $transaction: jest.Mock<
    Promise<unknown>,
    [(client: MockDatabase) => Promise<unknown>, unknown?]
  >;
}
const database = jest.requireMock<{ mockDatabase: MockDatabase }>(
  '@prisma/client',
).mockDatabase;
const row = (
  id: number,
  day: string,
  timeIn: string,
  timeOut: string,
): SourceRow => ({
  id,
  employeeId: employee.id,
  date: `2026-10-${day}`,
  timeIn,
  timeOut,
  // The source cache is deliberately wrong: previews must use the punches.
  hours: 999,
  shiftStart: settings.shiftStart,
  shiftEnd: settings.shiftEnd,
  lunchStart: settings.lunchStart,
  lunchEnd: settings.lunchEnd,
  breakOut: null,
  breakIn: null,
  lunchOverrideMinutes: null,
});
const input = {
  employeeId: employee.id,
  company: employee.company,
  cutoffStart: '2026-10-11',
  cutoffEnd: '2026-10-25',
  isDeclared: false,
  cashAdvance: 1000,
  pagIbigDeduct: 490.75,
  philhealthDeduct: 490.75,
};

// The source amounts are anonymous minute-only attendance fixtures. The Sunday
// is intentionally present alongside all twelve scheduled working dates.
const referenceRows = () => [
  row(1, '12', '09:41', '18:46'),
  row(2, '13', '08:14', '18:10'),
  row(3, '14', '08:28', '18:00'),
  row(4, '15', '08:24', '18:00'),
  row(5, '16', '08:36', '18:14'),
  row(6, '17', '08:24', '18:18'),
  row(7, '18', '07:42', '20:08'),
  row(8, '19', '08:47', '17:44'),
  row(9, '20', '06:41', '19:33'),
  row(10, '21', '09:00', '18:00'),
  row(11, '22', '09:00', '18:00'),
  row(12, '23', '09:00', '18:00'),
  row(13, '24', '08:45', '18:34'),
];

describe('scheduled rest-day pay through the payroll service', () => {
  let service: EmployeesService;
  let sourceRows: SourceRow[];
  let savedPayrolls: SavedPayroll[];

  beforeEach(() => {
    jest.clearAllMocks();
    sourceRows = referenceRows();
    savedPayrolls = [];
    database.employee.findUnique.mockResolvedValue(structuredClone(employee));
    database.employee.findMany.mockResolvedValue([structuredClone(employee)]);
    database.settings.findUnique.mockResolvedValue(settings);
    database.attendance.findMany.mockImplementation(() =>
      Promise.resolve(structuredClone(sourceRows)),
    );
    database.payroll.findMany.mockImplementation(() =>
      Promise.resolve(structuredClone(savedPayrolls)),
    );
    database.payroll.create.mockImplementation(({ data }) => {
      const saved = structuredClone({ id: savedPayrolls.length + 1, ...data });
      savedPayrolls.push(saved);
      return Promise.resolve(saved);
    });
    database.$transaction.mockImplementation((work) => work(database));
    service = new EmployeesService();
  });

  const expectNoHistoryWrites = () => {
    expect(database.employee.update).not.toHaveBeenCalled();
    expect(database.attendance.create).not.toHaveBeenCalled();
    expect(database.attendance.update).not.toHaveBeenCalled();
    expect(database.attendance.delete).not.toHaveBeenCalled();
    expect(database.payroll.update).not.toHaveBeenCalled();
    expect(database.payroll.delete).not.toHaveBeenCalled();
  };

  it('separates ordinary and rest-day hours and calculates approved premium pay', async () => {
    const before = structuredClone(sourceRows);
    const preview = await service.previewPayroll(input);

    expect(preview.attendanceSummary).toMatchObject({
      calculationVersion: PAYROLL_CALCULATION_VERSION,
      lunchPolicy: 'FIXED_DAILY',
      grossMinutes: 7725,
      lunchDeductionMinutes: 780,
      totalMinutes: 6945,
      ordinaryMinutes: 6259,
      restDayMinutes: 686,
      restDayCount: 1,
      restDayRegularMinutes: 480,
      restDayOvertimeMinutes: 206,
      requiredMinutes: 5760,
      overtimeMinutes: 499,
      basicSalary: 9060,
      ratePerDay: 755,
      ratePerHour: 94.375,
      otPay: 981.11,
      undertimeDeduction: 0,
      restDayRegularPay: 981.5,
      restDayOvertimePay: 547.6,
      restDayPay: 1529.1,
      roundingAdjustment: -0.01,
      grossPay: 11570.2,
      paidDays: 12,
    });
    expect(preview.source).toMatchObject({
      workedDateCount: 13,
      sessionCount: 13,
    });
    expect(preview.computed).toMatchObject({
      grossPay: 11570.2,
      totalDeductions: 1981.5,
      netPay: 9588.7,
    });
    expect(sourceRows).toEqual(before);
    expect(database.payroll.create).not.toHaveBeenCalled();
    expectNoHistoryWrites();
  });

  it('does not increase scheduled paid days because an extra Sunday was worked', async () => {
    const withSunday = await service.previewPayroll(input);
    sourceRows = sourceRows.filter((log) => log.date !== '2026-10-18');
    const withoutSunday = await service.previewPayroll(input);

    for (const preview of [withSunday, withoutSunday]) {
      expect(preview.attendanceSummary).toMatchObject({
        paidDays: 12,
        requiredMinutes: 5760,
        basicSalary: 9060,
        ordinaryMinutes: 6259,
        overtimeMinutes: 499,
        otPay: 981.11,
      });
    }
    expect(withSunday.attendanceSummary.restDayPay).toBe(1529.1);
    expect(withoutSunday.attendanceSummary.restDayPay).toBe(0);
    expectNoHistoryWrites();
  });

  it('does not use rest-day hours to fill a shortage in scheduled working hours', async () => {
    sourceRows = [
      row(1, '12', '08:30', '16:30'),
      row(2, '18', '08:30', '17:30'),
    ];
    const preview = await service.previewPayroll(input);

    expect(preview.attendanceSummary).toMatchObject({
      totalMinutes: 900,
      ordinaryMinutes: 420,
      restDayMinutes: 480,
      restDayRegularMinutes: 480,
      restDayOvertimeMinutes: 0,
      requiredMinutes: 5760,
      undertimeMinutes: 5340,
      overtimeMinutes: 0,
      otPay: 0,
      restDayPay: 981.5,
    });
    expectNoHistoryWrites();
  });

  it('treats Sunday as ordinary work when it is configured as a working weekday', async () => {
    database.employee.findUnique.mockResolvedValue({
      ...employee,
      payrollProfile: { ...profile, workingWeekdays: [0, 1, 2, 3, 4, 5, 6] },
    });
    sourceRows = [row(1, '18', '07:42', '20:08')];
    const preview = await service.previewPayroll(input);

    expect(preview.attendanceSummary).toMatchObject({
      totalMinutes: 686,
      ordinaryMinutes: 686,
      restDayMinutes: 0,
      restDayCount: 0,
      restDayPay: 0,
      paidDays: 15,
      requiredMinutes: 7200,
    });
    expectNoHistoryWrites();
  });

  it('keeps an existing saved payroll unchanged when the new calculation is previewed', async () => {
    savedPayrolls = [
      {
        id: 77,
        employeeId: employee.id,
        daysWorked: 14,
        totalHours: 115.75,
        grossPay: 10225.78,
        netPay: 8244.28,
        cashAdvance: 1000,
        pagIbigDeduct: 490.75,
        philhealthDeduct: 490.75,
        attendanceSummary: {
          calculationVersion: 'excel-fixed-break-20261029-v1',
          totalMinutes: 6945,
          requiredMinutes: 6720,
          overtimeMinutes: 225,
          basicSalary: 9815,
        },
      },
    ];
    const saved = structuredClone(savedPayrolls);
    const preview = await service.previewPayroll(input);

    expect(preview.computed.netPay).toBe(9588.7);
    expect(await service.getPayrolls()).toEqual(saved);
    expect(savedPayrolls).toEqual(saved);
    expect(database.payroll.create).not.toHaveBeenCalled();
    expectNoHistoryWrites();
  });

  it('saves server-calculated rest-day amounts and keeps the new snapshot authoritative', async () => {
    const preview = await service.previewPayroll(input);
    await service.createPayroll({
      ...input,
      previewFingerprint: preview.previewFingerprint,
      daysWorked: 14,
      totalHours: 999,
      grossPay: 1,
      netPay: 1,
    });

    expect(savedPayrolls).toHaveLength(1);
    expect(savedPayrolls[0]).toMatchObject({
      daysWorked: 12,
      totalHours: 6945 / 60,
      grossPay: 11570.2,
      netPay: 9588.7,
      attendanceSummary: preview.attendanceSummary,
    });
    const saved = structuredClone(savedPayrolls);
    sourceRows = [];
    database.employee.findUnique.mockResolvedValue({
      ...employee,
      payrollProfile: { ...profile, basis: 'DAILY', dailyRate: 800 },
    });
    await service.previewPayroll(input);
    expect(await service.getPayrolls()).toEqual(saved);
    expect(savedPayrolls).toEqual(saved);
    expectNoHistoryWrites();
  });

  it('rejects a preview produced before the rest-day calculation version', async () => {
    const previousFingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          calculation: {
            version: 'excel-fixed-break-20261029-v1',
            ...APP_ATTENDANCE_POLICY,
          },
          employee: {
            id: employee.id,
            company: employee.company,
            baseRate: employee.baseRate,
            profile: validatePayrollProfile(profile),
            cashAdvanceBalance: employee.cashAdvanceBalance,
            loanBalance: employee.loanBalance,
          },
          settings: {
            shiftStart: settings.shiftStart,
            shiftEnd: settings.shiftEnd,
            lunchStart: settings.lunchStart,
            lunchEnd: settings.lunchEnd,
          },
          cutoffStart: input.cutoffStart,
          cutoffEnd: input.cutoffEnd,
          logs: sourceRows.map((log) => ({
            id: log.id,
            employeeId: log.employeeId,
            date: log.date,
            timeIn: log.timeIn,
            timeOut: log.timeOut,
            shiftStart: log.shiftStart,
            shiftEnd: log.shiftEnd,
            lunchStart: log.lunchStart,
            lunchEnd: log.lunchEnd,
            breakOut: log.breakOut,
            breakIn: log.breakIn,
            lunchOverrideMinutes: log.lunchOverrideMinutes,
          })),
        }),
      )
      .digest('hex');
    const preview = await service.previewPayroll(input);
    expect(PAYROLL_CALCULATION_VERSION).toBe('scheduled-rest-day-20261029-v2');
    expect(preview.previewFingerprint).not.toBe(previousFingerprint);

    await expect(
      service.createPayroll({
        ...input,
        previewFingerprint: previousFingerprint,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(database.payroll.create).not.toHaveBeenCalled();
    expect(savedPayrolls).toEqual([]);
    expectNoHistoryWrites();
  });
});
