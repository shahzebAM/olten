jest.mock('@prisma/client', () => {
  const actual =
    jest.requireActual<typeof import('@prisma/client')>('@prisma/client');
  const mockDatabase = {
    employee: { findUnique: jest.fn(), findMany: jest.fn() },
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
    $executeRaw: jest.fn(),
  };
  return {
    PrismaClient: jest.fn(() => mockDatabase),
    Prisma: actual.Prisma,
    mockDatabase,
  };
});

import { ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  EmployeesService,
  PAYROLL_CALCULATION_VERSION,
  calculatePhilippinePayrollTax,
} from './employees.service';
import { validatePayrollProfile } from './payroll-profile';

const profile = {
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
  cashAdvanceBalance: 0,
  loanBalance: 0,
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
  $executeRaw: jest.Mock<Promise<number>, [TemplateStringsArray, ...unknown[]]>;
}
const database = jest.requireMock<{ mockDatabase: MockDatabase }>(
  '@prisma/client',
).mockDatabase;
const row = (
  id: number,
  date: string,
  timeIn: string,
  timeOut: string,
  storedMinutes = 0,
): SourceRow => ({
  id,
  employeeId: employee.id,
  date,
  timeIn,
  timeOut,
  hours: storedMinutes / 60,
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
  pagIbigDeduct: 490.75,
  philhealthDeduct: 490.75,
};

// Minute-only reference punches. Stored hours deliberately retain the former
// overlap policy, proving that reading and previewing need no data backfill.
const referenceRows = () => [
  row(1, '2026-10-12', '09:23', '20:26', 603),
  row(2, '2026-10-13', '09:18', '20:27', 609),
  row(3, '2026-10-14', '09:45', '18:25', 460),
  row(4, '2026-10-15', '09:42', '19:33', 531),
  row(5, '2026-10-16', '09:34', '20:21', 587),
  row(6, '2026-10-17', '09:35', '19:33', 538),
  row(7, '2026-10-19', '09:47', '19:59', 552),
  row(8, '2026-10-20', '12:48', '19:48', 408),
  row(9, '2026-10-21', '09:53', '21:08', 615),
  row(10, '2026-10-22', '09:14', '21:02', 648),
  row(11, '2026-10-23', '09:45', '18:22', 457),
  row(12, '2026-10-24', '09:43', '18:30', 467),
];

describe('Excel break policy through attendance and payroll services', () => {
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
    database.$executeRaw.mockResolvedValue(1);
    service = new EmployeesService();
  });

  const expectNoHistoryWrites = () => {
    expect(database.attendance.create).not.toHaveBeenCalled();
    expect(database.attendance.update).not.toHaveBeenCalled();
    expect(database.attendance.delete).not.toHaveBeenCalled();
    expect(database.payroll.update).not.toHaveBeenCalled();
    expect(database.payroll.delete).not.toHaveBeenCalled();
  };

  it('deducts the fixed hour on a post-noon start without rewriting attendance', async () => {
    sourceRows = [row(8, '2026-10-20', '12:48', '19:48', 408)];
    const before = structuredClone(sourceRows);
    const result = await service.getAttendances(employee.company);

    expect(result).toHaveLength(1);
    expect(result[0].metrics).toMatchObject({
      grossMinutes: 420,
      lunchDeductionMinutes: 60,
      netMinutes: 360,
    });
    expect(result[0].hours).toBe(6);
    expect(sourceRows).toEqual(before);
    expect(database.payroll.create).not.toHaveBeenCalled();
    expectNoHistoryWrites();
  });

  it('reconciles the reference cutoff and preserves its saved payroll snapshot', async () => {
    const before = structuredClone(sourceRows);
    const attendance = await service.getAttendances(employee.company);
    const preview = await service.previewPayroll(input);

    expect(
      attendance.reduce((sum, log) => sum + log.metrics.netMinutes, 0),
    ).toBe(6427);
    expect(preview.attendanceSummary).toMatchObject({
      calculationVersion: PAYROLL_CALCULATION_VERSION,
      lunchPolicy: 'FIXED_DAILY',
      grossMinutes: 7147,
      lunchDeductionMinutes: 720,
      totalMinutes: 6427,
      requiredMinutes: 5760,
      overtimeMinutes: 667,
      basicSalary: 9060,
      ratePerDay: 755,
      ratePerHour: 94.375,
      otPay: 1311.42,
      undertimeDeduction: 0,
      grossPay: 10371.42,
    });
    expect(preview.computed).toMatchObject({
      totalDeductions: 981.5,
      netPay: 9389.92,
    });
    expect(database.payroll.create).not.toHaveBeenCalled();

    await service.createPayroll({
      ...input,
      previewFingerprint: preview.previewFingerprint,
      daysWorked: 999,
      totalHours: 999,
      grossPay: 999999,
      netPay: 999999,
    });
    expect(savedPayrolls).toHaveLength(1);
    expect(savedPayrolls[0]).toMatchObject({
      daysWorked: 12,
      totalHours: 6427 / 60,
      grossPay: 10371.42,
      netPay: 9389.92,
      attendanceSummary: preview.attendanceSummary,
    });

    const saved = structuredClone(savedPayrolls[0]);
    sourceRows[7] = row(8, '2026-10-20', '12:48', '20:48', 408);
    await service.previewPayroll(input);
    expect(await service.getPayrolls()).toEqual([saved]);
    expect(savedPayrolls[0]).toEqual(saved);
    sourceRows[7] = before[7];
    expect(sourceRows).toEqual(before);
    expectNoHistoryWrites();
  });

  it('counts a recorded split-session lunch gap once in official hours and preview', async () => {
    sourceRows = [
      row(1, '2026-10-12', '08:00', '12:00'),
      row(2, '2026-10-12', '13:00', '17:00'),
    ];
    const before = structuredClone(sourceRows);
    const result = await service.getAttendances(employee.company);
    const preview = await service.previewPayroll(input);

    expect(result.reduce((sum, log) => sum + log.metrics.netMinutes, 0)).toBe(
      480,
    );
    expect(preview.attendanceSummary.totalMinutes).toBe(480);
    expect(sourceRows).toEqual(before);
    expect(database.payroll.create).not.toHaveBeenCalled();
    expectNoHistoryWrites();
  });

  it('preserves a midnight continuation and deducts only the daytime break', async () => {
    sourceRows = [
      row(1, '2026-10-12', '00:00', '00:38', 38),
      row(2, '2026-10-12', '09:32', '18:13', 461),
    ];
    const before = structuredClone(sourceRows);
    const result = await service.getAttendances(employee.company);
    const preview = await service.previewPayroll(input);

    expect(result.find((log) => log.id === 1)?.metrics.netMinutes).toBe(38);
    expect(result.reduce((sum, log) => sum + log.metrics.netMinutes, 0)).toBe(
      499,
    );
    expect(preview.attendanceSummary).toMatchObject({
      totalMinutes: 499,
      lunchDeductionMinutes: 60,
    });
    expect(sourceRows).toEqual(before);
    expect(database.payroll.create).not.toHaveBeenCalled();
    expectNoHistoryWrites();
  });

  it('rejects a pre-fix preview fingerprint before creating a changed payroll', async () => {
    const legacyFingerprint = createHash('sha256')
      .update(
        JSON.stringify({
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
    const before = structuredClone(sourceRows);
    const preview = await service.previewPayroll(input);
    expect(preview.previewFingerprint).not.toBe(legacyFingerprint);

    await expect(
      service.createPayroll({
        ...input,
        previewFingerprint: legacyFingerprint,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(database.payroll.create).not.toHaveBeenCalled();
    expect(savedPayrolls).toEqual([]);
    expect(sourceRows).toEqual(before);
    expectNoHistoryWrites();
  });

  it('keeps rounded breakdown amounts reconciled with the full-precision gross', async () => {
    // 12 paid days at 755; one hour short leaves exact gross 8965.625.
    sourceRows = Array.from({ length: 12 }, (_, index) =>
      row(
        index + 1,
        `2026-10-${[12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24][index]}`,
        '08:30',
        index === 11 ? '16:30' : '17:30',
      ),
    );
    const preview = await service.previewPayroll(input);
    expect(preview.attendanceSummary).toMatchObject({
      overtimeMinutes: 0,
      undertimeMinutes: 60,
      undertimeDeduction: 94.38,
      roundingAdjustment: 0.01,
      grossPay: 8965.63,
    });
    expect(preview.computed.netPay).toBe(7984.13);
    expectNoHistoryWrites();
  });

  it('rounds the existing 35 percent tax formula correctly at a half-cent', () => {
    expect(
      calculatePhilippinePayrollTax({ grossPay: 333336.3, isDeclared: true }),
    ).toMatchObject({ withholdingTax: 91771.86, netPay: 241564.44 });
    expectNoHistoryWrites();
  });

  it('uses aggregate paid hours after creating and editing split-session punches', async () => {
    sourceRows = [];
    database.attendance.create.mockImplementation(
      ({ data }: { data: Omit<SourceRow, 'id'> }) => {
        const saved = { ...data, id: sourceRows.length + 1 };
        sourceRows.push(saved);
        return Promise.resolve(saved);
      },
    );
    database.attendance.update.mockImplementation(
      ({
        where,
        data,
      }: {
        where: { id: number };
        data: Partial<SourceRow>;
      }) => {
        const index = sourceRows.findIndex((log) => log.id === where.id);
        sourceRows[index] = { ...sourceRows[index], ...data };
        return Promise.resolve(sourceRows[index]);
      },
    );
    // Normalization looks up the exact source row for PATCH.
    Object.assign(database.attendance, {
      findUnique: jest.fn(({ where }: { where: { id: number } }) =>
        Promise.resolve(sourceRows.find((log) => log.id === where.id) ?? null),
      ),
    });
    await service.createAttendance({
      employeeId: employee.id,
      date: '2026-10-12',
      timeIn: '08:00',
      timeOut: '12:00',
    });
    await service.createAttendance({
      employeeId: employee.id,
      date: '2026-10-12',
      timeIn: '13:00',
      timeOut: '17:00',
    });
    const official = await service.getAttendances(employee.company);
    expect(official.reduce((sum, log) => sum + log.metrics.netMinutes, 0)).toBe(
      480,
    );
    expect(
      (await service.previewPayroll(input)).attendanceSummary.totalMinutes,
    ).toBe(480);
    await service.updateAttendance(2, { timeOut: '18:00' });
    const updated = await service.getAttendances(employee.company);
    expect(updated.reduce((sum, log) => sum + log.metrics.netMinutes, 0)).toBe(
      540,
    );
    expect(
      (await service.previewPayroll(input)).attendanceSummary.totalMinutes,
    ).toBe(540);
    expect(database.payroll.create).not.toHaveBeenCalled();
    expect(database.payroll.update).not.toHaveBeenCalled();
    expect(database.attendance.update).toHaveBeenCalledTimes(1);
  });
});
