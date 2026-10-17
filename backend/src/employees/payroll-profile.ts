import { toAttendanceDateYMD } from './attendance-calculator';

export type PayrollProfile = {
  version: 1;
  paidDayBasis: 'SCHEDULED' | 'FIXED';
  workingWeekdays: number[];
  fixedPaidDays?: number;
  overtimeBasis?: 'DAILY' | 'CUTOFF_NET';
} & (
  | { basis: 'DAILY'; dailyRate: number }
  | { basis: 'CUTOFF'; referenceDays: number }
);

export function validatePayrollProfile(value: unknown): PayrollProfile | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('A valid pay profile is required.');
  const profile = value as Record<string, unknown>;
  if (
    profile.version !== 1 ||
    !['DAILY', 'CUTOFF'].includes(String(profile.basis)) ||
    !['SCHEDULED', 'FIXED'].includes(String(profile.paidDayBasis))
  )
    throw new Error('Unsupported pay profile or paid-day rule.');
  const weekdays = profile.workingWeekdays;
  if (
    profile.overtimeBasis !== undefined &&
    profile.overtimeBasis !== 'DAILY' &&
    profile.overtimeBasis !== 'CUTOFF_NET'
  )
    throw new Error('Select a supported overtime calculation method.');
  if (
    !Array.isArray(weekdays) ||
    !weekdays.length ||
    weekdays.some(
      (day) =>
        typeof day !== 'number' || !Number.isInteger(day) || day < 0 || day > 6,
    ) ||
    new Set(weekdays).size !== weekdays.length
  )
    throw new Error(
      'Select unique working weekdays from Sunday through Saturday.',
    );
  const positive = (input: unknown, maximum: number) =>
    typeof input === 'number' &&
    Number.isFinite(input) &&
    input > 0 &&
    input <= maximum;
  if (
    profile.basis === 'DAILY' &&
    (!positive(profile.dailyRate, 10000000) ||
      Math.abs(
        Number(profile.dailyRate) * 100 -
          Math.round(Number(profile.dailyRate) * 100),
      ) > 0.000001)
  )
    throw new Error(
      'Enter a positive daily rate with at most two decimal places.',
    );
  const validDays = (input: unknown) =>
    positive(input, 31) && Number.isInteger(input);
  if (profile.basis === 'CUTOFF' && !validDays(profile.referenceDays))
    throw new Error('Reference days must be a whole number from 1 through 31.');
  if (profile.paidDayBasis === 'FIXED' && !validDays(profile.fixedPaidDays))
    throw new Error(
      'Fixed paid days must be a whole number from 1 through 31.',
    );
  if (
    profile.basis === 'CUTOFF' &&
    (profile.paidDayBasis !== 'FIXED' ||
      profile.fixedPaidDays !== profile.referenceDays)
  )
    throw new Error(
      'A fixed cutoff salary requires fixed paid days equal to its reference days.',
    );
  const allowed = [
    'version',
    'basis',
    'paidDayBasis',
    'workingWeekdays',
    'overtimeBasis',
    ...(profile.basis === 'DAILY' ? ['dailyRate'] : ['referenceDays']),
    ...(profile.paidDayBasis === 'FIXED' ? ['fixedPaidDays'] : []),
  ];
  if (Object.keys(profile).some((key) => !allowed.includes(key)))
    throw new Error('The pay profile contains unsupported fields.');
  return {
    version: 1,
    paidDayBasis: profile.paidDayBasis as PayrollProfile['paidDayBasis'],
    workingWeekdays: [...(weekdays as number[])].sort((a, b) => a - b),
    ...(profile.overtimeBasis !== undefined
      ? { overtimeBasis: profile.overtimeBasis }
      : {}),
    ...(profile.paidDayBasis === 'FIXED'
      ? { fixedPaidDays: Number(profile.fixedPaidDays) }
      : {}),
    ...(profile.basis === 'DAILY'
      ? { basis: 'DAILY', dailyRate: Number(profile.dailyRate) }
      : { basis: 'CUTOFF', referenceDays: Number(profile.referenceDays) }),
  };
}

export function resolvePayrollBasis(
  profile: PayrollProfile,
  baseRate: number,
  start: string,
  end: string,
) {
  const startDate = toAttendanceDateYMD(start);
  const endDate = toAttendanceDateYMD(end);
  if (!startDate || !endDate || startDate > endDate)
    throw new Error('Select a valid payroll cutoff.');
  const first = new Date(`${startDate}T00:00:00Z`);
  const last = new Date(`${endDate}T00:00:00Z`);
  const expectedStart = new Date(last);
  if (last.getUTCDate() === 10) {
    expectedStart.setUTCDate(1);
    expectedStart.setUTCMonth(expectedStart.getUTCMonth() - 1);
    expectedStart.setUTCDate(26);
  } else if (last.getUTCDate() === 25) expectedStart.setUTCDate(11);
  else
    throw new Error(
      'Automated payroll requires a 26th–10th or 11th–25th cutoff.',
    );
  if (expectedStart.getTime() !== first.getTime())
    throw new Error(
      'Automated payroll requires a 26th–10th or 11th–25th cutoff.',
    );
  const scheduledDates: string[] = [];
  for (
    const date = new Date(first);
    date <= last;
    date.setUTCDate(date.getUTCDate() + 1)
  ) {
    if (profile.workingWeekdays.includes(date.getUTCDay()))
      scheduledDates.push(date.toISOString().slice(0, 10));
  }
  const paidDays =
    profile.paidDayBasis === 'FIXED'
      ? profile.fixedPaidDays!
      : scheduledDates.length;
  if (paidDays <= 0)
    throw new Error('This cutoff has no configured paid working days.');
  if (!Number.isFinite(baseRate) || baseRate < 0)
    throw new Error('The stored cutoff salary is invalid.');
  const ratePerDay =
    profile.basis === 'DAILY'
      ? profile.dailyRate
      : baseRate / profile.referenceDays;
  const basicSalary =
    profile.basis === 'DAILY'
      ? Math.round(ratePerDay * paidDays * 100) / 100
      : baseRate;
  return { paidDays, ratePerDay, basicSalary, scheduledDates };
}
