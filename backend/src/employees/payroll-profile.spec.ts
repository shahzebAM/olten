jest.mock('@prisma/client', () => {
  const actual =
    jest.requireActual<typeof import('@prisma/client')>('@prisma/client');
  const mockDatabase = {
    employee: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    settings: { findUnique: jest.fn() },
    attendance: { findMany: jest.fn() },
    payroll: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    $transaction: jest.fn(),
  };
  return {
    PrismaClient: jest.fn(() => mockDatabase),
    Prisma: { ...actual.Prisma, DbNull: 'DB_NULL' },
    mockDatabase,
  };
});

import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EmployeesService } from './employees.service';
import { calculateAttendancePayroll } from './attendance-calculator';
import { resolvePayrollBasis, validatePayrollProfile } from './payroll-profile';
import type { PayrollProfile } from './payroll-profile';

const database = jest.requireMock<{
  mockDatabase: Record<
    'employee' | 'settings' | 'attendance' | 'payroll',
    Record<string, jest.Mock>
  > & { $transaction: jest.Mock };
}>('@prisma/client').mockDatabase;
const profile: PayrollProfile = {
  version: 1,
  basis: 'DAILY',
  dailyRate: 755,
  overtimeBasis: 'DAILY',
  paidDayBasis: 'SCHEDULED',
  workingWeekdays: [1, 2, 3, 4, 5, 6],
};
const fixed: PayrollProfile = {
  version: 1,
  basis: 'CUTOFF',
  referenceDays: 14,
  paidDayBasis: 'FIXED',
  fixedPaidDays: 14,
  workingWeekdays: [1, 2, 3, 4, 5, 6],
};
const employee = {
  id: 1,
  firstName: 'Example',
  lastName: 'Employee',
  company: 'Company A',
  baseRate: 9815,
  payrollProfile: profile,
};
const settings = {
  id: 1,
  company: 'Company A',
  shiftStart: '08:30',
  shiftEnd: '17:30',
  lunchStart: '12:00',
  lunchEnd: '13:00',
};
const row = (
  id: number,
  date: string,
  timeIn = '08:30',
  timeOut = '17:30',
) => ({ id, employeeId: 1, date, timeIn, timeOut, hours: 0 });
const input = {
  employeeId: 1,
  company: 'Company A',
  cutoffStart: '2026-09-26',
  cutoffEnd: '2026-10-10',
  daysWorked: 999,
  sssDeduction: 975,
};

