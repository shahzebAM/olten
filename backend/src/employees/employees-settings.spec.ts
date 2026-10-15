jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn() }));

import { PrismaClient } from '@prisma/client';
import { EmployeesService } from './employees.service';

const database = { settings: { findFirst: jest.fn(), create: jest.fn() } };
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
    database.settings.findFirst.mockResolvedValue(settings);
    await expect(new EmployeesService().getSettings()).resolves.toEqual(
      settings,
    );
    expect(database.settings.create).not.toHaveBeenCalled();
  });

  it('returns the database defaults when initial settings are created', async () => {
    database.settings.findFirst.mockResolvedValue(null);
    const defaults = {
      id: 1,
      company: 'Global',
      shiftStart: '08:00',
      shiftEnd: '17:00',
      lunchStart: '12:00',
      lunchEnd: '13:00',
    };
    database.settings.create.mockResolvedValue(defaults);
    await expect(new EmployeesService().getSettings()).resolves.toEqual(
      defaults,
    );
  });

  it('propagates a settings read failure instead of replacing configured values', async () => {
    const failure = new Error('Settings unavailable');
    database.settings.findFirst.mockRejectedValue(failure);
    await expect(new EmployeesService().getSettings()).rejects.toThrow(failure);
    expect(database.settings.create).not.toHaveBeenCalled();
  });
});
