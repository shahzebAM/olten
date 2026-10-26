jest.mock('@prisma/client', () => {
  const mockDatabase = {
    employee: { findUnique: jest.fn(), findMany: jest.fn() },
    settings: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    attendance: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
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
  };
  return { PrismaClient: jest.fn(() => mockDatabase), mockDatabase };
});

import {
  EmployeesService,
  filterAndAggregatePayrollRecords,
} from './employees.service';
import { EmployeesController } from './employees.controller';
import { PayrollAuthGuard } from '../auth/payroll-auth.guard';
import { AdminAuthGuard } from '../auth/admin-auth.guard';
import type { ExecutionContext } from '@nestjs/common';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'node:http';

const database = jest.requireMock<{ mockDatabase: MockDatabase }>(
  '@prisma/client',
).mockDatabase;
const globalSettings = {
  id: 1,
  company: 'Global',
  shiftStart: '08:30',
  shiftEnd: '17:30',
  lunchStart: '12:00',
  lunchEnd: '13:00',
};
const employees = [
  { id: 1, company: 'Company A', baseRate: 1600 },
  { id: 2, company: 'Company B', baseRate: 1600 },
];
const settingRows = [
  globalSettings,
  { ...globalSettings, id: 2, company: 'Company A' },
  {
    id: 3,
    company: 'Company B',
    shiftStart: '10:00',
    shiftEnd: '19:00',
    lunchStart: '14:00',
    lunchEnd: '14:30',
  },
];

interface SourceRow {
  id: number;
  employeeId: number;
  date: string;
  timeIn: string;
  timeOut: string;
  hours: number;
  shiftStart?: string | null;
  shiftEnd?: string | null;
  breakOut?: string | null;
  breakIn?: string | null;
  lunchOverrideMinutes?: number | null;
}

interface MockDatabase {
  employee: {
    findUnique: jest.Mock<
      Promise<(typeof employees)[number] | null>,
      [{ where: { id: number } }]
    >;
    findMany: jest.Mock<Promise<typeof employees>, [unknown?]>;
  };
  settings: {
    findUnique: jest.Mock<
      Promise<typeof globalSettings | null>,
      [{ where: { company: string } }]
    >;
    findFirst: jest.Mock<Promise<typeof globalSettings | null>, [unknown?]>;
    findMany: jest.Mock<Promise<typeof settingRows>, [unknown?]>;
    create: jest.Mock<Promise<unknown>, [unknown]>;
    update: jest.Mock<Promise<unknown>, [unknown]>;
    upsert: jest.Mock<Promise<unknown>, [unknown]>;
  };
  attendance: {
    findUnique: jest.Mock<
      Promise<SourceRow | null>,
      [{ where: { id: number } }]
    >;
    findFirst: jest.Mock<Promise<SourceRow | null>, [unknown?]>;
    findMany: jest.Mock<
      Promise<SourceRow[]>,
      [{ where?: { employeeId?: number } }?]
    >;
    create: jest.Mock<Promise<SourceRow>, [{ data: Omit<SourceRow, 'id'> }]>;
    update: jest.Mock<
      Promise<SourceRow>,
      [{ where: { id: number }; data: Partial<SourceRow> }]
    >;
    delete: jest.Mock<
      Promise<SourceRow | undefined>,
      [{ where: { id: number } }]
    >;
  };
  payroll: {
    findMany: jest.Mock<Promise<Record<string, unknown>[]>, [unknown?]>;
    create: jest.Mock<
      Promise<Record<string, unknown>>,
      [{ data: Record<string, unknown> }]
    >;
    update: jest.Mock<Promise<unknown>, [unknown]>;
    delete: jest.Mock<Promise<unknown>, [unknown]>;
  };
}

const row = (
  id: number,
  timeIn: string,
  timeOut: string,
  overrides: Partial<SourceRow> = {},
): SourceRow => ({
  id,
  employeeId: 1,
  date: '2026-10-06',
  timeIn,
  timeOut,
  hours: 0,
  ...overrides,
});

