import type { Attendance, PrismaClient } from '@prisma/client';
import { importBiometricAttendance } from './biometrics-attendance.service';

const actor = { id: 1, username: 'payroll-staff' };
const request = {
  company: 'Example',
  mode: 'replace',
  submissionKey: '12345678-1234-4234-8234-123456789abc',
  rows: [
    {
      personnelId: '007',
      date: '2026-10-12',
      time: '08:00:59',
      direction: 'IN',
    },
    {
      personnelId: '007',
      date: '2026-10-12',
      time: '17:00:39',
      direction: 'OUT',
    },
  ],
  startDate: '2026-10-11',
  endDate: '2026-10-25',
  dryRun: true,
};
const row = (id: number, changes: Partial<Attendance> = {}): Attendance => ({
  id,
  employeeId: 100,
  date: '2026-10-12',
  timeIn: '09:00',
  timeOut: '18:00',
  hours: 8,
  shiftStart: '08:00',
  shiftEnd: '17:00',
  lunchStart: '12:00',
  lunchEnd: '13:00',
  breakOut: null,
  breakIn: null,
  lunchOverrideMinutes: null,
  reason: null,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  ...changes,
});
const setup = (initial = [row(1)]) => {
  const saved = structuredClone(initial);
  const audits: Array<{
    company: string;
    actorId: number;
    action: string;
    entityType: string;
    entityId: string;
    details: unknown;
  }> = [];
  const employees = [
    { id: 100, employeeId: '007', company: 'Example' },
    { id: 200, employeeId: '007', company: 'Other' },
  ];
  const settings = {
    shiftStart: '08:00',
    shiftEnd: '17:00',
    lunchStart: '12:00',
    lunchEnd: '13:00',
  };
  let nextId = 1000;
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    employee: {
      findMany: jest
        .fn()
        .mockImplementation(({ where }: { where: { company: string } }) =>
          Promise.resolve(
            employees.filter((item) => item.company === where.company),
          ),
        ),
    },
    settings: {
      findUnique: jest.fn().mockImplementation(() => Promise.resolve(settings)),
    },
    attendance: {
      findMany: jest
        .fn()
        .mockImplementation(
          ({ where }: { where: { employee: { company: string } } }) =>
            Promise.resolve(
              saved
                .filter((item) =>
                  employees.some(
                    (employee) =>
                      employee.id === item.employeeId &&
                      employee.company === where.employee.company,
                  ),
                )
                .map((item) => ({ ...item })),
            ),
        ),
      deleteMany: jest
        .fn()
        .mockImplementation(
          ({
            where,
          }: {
            where: { id: { in: number[] }; employee: { company: string } };
          }) => {
            const ids = saved
              .filter(
                (item) =>
                  where.id.in.includes(item.id) &&
                  employees.some(
                    (employee) =>
                      employee.id === item.employeeId &&
                      employee.company === where.employee.company,
                  ),
              )
              .map((item) => item.id);
            for (let index = saved.length - 1; index >= 0; index--)
              if (ids.includes(saved[index].id)) saved.splice(index, 1);
            return Promise.resolve({ count: ids.length });
          },
        ),
      createMany: jest
        .fn()
        .mockImplementation(
          ({ data }: { data: Array<Partial<Attendance>> }) => {
            for (const value of data)
              saved.push(
                row(++nextId, {
                  ...value,
                  createdAt: new Date('2026-10-30T00:00:00Z'),
                }),
              );
            return Promise.resolve({ count: data.length });
          },
        ),
    },
    erpAuditLog: {
      findFirst: jest
        .fn()
        .mockImplementation(
          ({ where }: { where: { company: string; entityId: string } }) =>
            Promise.resolve(
              audits.find(
                (item) =>
                  item.company === where.company &&
                  item.entityId === where.entityId,
              ) ?? null,
            ),
        ),
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: (typeof audits)[number] }) => {
          audits.push(structuredClone(data));
          return Promise.resolve(data);
        }),
    },
  };
  const db = {
    $transaction: jest
      .fn()
      .mockImplementation(
        async (action: (client: typeof tx) => Promise<unknown>) => {
          const before = structuredClone(saved),
            beforeAudits = structuredClone(audits);
          try {
            return await action(tx);
          } catch (error) {
            saved.splice(0, saved.length, ...before);
            audits.splice(0, audits.length, ...beforeAudits);
            throw error;
          }
        },
      ),
  } as unknown as PrismaClient;
  const preview = (change: Record<string, unknown> = {}) =>
    importBiometricAttendance(db, { ...request, ...change }, actor);
  const apply = (
    previewFingerprint: string,
    change: Record<string, unknown> = {},
  ) => preview({ ...change, dryRun: false, previewFingerprint });
  return { saved, audits, tx, db, employees, settings, preview, apply };
};

