import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { EmployeesController } from '../employees/employees.controller';
import { EmployeesService } from '../employees/employees.service';
import { AdminAuthGuard } from './admin-auth.guard';
import { AuthSessionService } from './auth-session.service';
import { PayrollAuthGuard } from './payroll-auth.guard';

jest.mock('@prisma/client', () => {
  const actual =
    jest.requireActual<typeof import('@prisma/client')>('@prisma/client');
  const mockClient = {
    employee: { findFirst: jest.fn(), findMany: jest.fn() },
    attendance: { findFirst: jest.fn(), findMany: jest.fn() },
    payroll: { findFirst: jest.fn(), findMany: jest.fn() },
    $disconnect: jest.fn().mockResolvedValue(undefined),
  };
  return { ...actual, PrismaClient: jest.fn(() => mockClient), mockClient };
});
const database = jest.requireMock<{
  mockClient: {
    employee: { findFirst: jest.Mock; findMany: jest.Mock };
    attendance: { findFirst: jest.Mock; findMany: jest.Mock };
    payroll: { findFirst: jest.Mock; findMany: jest.Mock };
  };
}>('@prisma/client').mockClient;

describe('Payroll authenticated company boundary', () => {
  const user = {
    id: 1,
    username: 'payroll-staff',
    role: 'Admin',
    modules: { payroll: true, companies: { 'Company A': true } },
  };
  const sessions = { authenticate: jest.fn(), companyExists: jest.fn() };
  const guard = new PayrollAuthGuard(sessions as unknown as AuthSessionService);
  const employees = {
    getEmployees: jest.fn(),
    getAttendances: jest.fn(),
    getPayrolls: jest.fn(),
    previewPayroll: jest.fn(),
    createPayroll: jest.fn(),
    updateAttendance: jest.fn(),
    deletePayroll: jest.fn(),
    getSettings: jest.fn(),
    updateSettings: jest.fn(),
  };
  type ScopeRequest = {
    method: string;
    path: string;
    params: Record<string, string>;
    query: Record<string, unknown>;
    headers: Record<string, unknown>;
    body?: Record<string, unknown>;
  };
  const scopeRequest = (patch: Partial<ScopeRequest> = {}): ScopeRequest => ({
    method: 'GET',
    path: '/employees',
    params: {},
    query: {},
    headers: { authorization: 'Bearer test', 'x-company': 'Company A' },
    ...patch,
  });
  const context = (req: ScopeRequest) =>
    ({ switchToHttp: () => ({ getRequest: () => req }) }) as ExecutionContext;
  let app: INestApplication<Server>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [EmployeesController],
      providers: [
        PayrollAuthGuard,
        AdminAuthGuard,
        { provide: AuthSessionService, useValue: sessions },
        { provide: EmployeesService, useValue: employees },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    sessions.authenticate.mockImplementation((authorization: unknown) => {
      if (authorization !== 'Bearer test') throw new UnauthorizedException();
      return Promise.resolve(user);
    });
    sessions.companyExists.mockResolvedValue(true);
    database.employee.findFirst.mockImplementation(
      ({ where }: { where: { id: number; company: string } }) =>
        Promise.resolve(
          where.company === 'Company A' && where.id === 1 ? { id: 1 } : null,
        ),
    );
    for (const [table, id] of [
      [database.attendance, 101],
      [database.payroll, 201],
    ] as const) {
      table.findFirst.mockImplementation(
        ({ where }: { where: { id: number; employee: { company: string } } }) =>
          Promise.resolve(
            where.employee.company === 'Company A' && where.id === id
              ? { id }
              : null,
          ),
      );
      table.findMany.mockImplementation(
        ({
          where,
        }: {
          where: { id: { in: number[] }; employee: { company: string } };
        }) =>
          Promise.resolve(
            where.employee.company === 'Company A' && where.id.in.includes(id)
              ? [{ id }]
              : [],
          ),
      );
    }
    employees.getEmployees.mockResolvedValue([
      { id: 1, company: 'Company A' },
      { id: 2, company: 'Company B' },
    ]);
    employees.getAttendances.mockResolvedValue([]);
    employees.getPayrolls.mockResolvedValue([]);
    employees.previewPayroll.mockResolvedValue({
      computed: { grossPay: 10884.58, netPay: 9909.58 },
    });
    employees.createPayroll.mockResolvedValue({
      id: 201,
      employeeId: 1,
      grossPay: 10884.58,
      netPay: 9909.58,
    });
    employees.updateAttendance.mockResolvedValue({ id: 101, employeeId: 1 });
    employees.getSettings.mockResolvedValue({
      company: 'Company A',
      shiftStart: '08:30',
      shiftEnd: '17:30',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a missing session before reading any employee', async () => {
    await request(app.getHttpServer())
      .get('/employees')
      .set('x-company', 'Company A')
      .expect(401);
    expect(employees.getEmployees).not.toHaveBeenCalled();
    expect(database.employee.findFirst).not.toHaveBeenCalled();
  });

  it.each([undefined, '', ['Company A'], 'Company\nA'])(
    'rejects malformed company headers: %p',
    async (company) => {
      await expect(
        guard.canActivate(
          context(
            scopeRequest({
              headers: { authorization: 'Bearer test', 'x-company': company },
            }),
          ),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it.each([
    { payroll: false, companies: { 'Company A': true } },
    { payroll: true, companies: { 'Company A': false } },
    { payroll: 'true', companies: { 'Company A': true } },
  ])('requires explicit payroll and company access: %p', async (modules) => {
    sessions.authenticate.mockResolvedValue({ ...user, modules });
    await expect(
      guard.canActivate(context(scopeRequest())),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires an existing company even for a Super Admin', async () => {
    sessions.authenticate.mockResolvedValue({
      ...user,
      role: 'Super Admin',
      modules: {},
    });
    sessions.companyExists.mockResolvedValue(false);
    await expect(
      guard.canActivate(context(scopeRequest())),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('normalizes the header and injects only trusted company without changing payload amounts', async () => {
    const req = scopeRequest({
      method: 'POST',
      path: '/employees/payroll',
      headers: { authorization: 'Bearer test', 'x-company': ' Company A ' },
      body: { employeeId: 1, grossPay: 10884.58, netPay: 9909.58 },
    });
    await expect(guard.canActivate(context(req))).resolves.toBe(true);
    expect(req.headers['x-company']).toBe('Company A');
    expect(req.body).toEqual({
      employeeId: 1,
      grossPay: 10884.58,
      netPay: 9909.58,
      company: 'Company A',
    });
  });

  it.each([
    { query: { company: 'Company B' } },
    { body: { company: 'Company B' } },
  ])('rejects a conflicting query/body company: %p', async (patch) => {
    await expect(
      guard.canActivate(context(scopeRequest(patch))),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('retains a new employee code instead of treating it as a foreign employee ID', async () => {
    const req = scopeRequest({
      method: 'POST',
      body: { employeeId: 'EMP-2026-001', company: 'Company A' },
    });
    await expect(guard.canActivate(context(req))).resolves.toBe(true);
    expect(req.body?.employeeId).toBe('EMP-2026-001');
    expect(database.employee.findFirst).not.toHaveBeenCalled();
  });

  it.each(['2', '999'])(
    'rejects a foreign or absent employee ID %s',
    async (id) => {
      await expect(
        guard.canActivate(
          context(
            scopeRequest({
              method: 'PATCH',
              path: `/employees/${id}`,
              params: { id },
              body: { baseRate: 1 },
            }),
          ),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    },
  );

  it('rejects malformed employee IDs', async () => {
    await expect(
      guard.canActivate(
        context(
          scopeRequest({
            path: '/employees/1suffix',
            params: { id: '1suffix' },
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects reassigning an owned attendance to a foreign employee', async () => {
    await request(app.getHttpServer())
      .patch('/employees/attendance/101')
      .set('Authorization', 'Bearer test')
      .set('x-company', 'Company A')
      .send({ employeeId: 2 })
      .expect(404);
    expect(employees.updateAttendance).not.toHaveBeenCalled();
  });

  it('rejects foreign payroll IDs before deletion', async () => {
    await request(app.getHttpServer())
      .delete('/employees/payroll/202')
      .set('Authorization', 'Bearer test')
      .set('x-company', 'Company A')
      .expect(404);
    expect(employees.deletePayroll).not.toHaveBeenCalled();
  });

  it('rejects mixed-company bulk recalculation IDs', async () => {
    await expect(
      guard.canActivate(
        context(
          scopeRequest({
            method: 'POST',
            path: '/employees/payroll/recalculate-tax',
            body: { payrollIds: [201, 202], dryRun: false },
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('accepts only owned IDs in a bulk correction request', async () => {
    await expect(
      guard.canActivate(
        context(
          scopeRequest({
            method: 'POST',
            path: '/employees/attendance/recalculate-lunch',
            body: { recordIds: [101], dryRun: true },
          }),
        ),
      ),
    ).resolves.toBe(true);
  });

  it('scopes employee reads to the validated company even when the query omits it', async () => {
    const response = await request(app.getHttpServer())
      .get('/employees')
      .set('Authorization', 'Bearer test')
      .set('x-company', 'Company A')
      .expect(200);
    expect(response.body).toEqual([{ id: 1, company: 'Company A' }]);
  });

  it('passes the validated company to attendance, payroll and settings reads', async () => {
    for (const path of [
      '/employees/attendance/all',
      '/employees/payroll/all',
      '/settings',
    ])
      await request(app.getHttpServer())
        .get(path)
        .set('Authorization', 'Bearer test')
        .set('x-company', 'Company A')
        .expect(200);
    expect(employees.getAttendances).toHaveBeenCalledWith('Company A');
    expect(employees.getPayrolls).toHaveBeenCalledWith(
      expect.objectContaining({ company: 'Company A' }),
    );
    expect(employees.getSettings).toHaveBeenCalledWith('Company A');
  });

  it('retains the approved request payload and saved payroll response amounts', async () => {
    const payload = {
      employeeId: 1,
      cutoffStart: '2026-08-11',
      cutoffEnd: '2026-08-25',
      sssDeduction: 975,
    };
    const response = await request(app.getHttpServer())
      .post('/employees/payroll')
      .set('Authorization', 'Bearer test')
      .set('x-company', 'Company A')
      .send(payload)
      .expect(201);
    expect(employees.createPayroll).toHaveBeenCalledWith({
      ...payload,
      company: 'Company A',
    });
    expect(response.body).toEqual({
      id: 201,
      employeeId: 1,
      grossPay: 10884.58,
      netPay: 9909.58,
    });
  });

  it('scopes the employee service database read to the validated company', async () => {
    database.employee.findMany.mockResolvedValue([]);
    const service = new EmployeesService();
    await expect(service.getEmployees('Company A')).resolves.toEqual([]);
    expect(database.employee.findMany).toHaveBeenCalledWith({
      where: { company: 'Company A' },
    });
  });

  it('scopes payroll listing database reads before calculating display aggregates', async () => {
    database.employee.findMany.mockResolvedValue([]);
    database.payroll.findMany.mockResolvedValue([]);
    const service = new EmployeesService();
    await service.getPayrolls({ company: 'Company A' });
    expect(database.payroll.findMany).toHaveBeenCalledWith({
      where: { employee: { company: 'Company A' } },
    });
    expect(database.employee.findMany).toHaveBeenCalledWith({
      where: { company: 'Company A' },
    });
  });

  it('limits the payroll tax audit scanned count to the authorized company query', async () => {
    database.employee.findMany.mockResolvedValue([]);
    database.payroll.findMany.mockResolvedValue([]);
    const service = new EmployeesService();
    await expect(
      service.auditHistoricalPayrollTax('Company A'),
    ).resolves.toEqual({
      totalScanned: 0,
      discrepancyCount: 0,
      discrepancies: [],
    });
    expect(database.payroll.findMany).toHaveBeenCalledWith({
      where: { employee: { company: 'Company A' } },
    });
  });
});
