import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { input, primary, textValue } from './api';
import type { JsonRow, Party } from './api';

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="phase3-field flex min-w-0 flex-col gap-1 text-sm font-medium text-slate-600">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Panel({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="phase3-panel rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="phase3-panel-heading mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
        {actions}
      </div>
      <div className="phase3-panel-body">{children}</div>
    </section>
  );
}
export function Form({
  title,
  children,
  onSubmit,
  disabled,
  button = 'Save',
}: {
  title: string;
  children: ReactNode;
  onSubmit: (form: HTMLFormElement) => Promise<unknown>;
  disabled: boolean;
  button?: string;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onSubmit(event.currentTarget);
  };
  return (
    <details className="phase3-form rounded-xl border border-slate-200 bg-slate-50 p-4">
      <summary className="cursor-pointer font-semibold text-slate-800">
        {title}
      </summary>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <fieldset disabled={disabled} className="space-y-4">
          {children}
          <button className={primary}>
            {disabled ? 'Please wait…' : button}
          </button>
        </fieldset>
      </form>
    </details>
  );
}
export function Notice({
  error,
  notice,
  loading,
}: {
  error?: string;
  notice?: string;
  loading?: boolean;
}) {
  return (
    <>
      {error && (
        <p
          role="alert"
          className="phase3-notice phase3-notice-error rounded-lg bg-rose-50 p-3 text-sm text-rose-800"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="phase3-notice phase3-notice-success rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800"
        >
          {notice}
        </p>
      )}
      {loading && (
        <p role="status" className="phase3-loading text-sm text-slate-500">
          Loading saved records…
        </p>
      )}
    </>
  );
}
export function DataTable({
  rows,
  columns,
  actions,
  searchLabel,
}: {
  rows: JsonRow[];
  columns: string[];
  actions?: (row: JsonRow) => ReactNode;
  searchLabel?: string;
}) {
  const [query, setQuery] = useState('');
  const visibleRows =
    searchLabel && query.trim()
      ? rows.filter((row) =>
          columns.some((column) =>
            textValue(row[column]).toLowerCase().includes(query.trim().toLowerCase()),
          ),
        )
      : rows;
  if (!rows.length)
    return (
      <div className="phase3-empty text-sm text-slate-500">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" />
        </svg>
        <p>No records in this workspace.</p>
      </div>
    );
  return (
    <>
    {searchLabel && (
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <input
          className={`${input} max-w-sm`}
          type="search"
          aria-label={searchLabel}
          placeholder={searchLabel}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="text-xs text-slate-500">{visibleRows.length} of {rows.length} records</span>
      </div>
    )}
    <div className="phase3-table-scroll max-h-[32rem] overflow-auto">
      <table className="phase3-table w-full text-left text-sm">
        <thead className="sticky top-0 bg-slate-100 text-xs uppercase text-slate-600">
          <tr>
            {columns.map((column) => (
              <th scope="col" key={column} className="px-3 py-3 whitespace-nowrap">
                {column.replace(/([a-z])([A-Z])/g, '$1 $2')}
              </th>
            ))}
            {actions && <th scope="col" className="px-3">Actions</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {visibleRows.map((row, index) => (
            <tr key={String(row.id || index)} className="hover:bg-slate-50">
              {columns.map((column) => (
                <td
                  key={column}
                  className="max-w-xs px-3 py-3 align-top break-words"
                >
                  {textValue(row[column])}
                </td>
              ))}
              {actions && <td className="px-3 py-2">{actions(row)}</td>}
            </tr>
          ))}
          {!visibleRows.length && (
            <tr>
              <td colSpan={columns.length + (actions ? 1 : 0)} className="py-8 text-center text-slate-500">
                No matching records. Try a different search.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
    </>
  );
}
export function PartySelect({
  parties,
  name = 'partyId',
  value,
  onChange,
}: {
  parties: Party[];
  name?: string;
  value?: string;
  onChange?: (value: string) => void;
}) {
  const [query, setQuery] = useState('');
  return (
    <div className="space-y-2">
      <input
        aria-label="Search names"
        placeholder="Search name…"
        className={input}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <select
        required
        aria-label={name === 'supplierId' ? 'Select supplier' : name === 'sourceId' ? 'Select ERP source record' : 'Select customer or supplier'}
        name={name}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        className={input}
      >
        <option value="">Select name</option>
        {parties
          .filter(
            (party) =>
              party.id === value ||
              party.name.toLowerCase().includes(query.toLowerCase()),
          )
          .map((party) => (
            <option key={party.id} value={party.id}>
              {party.name}
            </option>
          ))}
      </select>
    </div>
  );
}
