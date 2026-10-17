import { useEffect, useRef, useState } from 'react';
import { validatePayrollProfile } from '../../../backend/src/employees/payroll-profile';
import type { PayrollProfile } from '../../../backend/src/employees/payroll-profile';
import { getApiAuthHeaders } from '../lib/apiSession';

export type PayrollProfileEmployee = { id: number; company: string; baseRate: number; payrollProfile?: PayrollProfile | null };
type Props = {
  employee: PayrollProfileEmployee;
  API_BASE_URL: string;
  onSaved: (employee: PayrollProfileEmployee) => void | Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
};
const fromProfile = (profile?: PayrollProfile | null) => ({
  basis: profile?.basis ?? 'CUTOFF',
  dailyRate: profile?.basis === 'DAILY' ? String(profile.dailyRate) : '',
  referenceDays: profile?.basis === 'CUTOFF' ? String(profile.referenceDays) : '14',
  paidDayBasis: profile?.paidDayBasis ?? 'FIXED',
  fixedPaidDays: String(profile?.fixedPaidDays ?? 14),
  workingWeekdays: profile?.workingWeekdays ?? [1, 2, 3, 4, 5, 6],
  overtimeBasis: profile?.overtimeBasis ?? 'CUTOFF_NET',
});
const inputClass = 'mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none focus:border-indigo-500';

