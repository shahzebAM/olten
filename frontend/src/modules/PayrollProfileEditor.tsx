import { resolvePayrollBasis } from '../../../backend/src/employees/payroll-profile';
import type { PayrollDefaults, PayrollProfile } from '../../../backend/src/employees/payroll-profile';
import { profileFromPaySetup } from '../lib/employeePaySetup';
import type { PaySetupDraft } from '../lib/employeePaySetup';

export type PayrollProfileEmployee = { id: number; company: string; baseRate: number; payrollProfile?: PayrollProfile | null };
type Props = {
  value: PaySetupDraft;
  onChange: (value: PaySetupDraft) => void;
  baseRate: string;
  onBaseRateChange: (value: string) => void;
  companyDefaults: PayrollDefaults | null;
  defaultsError?: string;
  cutoffStart?: string;
  cutoffEnd?: string;
  disabled?: boolean;
};
const inputClass = 'mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-green-600';
const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function PayrollProfileFields({ value, onChange, baseRate, onBaseRateChange, companyDefaults, defaultsError, cutoffStart, cutoffEnd, disabled }: Props) {
  const preview = (() => {
    if (!cutoffStart || !cutoffEnd) return null;
    try { return resolvePayrollBasis(profileFromPaySetup(value, companyDefaults), Number(baseRate || 0), cutoffStart, cutoffEnd); }
    catch { return null; }
  })();
  const fixedMismatch = Boolean(preview && value.paidDayBasis === 'FIXED' && preview.paidDays !== preview.scheduledDates.length);
  return <fieldset disabled={disabled} className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
    <legend className="px-2 text-base font-semibold text-slate-900">Pay setup · save once with employee details</legend>
    <p className="text-sm text-slate-600">Payroll loads this saved wage automatically for every cutoff. Enter the agreed wage once; attendance never changes the wage rate.</p>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <label className="text-sm text-slate-600">Pay basis<select aria-label="Pay basis" value={value.basis} onChange={event => onChange({ ...value, basis: event.target.value as PayrollProfile['basis'], paidDayBasis: event.target.value === 'CUTOFF' ? 'FIXED' : 'SCHEDULED', fixedPaidDays: value.referenceDays })} className={inputClass}><option value="DAILY">Fixed daily rate</option><option value="CUTOFF">Fixed cutoff salary</option></select></label>
      {value.basis === 'DAILY'
        ? <label className="text-sm text-slate-600">Agreed daily rate (₱)<input aria-label="Daily rate" required type="number" min="0.01" step="0.01" value={value.dailyRate} onChange={event => onChange({ ...value, dailyRate: event.target.value })} className={inputClass} placeholder="Employee’s agreed daily wage" /></label>
        : <><label className="text-sm text-slate-600">Agreed cutoff salary (₱)<input aria-label="Cutoff salary" required type="number" min="0.01" step="0.01" value={baseRate} onChange={event => onBaseRateChange(event.target.value)} className={inputClass} /></label><label className="text-sm text-slate-600">Agreed salary divisor (days)<input aria-label="Rate divisor in days" required type="number" min="1" max="31" step="1" value={value.referenceDays} onChange={event => onChange({ ...value, referenceDays: event.target.value, fixedPaidDays: event.target.value })} className={inputClass} /><span className="mt-1 block text-xs">The cutoff salary stays fixed; this saved divisor determines the daily and hourly rate.</span></label></>}
    </div>
    <label className="block text-sm text-slate-600">Schedule and overtime rules<select aria-label="Payroll rules source" value={value.rulesSource} onChange={event => onChange({ ...value, rulesSource: event.target.value as PaySetupDraft['rulesSource'], ...(value.rulesSource === 'COMPANY' && event.target.value === 'EMPLOYEE' && companyDefaults ? { workingWeekdays: [...companyDefaults.workingWeekdays], overtimeBasis: companyDefaults.overtimeBasis } : {}) })} className={inputClass}><option value="COMPANY">Use company defaults</option><option value="EMPLOYEE">Individual employee rules</option></select></label>
    {value.rulesSource === 'COMPANY' && (companyDefaults
      ? <p className="text-sm text-slate-600">Company schedule: {companyDefaults.workingWeekdays.map(day => days[day]).join(', ')}. Overtime: {companyDefaults.overtimeBasis === 'CUTOFF_NET' ? 'Excel cutoff balance' : 'Daily overtime and separate shortfalls'}. Company rule updates apply automatically; this employee’s wage stays the same.</p>
      : <p role="alert" className="text-sm text-amber-800">{defaultsError || 'Loading company payroll defaults…'} Employee save is unavailable until the company rules load.</p>)}
    <details open={value.rulesSource === 'EMPLOYEE' || fixedMismatch || (value.basis === 'DAILY' && value.paidDayBasis === 'FIXED')} className="rounded-lg border border-slate-200 bg-white">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-700">Advanced employee exceptions{fixedMismatch && <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-amber-900">Review fixed paid days</span>}</summary>
      <div className="space-y-3 border-t border-slate-200 p-3">
        {value.basis === 'DAILY' && <><label className="block text-sm text-slate-600">Required paid-day basis<select aria-label="Required paid-day basis" value={value.paidDayBasis} onChange={event => onChange({ ...value, paidDayBasis: event.target.value as PayrollProfile['paidDayBasis'] })} className={inputClass}><option value="SCHEDULED">Working weekdays in cutoff</option><option value="FIXED">Fixed number per cutoff</option></select></label>{value.paidDayBasis === 'FIXED' && <label className="block text-sm text-slate-600">Paid days per cutoff<input aria-label="Paid days per cutoff" type="number" min="1" max="31" step="1" value={value.fixedPaidDays} onChange={event => onChange({ ...value, fixedPaidDays: event.target.value })} className={inputClass} /></label>}</>}
        {value.rulesSource === 'EMPLOYEE' ? <><label className="block text-sm text-slate-600">Overtime calculation<select aria-label="Overtime calculation" value={value.overtimeBasis} onChange={event => onChange({ ...value, overtimeBasis: event.target.value as PaySetupDraft['overtimeBasis'] })} className={inputClass}><option value="CUTOFF_NET">Excel cutoff balance</option><option value="DAILY">Daily overtime and separate shortfalls</option></select></label><div><p className="mb-2 text-sm text-slate-600">Scheduled working weekdays · other weekdays are rest days</p><div className="flex flex-wrap gap-3">{days.map((day, index) => <label key={day} className="flex items-center gap-1 text-sm text-slate-600"><input type="checkbox" aria-label={`Working ${day}`} checked={value.workingWeekdays.includes(index)} onChange={event => onChange({ ...value, workingWeekdays: event.target.checked ? [...value.workingWeekdays, index].sort() : value.workingWeekdays.filter(item => item !== index) })} />{day}</label>)}</div></div></> : <p className="text-sm text-slate-500">Choose Individual employee rules above only when this employee has an agreed schedule or overtime rule different from the company.</p>}
        <p className="text-xs text-slate-500">Rest-day work earns 130% for the first eight hours and 169% for additional hours. A scheduled Sunday remains an ordinary workday.</p>
      </div>
    </details>
    {preview && <p role="status" className="rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700">Selected cutoff: {preview.paidDays} required paid days · {preview.paidDays * 8} required hours · ₱{preview.ratePerDay.toFixed(2)} per day · ₱{(preview.ratePerDay / 8).toFixed(2)} per hour · ₱{preview.basicSalary.toFixed(2)} basic pay.</p>}
    {fixedMismatch && preview && <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">This fixed profile requires {preview.paidDays} paid days, while this cutoff has {preview.scheduledDates.length} scheduled working days. Confirm the agreed salary and divisor. Use Fixed daily rate when the agreement is a daily wage.</p>}
  </fieldset>;
}

export function SavedEmployeePaySetup({ employee, effectiveProfile }: { employee: PayrollProfileEmployee; effectiveProfile?: PayrollProfile | null }) {
  const profile = effectiveProfile ?? employee.payrollProfile;
  if (!profile) return <div role="status" className="text-sm text-amber-800">Employee pay setup is required. Open Employee Details to save the agreed wage once.</div>;
  return <div className="space-y-1 text-sm text-slate-600" aria-label="Saved employee pay setup">
    <p className="font-semibold text-slate-800">{profile.basis === 'DAILY' ? `Agreed daily rate: ₱${profile.dailyRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `Fixed cutoff salary: ₱${employee.baseRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · divisor ${profile.referenceDays} days`}</p>
    <p>{employee.payrollProfile?.rulesSource === 'COMPANY' ? 'Company defaults' : 'Employee rules'} · {profile.workingWeekdays.map(day => days[day]).join(', ')} · {profile.overtimeBasis === 'DAILY' ? 'Daily overtime and separate shortfalls' : 'Excel cutoff balance'}</p>
    <p className="text-xs text-slate-500">Loaded automatically from Employee Details. Wage and rules are read-only while computing payroll.</p>
  </div>;
}
