import { PrismaClient } from '@prisma/client';
import { importBiometricAttendance } from './biometrics-attendance.service';

const rows = [
  {
    personnelId: '7',
    date: '10-12-2026',
    time: '08:00:59 AM',
    direction: 'IN',
  },
  {
    personnelId: '7',
    date: '10-12-2026',
    time: '05:00:49 PM',
    direction: 'OUT',
  },
];
const request = {
  company: 'Example',
  rows,
  startDate: '2026-10-11',
  endDate: '2026-10-25',
  dryRun: true,
};
const setup = () => {
  const saved: Array<{
    employeeId: number;
    date: string;
    timeIn: string;
    timeOut: string;
    hours?: number;
  }> = [];
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    employee: {
      findMany: jest.fn().mockResolvedValue([{ id: 100, employeeId: '007' }]),
    },
    attendance: {
      findMany: jest
        .fn()
        .mockImplementation(() => Promise.resolve(saved.slice())),
      createMany: jest
        .fn()
        .mockImplementation(({ data }: { data: typeof saved }) => {
          saved.push(...data);
          return Promise.resolve({ count: data.length });
        }),
    },
    settings: {
      findUnique: jest.fn().mockResolvedValue({
        shiftStart: '08:00',
        shiftEnd: '17:00',
        lunchStart: '12:00',
        lunchEnd: '13:00',
      }),
    },
  };
  const db = {
    $transaction: jest
      .fn()
      .mockImplementation((action: (value: typeof tx) => unknown) =>
        action(tx),
      ),
  } as unknown as PrismaClient;
  return { db, tx, saved };
};

describe('company-scoped biometrics import', () => {
  it('retries a successful import even when its preview also contained an existing conflict', async () => {
    const { db, saved } = setup();
    saved.push({
      employeeId: 100,
      date: '2026-10-13',
      timeIn: '08:00',
      timeOut: '17:00',
    });
    const input = {
      ...request,
      rows: [
        ...rows,
        { ...rows[0], date: '10-13-2026', time: '09:00' },
        { ...rows[1], date: '10-13-2026', time: '18:00' },
      ],
    };
    const preview = await importBiometricAttendance(db, input);
    const commit = {
      ...input,
      dryRun: false,
      previewFingerprint: preview.previewFingerprint,
    };
    expect((await importBiometricAttendance(db, commit)).imported).toBe(1);
    expect((await importBiometricAttendance(db, commit)).imported).toBe(0);
    expect(saved).toHaveLength(2);
  });
  it('previews by business ID without writes or taking a write lock', async () => {
    const { db, tx } = setup();
    const result = await importBiometricAttendance(db, request);
    expect(result.dryRun).toBe(true);
    expect(result.imported).toBe(0);
    expect(result.plan.summary.newSessions).toBe(1);
    expect(tx.employee.findMany).toHaveBeenCalledWith({
      where: { company: 'Example' },
      select: { id: true, employeeId: true },
    });
    expect(tx.attendance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { employee: { company: 'Example' } } }),
    );
    expect(tx.attendance.createMany).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.settings.findUnique).not.toHaveBeenCalled();
  });
  it('rechecks and imports minute-only sessions using server settings and formulas', async () => {
    const { db, tx, saved } = setup();
    const preview = await importBiometricAttendance(db, request);
    const result = await importBiometricAttendance(db, {
      ...request,
      dryRun: false,
      previewFingerprint: preview.previewFingerprint,
    });
    expect(result.imported).toBe(1);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(saved).toMatchObject([
      {
        employeeId: 100,
        date: '2026-10-12',
        timeIn: '08:00',
        timeOut: '17:00',
        hours: 8,
        reason: null,
      },
    ]);
    const retry = await importBiometricAttendance(db, {
      ...request,
      dryRun: false,
      previewFingerprint: preview.previewFingerprint,
    });
    expect(retry.imported).toBe(0);
    expect(retry.plan.summary.duplicateSessions).toBe(1);
    expect(saved).toHaveLength(1);
  });
  it('preserves a missing side as blank with zero paid hours', async () => {
    const { db, saved } = setup();
    const input = { ...request, rows: rows.slice(0, 1) };
    const preview = await importBiometricAttendance(db, input);
    await importBiometricAttendance(db, {
      ...input,
      dryRun: false,
      previewFingerprint: preview.previewFingerprint,
    });
    expect(saved).toMatchObject([{ timeIn: '08:00', timeOut: '', hours: 0 }]);
  });
  it('requires a new preview after employee IDs or overlapping attendance change', async () => {
    const { db, tx, saved } = setup();
    const preview = await importBiometricAttendance(db, request);
    saved.push({
      employeeId: 100,
      date: '2026-10-12',
      timeIn: '09:00',
      timeOut: '18:00',
    });
    await expect(
      importBiometricAttendance(db, {
        ...request,
        dryRun: false,
        previewFingerprint: preview.previewFingerprint,
      }),
    ).rejects.toThrow(/changed/);
    expect(tx.attendance.createMany).not.toHaveBeenCalled();
    expect(saved).toHaveLength(1);
  });
  it('cannot import an employee ID absent from the selected company', async () => {
    const { db, tx } = setup();
    tx.employee.findMany.mockResolvedValue([]);
    const result = await importBiometricAttendance(db, request);
    expect(result.plan.summary.unmatchedPunches).toBe(2);
    expect(result.plan.sessions).toEqual([]);
  });
  it.each([
    { dryRun: false },
    { hours: 100 },
    { rows: [] },
    { endDate: '2026-02-30' },
    { dryRun: 'yes' },
    { rows: Array(10001).fill({}) },
  ])('rejects malformed or unpreviewed import %j', async (change) => {
    const { db } = setup();
    await expect(
      importBiometricAttendance(db, { ...request, ...change }),
    ).rejects.toThrow();
  });
});
