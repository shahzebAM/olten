jest.mock('@prisma/client', () => {
  const actual =
    jest.requireActual<typeof import('@prisma/client')>('@prisma/client');
  const mockDatabase = {
    employee: { findUnique: jest.fn(), findMany: jest.fn() },
    attendance: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
    },
    settings: { findUnique: jest.fn() },
    erpAuditLog: { create: jest.fn() },
    payroll: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    $executeRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  return { ...actual, PrismaClient: jest.fn(() => mockDatabase), mockDatabase };
});

import type { Attendance } from '@prisma/client';
import type { PayrollRequest } from '../auth/payroll-auth.guard';
import { getAttendanceSourceFingerprint } from './attendance-session-source';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';

type Employee = { id: number; company: string };
type AuditData = {
  company: string;
  actorId: number;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  details: unknown;
};
interface MockDatabase {
  employee: {
    findUnique: jest.Mock<
      Promise<Employee | null>,
      [{ where: { id: number } }]
    >;
    findMany: jest.Mock<Promise<Employee[]>, [unknown?]>;
  };
  attendance: {
    findUnique: jest.Mock<
      Promise<Attendance | null>,
      [{ where: { id: number } }]
    >;
    findMany: jest.Mock<Promise<Attendance[]>, [unknown?]>;
    delete: jest.Mock<Promise<Attendance>, [{ where: { id: number } }]>;
  };
  settings: { findUnique: jest.Mock<Promise<typeof settings>, [unknown]> };
  erpAuditLog: { create: jest.Mock<Promise<AuditData>, [{ data: AuditData }]> };
  payroll: { create: jest.Mock; update: jest.Mock; delete: jest.Mock };
  $executeRaw: jest.Mock<Promise<number>, [TemplateStringsArray, ...unknown[]]>;
  $transaction: jest.Mock<
    Promise<unknown>,
    [(database: MockDatabase) => Promise<unknown>]
  >;
}

const database = jest.requireMock<{ mockDatabase: MockDatabase }>(
  '@prisma/client',
).mockDatabase;
const service = new EmployeesService();
const controller = new EmployeesController(service);
const actor = { id: 7, username: 'payroll-staff' };
const employee = { id: 1, company: 'Company A' };
const settings = {
  company: 'Company A',
  shiftStart: '08:00',
  shiftEnd: '17:00',
  lunchStart: '12:00',
  lunchEnd: '13:00',
};
const makeRecord = (changes: Partial<Attendance> = {}): Attendance => ({
  id: 101,
  employeeId: 1,
  date: '2026-10-12',
  timeIn: '08:00',
  timeOut: '17:00',
  hours: 999,
  reason: null,
  shiftStart: '08:00',
  shiftEnd: '17:00',
  lunchStart: '12:00',
  lunchEnd: '13:00',
  breakOut: null,
  breakIn: null,
  lunchOverrideMinutes: null,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  ...changes,
});
let records: Attendance[];
let audits: AuditData[];

beforeEach(() => {
  jest.resetAllMocks();
  records = [makeRecord()];
  audits = [];
  database.employee.findUnique.mockResolvedValue(employee);
  database.employee.findMany.mockResolvedValue([employee]);
  database.settings.findUnique.mockResolvedValue(settings);
  database.$executeRaw.mockResolvedValue(1);
  database.attendance.findUnique.mockImplementation(({ where }) =>
    Promise.resolve(records.find((row) => row.id === where.id) ?? null),
  );
  database.attendance.findMany.mockImplementation(() =>
    Promise.resolve(records.slice()),
  );
  database.attendance.delete.mockImplementation(({ where }) => {
    const index = records.findIndex((row) => row.id === where.id);
    if (index < 0) return Promise.reject(new Error('Missing record'));
    return Promise.resolve(records.splice(index, 1)[0]);
  });
  database.erpAuditLog.create.mockImplementation(({ data }) => {
    audits.push(data);
    return Promise.resolve(data);
  });
  database.$transaction.mockImplementation(async (work) => {
    const before = structuredClone(records),
      beforeAudits = structuredClone(audits);
    try {
      return await work(database);
    } catch (error) {
      records = before;
      audits = beforeAudits;
      throw error;
    }
  });
});

