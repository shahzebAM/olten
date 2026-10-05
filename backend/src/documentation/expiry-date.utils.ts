import { BadRequestException } from '@nestjs/common';

const DAY_MS = 86_400_000;
export const DEFAULT_REMINDER_DAYS = 30;
export interface ReminderChoice {
  value: number;
  unit: 'days' | 'months';
}
export interface ReminderOptions {
  reminderDays?: unknown;
  reminderValue?: unknown;
  reminderUnit?: unknown;
  reminderSetup?: unknown;
}

// Expiry dates are calendar dates, stored at UTC midnight, never parsed heuristically.
export function parseIsoDate(value: unknown): Date | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return parseIsoDate(value.toISOString().slice(0, 10));
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.000)?Z)?$/.test(value)) return null;
  const dateText = value.slice(0, 10);
  const parsed = new Date(`${dateText}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === dateText ? parsed : null;
}

export function companyToday(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.DOCUMENT_EXPIRY_TIMEZONE || 'Asia/Manila',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00.000Z`);
}

export function daysBetween(later: Date, earlier: Date): number {
  return Math.round((later.getTime() - earlier.getTime()) / DAY_MS);
}

export function readReminderChoice(options: ReminderOptions = {}, fallback?: ReminderChoice): ReminderChoice {
  const hasDays = options.reminderDays !== undefined && options.reminderDays !== null;
  const hasValue = options.reminderValue !== undefined && options.reminderValue !== null;
  const hasUnit = options.reminderUnit !== undefined && options.reminderUnit !== null;
  if (!hasDays && !hasValue && !hasUnit) return fallback || { value: DEFAULT_REMINDER_DAYS, unit: 'days' };
  if (hasDays && (hasValue || hasUnit)) throw new BadRequestException('Use reminderDays or reminderValue with reminderUnit, not both.');
  const unit = hasDays ? 'days' : options.reminderUnit;
  const rawValue = hasDays ? options.reminderDays : options.reminderValue;
  if (unit !== 'days' && unit !== 'months') throw new BadRequestException('Reminder unit must be days or months.');
  if ((typeof rawValue !== 'number' && typeof rawValue !== 'string') || !/^\d+$/.test(String(rawValue))) {
    throw new BadRequestException('Reminder lead time must be a whole number of zero or more.');
  }
  const value = Number(rawValue);
  const maximum = unit === 'months' ? 1200 : 36500;
  if (!Number.isSafeInteger(value) || value > maximum) throw new BadRequestException(`Reminder lead time cannot exceed ${maximum} ${unit}.`);
  return { value, unit };
}

export function choiceFromReminder(reminder: { reminderType?: string | null; reminderDays: number }): ReminderChoice {
  const months = reminder.reminderType?.match(/^MANUAL_MONTHS_(\d+)$/);
  return months ? { value: Number(months[1]), unit: 'months' } : { value: reminder.reminderDays, unit: 'days' };
}

export function reminderSchedule(expiryDate: Date, choice: ReminderChoice) {
  const triggerDate = new Date(expiryDate);
  if (choice.unit === 'months') {
    const day = triggerDate.getUTCDate();
    triggerDate.setUTCDate(1);
    triggerDate.setUTCMonth(triggerDate.getUTCMonth() - choice.value);
    const lastDay = new Date(triggerDate.getTime());
    lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
    triggerDate.setUTCDate(Math.min(day, lastDay.getUTCDate()));
  } else {
    triggerDate.setUTCDate(triggerDate.getUTCDate() - choice.value);
  }
  return {
    triggerDate,
    reminderDays: daysBetween(expiryDate, triggerDate),
    reminderType: choice.unit === 'months' ? `MANUAL_MONTHS_${choice.value}` : 'MANUAL',
  };
}

export function expiryStatus(expiryDate: Date | null, needsReview = false, today = companyToday()): string {
  if (needsReview) return 'NEEDS_REVIEW';
  if (!expiryDate) return 'NO_EXPIRY';
  const remaining = daysBetween(expiryDate, today);
  return remaining < 0 ? 'EXPIRED' : remaining === 0 ? 'EXPIRES_TODAY' : remaining <= 30 ? 'EXPIRING_SOON' : 'ACTIVE';
}

export function reminderMessage(fileName: string, expiryDate: Date, today = companyToday()): string {
  const remaining = daysBetween(expiryDate, today);
  const dateText = expiryDate.toISOString().slice(0, 10);
  if (remaining < 0) return `${fileName} expired on ${dateText} (${Math.abs(remaining)} ${remaining === -1 ? 'day' : 'days'} ago).`;
  if (remaining === 0) return `${fileName} expires today (${dateText}).`;
  return `${fileName} expires on ${dateText} (${remaining} ${remaining === 1 ? 'day' : 'days'} remaining).`;
}
