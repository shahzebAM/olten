import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toAttendanceDateYMD } from '../../../backend/src/employees/attendance-calculator';
import { getApiAuthHeaders } from '../lib/apiSession';
import { displayEntryTime, entrySessionKey, fromRecord, getCutoffDates, getInitialCutoff, isChanged, mergeRows, moveCutoff, normalizeEntryTime, rowPunches, samePunches, sameSource, sourcePunches } from '../lib/attendanceEntry';
import type { AttendanceEntryEmployee, AttendanceEntryRecord, CutoffSelection, EntryKind, EntryRow } from '../lib/attendanceEntry';
type Props = {
  selectedCompany: string;
  API_BASE_URL: string;
  employees: AttendanceEntryEmployee[];
  onRecordsChange: (records: AttendanceEntryRecord[]) => void;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
  cutoffSelection?: CutoffSelection;
  onCutoffChange?: (cutoff: CutoffSelection) => void;
};

const fieldClass = 'rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100';
const buttonClass = 'rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50';
const fullName = (employee: AttendanceEntryEmployee) => [employee.firstName, employee.middleName, employee.lastName].filter(Boolean).join(' ');
const dateLabel = (date: string, weekday = false) => new Intl.DateTimeFormat('en-US', weekday ? { weekday: 'short', timeZone: 'UTC' } : { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
const hoursLabel = (minutes: number) => `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`;
export default function AttendanceEntryGrid({ selectedCompany, API_BASE_URL, employees, onRecordsChange, onDirtyChange, onBusyChange, cutoffSelection, onCutoffChange }: Props) {
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [optionIndex, setOptionIndex] = useState(0);
  const [localCutoff, setLocalCutoff] = useState<CutoffSelection>(getInitialCutoff);
  const cutoff = cutoffSelection ?? localCutoff;
  const [records, setRecords] = useState<AttendanceEntryRecord[]>([]);
  const [rows, setRows] = useState<EntryRow[]>([]);
  const [loadedScope, setLoadedScope] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [officialCurrent, setOfficialCurrent] = useState(false);
  const [message, setMessage] = useState('');
  const [loadError, setLoadError] = useState('');
  const saveLock = useRef(false);
  const readSequence = useRef(0);
  const loadedScopeRef = useRef('');
  const nextKey = useRef(0);
  const tableRef = useRef<HTMLTableElement>(null);
  const companyEmployees = useMemo(() => employees.filter(employee => employee.company === selectedCompany), [employees, selectedCompany]);
  const companyIdKey = companyEmployees.map(employee => employee.id).sort((a, b) => a - b).join(',');
  const companyIds = useMemo(() => new Set(companyIdKey.split(',').filter(Boolean).map(Number)), [companyIdKey]);
  const employee = companyEmployees.find(item => item.id === employeeId);
  const selectedEmployeeId = employee?.id;
  const options = companyEmployees.filter(item => `${fullName(item)} ${item.employeeId ?? ''} ${item.id}`.toLowerCase().includes(query.trim().toLowerCase()));
  const dates = useMemo(() => getCutoffDates(cutoff), [cutoff]);
  const scope = `${selectedCompany}:${employee?.id ?? ''}:${cutoff.month}:${cutoff.period}`;
  const ready = !!employee && dates.length > 0 && loadedScope === scope;
  const dirty = ready && rows.some(isChanged);
  const uncertain = ready && rows.some(row => !!row.unconfirmed);

  const readRecords = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`${API_BASE_URL}/employees/attendance/all?company=${encodeURIComponent(selectedCompany)}`, { headers: { ...getApiAuthHeaders(), 'x-company': selectedCompany }, signal });
    if (!response.ok) throw new Error(`Attendance could not be loaded (${response.status}).`);
    const data: unknown = await response.json();
    if (!Array.isArray(data) || data.some(record => !record || !Number.isSafeInteger(record.id) || !Number.isSafeInteger(record.employeeId) || typeof record.date !== 'string' || typeof record.timeIn !== 'string' || typeof record.timeOut !== 'string')) throw new Error('The server returned invalid attendance data.');
    return (data as AttendanceEntryRecord[]).filter(record => companyIds.has(record.employeeId));
  }, [API_BASE_URL, selectedCompany, companyIds]);

  useEffect(() => {
    if (!selectedEmployeeId || !dates.length) return;
    const controller = new AbortController();
    const sequence = ++readSequence.current;
    readRecords(controller.signal).then(fresh => {
      if (controller.signal.aborted || sequence !== readSequence.current) return;
      setRecords(fresh); onRecordsChange(fresh);
      const retainDrafts = loadedScopeRef.current === scope;
      setRows(current => mergeRows(fresh, dates, selectedEmployeeId, retainDrafts ? current : []));
      loadedScopeRef.current = scope;
      setLoadedScope(scope); setOfficialCurrent(true); setLoadError('');
    }).catch(error => {
      if (!controller.signal.aborted && sequence === readSequence.current) setLoadError(error instanceof Error ? error.message : 'Attendance could not be loaded.');
    });
    return () => controller.abort();
  }, [scope, selectedEmployeeId, dates, readRecords, onRecordsChange]);

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange(saving || loading); }, [saving, loading, onBusyChange]);
  useEffect(() => () => { onDirtyChange(false); onBusyChange(false); }, [onDirtyChange, onBusyChange]);
  useEffect(() => {
    if (!dirty && !saving) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, saving]);

  const allowSwitch = () => !saveLock.current && (!dirty || window.confirm('Discard unsaved attendance changes? Saved database records will remain.'));
  const switchCutoff = (next: CutoffSelection) => {
    if (next.month === cutoff.month && next.period === cutoff.period) return;
    if (!allowSwitch()) return;
    setRows([]); setMessage(''); setLoadError('');
    if (onCutoffChange) onCutoffChange(next); else setLocalCutoff(next);
  };
  const selectEmployee = (next: AttendanceEntryEmployee) => {
    if (next.id !== employeeId) {
      if (!allowSwitch()) return;
      setRows([]); setMessage(''); setLoadError(''); setEmployeeId(next.id);
    }
    setQuery(''); setPickerOpen(false);
  };
  const updateRow = (key: string, update: Partial<EntryRow>) => setRows(current => current.map(row => row.key === key ? { ...row, ...update, error: undefined } : row));
  const refresh = async (reset = false) => {
    if (!employee || saveLock.current || (reset && dirty && !window.confirm('Reset unsaved changes and reload saved attendance? This does not delete records.'))) return;
    saveLock.current = true; setLoading(true);
    readSequence.current++;
    try {
      const fresh = await readRecords();
      setRecords(fresh); onRecordsChange(fresh); setOfficialCurrent(true);
      setRows(mergeRows(fresh, dates, employee.id, reset ? [] : rows));
      loadedScopeRef.current = scope;
      setLoadedScope(scope); setLoadError('');
      setMessage(reset ? 'Unsaved changes reset. Saved records reloaded.' : 'Saved attendance refreshed. Local edits have been retained.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Refresh failed. Your drafts have been retained.'); }
    finally { saveLock.current = false; setLoading(false); }
  };

  const save = async () => {
    if (!employee || !ready || saveLock.current || uncertain) return;
    const changed = rows.filter(isChanged);
    if (!changed.length) return;
    const errors = new Map<string, string>();
    for (const row of changed) {
      if (row.kind === 'work' && (!normalizeEntryTime(row.timeIn) || !normalizeEntryTime(row.timeOut))) errors.set(row.key, 'Enter both valid times, e.g. 9:00 AM and 6:00 PM.');
      const key = entrySessionKey({ employeeId: employee.id, date: row.date, ...rowPunches(row) });
      const changedSession = !row.source || key !== entrySessionKey(row.source);
      if (changedSession && rows.some(other => other.key !== row.key && (other.source || isChanged(other)) && entrySessionKey({ employeeId: employee.id, date: other.date, ...rowPunches(other) }) === key)) errors.set(row.key, 'This session already exists. Edit its existing row.');
    }
    if (errors.size) {
      setRows(current => current.map(row => ({ ...row, error: errors.get(row.key) })));
      setMessage('Correct the highlighted rows before saving. No records were submitted.'); return;
    }
    saveLock.current = true; setSaving(true); setMessage('Saving attendance…');
    readSequence.current++;
    let working: EntryRow[] = rows.map(row => ({ ...row, error: undefined }));
    let savedCount = 0;
    let failedCount = 0;
    let unknownCount = 0;
    try {
      // Refresh before writing to detect stale edits and sessions saved elsewhere.
      const latest = await readRecords();
      for (const row of changed) {
        const punch = rowPunches(row);
        const existing = row.source && latest.find(record => record.id === row.source?.id);
        const conflict = row.source && (!existing || !sameSource(row.source, existing));
        const targetKey = entrySessionKey({ employeeId: employee.id, date: row.date, ...punch });
        const duplicate = (!row.source || targetKey !== entrySessionKey(row.source)) && latest.some(record => record.id !== row.source?.id && entrySessionKey(record) === targetKey);
        if (conflict || duplicate) {
          failedCount++;
          working = working.map(item => item.key === row.key ? { ...item, error: conflict ? 'This record changed on the server. Reset and review it before editing again.' : 'This session was already saved. Reset to load its existing record.' } : item);
          continue;
        }
        const payload: Record<string, unknown> = row.source ? {} : { employeeId: employee.id, date: row.date, ...punch };
        if (row.source) {
          const baseline = sourcePunches(row.source);
          for (const field of ['timeIn', 'timeOut', 'reason'] as const) if (punch[field] !== baseline[field]) payload[field] = punch[field];
        }
        let response: Response;
        try {
          response = await fetch(`${API_BASE_URL}/employees/attendance${row.source ? `/${row.source.id}` : ''}`, {
            method: row.source ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json', ...getApiAuthHeaders(), 'x-company': selectedCompany }, body: JSON.stringify(payload),
          });
          if (!response.ok && response.status < 500) {
            let detail = `Save failed (${response.status}).`;
            try { const body = await response.json(); if (typeof body.message === 'string') detail = body.message; } catch { /* Status is sufficient if the error body is not JSON. */ }
            failedCount++;
            working = working.map(item => item.key === row.key ? { ...item, error: detail } : item);
            continue;
          }
          if (!response.ok) throw new Error(`Server error (${response.status}).`);
          const result: AttendanceEntryRecord = await response.json();
          if (!Number.isSafeInteger(result.id) || result.employeeId !== employee.id || toAttendanceDateYMD(result.date) !== row.date || !samePunches(sourcePunches(result), punch) || (row.source && result.id !== row.source.id)) throw new Error('The save reply could not be confirmed.');
          savedCount++;
          const latestIndex = latest.findIndex(record => record.id === result.id);
          if (latestIndex >= 0) latest[latestIndex] = result;
          else latest.push(result);
          working = working.map(item => item.key === row.key ? { ...fromRecord(result), unconfirmed: punch } : item);
        } catch {
          // A lost response can follow a committed write. Never blindly submit it twice.
          unknownCount++;
          working = working.map(item => item.key === row.key ? { ...item, unconfirmed: punch, error: 'Save result unconfirmed. Check saved status before entering this session again.' } : item);
        }
        setRows(working); setOfficialCurrent(false);
      }
      try {
        const fresh = await readRecords();
        const merged = mergeRows(fresh, dates, employee.id, working);
        const unresolved = merged.filter(row => row.unconfirmed).length;
        setRecords(fresh); onRecordsChange(fresh); setRows(merged); setOfficialCurrent(true);
        if (!failedCount && !unresolved) setMessage(`${savedCount + unknownCount} attendance ${savedCount + unknownCount === 1 ? 'session' : 'sessions'} saved and confirmed.`);
        else setMessage(`${savedCount + unknownCount - unresolved} saved and confirmed; ${failedCount} failed${unresolved ? `; ${unresolved} unconfirmed. Use Check saved status` : ''}. Your remaining drafts are retained.`);
      } catch {
        setRows(working); setOfficialCurrent(false);
        setMessage(`${savedCount} save replies confirmed; ${failedCount} failed; ${unknownCount} unconfirmed. Refresh failed. Check saved status to load official totals. Your drafts are retained.`);
      }
    } catch (error) {
      setMessage(`${error instanceof Error ? error.message : 'Attendance could not be checked.'} No new save requests were sent. Your drafts are retained.`);
    } finally { saveLock.current = false; setSaving(false); }
  };

  const savedInCutoff = ready ? records.filter(record => record.employeeId === employee?.id && dates.includes(toAttendanceDateYMD(record.date))) : [];
  const officialAvailable = ready && officialCurrent && savedInCutoff.every(record => record.metrics && Number.isFinite(record.metrics.regularMinutes) && Number.isFinite(record.metrics.otMinutes));
  const totalRegular = savedInCutoff.reduce((sum, record) => sum + (record.metrics?.regularMinutes ?? 0), 0);
  const totalOvertime = savedInCutoff.reduce((sum, record) => sum + (record.metrics?.otMinutes ?? 0), 0);
  const disabled = saving || loading;

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-label="Bulk attendance entry">
      <div className="border-b border-slate-200 p-4">
        <h2 className="font-bold text-indigo-950">Attendance Logs</h2>
        <p className="mt-1 text-xs text-slate-500">Enter a cutoff, then save once. Hours are confirmed by the existing attendance service.</p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="relative min-w-64 flex-1" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPickerOpen(false); }}>
            <label htmlFor="attendance-employee" className="mb-1 block text-xs font-semibold text-slate-600">Employee</label>
            <input id="attendance-employee" role="combobox" aria-autocomplete="list" aria-expanded={pickerOpen} aria-controls="attendance-employee-options" aria-activedescendant={pickerOpen && options[optionIndex] ? `attendance-option-${options[optionIndex].id}` : undefined}
              value={pickerOpen ? query : employee ? `${fullName(employee)} · ${employee.employeeId || employee.id}` : query} disabled={disabled}
              placeholder="Search name or employee ID" className={`${fieldClass} w-full py-2`} autoComplete="off"
              onFocus={() => { setPickerOpen(true); setQuery(''); setOptionIndex(0); }}
              onChange={event => { setQuery(event.target.value); setOptionIndex(0); setPickerOpen(true); }}
              onKeyDown={event => {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setPickerOpen(true); setOptionIndex(index => Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))); }
                if (event.key === 'Enter' && pickerOpen && options[optionIndex]) { event.preventDefault(); selectEmployee(options[optionIndex]); }
                if (event.key === 'Escape') setPickerOpen(false);
              }} />
            {pickerOpen && <div id="attendance-employee-options" role="listbox" className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
              {options.map((option, index) => <button type="button" role="option" aria-selected={option.id === employeeId} id={`attendance-option-${option.id}`} key={option.id} onMouseDown={event => event.preventDefault()} onClick={() => selectEmployee(option)} className={`block w-full px-3 py-2 text-left text-sm hover:bg-indigo-50 ${index === optionIndex ? 'bg-indigo-50' : ''}`}>
                <span className="font-medium text-slate-800">{fullName(option)}</span><span className="ml-2 text-xs text-slate-500">ID: {option.employeeId || option.id}</span>
              </button>)}
              {!options.length && <p className="p-3 text-sm text-slate-500">No employees found in this company.</p>}
            </div>}
          </div>
          <label className="text-xs font-semibold text-slate-600">Cutoff period<select aria-label="Cutoff period" value={cutoff.period} disabled={disabled} onChange={event => switchCutoff({ ...cutoff, period: event.target.value as CutoffSelection['period'] })} className={`${fieldClass} mt-1 block py-2`}><option value="26-10">26th–10th</option><option value="11-25">11th–25th</option></select></label>
          <label className="text-xs font-semibold text-slate-600">Cutoff end month<input aria-label="Cutoff end month" type="month" min="1900-01" max="9998-12" value={cutoff.month} disabled={disabled} onChange={event => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) switchCutoff({ ...cutoff, month: event.target.value }); }} className={`${fieldClass} mt-1 block py-2`} /></label>
          <div className="flex gap-1"><button type="button" className={buttonClass} disabled={disabled} onClick={() => switchCutoff(moveCutoff(cutoff, -1))}>← Previous Cutoff</button><button type="button" className={buttonClass} disabled={disabled} onClick={() => switchCutoff(moveCutoff(cutoff, 1))}>Next Cutoff →</button></div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><span>{dates.length ? `${dateLabel(dates[0])}, ${dates[0].slice(0, 4)} – ${dateLabel(dates.at(-1)!)}, ${dates.at(-1)!.slice(0, 4)} · Asia/Manila` : 'Select a valid cutoff month.'}</span><button type="button" className="font-semibold text-indigo-600 disabled:opacity-50" disabled={disabled || !employee} onClick={() => void refresh()}>Check saved status / Refresh</button></div>
      </div>
      {message && <p role="status" className="border-b border-indigo-100 bg-indigo-50 px-4 py-2 text-sm text-indigo-900">{message}</p>}
      {loadError && <p role="alert" className="px-4 py-3 text-sm text-rose-700">{loadError}</p>}
      {!employee ? <p className="p-8 text-center text-sm text-slate-500">Select an employee to enter attendance.</p> : !ready ? <p className="p-8 text-center text-sm text-slate-500">{loadError ? 'Use Refresh to retry loading attendance.' : 'Loading saved attendance…'}</p> : <>
        <div className="max-h-[62vh] overflow-auto">
          <table ref={tableRef} className="w-full min-w-[920px] border-collapse text-left text-sm" aria-label="Attendance cutoff entries">
            <thead className="sticky top-0 z-10 bg-slate-100 text-xs text-slate-600"><tr>{['Date', 'Day', 'Time In', 'Time Out', 'Regular Hours', 'Overtime', 'Action'].map(label => <th key={label} scope="col" className="border-b border-slate-300 px-3 py-2.5 font-semibold">{label}</th>)}</tr></thead>
            <tbody>{rows.map((row, index) => {
              const changed = isChanged(row);
              const pending = changed || (!!row.source && !officialCurrent);
              const label = `${row.date} session ${rows.slice(0, index + 1).filter(item => item.date === row.date).length}`;
              const firstOnDate = index === 0 || rows[index - 1].date !== row.date;
              const overnight = row.kind === 'work' && normalizeEntryTime(row.timeIn) && normalizeEntryTime(row.timeOut) && normalizeEntryTime(row.timeOut)! < normalizeEntryTime(row.timeIn)!;
              const readOnly = disabled || !!row.unconfirmed;
              return <tr key={row.key} data-entry-date={row.date} data-record-id={row.source?.id} className={`border-b border-slate-200 ${row.error ? 'bg-rose-50' : changed ? 'bg-amber-50/70' : 'hover:bg-slate-50'} ${firstOnDate ? 'border-t' : ''}`}>
                <th scope="row" className="px-3 py-2 font-medium text-slate-700"><span>{dateLabel(row.date)}</span><span className="mt-0.5 block text-[10px] font-normal text-slate-400">{row.source ? `#${row.source.id}` : changed ? 'Unsaved' : 'Blank'}</span></th>
                <td className="px-3 py-2 text-xs text-slate-500">{dateLabel(row.date, true)}</td>
                {(['timeIn', 'timeOut'] as const).map(field => <td key={field} className="w-40 px-3 py-1.5">{row.kind !== 'work' ? <span className="text-xs text-slate-500">{field === 'timeIn' ? 'Leave' : row.kind === 'paid' ? 'Paid' : 'Unpaid'}</span> : <div className="flex items-center gap-1">
                  <input aria-label={`${label} ${field === 'timeIn' ? 'Time In' : 'Time Out'}`} aria-invalid={!!row.error} data-time-field={field} value={row[field]} placeholder="h:mm AM/PM" disabled={readOnly} className={`${fieldClass} w-28 font-mono text-xs`}
                    onChange={event => updateRow(row.key, { [field]: event.target.value })}
                    onBlur={event => { if (normalizeEntryTime(event.target.value)) updateRow(row.key, { [field]: displayEntryTime(event.target.value) }); }}
                    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); const inputs = [...(tableRef.current?.querySelectorAll<HTMLInputElement>(`input[data-time-field="${field}"]:not(:disabled)`) ?? [])]; inputs[inputs.indexOf(event.currentTarget) + 1]?.focus(); } }} />
                  <label className="relative cursor-pointer rounded border border-slate-200 bg-white p-1 text-slate-400" title="Choose time">◷<input type="time" aria-label={`${label} choose ${field === 'timeIn' ? 'Time In' : 'Time Out'}`} tabIndex={-1} value={normalizeEntryTime(row[field]) ?? ''} disabled={readOnly} onChange={event => updateRow(row.key, { [field]: displayEntryTime(event.target.value) })} className="absolute inset-0 w-full cursor-pointer opacity-0" /></label>
                </div>}{field === 'timeOut' && overnight && <span className="text-[10px] text-indigo-600">Ends next day</span>}</td>)}
                <td className="px-3 py-2 font-mono text-xs text-indigo-700">{pending ? 'Pending' : row.source ? row.source.metrics ? hoursLabel(row.source.metrics.regularMinutes) : 'Unavailable' : '—'}</td>
                <td className="px-3 py-2 font-mono text-xs text-purple-700">{pending ? 'Pending' : row.source ? row.source.metrics ? hoursLabel(row.source.metrics.otMinutes) : 'Unavailable' : '—'}</td>
                <td className="min-w-56 px-3 py-1.5">
                  <div className="flex flex-wrap items-center gap-2"><select aria-label={`${label} entry type`} value={row.kind} disabled={readOnly} onChange={event => updateRow(row.key, { kind: event.target.value as EntryKind, timeIn: '', timeOut: '' })} className={`${fieldClass} py-1 text-xs`}><option value="work">Work</option><option value="paid">Paid leave</option><option value="unpaid">Unpaid leave</option></select>
                    {firstOnDate && <button type="button" disabled={disabled} onClick={() => setRows(current => { const added: EntryRow = { key: `new-${++nextKey.current}`, date: row.date, kind: 'work', timeIn: '', timeOut: '', reason: '' }; const last = current.findLastIndex(item => item.date === row.date); return [...current.slice(0, last + 1), added, ...current.slice(last + 1)]; })} className="text-xs font-semibold text-indigo-600 disabled:opacity-50" aria-label={`Add Session ${row.date}`}>+ Add Session</button>}
                    {changed && <span className="text-[10px] font-semibold text-amber-700">{row.unconfirmed ? 'Check status' : 'Unsaved'}</span>}
                  </div>
                  {(row.kind !== 'work' || row.reason) && <input aria-label={`${label} reason`} placeholder="Reason (optional)" value={row.reason} disabled={readOnly} onChange={event => updateRow(row.key, { reason: event.target.value })} className={`${fieldClass} mt-1 w-full py-1 text-xs`} />}
                  {row.error && <p role="alert" className="mt-1 max-w-72 text-xs text-rose-700">{row.error}</p>}
                </td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-500" aria-label="Saved attendance summary">
            <span>Cutoff dates <strong className="ml-1 text-slate-800">{dates.length}</strong></span><span>Saved dates <strong className="ml-1 text-slate-800">{new Set(savedInCutoff.map(record => toAttendanceDateYMD(record.date))).size}</strong></span>
            <span>Total paid hours <strong className="ml-1 text-slate-800">{officialAvailable ? hoursLabel(totalRegular + totalOvertime) : 'Pending refresh'}</strong></span>
            <span>Daily regular <strong className="ml-1 text-indigo-700">{officialAvailable ? hoursLabel(totalRegular) : 'Pending refresh'}</strong></span><span>Daily overtime <strong className="ml-1 text-purple-700">{officialAvailable ? hoursLabel(totalOvertime) : 'Pending refresh'}</strong></span>
          </div>
          <div className="flex items-center gap-2"><button type="button" disabled={disabled} onClick={() => void refresh(true)} className={buttonClass}>Reset Unsaved Changes</button><button type="button" disabled={disabled || !dirty || uncertain} onClick={() => void save()} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save Attendance'}</button></div>
          <p className="w-full text-[11px] text-slate-400">Official totals include saved records only. Payroll applies the employee’s selected cutoff calculation to these hours. Blank dates stay empty. Enter moves down the same time column; Tab moves between cells.</p>
        </div>
      </>}
    </section>
  );
}
