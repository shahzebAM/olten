import { useEffect, useRef, useState } from 'react';
import type { BiometricImportPlan, RawBiometricPunch } from '../../../backend/src/employees/biometrics-import';
import { getApiAuthHeaders } from '../lib/apiSession';
import { readBiometricsFile } from '../lib/biometricsWorkbook';

type Props = { selectedCompany: string; API_BASE_URL: string; disabled: boolean; onBusyChange: (busy: boolean) => void; onImported: () => Promise<void> };
type Preview = { plan: BiometricImportPlan; previewFingerprint: string; imported: number; dryRun: boolean };
const button = 'rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50';
const field = 'rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800';
const PAGE_SIZE = 50;

export default function BiometricsAttendanceImport({ selectedCompany, API_BASE_URL, disabled, onBusyChange, onImported }: Props) {
  const [rows, setRows] = useState<RawBiometricPunch[]>([]);
  const [fileName, setFileName] = useState('');
  const [startDate, setStartDate] = useState(''), [endDate, setEndDate] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [page, setPage] = useState(0), [issuePage, setIssuePage] = useState(0);
  const lock = useRef(false), alive = useRef(true), controller = useRef<AbortController | null>(null);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); onBusyChange(false); }; }, [onBusyChange]);

  const request = async (punchRows: RawBiometricPunch[], from: string, to: string, dryRun: boolean): Promise<Preview> => {
    controller.current?.abort(); controller.current = new AbortController();
    const response = await fetch(`${API_BASE_URL}/employees/attendance/import-biometrics`, {
      method: 'POST', signal: controller.current.signal,
      headers: { 'Content-Type': 'application/json', ...getApiAuthHeaders(), 'x-company': selectedCompany },
      body: JSON.stringify({ rows: punchRows, startDate: from, endDate: to, dryRun, ...(dryRun ? {} : { previewFingerprint: preview?.previewFingerprint }) }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(typeof result.message === 'string' ? result.message : `Import request failed (${response.status}).`);
    if (!Array.isArray(result.plan?.sessions) || !Array.isArray(result.plan?.issues) || !Number.isInteger(result.plan?.summary?.newSessions) || !Number.isInteger(result.imported) || !/^[a-f0-9]{64}$/.test(result.previewFingerprint)) throw new Error('The attendance import reply could not be confirmed. Preview again to check saved sessions.');
    return result as Preview;
  };
  const run = async (operation: () => Promise<void>) => {
    if (lock.current || disabled) return;
    lock.current = true; setBusy(true); setError(''); setMessage('');
    try { await operation(); }
    catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : 'Import could not be confirmed. Preview again before retrying.'); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  const chooseFile = (file?: File) => {
    if (!file) return;
    void run(async () => {
      setPreview(null); setRows([]); setFileName(''); setPage(0); setIssuePage(0);
      const parsed = await readBiometricsFile(file);
      if (!alive.current) return;
      setRows(parsed.rows); setFileName(file.name); setStartDate(parsed.startDate); setEndDate(parsed.endDate);
      const result = await request(parsed.rows, parsed.startDate, parsed.endDate, true);
      if (alive.current) setPreview(result);
    });
  };
  const refreshPreview = () => void run(async () => {
    const result = await request(rows, startDate, endDate, true);
    if (alive.current) { setPreview(result); setPage(0); setIssuePage(0); }
  });
  const commit = () => void run(async () => {
    const result = await request(rows, startDate, endDate, false);
    if (!alive.current) return;
    setPreview(result);
    setMessage(`${result.imported} sessions imported. ${result.plan.summary.duplicateSessions} existing duplicates and ${result.plan.summary.conflictSessions} conflicts were left unchanged. Select the employee and matching cutoff below to review.`);
    try { await onImported(); }
    catch { if (alive.current) setError('Import was saved, but the attendance refresh failed. Use Check saved status / Refresh below.'); }
  });
  const summary = preview?.plan.summary;
  const blocked = disabled || busy;
  return <section aria-label="Biometrics attendance import" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-bold text-slate-900">Import biometrics</h2><p className="mt-1 text-xs text-slate-600">Match personnel IDs in {selectedCompany}. Seconds and departments are ignored. Each IN/OUT pair becomes a separate session on the same date.</p></div>
      <label className={`${button} ${blocked ? 'opacity-50' : 'cursor-pointer'}`}>Choose biometrics file<input aria-label="Choose biometrics file" type="file" accept=".xls,.xlsx,.csv" disabled={blocked} className="sr-only" onChange={event => { chooseFile(event.target.files?.[0]); event.target.value = ''; }} /></label>
    </div>
    {disabled && <p className="mt-2 text-xs text-amber-800">Save or discard attendance edits and wait for active operations before importing.</p>}
    {busy && <p role="status" className="mt-3 text-sm text-slate-600">Checking attendance import…</p>}
    {fileName && <div className="mt-4 flex flex-wrap items-end gap-3">
      <p className="w-full break-all text-xs text-slate-600">{fileName} · {rows.length} punch rows</p>
      <label className="text-xs font-semibold text-slate-600">From<input aria-label="Import from date" type="date" className={`${field} mt-1 block`} value={startDate} disabled={blocked} onChange={event => { setStartDate(event.target.value); setPreview(null); }} /></label>
      <label className="text-xs font-semibold text-slate-600">Through<input aria-label="Import through date" type="date" className={`${field} mt-1 block`} value={endDate} disabled={blocked} onChange={event => { setEndDate(event.target.value); setPreview(null); }} /></label>
      <button type="button" className={button} disabled={blocked || !startDate || !endDate || startDate > endDate} onClick={refreshPreview}>Preview import</button>
    </div>}
    {error && <p role="alert" className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {message && <p role="status" className="mt-3 rounded-md bg-green-50 p-3 text-sm text-green-900">{message}</p>}
    {preview && summary && <div className="mt-4 space-y-3">
      <p className="text-sm text-slate-700">{summary.employeeCount} matched employees · {summary.newSessions} new sessions · {summary.duplicateSessions} existing duplicates · {summary.conflictSessions} conflicts · {summary.incompleteSessions} incomplete sessions</p>
      <p className="text-xs text-slate-600">{summary.unmatchedPunches} unmatched/ambiguous punches · {summary.invalidPunches} invalid rows · {summary.blockedPunches} punches held for review · {summary.outsideRangePunches} outside the date range · {summary.duplicatePunches} repeated punches ignored. Missing IN or OUT remains blank and adds no paid hours until corrected. Existing attendance is never overwritten.</p>
      <div className="max-h-80 overflow-auto rounded-md border border-slate-200">
        <table className="w-full min-w-[580px] text-left text-xs"><thead className="sticky top-0 bg-slate-100 text-slate-600"><tr>{['Personnel ID', 'Date', 'Time in', 'Time out', 'Result'].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead>
          <tbody>{preview.plan.sessions.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((session, index) => <tr key={`${session.employeeId}:${session.date}:${index}`} className="border-t border-slate-100"><td className="p-2">{session.personnelId}</td><td className="p-2">{session.date}</td><td className="p-2 font-mono">{session.timeIn || <span aria-label="Missing time in">—</span>}</td><td className="p-2 font-mono">{session.timeOut || <span aria-label="Missing time out">—</span>}</td><td className="p-2">{session.status === 'new' ? preview.dryRun ? 'New' : 'Imported' : session.status}{!session.complete ? ' · missing punch' : ''}</td></tr>)}</tbody>
        </table>
        {!preview.plan.sessions.length && <p className="p-3 text-sm text-slate-600">No matched sessions in this date range. Review the issues and employee IDs.</p>}
      </div>
      {preview.plan.sessions.length > PAGE_SIZE && <div className="flex items-center gap-2 text-xs"><button type="button" className={button} disabled={page === 0} onClick={() => setPage(value => value - 1)}>Previous sessions</button><span>Page {page + 1} of {Math.ceil(preview.plan.sessions.length / PAGE_SIZE)}</span><button type="button" className={button} disabled={(page + 1) * PAGE_SIZE >= preview.plan.sessions.length} onClick={() => setPage(value => value + 1)}>Next sessions</button></div>}
      {!!preview.plan.issues.length && <details className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950"><summary className="cursor-pointer font-semibold">Review {preview.plan.issues.length} import issues</summary><ul className="mt-2 max-h-52 space-y-2 overflow-auto">{preview.plan.issues.slice(issuePage * PAGE_SIZE, (issuePage + 1) * PAGE_SIZE).map((issue, index) => <li key={index}>Rows {issue.rowNumbers.join(', ')}{issue.personnelId ? ` · ID ${issue.personnelId}` : ''}{issue.date ? ` · ${issue.date}` : ''}: {issue.message}</li>)}</ul>{preview.plan.issues.length > PAGE_SIZE && <div className="mt-2 flex items-center gap-2"><button type="button" className={button} disabled={issuePage === 0} onClick={() => setIssuePage(value => value - 1)}>Previous issues</button><span>Page {issuePage + 1}</span><button type="button" className={button} disabled={(issuePage + 1) * PAGE_SIZE >= preview.plan.issues.length} onClick={() => setIssuePage(value => value + 1)}>Next issues</button></div>}</details>}
      <button type="button" className="rounded-md bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50" disabled={blocked || !preview.dryRun || !summary.newSessions} onClick={commit}>Import {summary.newSessions} new sessions</button>
    </div>}
  </section>;
}
