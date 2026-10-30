import type { PayrollDefaults } from '../../../backend/src/employees/payroll-profile';

type Props = {
  company: string;
  value: PayrollDefaults | null;
  configured: boolean;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  error: string;
  inheritedCount: number;
  individualCount: number;
  onChange: (value: PayrollDefaults) => void;
  onSave: () => void;
  onRetry: () => void;
  onReset: () => void;
};

export default function CompanyPayrollSetup({ company, value, configured, loading, saving, dirty, error, inheritedCount, individualCount, onChange, onSave, onRetry, onReset }: Props) {
  return <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
    <h2 className="text-lg font-semibold text-slate-900">{company} payroll defaults</h2>
    <p className="mt-2 text-sm text-slate-600">Set the usual working weekdays and overtime method once. Changes apply to employees using company defaults. Existing individual agreements keep their saved rules, and each employee’s agreed wage stays unchanged.</p>
    <p className="mt-2 text-sm text-slate-500">{inheritedCount} using company defaults · {individualCount} with existing individual rules</p>
    {loading && <p role="status" className="mt-4 text-sm text-slate-600">Loading saved company payroll defaults…</p>}
    {error && <div role="alert" className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{error}<button type="button" onClick={onRetry} className="ml-3 font-semibold underline">Retry</button></div>}
    {value && <form onSubmit={event => { event.preventDefault(); onSave(); }} className="mt-5 space-y-5">
      <fieldset disabled={loading || saving || Boolean(error)} className="space-y-5">
        <div><p className="mb-2 text-sm font-medium text-slate-700">Scheduled working weekdays</p><div className="flex flex-wrap gap-4">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, index) => <label key={day} className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" aria-label={`Company working ${day}`} checked={value.workingWeekdays.includes(index)} onChange={event => onChange({ ...value, workingWeekdays: event.target.checked ? [...value.workingWeekdays, index].sort() : value.workingWeekdays.filter(item => item !== index) })} />{day}</label>)}</div><p className="mt-2 text-xs text-slate-500">Other weekdays are rest days. Rest-day pay is automatic at 130% for the first eight hours and 169% for additional hours.</p></div>
        <label className="block text-sm font-medium text-slate-700">Overtime method<select aria-label="Company overtime method" value={value.overtimeBasis} onChange={event => onChange({ ...value, overtimeBasis: event.target.value as PayrollDefaults['overtimeBasis'] })} className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm sm:max-w-md"><option value="CUTOFF_NET">Excel cutoff balance</option><option value="DAILY">Daily overtime and separate shortfalls</option></select></label>
        <p className="text-sm text-slate-600">Excel cutoff balance compares ordinary work hours with required cutoff hours. It pays overtime above that total at 125% and deducts shortages at the normal hourly rate. Daily overtime keeps each ordinary day’s overtime and shortfall separate. These methods use the existing payroll formulas.</p>
        <div className="flex flex-wrap gap-3"><button type="submit" disabled={saving || (!dirty && configured)} className="rounded-md bg-green-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving defaults…' : 'Save company defaults'}</button><button type="button" disabled={saving || !dirty} onClick={onReset} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 disabled:opacity-50">Reset unsaved changes</button></div>
      </fieldset>
    </form>}
    <p className="mt-5 border-t border-slate-200 pt-4 text-sm text-slate-500">Set each person’s daily wage or fixed cutoff salary in Employee Details. Payroll then uses it automatically; no rate entry is needed in Compute Payroll.</p>
  </section>;
}
