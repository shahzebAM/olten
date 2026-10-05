import { BadRequestException } from '@nestjs/common';
import {
  choiceFromReminder,
  companyToday,
  daysBetween,
  expiryStatus,
  parseIsoDate,
  readReminderChoice,
  reminderMessage,
  reminderSchedule,
} from './expiry-date.utils';

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe('document expiry calendar dates', () => {
  const originalTimezone = process.env.DOCUMENT_EXPIRY_TIMEZONE;

  afterEach(() => {
    if (originalTimezone === undefined) delete process.env.DOCUMENT_EXPIRY_TIMEZONE;
    else process.env.DOCUMENT_EXPIRY_TIMEZONE = originalTimezone;
  });

  it('accepts real ISO calendar dates and rejects ambiguous or rolled-over dates', () => {
    expect(parseIsoDate('2028-02-29')).toEqual(date('2028-02-29'));
    expect(parseIsoDate('2026-10-06T00:00:00.000Z')).toEqual(date('2026-10-06'));
    expect(parseIsoDate(date('2026-10-06'))).toEqual(date('2026-10-06'));
    for (const invalid of ['2026-02-29', '2026-04-31', '10/06/2026', '',
      '2026-10-06T04:00:00Z', '2026-13-01', new Date(NaN), 1791244800000]) {
      expect(parseIsoDate(invalid)).toBeNull();
    }
  });

  it('uses Manila midnight by default and supports the configured company timezone', () => {
    delete process.env.DOCUMENT_EXPIRY_TIMEZONE;
    expect(companyToday(new Date('2026-10-04T15:59:59.999Z'))).toEqual(date('2026-10-04'));
    expect(companyToday(new Date('2026-10-04T16:00:00.000Z'))).toEqual(date('2026-10-05'));
    process.env.DOCUMENT_EXPIRY_TIMEZONE = 'America/New_York';
    expect(companyToday(new Date('2026-10-05T01:00:00.000Z'))).toEqual(date('2026-10-04'));
  });

  it('keeps day lead times exact across month and year boundaries, including zero', () => {
    expect(reminderSchedule(date('2026-10-06'), { value: 2, unit: 'days' })).toEqual({
      triggerDate: date('2026-10-04'), reminderDays: 2, reminderType: 'MANUAL',
    });
    expect(reminderSchedule(date('2027-01-01'), { value: 2, unit: 'days' }).triggerDate)
      .toEqual(date('2026-12-30'));
    expect(reminderSchedule(date('2026-10-06'), { value: 0, unit: 'days' }).triggerDate)
      .toEqual(date('2026-10-06'));
  });

  it.each([
    ['2026-10-06', 2, '2026-08-06', 61],
    ['2026-03-31', 1, '2026-02-28', 31],
    ['2028-03-31', 1, '2028-02-29', 31],
    ['2027-01-31', 2, '2026-11-30', 62],
  ])('subtracts %s minus %s calendar months with month-end clamping', (expiry, months, trigger, days) => {
    const original = date(expiry);
    expect(reminderSchedule(original, { value: months, unit: 'months' })).toEqual({
      triggerDate: date(trigger), reminderDays: days, reminderType: `MANUAL_MONTHS_${months}`,
    });
    expect(original).toEqual(date(expiry));
  });

  it('keeps uncertain dates under review even after their proposed expiry', () => {
    const today = date('2026-10-05');
    expect(expiryStatus(date('2026-10-04'), true, today)).toBe('NEEDS_REVIEW');
    expect(expiryStatus(null, false, today)).toBe('NO_EXPIRY');
    expect(expiryStatus(date('2026-10-04'), false, today)).toBe('EXPIRED');
    expect(expiryStatus(today, false, today)).toBe('EXPIRES_TODAY');
    expect(expiryStatus(date('2026-11-04'), false, today)).toBe('EXPIRING_SOON');
    expect(expiryStatus(date('2026-11-05'), false, today)).toBe('ACTIVE');
    expect(daysBetween(date('2026-10-06'), today)).toBe(1);
  });

  it('renders due reminders correctly for tomorrow, today, and already expired documents', () => {
    const today = date('2026-10-05');
    expect(reminderMessage('Permit.pdf', date('2026-10-06'), today))
      .toBe('Permit.pdf expires on 2026-10-06 (1 day remaining).');
    expect(reminderMessage('Permit.pdf', today, today))
      .toBe('Permit.pdf expires today (2026-10-05).');
    expect(reminderMessage('Permit.pdf', date('2026-10-03'), today))
      .toBe('Permit.pdf expired on 2026-10-03 (2 days ago).');
  });
});

describe('document reminder input', () => {
  it('accepts legacy day inputs and explicit day/month choices without losing zero', () => {
    expect(readReminderChoice({ reminderDays: '0' })).toEqual({ value: 0, unit: 'days' });
    expect(readReminderChoice({ reminderValue: '2', reminderUnit: 'months' }))
      .toEqual({ value: 2, unit: 'months' });
    expect(readReminderChoice({ reminderValue: 2, reminderUnit: 'days' }))
      .toEqual({ value: 2, unit: 'days' });
    expect(readReminderChoice()).toEqual({ value: 30, unit: 'days' });
    expect(readReminderChoice({}, { value: 2, unit: 'months' }))
      .toEqual({ value: 2, unit: 'months' });
  });

  it.each([
    { reminderDays: -1 }, { reminderDays: 1.5 }, { reminderDays: '' },
    { reminderDays: ' 2' }, { reminderDays: 36501 }, { reminderDays: NaN },
    { reminderValue: 1201, reminderUnit: 'months' }, { reminderValue: 2 },
    { reminderValue: 2, reminderUnit: 'years' }, { reminderUnit: 'days' },
    { reminderDays: 2, reminderValue: 2, reminderUnit: 'months' },
  ])('rejects invalid or conflicting choices: %j', input => {
    expect(() => readReminderChoice(input)).toThrow(BadRequestException);
  });

  it('restores calendar-month lead times from the existing reminderType field', () => {
    expect(choiceFromReminder({ reminderType: 'MANUAL_MONTHS_2', reminderDays: 61 }))
      .toEqual({ value: 2, unit: 'months' });
    expect(choiceFromReminder({ reminderType: 'MANUAL', reminderDays: 2 }))
      .toEqual({ value: 2, unit: 'days' });
  });
});
