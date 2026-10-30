jest.mock('@prisma/client', () => {
  const actual =
    jest.requireActual<typeof import('@prisma/client')>('@prisma/client');
  const mockDatabase = {
    employee: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    settings: { findUnique: jest.fn(), upsert: jest.fn() },
    attendance: { findMany: jest.fn(), update: jest.fn() },
    payroll: { create: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
  };
  return {
    PrismaClient: jest.fn(() => mockDatabase),
    Prisma: actual.Prisma,
    mockDatabase,
  };
});

import { BadRequestException, ConflictException } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Prisma } from '@prisma/client';
import { PayrollAuthGuard } from '../auth/payroll-auth.guard';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import type { PayrollDefaults, PayrollProfile } from './payroll-profile';

interface MockDatabase {
  employee: { findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock };
  settings: { findUnique: jest.Mock; upsert: jest.Mock };
  attendance: { findMany: jest.Mock; update: jest.Mock };
  payroll: { create: jest.Mock; findMany: jest.Mock; update: jest.Mock };
  $transaction: jest.Mock;
}
const database = jest.requireMock<{ mockDatabase: MockDatabase }>(
  '@prisma/client',
).mockDatabase;
const defaults: PayrollDefaults = {
  version: 1,
  workingWeekdays: [1, 2, 3, 4, 5, 6],
  overtimeBasis: 'CUTOFF_NET',
};
const profile: PayrollProfile = {
  version: 1,
  basis: 'DAILY',
  dailyRate: 800,
  paidDayBasis: 'SCHEDULED',
  workingWeekdays: [0],
  overtimeBasis: 'DAILY',
  rulesSource: 'COMPANY',
};
const employee = {
  id: 1,
  firstName: 'Example',
  lastName: 'Employee',
  company: 'Company A',
  baseRate: 0,
  payrollProfile: profile,
  cashAdvanceBalance: 0,
  loanBalance: 0,
};
const settings = {
  id: 1,
  company: employee.company,
  shiftStart: '08:00',
  shiftEnd: '17:00',
  lunchStart: '12:00',
  lunchEnd: '13:00',
  payrollDefaults: defaults,
};
const input = {
  employeeId: employee.id,
  company: employee.company,
  cutoffStart: '2026-10-11',
  cutoffEnd: '2026-10-25',
  isDeclared: false,
};
const attendance = [
  {
    id: 1,
    employeeId: 1,
    date: '2026-10-12',
    timeIn: '08:00',
    timeOut: '18:00',
    hours: 999,
  },
  {
    id: 2,
    employeeId: 1,
    date: '2026-10-13',
    timeIn: '08:00',
    timeOut: '16:00',
    hours: 999,
  },
];

