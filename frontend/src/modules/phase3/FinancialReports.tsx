import { useState } from "react";
import * as XLSX from "xlsx";
import { DataTable, Field, Form, Notice, Panel } from "./shared";
import {
  formValue,
  input,
  phase3Request,
  primary,
  secondary,
  today,
  usePhase3Data,
} from "./api";
import type { JsonRow } from "./api";

type Report = {
  kind: string;
  company: string;
  from: string;
  to: string;
  generatedAt: string;
  basis: string;
  note: string;
  controlAccountScope?: string;
  accounts: { id: string; code: string; name: string }[];
  rows: JsonRow[];
  totals: Record<string, string | null>;
  complete?: boolean;
  configured?: boolean;
  unclassifiedCount?: number;
  transferExceptions?: JsonRow[];
  pagination?: { page: number; pages: number; count: number };
};
const kinds = [
  ["profit-loss", "Profit & Loss"],
  ["balance-sheet", "Balance Sheet"],
  ["trial-balance", "Trial Balance"],
  ["general-ledger", "General Ledger"],
  ["cash-flow", "Cash Flow"],
];

export function ReportMoney({ value }: { value: string | null }) {
  if (typeof value !== "string" || !/^-?\d+\.\d{2}$/.test(value))
    return <span>Unavailable</span>;
  const negative = value.startsWith("-"),
    [whole, cents] = value.replace("-", "").split(".");
  return (
    <span>
      {negative ? "-" : ""}₱{BigInt(whole).toLocaleString("en-PH")}.{cents}
    </span>
  );
}