describe('attendance source records and payroll snapshots', () => {
  const service = new EmployeesService();
  let sourceRows: SourceRow[];
  let savedPayrolls: Record<string, unknown>[];

  beforeEach(() => {
    jest.resetAllMocks();
    sourceRows = [];
    savedPayrolls = [];
    database.employee.findUnique.mockImplementation(
      ({ where }: { where: { id: number } }) =>
        Promise.resolve(
          employees.find((employee) => employee.id === where.id) || null,
        ),
    );
    database.employee.findMany.mockResolvedValue(employees);
    database.settings.findUnique.mockImplementation(
      ({ where }: { where: { company: string } }) =>
        Promise.resolve(
          settingRows.find((settings) => settings.company === where.company) ||
            null,
        ),
    );
    database.settings.findFirst.mockResolvedValue(globalSettings);
    database.settings.findMany.mockResolvedValue(settingRows);
    database.attendance.findMany.mockImplementation(
      (query?: { where?: { employeeId?: number } }) =>
        Promise.resolve(
          sourceRows.filter(
            (log) =>
              !query?.where?.employeeId ||
              log.employeeId === query.where.employeeId,
          ),
        ),
    );
    database.attendance.findUnique.mockImplementation(
      ({ where }: { where: { id: number } }) =>
        Promise.resolve(sourceRows.find((log) => log.id === where.id) || null),
    );
    database.attendance.findFirst.mockResolvedValue(null);
    database.attendance.create.mockImplementation(
      ({ data }: { data: Omit<SourceRow, 'id'> }) => {
        const created = {
          ...data,
          id: Math.max(0, ...sourceRows.map((log) => log.id)) + 1,
        };
        sourceRows.push(created);
        return Promise.resolve(created);
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
    database.attendance.delete.mockImplementation(
      ({ where }: { where: { id: number } }) => {
        const removed = sourceRows.find((log) => log.id === where.id);
        sourceRows = sourceRows.filter((log) => log.id !== where.id);
        return Promise.resolve(removed);
      },
    );
    database.payroll.findMany.mockResolvedValue(savedPayrolls);
    database.payroll.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => {
        const created = structuredClone({
          ...data,
          id: savedPayrolls.length + 1,
        });
        savedPayrolls.push(created);
        return Promise.resolve(created);
      },
    );
  });

  const expectNoWrites = () => {
    expect(database.attendance.create).not.toHaveBeenCalled();
    expect(database.attendance.update).not.toHaveBeenCalled();
    expect(database.attendance.delete).not.toHaveBeenCalled();
    expect(database.payroll.create).not.toHaveBeenCalled();
    expect(database.payroll.update).not.toHaveBeenCalled();
    expect(database.payroll.delete).not.toHaveBeenCalled();
    expect(database.settings.create).not.toHaveBeenCalled();
    expect(database.settings.update).not.toHaveBeenCalled();
    expect(database.settings.upsert).not.toHaveBeenCalled();
  };

  const payrollInput = (overrides: Record<string, unknown> = {}) => ({
    employeeId: 1,
    cutoffStart: '2026-10-06',
    cutoffEnd: '2026-10-07',
    daysWorked: 2,
    isDeclared: false,
    ...overrides,
  });

  it('recalculates stale midnight hours and includes a separate session without changing source data', async () => {
    sourceRows = [row(1, '00:00', '00:38'), row(2, '09:32', '18:13')];
    const before = structuredClone(sourceRows);
    const result = await service.getAttendances('Company A');

    expect(result).toHaveLength(2);
    expect(
      Math.round((result.find((log) => log.id === 1)?.hours || 0) * 60),
    ).toBe(38);
    expect(
      result.reduce((minutes, log) => minutes + Math.round(log.hours * 60), 0),
    ).toBe(499);
    expect(sourceRows).toEqual(before);
    expectNoWrites();
  });

  it('preserves all source rows while allocating duplicate and overlapping minutes once', async () => {
    sourceRows = [
      row(1, '08:30', '12:30'),
      row(2, '08:30', '12:30'),
      row(3, '12:00', '17:30'),
    ];
    const result = await service.getAttendances('Company A');

    expect(result.map((log) => log.id).sort()).toEqual([1, 2, 3]);
    expect(
      result.reduce((minutes, log) => minutes + Math.round(log.hours * 60), 0),
    ).toBe(480);
    expectNoWrites();
  });

  it('uses each employee company schedule and unpaid lunch when reading attendance', async () => {
    sourceRows = [
      row(1, '08:30', '17:30'),
      row(2, '10:00', '19:00', { employeeId: 2 }),
    ];
    const result = await service.getAttendances();

    expect(result.find((log) => log.employeeId === 1)?.hours).toBe(8);
    expect(result.find((log) => log.employeeId === 2)?.hours).toBe(8.5);
    expectNoWrites();
  });

  it('normalizes midnight/date values and returns an exact existing source session without inserting it twice', async () => {
    sourceRows = [row(1, '00:00', '00:38')];
    const result = await service.createAttendance({
      employeeId: 1,
      date: '2026-10-05T16:00:00.000Z',
      timeIn: '12:00 AM',
      timeOut: '12:38 AM',
      hours: 999,
    });

    expect(result.id).toBe(1);
    expect(database.attendance.create).not.toHaveBeenCalled();
    expect(database.attendance.update).not.toHaveBeenCalled();
    expect(sourceRows).toHaveLength(1);
  });

  it('creates a distinct same-day session and calculates its hours instead of trusting the client', async () => {
    sourceRows = [row(1, '00:00', '00:38')];
    const result = await service.createAttendance({
      employeeId: 1,
      date: '2026-10-06',
      timeIn: '9:32 AM',
      timeOut: '6:13 PM',
      hours: 999,
    });

    expect(sourceRows).toHaveLength(2);
    expect(result.timeIn).toBe('09:32');
    expect(result.timeOut).toBe('18:13');
    expect(Math.round(result.hours * 60)).toBe(461);
    expect(database.attendance.update).not.toHaveBeenCalled();
  });

  it('updates only the explicit source ID, preserves approved break overrides, and clears hours for missing punches', async () => {
    sourceRows = [
      row(1, '08:30', '17:30', {
        breakOut: '12:10',
        breakIn: '12:40',
        lunchOverrideMinutes: 45,
      }),
      row(2, '19:00', '20:00'),
    ];
    const changed = await service.updateAttendance(1, { timeOut: '18:00' });

    expect(Math.round(changed.hours * 60)).toBe(525);
    expect(changed.breakOut).toBe('12:10');
    expect(changed.breakIn).toBe('12:40');
    expect(changed.lunchOverrideMinutes).toBe(45);
    expect(sourceRows[1]).toEqual(row(2, '19:00', '20:00'));

    const missing = await service.updateAttendance(1, { timeOut: '' });
    expect(missing.hours).toBe(0);
    expect(sourceRows[1]).toEqual(row(2, '19:00', '20:00'));
  });

  it('reads fresh attendance and applies cutoff net hours by default', async () => {
    sourceRows = [
      row(1, '08:30', '18:30'),
      row(2, '08:30', '16:30', { date: '2026-10-07' }),
    ];
    await service.createPayroll(
      payrollInput({
        totalHours: 999,
        grossPay: 999999,
        netPay: 999999,
        attendanceSummary: { version: 999 },
        overtimeBasis: 'DAILY',
      }),
    );
    const stored = database.payroll.create.mock.calls[0][0].data;

    expect(stored.totalHours).toBe(16);
    expect(stored.grossPay).toBe(1600);
    expect(stored.netPay).toBe(1600);
    expect(stored.attendanceSummary).toEqual(
      expect.objectContaining({
        version: 1,
        cutoffStart: '2026-10-06',
        cutoffEnd: '2026-10-07',
        totalMinutes: 960,
        regularMinutes: 960,
        overtimeMinutes: 0,
        overtimeBasis: 'CUTOFF_NET',
        requiredMinutes: 960,
        basicSalary: 1600,
        ratePerDay: 800,
        ratePerHour: 100,
        otPay: 0,
        undertimeDeduction: 0,
        grossPay: 1600,
      }),
    );
    expect(database.attendance.update).not.toHaveBeenCalled();
    expect(database.payroll.update).not.toHaveBeenCalled();
  });

  it.each([
    ['above target', '18:30', '17:30', 1020, 60, 0, 125, 0, 1725],
    ['below target', '17:30', '16:30', 900, 0, 60, 0, 100, 1500],
  ])(
    'saves cutoff net payroll %s with excess at 125%% and shortage at the normal rate',
    async (
      _case,
      firstOut,
      secondOut,
      totalMinutes,
      overtimeMinutes,
      undertimeMinutes,
      otPay,
      undertimeDeduction,
      grossPay,
    ) => {
      sourceRows = [
        row(1, '08:30', firstOut),
        row(2, '08:30', secondOut, { date: '2026-10-07' }),
      ];
      const before = structuredClone(sourceRows);
      const preview = await service.previewPayroll(payrollInput());
      expect(preview.attendanceSummary).toEqual(
        expect.objectContaining({
          overtimeBasis: 'CUTOFF_NET',
          requiredMinutes: 960,
          totalMinutes,
          overtimeMinutes,
          undertimeMinutes,
          otPay,
          undertimeDeduction,
          grossPay,
        }),
      );
      await service.createPayroll(payrollInput());
      expect(savedPayrolls[0]).toEqual(
        expect.objectContaining({
          grossPay,
          netPay: grossPay,
          attendanceSummary: preview.attendanceSummary,
        }),
      );
      expect(sourceRows).toEqual(before);
      expect(database.attendance.update).not.toHaveBeenCalled();
      expect(database.payroll.update).not.toHaveBeenCalled();
    },
  );

  it('reflects attendance edits and deletions in subsequent payrolls while preserving the saved snapshot', async () => {
    sourceRows = [row(1, '08:30', '17:30')];
    await service.createPayroll(
      payrollInput({ cutoffEnd: '2026-10-06', daysWorked: 1 }),
    );
    const firstSaved = structuredClone(savedPayrolls[0]);

    await service.updateAttendance(1, { timeOut: '16:30' });
    await service.createPayroll(
      payrollInput({ cutoffEnd: '2026-10-06', daysWorked: 1 }),
    );
    expect(database.payroll.create.mock.calls[1][0].data.totalHours).toBe(7);

    await service.deleteAttendance(1);
    await service.createPayroll(
      payrollInput({ cutoffEnd: '2026-10-06', daysWorked: 1 }),
    );
    expect(database.payroll.create.mock.calls[2][0].data.totalHours).toBe(0);
    expect(savedPayrolls[0]).toEqual(firstSaved);
    expect(database.payroll.update).not.toHaveBeenCalled();
    expect(database.payroll.delete).not.toHaveBeenCalled();
  });

  it.each([
    { cutoffStart: undefined },
    { cutoffEnd: undefined },
    { cutoffStart: '2026-10-08' },
    { employeeId: 0 },
    { daysWorked: -1 },
  ])(
    'rejects invalid new payroll inputs without saving a snapshot: %o',
    async (invalid) => {
      await expect(
        service.createPayroll(payrollInput(invalid)),
      ).rejects.toThrow();
      expect(database.payroll.create).not.toHaveBeenCalled();
      expect(database.payroll.update).not.toHaveBeenCalled();
    },
  );

  it('returns company settings, falls back to Global, and never creates defaults on reads', async () => {
    await expect(service.getSettings('Company B')).resolves.toEqual(
      settingRows[2],
    );
    await expect(service.getSettings('Missing Company')).resolves.toEqual(
      globalSettings,
    );
    await expect(service.getSettings()).resolves.toEqual(globalSettings);
    database.settings.findUnique.mockResolvedValue(null);
    database.settings.findFirst.mockResolvedValue(null);
    database.settings.findMany.mockResolvedValue([]);
    await expect(service.getSettings('Missing Company')).resolves.toEqual(
      expect.objectContaining({
        shiftStart: '08:00',
        shiftEnd: '17:00',
        lunchStart: '12:00',
        lunchEnd: '13:00',
      }),
    );
    expectNoWrites();
  });

  it('keeps historical attendance audit and default recalculation dry runs read only', async () => {
    sourceRows = [row(1, '00:00', '00:38')];
    const audit = await service.auditHistoricalAttendance('Company A');
    expect(audit.affectedRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 1,
          previousMinutes: 0,
          correctedMinutes: 38,
        }),
      ]),
    );
    const preview = await service.recalculateHistoricalAttendance({
      company: 'Company A',
    });
    expect(preview.mode).toBe('DRY_RUN');
    expect(preview.updatedCount).toBe(0);
    expectNoWrites();
  });

  it('requires reviewed source IDs before applying historical corrections', async () => {
    sourceRows = [row(1, '00:00', '00:38')];
    await expect(
      service.recalculateHistoricalAttendance({
        company: 'Company A',
        dryRun: false,
      }),
    ).rejects.toThrow('recordIds');
    expectNoWrites();
  });

  it('filters saved payrolls by snapshot cutoff dates even when processing occurred later', () => {
    const payrolls = [
      {
        id: 71,
        employeeId: 1,
        createdAt: '2026-11-01T01:00:00.000Z',
        totalHours: 8,
        daysWorked: 1,
        grossPay: 1600,
        netPay: 1600,
        tax: 0,
        attendanceSummary: {
          version: 1,
          cutoffStart: '2026-09-26',
          cutoffEnd: '2026-10-10',
        },
      },
    ];
    const query = {
      company: 'Company A',
      startDate: '2026-09-26',
      endDate: '2026-10-10',
    };
    const cutoffReport = filterAndAggregatePayrollRecords(payrolls, employees, {
      ...query,
      dateType: 'cutoff',
    });

    expect(cutoffReport.totalCount).toBe(1);
    expect(cutoffReport.data).toEqual([
      expect.objectContaining({
        id: 71,
        cutoffStart: '2026-09-26',
        cutoffEnd: '2026-10-10',
      }),
    ]);
    expect(
      filterAndAggregatePayrollRecords(payrolls, employees, {
        ...query,
        dateType: 'payroll_date',
      }).totalCount,
    ).toBe(0);
    expectNoWrites();
  });

  it('rejects invalid schedule clock values before updating company settings', async () => {
    await expect(
      service.updateSettings({
        company: 'Company A',
        shiftStart: '25:00',
        shiftEnd: '17:30',
      }),
    ).rejects.toThrow('Invalid shift or lunch time.');
    expectNoWrites();
  });

  describe('HTTP transport with an isolated mocked database', () => {
    let app: INestApplication<Server>;

    beforeAll(async () => {
      const module = await Test.createTestingModule({
        controllers: [EmployeesController],
        providers: [{ provide: EmployeesService, useValue: service }],
      })
        // Authentication requirements are independently tested with real guards.
        // Keep these existing transport/calculation fixtures in Company A.
        .overrideGuard(PayrollAuthGuard)
        .useValue({
          canActivate: (context: ExecutionContext) => {
            const req = context
              .switchToHttp()
              .getRequest<{ headers: Record<string, string> }>();
            req.headers['x-company'] = 'Company A';
            return true;
          },
        })
        .overrideGuard(AdminAuthGuard)
        .useValue({ canActivate: () => true })
        .compile();
      app = module.createNestApplication<INestApplication<Server>>();
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it('returns corrected company attendance without persisting recalculated hours', async () => {
      sourceRows = [
        row(1, '00:00', '00:38'),
        row(2, '09:32', '18:13'),
        row(3, '10:00', '19:00', { employeeId: 2 }),
      ];
      const response = await request(app.getHttpServer())
        .get('/employees/attendance/all')
        .query({ company: 'Company A' })
        .expect(200);
      const body = response.body as SourceRow[];

      expect(body).toHaveLength(2);
      expect(body.every((log) => log.employeeId === 1)).toBe(true);
      expect(
        body.reduce((minutes, log) => minutes + Math.round(log.hours * 60), 0),
      ).toBe(499);
      expect(sourceRows.every((log) => log.hours === 0)).toBe(true);
      expectNoWrites();
    });

    it('rejects a non-string punch before persisting attendance', async () => {
      await request(app.getHttpServer())
        .post('/employees/attendance')
        .send({
          employeeId: 1,
          date: '2026-10-06',
          timeIn: { hour: 8 },
          timeOut: '17:30',
        })
        .expect(400);
      expectNoWrites();
    });

    it('creates a distinct same-day session and makes exact reimports idempotent', async () => {
      sourceRows = [row(1, '00:00', '00:38')];
      const payload = {
        employeeId: 1,
        date: '2026-10-06',
        timeIn: '09:32',
        timeOut: '18:13',
        hours: 999,
      };
      const first = await request(app.getHttpServer())
        .post('/employees/attendance')
        .send(payload)
        .expect(201);
      const duplicate = await request(app.getHttpServer())
        .post('/employees/attendance')
        .send(payload)
        .expect(201);

      expect((duplicate.body as SourceRow).id).toBe(
        (first.body as SourceRow).id,
      );
      expect(sourceRows).toHaveLength(2);
      expect(database.attendance.create).toHaveBeenCalledTimes(1);
      expect(database.attendance.update).not.toHaveBeenCalled();
    });

    it('uses edited and deleted source records for new payrolls while retaining earlier snapshots', async () => {
      sourceRows = [row(1, '08:30', '17:30')];
      await request(app.getHttpServer())
        .patch('/employees/attendance/1')
        .send({ timeOut: '16:30' })
        .expect(200);
      const refreshed = await request(app.getHttpServer())
        .get('/employees/attendance/all')
        .query({ company: 'Company A' })
        .expect(200);
      expect((refreshed.body as SourceRow[])[0].hours).toBe(7);

      const payload = payrollInput({
        cutoffEnd: '2026-10-06',
        daysWorked: 1,
        totalHours: 999,
        grossPay: 999999,
        attendanceSummary: { version: 999 },
      });
      const first = await request(app.getHttpServer())
        .post('/employees/payroll')
        .send(payload)
        .expect(201);
      const firstBody = first.body as Record<string, unknown>;
      expect(firstBody.totalHours).toBe(7);
      expect(firstBody.grossPay).toBe(1400);
      expect(firstBody.attendanceSummary).toEqual(
        expect.objectContaining({ version: 1, totalMinutes: 420 }),
      );
      const earlierSnapshot = structuredClone(savedPayrolls[0]);

      await request(app.getHttpServer())
        .delete('/employees/attendance/1')
        .expect(200);
      const empty = await request(app.getHttpServer())
        .get('/employees/attendance/all')
        .query({ company: 'Company A' })
        .expect(200);
      expect(empty.body).toEqual([]);
      const afterDeletion = await request(app.getHttpServer())
        .post('/employees/payroll')
        .send(payload)
        .expect(201);
      expect((afterDeletion.body as Record<string, unknown>).totalHours).toBe(
        0,
      );
      expect(savedPayrolls[0]).toEqual(earlierSnapshot);
      expect(database.payroll.update).not.toHaveBeenCalled();
      expect(database.payroll.delete).not.toHaveBeenCalled();
    });

    it('rejects missing payroll cutoff dates through the HTTP API', async () => {
      await request(app.getHttpServer())
        .post('/employees/payroll')
        .send({ employeeId: 1, daysWorked: 1, totalHours: 999 })
        .expect(400);
      expectNoWrites();
    });

    it('rejects unreviewed historical apply requests through the HTTP API', async () => {
      sourceRows = [row(1, '00:00', '00:38')];
      await request(app.getHttpServer())
        .post('/employees/attendance/recalculate-lunch')
        .send({ company: 'Company A', dryRun: false })
        .expect(400);
      expectNoWrites();
    });

    it('rejects a lunch override outside the database integer range before persisting attendance', async () => {
      await request(app.getHttpServer())
        .post('/employees/attendance')
        .send({
          employeeId: 1,
          date: '2026-10-06',
          timeIn: '08:30',
          timeOut: '17:30',
          lunchOverrideMinutes: 2147483648,
        })
        .expect(400);
      expectNoWrites();
    });
  });
});