describe('company payroll defaults integration', () => {
  let service: EmployeesService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new EmployeesService();
    database.employee.findUnique.mockResolvedValue(structuredClone(employee));
    database.employee.findMany.mockResolvedValue([structuredClone(employee)]);
    database.settings.findUnique.mockResolvedValue(structuredClone(settings));
    database.settings.upsert.mockResolvedValue(structuredClone(settings));
    database.attendance.findMany.mockResolvedValue(structuredClone(attendance));
    database.payroll.findMany.mockResolvedValue([]);
    database.payroll.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(structuredClone({ id: 20, ...data })),
    );
    database.$transaction.mockImplementation(
      (work: (client: MockDatabase) => Promise<unknown>) => work(database),
    );
  });

  const noHistoryWrites = () => {
    expect(database.employee.update).not.toHaveBeenCalled();
    expect(database.attendance.update).not.toHaveBeenCalled();
    expect(database.payroll.update).not.toHaveBeenCalled();
  };

  it('returns normalized configured rules for only the requested company', async () => {
    database.settings.findUnique.mockResolvedValue({
      ...settings,
      payrollDefaults: { ...defaults, workingWeekdays: [6, 1] },
    });
    await expect(service.getPayrollDefaults('Company A')).resolves.toEqual({
      company: 'Company A',
      defaults: { ...defaults, workingWeekdays: [1, 6] },
      configured: true,
    });
    expect(database.settings.findUnique).toHaveBeenCalledWith({
      where: { company: 'Company A' },
    });
    expect(database.settings.findUnique).toHaveBeenCalledTimes(1);
    expect(database.settings.upsert).not.toHaveBeenCalled();
  });

  it.each([null, { ...settings, payrollDefaults: null }])(
    'returns built-in rules without configuring missing settings: %#',
    async (configured) => {
      database.settings.findUnique.mockResolvedValue(configured);
      await expect(service.getPayrollDefaults('Company A')).resolves.toEqual({
        company: 'Company A',
        defaults,
        configured: false,
      });
      expect(database.settings.findUnique).toHaveBeenCalledTimes(1);
      expect(database.settings.upsert).not.toHaveBeenCalled();
    },
  );

  it('does not hide a database read failure behind guessed rules', async () => {
    const failure = new Error('Settings unavailable');
    database.settings.findUnique.mockRejectedValue(failure);
    await expect(service.getPayrollDefaults('Company A')).rejects.toBe(failure);
    expect(database.settings.upsert).not.toHaveBeenCalled();
  });

  it('updates only payroll JSON and preserves the existing shift/lunch settings', async () => {
    const changed = { ...defaults, workingWeekdays: [1, 2, 3, 4, 5] };
    await expect(
      service.updatePayrollDefaults('Company A', { defaults: changed }),
    ).resolves.toEqual({
      company: 'Company A',
      defaults: changed,
      configured: true,
    });
    expect(database.settings.upsert).toHaveBeenCalledWith({
      where: { company: 'Company A' },
      create: {
        company: 'Company A',
        payrollDefaults: changed,
        shiftStart: settings.shiftStart,
        shiftEnd: settings.shiftEnd,
        lunchStart: settings.lunchStart,
        lunchEnd: settings.lunchEnd,
      },
      update: { payrollDefaults: changed },
    });
    noHistoryWrites();
  });

  it('preserves the effective Global shift when first creating company defaults', async () => {
    const sharedSchedule = {
      ...settings,
      company: 'Global',
      shiftStart: '09:30',
      shiftEnd: '18:30',
      lunchStart: '13:30',
      lunchEnd: '14:30',
    };
    database.settings.findUnique.mockImplementation(
      ({ where }: { where: { company: string } }) =>
        Promise.resolve(where.company === 'Global' ? sharedSchedule : null),
    );
    await service.updatePayrollDefaults('Company A', { defaults });
    expect(database.settings.upsert).toHaveBeenCalledWith({
      where: { company: 'Company A' },
      create: {
        company: 'Company A',
        payrollDefaults: defaults,
        shiftStart: '09:30',
        shiftEnd: '18:30',
        lunchStart: '13:30',
        lunchEnd: '14:30',
      },
      update: { payrollDefaults: defaults },
    });
    noHistoryWrites();
  });

  it('does not create a company shift if the current effective schedule cannot be read', async () => {
    const failure = new Error('Current schedule unavailable');
    database.settings.findUnique.mockRejectedValue(failure);
    await expect(
      service.updatePayrollDefaults('Company A', { defaults }),
    ).rejects.toBe(failure);
    expect(database.settings.upsert).not.toHaveBeenCalled();
    noHistoryWrites();
  });

  it('keeps defaults intact when existing shift settings are partially updated', async () => {
    await service.updateSettings({ company: 'Company A', shiftStart: '09:00' });
    expect(database.settings.upsert).toHaveBeenCalledWith({
      where: { company: 'Company A' },
      create: { company: 'Company A', shiftStart: '09:00' },
      update: { shiftStart: '09:00' },
    });
  });

  it('allows explicit clearing without deleting the company settings row', async () => {
    await expect(
      service.updatePayrollDefaults('Company A', { defaults: null }),
    ).resolves.toEqual({ company: 'Company A', defaults, configured: false });
    expect(database.settings.upsert).toHaveBeenCalledWith({
      where: { company: 'Company A' },
      create: {
        company: 'Company A',
        payrollDefaults: Prisma.DbNull,
        shiftStart: settings.shiftStart,
        shiftEnd: settings.shiftEnd,
        lunchStart: settings.lunchStart,
        lunchEnd: settings.lunchEnd,
      },
      update: { payrollDefaults: Prisma.DbNull },
    });
    noHistoryWrites();
  });

  it.each([
    {},
    { defaults: { ...defaults, workingWeekdays: [] } },
    { defaults: { ...defaults, overtimeBasis: 'WEEKLY' } },
    { defaults: { ...defaults, dailyRate: 800 } },
    { defaults, shiftStart: '09:00' },
    { defaults, company: 'Company B' },
  ])(
    'rejects unsupported or cross-company updates before writing: %#',
    async (data) => {
      await expect(
        service.updatePayrollDefaults('Company A', data),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(database.settings.upsert).not.toHaveBeenCalled();
      noHistoryWrites();
    },
  );

  it('uses effective rules but returns the raw employee profile for editing', async () => {
    const preview = await service.previewPayroll(input);
    expect(preview.employee.payrollProfile).toEqual(profile);
    expect(preview.companyPayrollDefaults).toEqual(defaults);
    expect(preview.attendanceSummary).toMatchObject({
      payrollProfile: {
        ...profile,
        workingWeekdays: defaults.workingWeekdays,
        overtimeBasis: 'CUTOFF_NET',
      },
      companyPayrollDefaults: defaults,
      paidDays: 12,
      requiredMinutes: 5760,
      basicSalary: 9600,
      ordinaryMinutes: 960,
      restDayMinutes: 0,
      overtimeMinutes: 0,
      undertimeMinutes: 4800,
      grossPay: 1600,
    });
    expect(employee.payrollProfile).toEqual(profile);
    noHistoryWrites();
  });

  it.each(['EMPLOYEE', undefined] as const)(
    'retains an employee exception or legacy omitted source: %s',
    async (rulesSource) => {
      const exception = {
        ...profile,
        rulesSource,
        workingWeekdays: [1, 2, 3, 4, 5, 6],
        overtimeBasis: 'DAILY',
      };
      if (rulesSource === undefined) delete exception.rulesSource;
      database.employee.findUnique.mockResolvedValue({
        ...employee,
        payrollProfile: exception,
      });
      const before = await service.previewPayroll(input);
      database.settings.findUnique.mockResolvedValue({
        ...settings,
        payrollDefaults: {
          ...defaults,
          workingWeekdays: [0],
          overtimeBasis: 'DAILY',
        },
      });
      const after = await service.previewPayroll(input);
      expect(after.employee.payrollProfile).toEqual(exception);
      expect(after.attendanceSummary).toEqual(before.attendanceSummary);
      expect(after.previewFingerprint).toBe(before.previewFingerprint);
      expect(after.attendanceSummary).toMatchObject({
        overtimeBasis: 'DAILY',
        overtimeMinutes: 60,
        undertimeMinutes: 4860,
      });
      noHistoryWrites();
    },
  );

  it('does not inherit Global payroll defaults while retaining Global shift fallback', async () => {
    database.settings.findUnique.mockImplementation(
      ({ where }: { where: { company: string } }) =>
        Promise.resolve(
          where.company === 'Global'
            ? {
                ...settings,
                company: 'Global',
                payrollDefaults: {
                  ...defaults,
                  workingWeekdays: [0],
                  overtimeBasis: 'DAILY',
                },
              }
            : null,
        ),
    );
    const preview = await service.previewPayroll(input);
    expect(preview.companyPayrollDefaults).toEqual(defaults);
    expect(preview.attendanceSummary).toMatchObject({
      paidDays: 12,
      overtimeBasis: 'CUTOFF_NET',
      restDayMinutes: 0,
    });
    expect(database.settings.upsert).not.toHaveBeenCalled();
    noHistoryWrites();
  });

  it('preserves a fixed cutoff salary and divisor under company rules', async () => {
    database.employee.findUnique.mockResolvedValue({
      ...employee,
      baseRate: 11200,
      payrollProfile: {
        version: 1,
        basis: 'CUTOFF',
        referenceDays: 14,
        paidDayBasis: 'FIXED',
        fixedPaidDays: 14,
        workingWeekdays: [0],
        rulesSource: 'COMPANY',
      },
    });
    const preview = await service.previewPayroll(input);
    expect(preview.attendanceSummary).toMatchObject({
      paidDays: 14,
      requiredMinutes: 6720,
      basicSalary: 11200,
      ratePerDay: 800,
      ratePerHour: 100,
    });
  });

  it('does not infer an agreed rate for an employee with no pay profile', async () => {
    database.employee.findUnique.mockResolvedValue({
      ...employee,
      payrollProfile: null,
    });
    const preview = await service.previewPayroll({ ...input, daysWorked: 12 });
    expect(preview.configurationRequired).toBe(true);
    expect(preview.employee.payrollProfile).toBeNull();
    expect(preview.attendanceSummary).not.toHaveProperty('payrollProfile');
    noHistoryWrites();
  });

  it.each(['workingWeekdays', 'overtimeBasis'])(
    'rejects a stale company %s preview before any payroll write',
    async (change) => {
      const preview = await service.previewPayroll(input);
      const changed =
        change === 'workingWeekdays'
          ? { ...defaults, workingWeekdays: [1, 2, 3, 4, 5] }
          : { ...defaults, overtimeBasis: 'DAILY' };
      database.settings.findUnique.mockResolvedValue({
        ...settings,
        payrollDefaults: changed,
      });
      await expect(
        service.createPayroll({
          ...input,
          previewFingerprint: preview.previewFingerprint,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(database.payroll.create).not.toHaveBeenCalled();
      noHistoryWrites();
    },
  );

  it('reads the effective company defaults inside the confirmed-save transaction', async () => {
    const preview = await service.previewPayroll(input);
    const transactional = {
      employee: { findUnique: jest.fn().mockResolvedValue(employee) },
      settings: {
        findUnique: jest.fn().mockResolvedValue({
          ...settings,
          payrollDefaults: { ...defaults, workingWeekdays: [1, 2, 3, 4, 5] },
        }),
      },
      attendance: { findMany: jest.fn().mockResolvedValue(attendance) },
      payroll: { create: jest.fn() },
    };
    database.$transaction.mockImplementation(
      (work: (client: typeof transactional) => Promise<unknown>) =>
        work(transactional),
    );
    await expect(
      service.createPayroll({
        ...input,
        previewFingerprint: preview.previewFingerprint,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transactional.settings.findUnique).toHaveBeenCalledWith({
      where: { company: 'Company A' },
    });
    expect(transactional.payroll.create).not.toHaveBeenCalled();
    expect(database.payroll.create).not.toHaveBeenCalled();
  });

  it('freezes effective rules in a new save and preserves all saved history after defaults change', async () => {
    const preview = await service.previewPayroll(input);
    const saved: unknown = await service.createPayroll({
      ...input,
      previewFingerprint: preview.previewFingerprint,
    });
    const before = structuredClone(saved);
    expect(saved).toMatchObject({
      attendanceSummary: {
        payrollProfile: {
          ...profile,
          workingWeekdays: defaults.workingWeekdays,
          overtimeBasis: 'CUTOFF_NET',
        },
        companyPayrollDefaults: defaults,
      },
      grossPay: 1600,
      netPay: 1600,
    });
    database.payroll.findMany.mockResolvedValue([saved]);
    database.settings.findUnique.mockResolvedValue({
      ...settings,
      payrollDefaults: {
        ...defaults,
        workingWeekdays: [0],
        overtimeBasis: 'DAILY',
      },
    });
    await service.previewPayroll(input);
    await expect(service.getPayrolls()).resolves.toEqual([before]);
    expect(saved).toEqual(before);
    noHistoryWrites();
  });

  it('keeps both dedicated routes behind the existing payroll authorization guard', () => {
    for (const method of ['getPayrollDefaults', 'updatePayrollDefaults']) {
      const descriptor: { value?: unknown } | undefined =
        Object.getOwnPropertyDescriptor(EmployeesController.prototype, method);
      if (typeof descriptor?.value !== 'function')
        throw new Error(`Expected the ${method} route handler.`);
      const handler = descriptor.value;
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(
        'employees/payroll/defaults',
      );
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(
        PayrollAuthGuard,
      );
    }
  });
});