export default function FinancialReports({
  api,
  company,
  overviewOnly = false,
}: {
  api: string;
  company: string;
  overviewOnly?: boolean;
}) {
  const [range, setRange] = useState({
    from: `${today().slice(0, 8)}01`,
    to: today(),
  });
  const [kind, setKind] = useState("profit-loss"),
    [accountId, setAccountId] = useState(""),
    [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false),
    [error, setError] = useState("");
  const params = new URLSearchParams({
    ...range,
    accountId,
    page: String(page),
    limit: "50",
  });
  const overview = usePhase3Data<Report>(
    api,
    company,
    `/books/reports/financial-overview?${params}`,
  );
  const ready = !overviewOnly && (kind !== "general-ledger" || !!accountId);
  const detail = usePhase3Data<Report>(
    api,
    company,
    `/books/reports/${kind}?${params}`,
    ready,
  );
  const current =
    !detail.loading && !detail.error && ready ? detail.data : null;
  const summary = !overview.loading && !overview.error ? overview.data : null;
  async function exportReport() {
    setExporting(true);
    setError("");
    try {
      const result = await phase3Request<Report>(
        api,
        company,
        `/books/reports/${kind}?${params}&export=true`,
      );
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(result.rows),
        "Report",
      );
      if (result.transferExceptions?.length) {
        XLSX.utils.book_append_sheet(
          workbook,
          XLSX.utils.json_to_sheet(result.transferExceptions),
          "Transfer exceptions",
        );
      }
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(
          Object.entries({
            company: result.company,
            from: result.from,
            to: result.to,
            basis: result.basis,
            generatedAt: result.generatedAt,
            complete: result.complete,
            configured: result.configured,
            unclassifiedEntries: result.unclassifiedCount,
            unmatchedTransferJournals: result.transferExceptions?.length,
            note: result.note,
            ...result.totals,
          }).map(([field, value]) => ({ field, value })),
        ),
        "Scope and totals",
      );
      XLSX.writeFile(workbook, `${kind}_${range.from}_${range.to}.xlsx`);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Report export failed.",
      );
    } finally {
      setExporting(false);
    }
  }
  const chartMaximum = Math.max(
    1,
    ...(summary?.rows || []).flatMap((row) => [
      Math.abs(Number(row.revenue)),
      Math.abs(Number(row.expenses)),
    ]),
  );
  return (
    <div className="space-y-5">
      <Panel
        title={overviewOnly ? "Financial overview" : "Financial statements"}
      >
        <Form
          title="Report period (Asia/Manila)"
          button="Apply period"
          disabled={overview.loading || (detail.loading && ready)}
          onSubmit={async (form) => {
            setRange({
              from: formValue(form, "from"),
              to: formValue(form, "to"),
            });
            setPage(1);
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="From">
              <input
                name="from"
                type="date"
                required
                defaultValue={range.from}
                className={input}
              />
            </Field>
            <Field label="Through">
              <input
                name="to"
                type="date"
                required
                defaultValue={range.to}
                className={input}
              />
            </Field>
          </div>
        </Form>
        <Notice {...overview} error={overview.error || error} />
        {summary && (
          <>
            <p className="my-3 text-sm text-slate-500">
              {summary.from} – {summary.to} · PHP · Posted ledger · Asia/Manila
            </p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {Object.entries(summary.totals).map(([label, value]) => (
                <div key={label} className="phase3-metric">
                  <p className="phase3-metric-label">
                    {(
                      {
                        revenue: "Posted revenue (excludes VAT)",
                        expenses: "Posted expenses",
                        profit: "Posted-ledger profit / loss",
                        cash: "Cash / bank ledger",
                        receivables: "AR ledger",
                        payables: "AP ledger",
                        inventory: "Inventory ledger",
                      } as Record<string, string>
                    )[label] || label}
                  </p>
                  <p className="phase3-metric-value">
                    <ReportMoney value={value} />
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-500">
              {summary.controlAccountScope} AR/AP here are ledger balances;
              current Finance subsidiary balances are separate.
            </p>
            <figure
              aria-label="Posted revenue and expense trends"
              className="mt-5 space-y-3"
            >
              <figcaption>Posted revenue and expenses by month</figcaption>
              {summary.rows.map((row) => (
                <div
                  key={String(row.month)}
                  className="grid grid-cols-[5rem_1fr] gap-3 text-xs"
                >
                  <span>{String(row.month)}</span>
                  <div className="space-y-1">
                    {["revenue", "expenses"].map((column, index) => (
                      <div
                        key={column}
                        role="img"
                        aria-label={`${row.month} ${column}: PHP ${row[column]}`}
                        title={`${column}: PHP ${row[column]}`}
                        className="h-4 rounded bg-slate-100"
                      >
                        <div
                          style={{
                            width: `${(Math.abs(Number(row[column])) / chartMaximum) * 100}%`,
                            background: index ? "#6b6c72" : "#218409",
                          }}
                          className="h-full rounded"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </figure>
            <p className="mt-3 text-xs text-slate-500">{summary.note}</p>
          </>
        )}
      </Panel>
      {!overviewOnly && (
        <Panel
          title="Report detail"
          actions={
            <button
              className={secondary}
              disabled={!current || exporting}
              onClick={() => void exportReport()}
            >
              {exporting ? "Exporting…" : "Export complete report"}
            </button>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2 mb-4">
            <Field label="Financial report">
              <select
                className={input}
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value);
                  setPage(1);
                }}
              >
                {kinds.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            {kind === "general-ledger" && (
              <Field label="Ledger account">
                <select
                  className={input}
                  value={accountId}
                  onChange={(event) => {
                    setAccountId(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">Select account</option>
                  {(summary?.accounts || []).map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.code} · {account.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
          {ready ? (
            <Notice {...detail} />
          ) : (
            <p>Select an account to view its General Ledger.</p>
          )}
          {current && (
            <>
              {kind === "cash-flow" && !current.complete && (
                <p
                  role="alert"
                  className="mb-3 rounded bg-amber-50 p-3 text-amber-900"
                >
                  Cash-flow classification is incomplete:{" "}
                  {current.configured === false
                    ? "no cash/bank accounts are designated."
                    : `${current.unclassifiedCount ?? 0} unclassified entries and ${current.transferExceptions?.length ?? 0} unmatched transfer journals.`}{" "}
                  Opening and closing cash still reconcile with the displayed
                  exception buckets.
                </p>
              )}
              <p className="mb-3 text-sm text-slate-500">
                {current.from} – {current.to} · {current.basis}
              </p>
              <DataTable
                rows={current.rows}
                columns={
                  kind === "general-ledger"
                    ? ["date", "number", "memo", "debit", "credit", "balance"]
                    : kind === "trial-balance"
                      ? [
                          "code",
                          "name",
                          "type",
                          "openingDebit",
                          "openingCredit",
                          "debit",
                          "credit",
                          "closingDebit",
                          "closingCredit",
                        ]
                      : ["code", "name", "type", "amount"]
                }
                searchLabel="Search report rows"
              />
              <DataTable
                rows={Object.entries(current.totals).map(
                  ([measure, amount]) => ({ measure, amount }),
                )}
                columns={["measure", "amount"]}
              />
              {!!current.transferExceptions?.length && (
                <div className="mt-4">
                  <h3 className="mb-2 font-semibold">Unmatched transfer journals</h3>
                  <DataTable
                    rows={current.transferExceptions}
                    columns={["journal", "amount"]}
                    searchLabel="Search unmatched transfers"
                  />
                </div>
              )}
              {current.pagination && (
                <div className="mt-3 flex items-center gap-3">
                  <button
                    className={secondary}
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                  >
                    Previous page
                  </button>
                  <span>
                    Page {current.pagination.page} of {current.pagination.pages}{" "}
                    · {current.pagination.count} entries
                  </span>
                  <button
                    className={primary}
                    disabled={page >= current.pagination.pages}
                    onClick={() => setPage(page + 1)}
                  >
                    Next page
                  </button>
                </div>
              )}
              <p className="mt-3 text-xs text-slate-500">{current.note}</p>
            </>
          )}
        </Panel>
      )}
    </div>
  );
}
