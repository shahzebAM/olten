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
    <label className="flex min-w-0 flex-col gap-1 text-sm font-medium text-slate-600">
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
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
        {actions}
      </div>
      {children}
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
    <details className="rounded-xl border border-slate-200 bg-slate-50 p-4">
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
          className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800"
        >
          {notice}
        </p>
      )}
      {loading && (
        <p role="status" className="text-sm text-slate-500">
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
}: {
  rows: JsonRow[];
  columns: string[];
  actions?: (row: JsonRow) => ReactNode;
}) {
  if (!rows.length)
    return (
      <p className="text-sm text-slate-500">No records in this workspace.</p>
    );
  return (
    <div className="max-h-[32rem] overflow-auto">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-slate-100 text-xs uppercase text-slate-600">
          <tr>
            {columns.map((column) => (
              <th key={column} className="px-3 py-3 whitespace-nowrap">
                {column.replace(/([a-z])([A-Z])/g, '$1 $2')}
              </th>
            ))}
            {actions && <th className="px-3">Actions</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, index) => (
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
        </tbody>
      </table>
    </div>
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
