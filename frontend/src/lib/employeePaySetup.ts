import { resolveEffectivePayrollProfile, validatePayrollProfile } from '../../../backend/src/employees/payroll-profile';
import type { PayrollDefaults, PayrollProfile } from '../../../backend/src/employees/payroll-profile';

export type PaySetupDraft = {
  basis: PayrollProfile['basis'];
  dailyRate: string;
  referenceDays: string;
  paidDayBasis: PayrollProfile['paidDayBasis'];
  fixedPaidDays: string;
  workingWeekdays: number[];
  overtimeBasis: 'DAILY' | 'CUTOFF_NET';
  rulesSource: 'COMPANY' | 'EMPLOYEE';
};

export const createPaySetupDraft = (profile?: PayrollProfile | null): PaySetupDraft => ({
  basis: profile?.basis ?? 'DAILY',
  dailyRate: profile?.basis === 'DAILY' ? String(profile.dailyRate) : '',
  referenceDays: profile?.basis === 'CUTOFF' ? String(profile.referenceDays) : '14',
  paidDayBasis: profile?.paidDayBasis ?? 'SCHEDULED',
  fixedPaidDays: String(profile?.fixedPaidDays ?? 14),
  workingWeekdays: [...(profile?.workingWeekdays ?? [1, 2, 3, 4, 5, 6])],
  overtimeBasis: profile?.overtimeBasis ?? 'CUTOFF_NET',
  rulesSource: profile ? profile.rulesSource ?? 'EMPLOYEE' : 'COMPANY',
});

export function profileFromPaySetup(draft: PaySetupDraft, defaults: PayrollDefaults | null): PayrollProfile {
  if (draft.rulesSource === 'COMPANY' && !defaults)
    throw new Error('Load the company payroll defaults before saving this employee.');
  const profile = validatePayrollProfile({
    version: 1,
    basis: draft.basis,
    paidDayBasis: draft.basis === 'CUTOFF' ? 'FIXED' : draft.paidDayBasis,
    rulesSource: draft.rulesSource,
    workingWeekdays: draft.rulesSource === 'COMPANY' ? defaults!.workingWeekdays : draft.workingWeekdays,
    overtimeBasis: draft.rulesSource === 'COMPANY' ? defaults!.overtimeBasis : draft.overtimeBasis,
    ...(draft.basis === 'DAILY' ? { dailyRate: Number(draft.dailyRate) } : { referenceDays: Number(draft.referenceDays) }),
    ...(draft.basis === 'CUTOFF' || draft.paidDayBasis === 'FIXED'
      ? { fixedPaidDays: Number(draft.basis === 'CUTOFF' ? draft.referenceDays : draft.fixedPaidDays) } : {}),
  });
  if (!profile) throw new Error('Complete the employee pay setup.');
  return profile;
}

export function buildEmployeePaySetup(draft: PaySetupDraft, cutoffSalary: string, existingBaseRate: number | null, defaults: PayrollDefaults | null) {
  const payrollProfile = profileFromPaySetup(draft, defaults);
  const baseRate = draft.basis === 'CUTOFF' ? Number(cutoffSalary) : existingBaseRate ?? 0;
  if (!Number.isFinite(baseRate) || baseRate < 0 || (draft.basis === 'CUTOFF' && (!cutoffSalary.trim() || baseRate <= 0)))
    throw new Error('Enter a positive agreed cutoff salary.');
  return { baseRate, payrollProfile };
}

export function effectiveEmployeePayProfile(profile: PayrollProfile | null | undefined, defaults: PayrollDefaults | null) {
  if (!profile) return null;
  if (profile.rulesSource === 'COMPANY' && !defaults)
    throw new Error('Company payroll defaults are not loaded.');
  return resolveEffectivePayrollProfile(profile, defaults);
}