describe('biometrics overwrite transaction and retry receipt', () => {
  it('previews before/after without writes, locks or audit insertion', async () => {
    const { saved, tx, preview } = setup();
    const before = structuredClone(saved),
      result = await preview();
    expect(result.plan.summary).toMatchObject({
      replacementDays: 1,
      removedSessions: 1,
      newSessions: 0,
    });
    expect(saved).toEqual(before);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.attendance.deleteMany).not.toHaveBeenCalled();
    expect(tx.erpAuditLog.create).not.toHaveBeenCalled();
  });
  it('replaces only represented employee dates and records authenticated before/after history', async () => {
    const unchanged = [
      row(2, { date: '2026-10-13' }),
      row(3, { employeeId: 200 }),
    ];
    const { saved, audits, tx, preview, apply } = setup([row(1), ...unchanged]);
    const result = await apply((await preview()).previewFingerprint);
    expect(result).toMatchObject({ imported: 1, removed: 1, replacedDays: 1 });
    expect(saved.filter((item) => [2, 3].includes(item.id))).toEqual(unchanged);
    expect(
      saved.find(
        (item) => item.employeeId === 100 && item.date === '2026-10-12',
      ),
    ).toMatchObject({ timeIn: '08:00', timeOut: '17:00', hours: 8 });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(3);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      company: 'Example',
      actorId: 1,
      action: 'BIOMETRIC_ATTENDANCE_IMPORT',
      entityId: request.submissionKey,
      details: {
        before: [{ id: 1, timeIn: '09:00' }],
        after: [{ timeIn: '08:00', timeOut: '17:00' }],
      },
    });
  });
  it('returns the original result on identical retry without deleting or creating again', async () => {
    const { preview, apply, tx, audits } = setup();
    const fingerprint = (await preview()).previewFingerprint;
    await apply(fingerprint);
    const repeated = await apply(fingerprint);
    expect(repeated).toMatchObject({ replayed: true, imported: 1, removed: 1 });
    expect(tx.attendance.createMany).toHaveBeenCalledTimes(1);
    expect(tx.attendance.deleteMany).toHaveBeenCalledTimes(1);
    expect(audits).toHaveLength(1);
  });
  it('retries successfully when PostgreSQL JSONB changes scope object key order', async () => {
    const { preview, apply, audits } = setup();
    const fingerprint = (await preview()).previewFingerprint;
    await apply(fingerprint);
    const details = audits[0].details as {
      scope: Array<{ employeeId: number; date: string }>;
    };
    details.scope = details.scope.map((day) => ({
      date: day.date,
      employeeId: day.employeeId,
    }));
    expect(await apply(fingerprint)).toMatchObject({ replayed: true });
    expect(audits).toHaveLength(1);
  });
  it('makes an identical new upload a no-op and keeps explicit zero-break records', async () => {
    const exact = row(1, {
      timeIn: '08:00',
      timeOut: '17:00',
      lunchOverrideMinutes: 0,
    });
    const { saved, preview, apply, tx } = setup([exact]);
    const result = await apply((await preview()).previewFingerprint);
    expect(result).toMatchObject({ imported: 0, removed: 0, replacedDays: 0 });
    expect(saved).toEqual([exact]);
    expect(tx.attendance.createMany).not.toHaveBeenCalled();
  });
  it.each(['reason', 'timeOut', 'lunchOverrideMinutes'] as const)(
    'rejects stale preview after %s changes',
    async (field) => {
      const { saved, preview, apply, tx } = setup();
      const fingerprint = (await preview()).previewFingerprint;
      if (field === 'lunchOverrideMinutes') saved[0][field] = 0;
      else saved[0][field] = field === 'timeOut' ? '19:00' : 'Reviewed';
      await expect(apply(fingerprint)).rejects.toThrow(/changed/);
      expect(tx.attendance.deleteMany).not.toHaveBeenCalled();
    },
  );
  it('rejects changed shift settings before applying the preview', async () => {
    const { settings, preview, apply } = setup();
    const fingerprint = (await preview()).previewFingerprint;
    settings.lunchStart = '11:30';
    await expect(apply(fingerprint)).rejects.toThrow(/changed/);
  });
  it('rejects a reused key with changed input, actor or later edits', async () => {
    const { saved, preview, apply, db } = setup();
    const fingerprint = (await preview()).previewFingerprint;
    await apply(fingerprint);
    await expect(
      apply(fingerprint, { rows: request.rows.slice(0, 1) }),
    ).rejects.toThrow(/already used|changed/);
    await expect(
      importBiometricAttendance(
        db,
        { ...request, dryRun: false, previewFingerprint: fingerprint },
        { id: 2, username: 'different' },
      ),
    ).rejects.toThrow(/already used/);
    saved[0].reason = 'Changed after import';
    await expect(apply(fingerprint)).rejects.toThrow(/changed/);
  });
  it('rejects a retry when an unmatched source ID acquires an empty new employee scope', async () => {
    const { employees, preview, apply } = setup([]);
    const input = {
      rows: request.rows.map((item) => ({ ...item, personnelId: 'NEW' })),
    };
    const fingerprint = (await preview(input)).previewFingerprint;
    await apply(fingerprint, input);
    employees.push({ id: 101, employeeId: 'NEW', company: 'Example' });
    await expect(apply(fingerprint, input)).rejects.toThrow(
      /already used|changed/,
    );
  });
  it('leaves missing punches blank after deliberate replacement', async () => {
    const { saved, preview, apply } = setup();
    const input = { rows: request.rows.slice(0, 1) };
    await apply((await preview(input)).previewFingerprint, input);
    expect(saved).toMatchObject([{ timeIn: '08:00', timeOut: '', hours: 0 }]);
  });
  it('rolls back deletes, inserts and audit together on audit failure', async () => {
    const { saved, tx, preview, apply, audits } = setup();
    const before = structuredClone(saved);
    const fingerprint = (await preview()).previewFingerprint;
    tx.erpAuditLog.create.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(apply(fingerprint)).rejects.toThrow(/audit unavailable/);
    expect(saved).toEqual(before);
    expect(audits).toEqual([]);
  });
  it('requires a trusted actor and UUID submission key for overwrite commits', async () => {
    const { db, preview } = setup();
    const fingerprint = (await preview()).previewFingerprint;
    await expect(
      importBiometricAttendance(db, {
        ...request,
        dryRun: false,
        previewFingerprint: fingerprint,
      }),
    ).rejects.toThrow(/signed-in/);
    await expect(
      importBiometricAttendance(
        db,
        {
          ...request,
          submissionKey: 'bad',
          dryRun: false,
          previewFingerprint: fingerprint,
        },
        actor,
      ),
    ).rejects.toThrow(/submission key/);
    await expect(preview({ mode: 'unknown' })).rejects.toThrow(
      /append or replace/,
    );
  });
});