describe('explicit payroll profiles', () => {
  it('accepts existing profiles without a policy and retains explicit overrides', () => {
    const existing = { ...profile };
    delete existing.overtimeBasis;
    expect(validatePayrollProfile(existing)).toEqual(existing);
    expect(validatePayrollProfile(profile)?.overtimeBasis).toBe('DAILY');
    expect(
      validatePayrollProfile({ ...profile, overtimeBasis: 'CUTOFF_NET' })
        ?.overtimeBasis,
    ).toBe('CUTOFF_NET');
  });
  it('normalizes weekdays without mutating the saved profile', () => {
    const original = { ...profile, workingWeekdays: [6, 1] };
    expect(validatePayrollProfile(original)?.workingWeekdays).toEqual([1, 6]);
    expect(original.workingWeekdays).toEqual([6, 1]);
    expect(validatePayrollProfile(null)).toBeNull();
  });
  it.each([
    undefined,
    {},
    { ...profile, version: 2 },
    { ...profile, dailyRate: 0 },
    { ...profile, dailyRate: -1 },
    { ...profile, dailyRate: 755.001 },
    { ...profile, dailyRate: '755' },
    { ...profile, dailyRate: Infinity },
    { ...profile, workingWeekdays: [] },
    { ...profile, workingWeekdays: [1, 1] },
    { ...profile, workingWeekdays: [7] },
    { ...profile, workingWeekdays: ['1'] },
    { ...profile, paidDayBasis: 'ATTENDANCE' },
    { ...profile, overtimeBasis: 'WEEKLY' },
    { ...profile, overtimeBasis: null },
    { ...profile, formula: 'cutoff-offset' },
    { ...fixed, referenceDays: 0 },
    { ...fixed, referenceDays: 13 },
    { ...fixed, referenceDays: 14.5, fixedPaidDays: 14.5 },
    {
      version: 1,
      basis: 'CUTOFF',
      referenceDays: 14,
      paidDayBasis: 'SCHEDULED',
      workingWeekdays: [1, 2, 3, 4, 5, 6],
    },
    { ...fixed, referenceDays: Number.MIN_VALUE },
    { ...fixed, fixedPaidDays: 0 },
    { ...fixed, fixedPaidDays: 32 },
  ])('rejects invalid profile %#', (value) =>
    expect(() => validatePayrollProfile(value)).toThrow(),
  );
  it.each([
    ['2026-09-26', '2026-10-10', 13],
    ['2026-10-11', '2026-10-25', 12],
    ['2026-08-26', '2026-09-10', 14],
    ['2024-02-26', '2024-03-10', 12],
    ['2026-02-26', '2026-03-10', 11],
    ['2026-12-26', '2027-01-10', 13],
  ])(
    'counts calendar workdays %s–%s independently of attendance',
    (start, end, count) => {
      const result = resolvePayrollBasis(profile, 9815, start, end);
      expect(result.paidDays).toBe(count);
      expect(result.scheduledDates).toHaveLength(count);
      expect(result.ratePerDay).toBe(755);
      expect(result.basicSalary).toBe(755 * count);
    },
  );
  it('supports fixed cutoff salary with an explicit stable rate divisor', () => {
    const result = resolvePayrollBasis(
      fixed,
      10570,
      '2026-09-26',
      '2026-10-10',
    );
    expect(result).toMatchObject({
      paidDays: 14,
      ratePerDay: 755,
      basicSalary: 10570,
    });
  });
  it.each([
    ['2026-10-01', '2026-10-15'],
    ['2026-09-25', '2026-10-10'],
    ['2026-10-26', '2026-10-10'],
    ['bad', '2026-10-10'],
  ])('rejects invalid or nonstandard automated periods %s–%s', (start, end) =>
    expect(() => resolvePayrollBasis(profile, 9815, start, end)).toThrow(),
  );
  it('keeps daily overtime separate from a short workday', () => {
    const result = calculateAttendancePayroll(
      [
        row(1, '2026-09-26', '08:30', '19:30'),
        row(2, '2026-09-28', '08:30', '15:30'),
      ],
      {
        ...settings,
        employeeId: 1,
        startDate: '2026-09-26',
        endDate: '2026-10-10',
        daysWorked: 2,
        basicSalary: 1510,
        ratePerDay: 755,
        overtimeBasis: 'DAILY',
      },
    );
    expect(result.totalMinutes).toBe(960);
    expect(result.regularMinutes).toBe(840);
    expect(result.overtimeMinutes).toBe(120);
    expect(result.undertimeMinutes).toBe(120);
    expect(result.otPay).toBe(235.94);
    expect(result.undertimeDeduction).toBe(188.75);
    expect(result.grossPay).toBe(1557.19);
  });
});