describe('attendance source fingerprint', () => {
  it('ignores derived hours and object key order', () => {
    const raw = makeRecord(),
      expected = getAttendanceSourceFingerprint(raw);
    const changedHours = { ...raw, hours: 8, metrics: { netMinutes: 480 } };
    const reordered = {
      createdAt: raw.createdAt,
      ...Object.fromEntries(Object.entries(raw).reverse()),
    } as Attendance;
    expect(getAttendanceSourceFingerprint(changedHours)).toBe(expected);
    expect(getAttendanceSourceFingerprint(reordered)).toBe(expected);
    expect(expected).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each<Partial<Attendance>>([
    { id: 102 },
    { employeeId: 2 },
    { date: '2026-10-13' },
    { timeOut: '18:00' },
    { reason: 'Reviewed exception' },
    { shiftStart: '09:00' },
    { lunchStart: '11:00' },
    { breakOut: '12:15' },
    { lunchOverrideMinutes: 0 },
  ])('detects a source edit %j', (changes) => {
    expect(getAttendanceSourceFingerprint(makeRecord(changes))).not.toBe(
      getAttendanceSourceFingerprint(makeRecord()),
    );
  });
  it('returns the raw-source fingerprint beside recalculated attendance metrics', async () => {
    const raw = records[0];
    const result = await service.getAttendances('Company A');
    expect(result).toHaveLength(1);
    expect(result[0].hours).toBe(8);
    expect(result[0].sourceFingerprint).toBe(
      getAttendanceSourceFingerprint(raw),
    );
    expect(raw.hours).toBe(999);
  });
});

describe('guarded attendance session removal', () => {
  it('deletes exactly one source row and atomically audits the authenticated actor', async () => {
    records.push(makeRecord({ id: 102, timeIn: '18:00', timeOut: '19:00' }));
    const before = records[0],
      retained = structuredClone(records[1]);
    const fingerprint = getAttendanceSourceFingerprint(before);
    const result = await controller.deleteAttendance(
      '101',
      'Company A',
      { sourceFingerprint: fingerprint },
      { payrollActor: actor } as PayrollRequest,
    );
    expect(result).toEqual(before);
    expect(records).toEqual([retained]);
    expect(audits).toEqual([
      expect.objectContaining({
        company: 'Company A',
        actorId: actor.id,
        actor: actor.username,
        action: 'ATTENDANCE_SESSION_REMOVED',
        entityType: 'Attendance',
        entityId: '101',
        details: {
          before: { ...before, createdAt: before.createdAt.toISOString() },
          sourceFingerprint: fingerprint,
        },
      }),
    ]);
    expect(database.$transaction).toHaveBeenCalledTimes(1);
    expect(database.payroll.create).not.toHaveBeenCalled();
    expect(database.payroll.update).not.toHaveBeenCalled();
    expect(database.payroll.delete).not.toHaveBeenCalled();
  });
  it('rejects a changed source after the employee lock is acquired', async () => {
    const fingerprint = getAttendanceSourceFingerprint(records[0]);
    database.$executeRaw.mockImplementation(() => {
      records[0].timeOut = '18:00';
      return Promise.resolve(1);
    });
    await expect(
      service.deleteAttendance(
        101,
        'Company A',
        { sourceFingerprint: fingerprint },
        actor,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(database.attendance.delete).not.toHaveBeenCalled();
    expect(audits).toEqual([]);
  });
  it('does not consider a derived-hours-only change stale', async () => {
    const fingerprint = getAttendanceSourceFingerprint(records[0]);
    database.$executeRaw.mockImplementation(() => {
      records[0].hours = 8;
      return Promise.resolve(1);
    });
    await expect(
      service.deleteAttendance(
        101,
        'Company A',
        { sourceFingerprint: fingerprint.toUpperCase() },
        actor,
      ),
    ).resolves.toMatchObject({ id: 101 });
    expect(records).toEqual([]);
  });
  it('rejects a foreign workspace without deleting or auditing', async () => {
    const fingerprint = getAttendanceSourceFingerprint(records[0]);
    await expect(
      service.deleteAttendance(
        101,
        'Company B',
        { sourceFingerprint: fingerprint },
        actor,
      ),
    ).rejects.toThrow('Employee does not belong');
    expect(database.attendance.delete).not.toHaveBeenCalled();
    expect(audits).toEqual([]);
  });
  it('rolls back the source deletion when audit writing fails', async () => {
    const before = structuredClone(records),
      fingerprint = getAttendanceSourceFingerprint(records[0]);
    database.erpAuditLog.create.mockRejectedValueOnce(
      new Error('Audit unavailable'),
    );
    await expect(
      service.deleteAttendance(
        101,
        'Company A',
        { sourceFingerprint: fingerprint },
        actor,
      ),
    ).rejects.toThrow('Audit unavailable');
    expect(records).toEqual(before);
    expect(audits).toEqual([]);
  });
  it.each(['bad', '', 1, null])(
    'rejects malformed fingerprints %j',
    async (sourceFingerprint) => {
      await expect(
        service.deleteAttendance(
          101,
          'Company A',
          { sourceFingerprint },
          actor,
        ),
      ).rejects.toThrow('valid attendance source fingerprint');
      expect(database.$transaction).not.toHaveBeenCalled();
    },
  );
  it('rejects actor fields in the client removal body', async () => {
    await expect(
      controller.deleteAttendance('101', 'Company A', { actorId: 999 }, {
        payrollActor: actor,
      } as PayrollRequest),
    ).rejects.toThrow('Invalid attendance removal fields');
    expect(database.$transaction).not.toHaveBeenCalled();
  });
  it('retains backwards-compatible internal deletion without a fingerprint or actor', async () => {
    await expect(
      service.deleteAttendance(101, 'Company A'),
    ).resolves.toMatchObject({ id: 101 });
    expect(records).toEqual([]);
    expect(database.erpAuditLog.create).not.toHaveBeenCalled();
  });
});