export default function PayrollProfileEditor({ employee, API_BASE_URL, onSaved, onDirtyChange, onBusyChange }: Props) {
  const [form, setForm] = useState(() => fromProfile(employee.payrollProfile));
  const [baseline, setBaseline] = useState(() => JSON.stringify(fromProfile(employee.payrollProfile)));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  const dirty = JSON.stringify(form) !== baseline;
  const savedFormKey = JSON.stringify(fromProfile(employee.payrollProfile));
  const sourceChanged = savedFormKey !== baseline;
  useEffect(() => {
    if (!sourceChanged || dirty) return;
    const timer = setTimeout(() => { setForm(JSON.parse(savedFormKey)); setBaseline(savedFormKey); }, 0);
    return () => clearTimeout(timer);
  }, [sourceChanged, dirty, savedFormKey]);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => () => { onDirtyChange(false); onBusyChange(false); }, [onDirtyChange, onBusyChange]);
  const save = async () => {
    if (lock.current || sourceChanged) return;
    let profile: PayrollProfile | null;
    try {
      profile = validatePayrollProfile({ version: 1, basis: form.basis, paidDayBasis: form.paidDayBasis, workingWeekdays: form.workingWeekdays, overtimeBasis: form.overtimeBasis,
        ...(form.basis === 'DAILY' ? { dailyRate: Number(form.dailyRate) } : { referenceDays: Number(form.referenceDays) }),
        ...(form.paidDayBasis === 'FIXED' ? { fixedPaidDays: Number(form.fixedPaidDays) } : {}),
      });
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Check the pay profile.'); return; }
    lock.current = true; setBusy(true); setMessage('');
    try {
      const response = await fetch(`${API_BASE_URL}/employees/${employee.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...getApiAuthHeaders(), 'x-company': employee.company }, body: JSON.stringify({ payrollProfile: profile }) });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.message === 'string' ? result.message : `Pay profile could not be saved (${response.status}).`);
      if (result.id !== employee.id || result.company !== employee.company || !validatePayrollProfile(result.payrollProfile)) throw new Error('The server did not confirm this employee’s pay profile.');
      const next = fromProfile(result.payrollProfile);
      setForm(next); setBaseline(JSON.stringify(next));
      await onSaved(result);
      setMessage('Pay profile saved. Future cutoffs reuse these rules.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Pay profile could not be saved. Your edits are retained.'); }
    finally { lock.current = false; setBusy(false); }
  };
  return <details open={!employee.payrollProfile} className="rounded-lg border border-indigo-200 bg-indigo-50/40">
    <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-indigo-900">{employee.payrollProfile ? 'Pay profile · saved rules' : 'One-time pay profile setup required'}</summary>
    <fieldset disabled={busy} className="space-y-3 border-t border-indigo-100 p-3">
      <p className="text-xs text-slate-600">Save the employee’s agreed pay basis once. Excel cutoff balance is the default: hours above the required cutoff total earn 125%; shortages use the normal hourly rate. Calculations retain full precision until amounts are rounded to cents.</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-2 text-xs text-slate-600">Overtime calculation<select aria-label="Overtime calculation" value={form.overtimeBasis} onChange={event => setForm({ ...form, overtimeBasis: event.target.value as 'DAILY' | 'CUTOFF_NET' })} className={inputClass}><option value="CUTOFF_NET">Excel cutoff balance (default)</option><option value="DAILY">Daily overtime and separate shortfalls</option></select></label>
        <label className="text-xs text-slate-600">Pay basis<select aria-label="Pay basis" value={form.basis} onChange={event => setForm({ ...form, basis: event.target.value as PayrollProfile['basis'], ...(event.target.value === 'CUTOFF' ? { paidDayBasis: 'FIXED', fixedPaidDays: form.referenceDays, workingWeekdays: form.workingWeekdays.length ? form.workingWeekdays : [1, 2, 3, 4, 5, 6] } : {}) })} className={inputClass}><option value="DAILY">Fixed daily rate</option><option value="CUTOFF">Fixed cutoff salary</option></select></label>
        {form.basis === 'DAILY'
          ? <label className="text-xs text-slate-600">Daily rate (₱)<input aria-label="Daily rate" type="number" min="0.01" step="0.01" value={form.dailyRate} onChange={event => setForm({ ...form, dailyRate: event.target.value })} className={inputClass} placeholder="Agreed daily rate" /></label>
          : <label className="text-xs text-slate-600">Rate divisor in days<input aria-label="Rate divisor in days" type="number" min="1" max="31" step="1" value={form.referenceDays} onChange={event => setForm({ ...form, referenceDays: event.target.value, fixedPaidDays: event.target.value })} className={inputClass} /><span className="mt-1 block text-[10px]">Stored cutoff salary ₱{employee.baseRate.toLocaleString()} ÷ this fixed divisor. Required paid days use the same divisor.</span></label>}
        <label className="text-xs text-slate-600">Required paid-day basis<select aria-label="Required paid-day basis" disabled={form.basis === 'CUTOFF'} value={form.paidDayBasis} onChange={event => setForm({ ...form, paidDayBasis: event.target.value as PayrollProfile['paidDayBasis'], ...(event.target.value === 'FIXED' && !form.workingWeekdays.length ? { workingWeekdays: [1, 2, 3, 4, 5, 6] } : {}) })} className={inputClass}><option value="SCHEDULED">Working weekdays in cutoff</option><option value="FIXED">Fixed number per cutoff</option></select></label>
        {form.paidDayBasis === 'FIXED' && <label className="text-xs text-slate-600">Paid days per cutoff<input aria-label="Paid days per cutoff" readOnly={form.basis === 'CUTOFF'} type="number" min="1" max="31" step="1" value={form.fixedPaidDays} onChange={event => setForm({ ...form, fixedPaidDays: event.target.value })} className={inputClass} /></label>}
      </div>
      {form.paidDayBasis === 'SCHEDULED' && <div><p className="mb-1 text-xs text-slate-600">Scheduled working weekdays</p><div className="flex flex-wrap gap-3">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, index) => <label key={day} className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" aria-label={`Working ${day}`} checked={form.workingWeekdays.includes(index)} onChange={event => setForm({ ...form, workingWeekdays: event.target.checked ? [...form.workingWeekdays, index].sort() : form.workingWeekdays.filter(value => value !== index) })} />{day}</label>)}</div></div>}
      {sourceChanged && dirty && <p role="alert" className="text-xs text-rose-700">The saved pay profile changed. Reset Profile Edits to load the current rules before editing again.</p>}
      <div className="flex flex-wrap items-center gap-2"><button type="button" disabled={busy || sourceChanged || (!!employee.payrollProfile && !dirty)} onClick={() => void save()} className="rounded-md bg-indigo-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? 'Saving profile…' : 'Save Pay Profile'}</button><button type="button" disabled={busy || (!dirty && !sourceChanged)} onClick={() => { const next = fromProfile(employee.payrollProfile); setForm(next); setBaseline(JSON.stringify(next)); setMessage(''); }} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-600 disabled:opacity-50">Reset Profile Edits</button></div>
      {message && <p role="status" className="text-xs text-indigo-800">{message}</p>}
    </fieldset>
  </details>;
}
