jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn() }));

import { PrismaClient } from '@prisma/client';
import { EmployeesService } from './employees.service';

const database = { settings: { findUnique: jest.fn(), create: jest.fn() } };
Object.assign(
  (PrismaClient as unknown as jest.Mock).mock.instances[0] as object,
  database,
);

describe('employee settings response', () => {
  beforeEach(() => jest.resetAllMocks());

  it('preserves configured lunch times and all existing settings fields', async () => {
    const settings = {
      id: 2,
      company: 'Surgicom',
      shiftStart: '09:00',
      shiftEnd: '18:00',
      lunchStart: '12:30',
      lunchEnd: '13:15',
    };
    database.settings.findUnique.mockResolvedValue(settings);
    await expect(
      new EmployeesService().getSettings('Surgicom'),
    ).resolves.toEqual(settings);
    expect(database.settings.create).not.toHaveBeenCalled();
  });

  it('returns defaults without writing during an unconfigured settings read', async () => {
    database.settings.findUnique.mockResolvedValue(null);
    const defaults = {
      id: 0,
      company: 'Global',
      shiftStart: '08:00',
      shiftEnd: '17:00',
      lunchStart: '12:00',
      lunchEnd: '13:00',
    };
    await expect(new EmployeesService().getSettings()).resolves.toEqual(
      defaults,
    );
    expect(database.settings.create).not.toHaveBeenCalled();
  });

  it('propagates a settings read failure instead of replacing configured values', async () => {
    const failure = new Error('Settings unavailable');
    database.settings.findUnique.mockRejectedValue(failure);
    await expect(new EmployeesService().getSettings()).rejects.toThrow(failure);
    expect(database.settings.create).not.toHaveBeenCalled();
  });
});