describe('authoritative payroll preview and save', () => {
  let service: EmployeesService;
  beforeEach(() => {
    jest.clearAllMocks();
    database.employee.findUnique.mockResolvedValue(structuredClone(employee));
    database.settings.findUnique.mockResolvedValue(settings);
    database.attendance.findMany.mockResolvedValue([
      row(1, '2026-09-26'),
      row(2, '2026-09-28', '08:30', '19:30'),
    ]);
    database.payroll.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 10, ...data }),
    );
    database.$transaction.mockImplementation(
      (work: (client: typeof database) => Promise<unknown>) => work(database),
    );
    service = new EmployeesService();
  });
  const noWrites = () => {
    for (const method of [
      database.employee.update,
      database.employee.create,
      database.payroll.create,
      database.payroll.update,
      database.payroll.delete,
    ])
      expect(method).not.toHaveBeenCalled();
  };
  it('previews fresh records without database writes or attendance-based rates', async () => {
    const result = await service.previewPayroll(input);
    expect(result.configurationRequired).toBe(false);
    expect(result.attendanceSummary).toMatchObject({
      version: 2,
      basicSalary: 9815,
      ratePerDay: 755,
      ratePerHour: 94.375,
      requiredMinutes: 6240,
      regularMinutes: 960,
      overtimeMinutes: 120,
      otPay: 235.94,
    });
    expect(result.source).toMatchObject({
      attendanceDateCount: 2,
      workedDateCount: 2,
      sessionCount: 2,
    });
    expect(result.previewFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(database.attendance.findMany).toHaveBeenCalledWith({
      where: { employeeId: 1 },
    });
    noWrites();
  });
  it('reuses the confirmed preview and ignores client day/hour/pay tampering', async () => {
    const preview = await service.previewPayroll(input);
    const result = await service.createPayroll({
      ...input,
      daysWorked: 0,
      totalHours: 9999,
      grossPay: 1,
      netPay: 1,
      previewFingerprint: preview.previewFingerprint,
    });
    expect(result).toMatchObject({
      daysWorked: 13,
      totalHours: 18,
      grossPay: preview.computed.grossPay,
      netPay: preview.computed.netPay,
    });
    expect(database.payroll.create).toHaveBeenCalledTimes(1);
    expect(database.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(database.$transaction.mock.invocationCallOrder[0]).toBeLessThan(
      database.payroll.create.mock.invocationCallOrder[0],
    );
  });
  it.each(['attendance', 'profile', 'overtime policy', 'settings'])(
    'rejects a stale %s preview before any write',
    async (change) => {
      const preview = await service.previewPayroll(input);
      if (change === 'attendance')
        database.attendance.findMany.mockResolvedValue([
          row(1, '2026-09-26', '08:30', '18:30'),
        ]);
      if (change === 'profile')
        database.employee.findUnique.mockResolvedValue({
          ...employee,
          payrollProfile: { ...profile, dailyRate: 800 },
        });
      if (change === 'overtime policy')
        database.employee.findUnique.mockResolvedValue({
          ...employee,
          payrollProfile: { ...profile, overtimeBasis: 'CUTOFF_NET' },
        });
      if (change === 'settings')
        database.settings.findUnique.mockResolvedValue({
          ...settings,
          lunchEnd: '12:30',
        });
      await expect(
        service.createPayroll({
          ...input,
          previewFingerprint: preview.previewFingerprint,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(database.$transaction).toHaveBeenCalledTimes(1);
      noWrites();
    },
  );
  it('does not mutate stored snapshots when a pay profile changes', async () => {
    const saved = await service.createPayroll(input);
    const before = structuredClone(saved);
    database.employee.findUnique.mockResolvedValue({
      ...employee,
      payrollProfile: { ...profile, dailyRate: 900 },
    });
    await service.previewPayroll(input);
    expect(saved).toEqual(before);
    expect(database.payroll.update).not.toHaveBeenCalled();
  });
  it('defaults existing profiles to cutoff net and stores that policy on new snapshots', async () => {
    const existingProfile = { ...profile };
    delete existingProfile.overtimeBasis;
    database.employee.findUnique.mockResolvedValue({
      ...employee,
      payrollProfile: existingProfile,
    });
    const result = await service.previewPayroll(input);
    expect(result.attendanceSummary).toMatchObject({
      overtimeBasis: 'CUTOFF_NET',
      totalMinutes: 1080,
      regularMinutes: 1080,
      overtimeMinutes: 0,
      undertimeMinutes: 5160,
      undertimeDeduction: 8116.25,
    });
    const saved = await service.createPayroll({
      ...input,
      previewFingerprint: result.previewFingerprint,
    });
    expect(saved.attendanceSummary).toMatchObject({
      overtimeBasis: 'CUTOFF_NET',
      overtimeMinutes: 0,
      undertimeMinutes: 5160,
    });
  });
  it('deducts missing scheduled attendance without changing the hourly rate', async () => {
    const first = await service.previewPayroll(input);
    database.attendance.findMany.mockResolvedValue([row(1, '2026-09-26')]);
    const second = await service.previewPayroll(input);
    expect(first.attendanceSummary.ratePerHour).toBe(
      second.attendanceSummary.ratePerHour,
    );
    expect(second.attendanceSummary.requiredMinutes).toBe(6240);
    expect(second.attendanceSummary.undertimeDeduction).toBe(9060);
  });
  it('does not pay a full daily-basis cutoff with zero attendance', async () => {
    database.attendance.findMany.mockResolvedValue([]);
    const result = await service.previewPayroll({ ...input, sssDeduction: 0 });
    expect(result.attendanceSummary).toMatchObject({
      basicSalary: 9815,
      undertimeDeduction: 9815,
      grossPay: 0,
      ratePerDay: 755,
    });
    expect(result.source.workedDateCount).toBe(0);
    noWrites();
  });
  it('does not pay a fixed-cutoff salary with zero attendance', async () => {
    database.employee.findUnique.mockResolvedValue({
      ...employee,
      baseRate: 10570,
      payrollProfile: fixed,
    });
    database.attendance.findMany.mockResolvedValue([]);
    const result = await service.previewPayroll({ ...input, sssDeduction: 0 });
    expect(result.attendanceSummary).toMatchObject({
      basicSalary: 10570,
      requiredMinutes: 6720,
      ratePerDay: 755,
      undertimeDeduction: 10570,
      grossPay: 0,
    });
    noWrites();
  });
  it('uses transaction-local employee, settings, attendance and insert clients for a confirmed save', async () => {
    const preview = await service.previewPayroll(input);
    const transactional = {
      employee: {
        findUnique: jest.fn().mockResolvedValue(structuredClone(employee)),
      },
      settings: { findUnique: jest.fn().mockResolvedValue(settings) },
      attendance: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            row(1, '2026-09-26'),
            row(2, '2026-09-28', '08:30', '19:30'),
          ]),
      },
      payroll: { create: jest.fn().mockResolvedValue({ id: 20 }) },
    };
    database.$transaction.mockImplementation(
      (work: (client: typeof transactional) => Promise<unknown>) =>
        work(transactional),
    );
    const rootReads = database.employee.findUnique.mock.calls.length;
    await service.createPayroll({
      ...input,
      previewFingerprint: preview.previewFingerprint,
    });
    expect(database.employee.findUnique).toHaveBeenCalledTimes(rootReads);
    expect(transactional.employee.findUnique).toHaveBeenCalledTimes(1);
    expect(transactional.settings.findUnique).toHaveBeenCalledTimes(1);
    expect(transactional.attendance.findMany).toHaveBeenCalledTimes(1);
    expect(transactional.payroll.create).toHaveBeenCalledTimes(1);
    expect(database.payroll.create).not.toHaveBeenCalled();
  });
  it('reports a serialization conflict without retrying or creating another payroll', async () => {
    const preview = await service.previewPayroll(input);
    database.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Serialization conflict', {
        code: 'P2034',
        clientVersion: '6.19.3',
      }),
    );
    await expect(
      service.createPayroll({
        ...input,
        previewFingerprint: preview.previewFingerprint,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(database.$transaction).toHaveBeenCalledTimes(1);
    noWrites();
  });
  it('retains the legacy direct-save path without requiring a preview fingerprint', async () => {
    await service.createPayroll(input);
    expect(database.$transaction).not.toHaveBeenCalled();
    expect(database.payroll.create).toHaveBeenCalledTimes(1);
  });
  it('separates physical work, paid leave and unpaid leave dates', async () => {
    database.attendance.findMany.mockResolvedValue([
      row(1, '2026-09-26'),
      row(2, '2026-09-28', 'LEAVE', 'PAID'),
      row(3, '2026-09-29', 'LEAVE', 'UNPAID'),
    ]);
    const result = await service.previewPayroll(input);
    expect(result.source).toMatchObject({
      attendanceDateCount: 3,
      workedDateCount: 1,
      paidLeaveDateCount: 1,
      unpaidLeaveDateCount: 1,
      sessionCount: 3,
    });
    expect(result.attendanceSummary.regularMinutes).toBe(960);
  });
  it('keeps legacy API results until an employee is explicitly configured', async () => {
    database.employee.findUnique.mockResolvedValue({
      ...employee,
      payrollProfile: null,
    });
    const result = await service.previewPayroll({ ...input, daysWorked: 13 });
    expect(result.configurationRequired).toBe(true);
    expect(result.attendanceSummary.version).toBe(1);
    expect(result.attendanceSummary.ratePerDay).toBe(755);
  });
  it.each([
    { company: 'Company B' },
    { cutoffStart: '2026-10-01', cutoffEnd: '2026-10-15' },
    { sssDeduction: -1 },
  ])('rejects scope, cutoff and deduction errors %#', async (invalid) => {
    await expect(
      service.previewPayroll({ ...input, ...invalid }),
    ).rejects.toBeInstanceOf(BadRequestException);
    noWrites();
  });
  it('validates profiles on the existing employee update API', async () => {
    await expect(
      service.updateEmployee(1, {
        payrollProfile: { ...profile, dailyRate: 0 },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(database.employee.update).not.toHaveBeenCalled();
    await service.updateEmployee(1, { payrollProfile: profile });
    expect(database.employee.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { payrollProfile: profile },
    });
  });
});
