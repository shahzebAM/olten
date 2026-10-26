import { useState } from "react";
import * as XLSX from "xlsx";
import { DataTable, Field, Form, Notice, Panel, PartySelect } from "./shared";
import {
  asObject,
  asRows,
  date,
  formValue,
  input,
  money,
  phase3Request,
  primary,
  secondary,
  textValue,
  today,
  usePhase3Data,
} from "./api";
import type { JsonRow } from "./api";
import FinancialReports from "./FinancialReports";
import CashFlowWorkspace from "./CashFlowWorkspace";
import InventoryReconciliation from "./InventoryReconciliation";

type Account = {
  id: string;
  code: string;
  name: string;
  type: string;
  active: boolean;
  deleteAction?: "DELETE" | "ARCHIVE";
};
type Entry = {
  id: string;
  accountId: string;
  debit: string;
  credit: string;
  account?: Account;
  statementLine?: { id: string; reconciliationId: string } | null;
};
type Journal = {
  id: string;
  number: string;
  date: string;
  memo: string;
  entries: Entry[];
};
type BankEntry = Entry & { journal: string; memo: string; date: string };
type StatementLine = {
  id: string;
  date: string;
  reference: string;
  description: string;
  amount: string;
  ledgerEntryId?: string;
};
type Reconciliation = {
  id: string;
  number: string;
  accountId: string;
  statementDate: string;
  openingBalance: string;
  closingBalance: string;
  status: string;
  lines: StatementLine[];
};
type Books = {
  accounts: Account[];
  journals: Journal[];
  mappings: JsonRow[];
  reconciliations: Reconciliation[];
  trialBalance: unknown;
  mappingSources?: Record<
    string,
    { id: string | number; name: string; sku?: string; code?: string }[]
  >;
};
type ImportedLine = {
  date: string;
  reference: string;
  description: string;
  amount: string;
};

function ReconciliationForm({
  accounts,
  busy,
  submit,
}: {
  accounts: Account[];
  busy: boolean;
  submit: (body: unknown) => Promise<boolean>;
}) {
  const [lines, setLines] = useState<ImportedLine[]>([]);
  const [error, setError] = useState("");
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), {
        type: "array",
        raw: false,
        cellDates: false,
      });
      const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        workbook.Sheets[workbook.SheetNames[0]],
        { raw: false, defval: "" },
      );
      if (!records.length || records.length > 1000)
        throw new Error("The statement must contain 1–1,000 transaction rows.");
      const imported = records.map((record, index) => {
        const normalized = Object.fromEntries(
          Object.entries(record).map(([key, value]) => [
            key.trim().toLowerCase(),
            String(value).trim(),
          ]),
        );
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(normalized.date) ||
          !/^-?\d+(\.\d{1,2})?$/.test(normalized.amount || "")
        )
          throw new Error(
            `Row ${index + 2}: use Date YYYY-MM-DD and a signed Amount with up to two decimals.`,
          );
        return {
          date: normalized.date,
          reference: normalized.reference || "",
          description: normalized.description || "",
          amount: normalized.amount,
        };
      });
      setLines(imported);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not read the statement.",
      );
    }
  };
  return (
    <Form
      title="Import bank statement and start reconciliation"
      disabled={busy}
      onSubmit={async (form) => {
        if (!lines.length) {
          setError("Import or add at least one statement transaction.");
          return;
        }
        await submit({
          accountId: formValue(form, "accountId"),
          statementDate: formValue(form, "statementDate"),
          openingBalance: formValue(form, "openingBalance"),
          closingBalance: formValue(form, "closingBalance"),
          lines,
        });
      }}
    >
      <div className="grid gap-4 md:grid-cols-4">
        <Field label="Bank ledger account">
          <select required name="accountId" className={input}>
            <option value="">Select account</option>
            {accounts
              .filter((account) => account.type === "ASSET")
              .map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} · {account.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Statement date">
          <input
            required
            name="statementDate"
            type="date"
            defaultValue={today()}
            className={input}
          />
        </Field>
        <Field label="Opening balance (PHP)">
          <input
            required
            name="openingBalance"
            type="number"
            step="0.01"
            className={input}
          />
        </Field>
        <Field label="Closing balance (PHP)">
          <input
            required
            name="closingBalance"
            type="number"
            step="0.01"
            className={input}
          />
        </Field>
      </div>
      <Field label="Statement CSV / Excel file">
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          className={input}
          onChange={(event) => void importFile(event.target.files?.[0])}
        />
      </Field>
      <p className="text-xs text-slate-500">
        Columns: Date (YYYY-MM-DD), Reference, Description, Amount. Deposits are
        positive; withdrawals are negative. Importing previews transactions
        before saving.
      </p>
      <Notice error={error} />
      {lines.map((line, index) => (
        <div className="grid gap-2 sm:grid-cols-5" key={index}>
          {(["date", "reference", "description", "amount"] as const).map(
            (key) => (
              <Field label={`${key} · row ${index + 1}`} key={key}>
                <input
                  required={key === "date" || key === "amount"}
                  type={
                    key === "date"
                      ? "date"
                      : key === "amount"
                        ? "number"
                        : "text"
                  }
                  step="0.01"
                  className={input}
                  value={line[key]}
                  onChange={(event) =>
                    setLines((previous) =>
                      previous.map((row, position) =>
                        position === index
                          ? { ...row, [key]: event.target.value }
                          : row,
                      ),
                    )
                  }
                />
              </Field>
            ),
          )}
          <button
            type="button"
            className={`${secondary} self-end`}
            onClick={() =>
              setLines((previous) =>
                previous.filter((_, position) => position !== index),
              )
            }
          >
            Remove row
          </button>
        </div>
      ))}
      <button
        type="button"
        className={secondary}
        onClick={() =>
          setLines((previous) => [
            ...previous,
            { date: today(), reference: "", description: "", amount: "" },
          ])
        }
      >
        Add transaction
      </button>
    </Form>
  );
}

export default function BooksWorkspace({
  api,
  company,
  canWrite,
  canManageAccounts,
  canReconcileInventory = false,
}: {
  api: string;
  company: string;
  canWrite: boolean;
  canManageAccounts: boolean;
  canReconcileInventory?: boolean;
}) {
  const state = usePhase3Data<Books>(api, company, "/books");
  const [tab, setTab] = useState("ledger");
  const [showArchived, setShowArchived] = useState(false);
  const [mappingKind, setMappingKind] = useState("ITEM");
  const [bankEntries, setBankEntries] = useState<Record<string, BankEntry[]>>(
    {},
  );
  const [bankCursors, setBankCursors] = useState<Record<string, string | null>>(
    {},
  );
  const [loadingBank, setLoadingBank] = useState("");
  const [bankError, setBankError] = useState("");
  const [lines, setLines] = useState([
    { code: "1000", debit: "", credit: "" },
    { code: "3000", debit: "", credit: "" },
  ]);
  const [selectedMatches, setSelectedMatches] = useState<
    Record<string, string>
  >({});
  const [audit, setAudit] = useState<JsonRow[]>([]);
  const [auditError, setAuditError] = useState("");
  const data = state.data;
  const activeAccounts = (data?.accounts || []).filter((account) => account.active !== false);
  const archivedAccounts = (data?.accounts || []).filter((account) => account.active === false);
  const debit = lines.reduce((sum, line) => sum + (Number(line.debit) || 0), 0);
  const credit = lines.reduce(
    (sum, line) => sum + (Number(line.credit) || 0),
    0,
  );
  const entries = (data?.journals || []).flatMap((journal) =>
    journal.entries.map((entry) => ({
      ...entry,
      journal: journal.number,
      memo: journal.memo,
      date: journal.date,
    })),
  );
  return (
    <div className="space-y-5">
      <div
        className="phase3-tabs flex flex-wrap gap-2"
        role="group"
        aria-label="Accounting sections"
      >
        {[
          ["ledger", "Accounts & journals"],
          ["mapping", "Account mappings"],
          ["reconciliation", "Bank reconciliation"],
          ["audit", "Audit log"],
          ["reports", "Financial statements"],
          ["cash-flow", "Cash flow classification"],
          ...(canReconcileInventory ? [["inventory-reconciliation", "Inventory reconciliation"]] : []),
        ].map(([id, title]) => (
          <button
            className={tab === id ? primary : secondary}
            key={id}
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            {title}
          </button>
        ))}
        <button
          className={`${secondary} ml-auto`}
          disabled={state.loading || state.busy}
          onClick={state.refresh}
        >
          Refresh
        </button>
      </div>
      <Notice {...state} />
      {tab === "reports" && <FinancialReports api={api} company={company} />}
      {tab === "cash-flow" && <CashFlowWorkspace api={api} company={company} canWrite={canWrite} />}
      {tab === "inventory-reconciliation" && canReconcileInventory && <InventoryReconciliation api={api} company={company} />}
      {data && tab === "ledger" && (
        <>
          <Panel
            title="Chart of accounts"
            actions={
              canWrite && (
                <button
                  className={secondary}
                  disabled={state.busy}
                  onClick={() =>
                    void state.run(
                      "/books/initialize",
                      {},
                      "Default accounting accounts are ready.",
                    )
                  }
                >
                  Initialize standard accounts
                </button>
              )
            }
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-3xl text-sm text-slate-500">
                Only a Super Admin can delete accounts. Unused accounts are removed;
                accounts with history are archived and remain in reports. Archived
                accounts must be restored before new postings use them. Deleted
                standard accounts may be recreated when needed for posting.
              </p>
              <button
                type="button"
                className={secondary}
                aria-pressed={showArchived}
                onClick={() => setShowArchived((previous) => !previous)}
              >
                {showArchived ? "Show active accounts" : `Show archived accounts (${archivedAccounts.length})`}
              </button>
            </div>
            <DataTable
              rows={(showArchived ? archivedAccounts : activeAccounts).map((account) => ({
                ...account,
                status: account.active === false ? "Archived" : "Active",
              }))}
              columns={["code", "name", "type", "status"]}
              searchLabel="Search accounts"
              actions={
                canManageAccounts
                  ? (account) => (
                      <div className="space-y-1">
                        <button
                          type="button"
                          className={`${secondary} text-rose-700`}
                          aria-label={`${account.active === false ? "Restore" : "Delete"} account ${account.code} ${account.name}`}
                          disabled={state.busy || state.loading}
                          onClick={() => {
                            if (account.active === false) {
                              void state.run(
                                `/books/accounts/${encodeURIComponent(String(account.id))}/restore`,
                                {},
                                "Ledger account restored.",
                              );
                              return;
                            }
                            if (
                              window.confirm(
                                `Delete account ${account.code} · ${account.name}? Accounts with linked history are archived and retain their balances and audit trail. Unused accounts are permanently removed. Restore archived accounts before new postings or loading bank matching candidates.`,
                              )
                            )
                              void state.run(
                                `/books/accounts/${encodeURIComponent(String(account.id))}`,
                                undefined,
                                "Account removed from the active chart. Any linked history has been preserved.",
                                "DELETE",
                              );
                          }}
                        >
                          {account.active === false ? "Restore" : "Delete"}
                        </button>
                        {account.active !== false && account.deleteAction === "ARCHIVE" && (
                          <p className="max-w-xs text-xs text-slate-500">
                            Linked history will be preserved by archiving this account.
                          </p>
                        )}
                      </div>
                    )
                  : undefined
              }
            />
            {canWrite && (
              <div className="mt-5">
                <Form
                  title="Add ledger account"
                  disabled={state.busy}
                  onSubmit={async (form) => {
                    await state.run(
                      "/books/accounts",
                      {
                        code: formValue(form, "code"),
                        name: formValue(form, "name"),
                        type: formValue(form, "type"),
                      },
                      "Ledger account created.",
                    );
                  }}
                >
                  <div className="grid gap-4 md:grid-cols-3">
                    <Field label="Account code">
                      <input required name="code" className={input} />
                    </Field>
                    <Field label="Account name">
                      <input required name="name" className={input} />
                    </Field>
                    <Field label="Account type">
                      <select name="type" className={input}>
                        {[
                          "ASSET",
                          "LIABILITY",
                          "EQUITY",
                          "REVENUE",
                          "EXPENSE",
                        ].map((type) => (
                          <option key={type}>{type}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                </Form>
              </div>
            )}
          </Panel>
          <Panel title="Balanced journal entries">
            {canWrite && (
              <Form
                title="Post manual journal"
                disabled={state.busy}
                button="Post balanced journal"
                onSubmit={async (form) => {
                  await state.run(
                    "/books/journals",
                    {
                      date: formValue(form, "date"),
                      memo: formValue(form, "memo"),
                      reference: formValue(form, "reference"),
                      lines: lines.map((line) => ({
                        ...line,
                        debit: line.debit || "0",
                        credit: line.credit || "0",
                      })),
                    },
                    "Balanced journal posted.",
                  );
                }}
              >
                <div className="grid gap-4 md:grid-cols-3">
                  <Field label="Journal date">
                    <input
                      required
                      name="date"
                      type="date"
                      defaultValue={today()}
                      className={input}
                    />
                  </Field>
                  <Field label="Memo">
                    <input required name="memo" className={input} />
                  </Field>
                  <Field label="Unique journal reference">
                    <input required name="reference" className={input} />
                  </Field>
                </div>
                {lines.map((line, index) => (
                  <div key={index} className="grid gap-3 sm:grid-cols-4">
                    <Field label={`Account · line ${index + 1}`}>
                      <select
                        required
                        className={input}
                        value={activeAccounts.some((account) => account.code === line.code) ? line.code : ""}
                        onChange={(event) =>
                          setLines((previous) =>
                            previous.map((row, position) =>
                              position === index
                                ? { ...row, code: event.target.value }
                                : row,
                            ),
                          )
                        }
                      >
                        <option value="">Select account</option>
                        {activeAccounts.map((account) => (
                          <option key={account.id} value={account.code}>
                            {account.code} · {account.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {(["debit", "credit"] as const).map((key) => (
                      <Field label={`${key} (PHP)`} key={key}>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className={input}
                          value={line[key]}
                          onChange={(event) =>
                            setLines((previous) =>
                              previous.map((row, position) =>
                                position === index
                                  ? { ...row, [key]: event.target.value }
                                  : row,
                              ),
                            )
                          }
                        />
                      </Field>
                    ))}
                    {lines.length > 2 && (
                      <button
                        type="button"
                        className={`${secondary} self-end`}
                        onClick={() =>
                          setLines((previous) =>
                            previous.filter(
                              (_, position) => position !== index,
                            ),
                          )
                        }
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  className={secondary}
                  onClick={() =>
                    setLines((previous) => [
                      ...previous,
                      { code: "", debit: "", credit: "" },
                    ])
                  }
                >
                  Add journal line
                </button>
                <p
                  className={
                    Math.abs(debit - credit) < 0.005
                      ? "font-semibold text-emerald-700"
                      : "font-semibold text-rose-700"
                  }
                >
                  Debits {money(debit)} · Credits {money(credit)} · Difference{" "}
                  {money(debit - credit)}
                </p>
              </Form>
            )}
            <div className="mt-5 space-y-3">
              {data.journals.map((journal) => (
                <details key={journal.id} className="rounded-lg border p-3">
                  <summary className="cursor-pointer text-sm font-semibold">
                    {journal.number} · {date(journal.date)} · {journal.memo}
                  </summary>
                  <DataTable
                    rows={journal.entries.map((entry) => ({
                      ...entry,
                      account: `${entry.account?.code || ""} ${entry.account?.name || entry.accountId}`,
                    }))}
                    columns={["account", "debit", "credit"]}
                  />
                </details>
              ))}
              {!data.journals.length && (
                <p className="text-sm text-slate-500">No journals posted.</p>
              )}
            </div>
          </Panel>
          <Panel title="General ledger · journal history">
            <p className="mb-4 text-xs text-slate-500">
              Entries from the journal history currently loaded in this workspace.
            </p>
            <DataTable
              rows={entries.map((entry) => ({
                ...entry,
                date: date(entry.date),
                account: `${entry.account?.code || ""} ${entry.account?.name || entry.accountId}`,
              }))}
              columns={["date", "journal", "account", "memo", "debit", "credit"]}
              searchLabel="Search journal entries"
            />
          </Panel>
          <Panel title="Trial balance">
            <DataTable
              rows={
                asRows(data.trialBalance).length
                  ? asRows(data.trialBalance)
                  : asRows(asObject(data.trialBalance).rows)
              }
              columns={["code", "name", "debit", "credit", "balance"]}
            />
          </Panel>
        </>
      )}
      {data && tab === "mapping" && (
        <Panel title="Posting roles and reference mappings">
          <p className="mb-4 text-sm text-slate-500">
            POSTING_ROLE controls the accounts used by new automatic Finance postings.
            Payments and memos retain their original source accounts. ITEM, CUSTOMER,
            SUPPLIER and ACCOUNT links remain references; manual journals use the accounts you select.
          </p>
          {canWrite && (
            <Form
              title="Save accounting mapping"
              disabled={state.busy}
              onSubmit={async (form) => {
                await state.run(
                  "/books/mappings",
                  {
                    kind: formValue(form, "kind"),
                    sourceId: formValue(form, "sourceId"),
                    accountId: formValue(form, "accountId"),
                  },
                  "Accounting mapping saved.",
                );
              }}
            >
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Source type">
                  <select
                    name="kind"
                    value={mappingKind}
                    onChange={(event) => setMappingKind(event.target.value)}
                    className={input}
                  >
                    {["ITEM", "CUSTOMER", "SUPPLIER", "ACCOUNT", "POSTING_ROLE"].map((kind) => (
                      <option key={kind}>{kind}</option>
                    ))}
                  </select>
                </Field>
                <Field label="ERP source record">
                  <PartySelect
                    key={mappingKind}
                    name="sourceId"
                    parties={(data.mappingSources?.[mappingKind] || []).map(
                      (source) => ({
                        id: String(source.id),
                        name: `${source.sku || source.code || ""} ${source.name}`.trim(),
                      }),
                    )}
                  />
                </Field>
                <Field label="Ledger account">
                  <select required name="accountId" className={input}>
                    <option value="">Select account</option>
                    {activeAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.code} · {account.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </Form>
          )}
          <div className="mt-5">
            <DataTable
              rows={data.mappings.map((mapping) => ({
                ...mapping,
                account: data.accounts.find(
                  (account) => account.id === mapping.accountId,
                )?.name,
              }))}
              columns={["kind", "sourceId", "account"]}
            />
          </div>
        </Panel>
      )}
      {data && tab === "reconciliation" && (
        <>
          <Panel title="Bank reconciliation">
            <p className="mb-4 text-sm text-slate-500">
              Match each statement transaction to one unused journal entry in
              the selected bank account. The server checks exact amounts and
              statement balance before completion.
            </p>
            {canWrite && (
              <ReconciliationForm
                accounts={activeAccounts}
                busy={state.busy}
                submit={(body) =>
                  state.run(
                    "/books/reconciliations",
                    body,
                    "Statement saved. Match its transactions to ledger entries.",
                  )
                }
              />
            )}
          </Panel>
          {data.reconciliations.map((record) => (
            <Panel
              key={record.id}
              title={`${record.number} · ${record.status}`}
              actions={
                record.status === "DRAFT" &&
                canWrite && (
                  <button
                    disabled={state.busy}
                    className={primary}
                    onClick={() =>
                      void state.run(
                        `/books/reconciliations/${record.id}/complete`,
                        {},
                        "Bank reconciliation completed and locked.",
                      )
                    }
                  >
                    Complete reconciliation
                  </button>
                )
              }
            >
              <p className="mb-4 text-sm text-slate-600">
                {
                  data.accounts.find(
                    (account) => account.id === record.accountId,
                  )?.name
                }{" "}
                · {date(record.statementDate)} · Opening{" "}
                {money(record.openingBalance)} · Closing{" "}
                {money(record.closingBalance)}
              </p>
              {record.status === "DRAFT" && canWrite && (
                <div className="mb-4 space-y-2">
                  <button
                    type="button"
                    className={secondary}
                    disabled={!!loadingBank}
                    onClick={async () => {
                      setLoadingBank(record.accountId);
                      setBankError("");
                      try {
                        const cursor = bankCursors[record.accountId];
                        const result = await phase3Request<{
                          entries: (Entry & {
                            journal: {
                              number: string;
                              memo: string;
                              date: string;
                            };
                          })[];
                          nextCursor: string | null;
                        }>(
                          api,
                          company,
                          `/books/ledger-entries?accountId=${encodeURIComponent(record.accountId)}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
                        );
                        setBankEntries((previous) => ({
                          ...previous,
                          [record.accountId]: [
                            ...new Map(
                              [
                                ...(previous[record.accountId] || []),
                                ...result.entries.map((entry) => ({
                                  ...entry,
                                  journal: entry.journal.number,
                                  memo: entry.journal.memo,
                                  date: entry.journal.date,
                                })),
                              ].map((entry) => [entry.id, entry]),
                            ).values(),
                          ],
                        }));
                        setBankCursors((previous) => ({
                          ...previous,
                          [record.accountId]: result.nextCursor,
                        }));
                      } catch (reason) {
                        setBankError(
                          reason instanceof Error
                            ? reason.message
                            : "Could not load bank ledger entries.",
                        );
                      } finally {
                        setLoadingBank("");
                      }
                    }}
                  >
                    {loadingBank === record.accountId
                      ? "Loading bank entries…"
                      : bankCursors[record.accountId]
                        ? "Load more unmatched bank entries"
                        : "Load unmatched bank entries from all history"}
                  </button>
                  <Notice error={bankError} />
                </div>
              )}
              <div className="space-y-3">
                {record.lines.map((line) => (
                  <div
                    key={line.id}
                    className="grid items-center gap-3 rounded-lg border p-3 md:grid-cols-3"
                  >
                    <div>
                      <strong>
                        {date(line.date)} · {money(line.amount)}
                      </strong>
                      <p className="text-sm text-slate-600">
                        {line.reference} · {line.description}
                      </p>
                    </div>
                    {line.ledgerEntryId ? (
                      <span className="text-sm font-semibold text-emerald-700">
                        Matched ·{" "}
                        {entries.find(
                          (entry) => entry.id === line.ledgerEntryId,
                        )?.journal || line.ledgerEntryId}
                      </span>
                    ) : record.status === "DRAFT" && canWrite ? (
                      <>
                        <Field label="Matching ledger transaction">
                          <select
                            required
                            className={input}
                            value={selectedMatches[line.id] || ""}
                            onChange={(event) =>
                              setSelectedMatches((previous) => ({
                                ...previous,
                                [line.id]: event.target.value,
                              }))
                            }
                          >
                            <option value="">Select bank entry</option>
                            {[
                              ...new Map(
                                [
                                  ...entries,
                                  ...(bankEntries[record.accountId] || []),
                                ].map((entry) => [entry.id, entry]),
                              ).values(),
                            ]
                              .filter(
                                (entry) =>
                                  entry.accountId === record.accountId &&
                                  !entry.statementLine &&
                                  !data.reconciliations.some((reconciliation) =>
                                    reconciliation.lines.some(
                                      (item) => item.ledgerEntryId === entry.id,
                                    ),
                                  ),
                              )
                              .map((entry) => (
                                <option key={entry.id} value={entry.id}>
                                  {entry.journal} · {date(entry.date)} ·{" "}
                                  {money(
                                    Number(entry.debit) - Number(entry.credit),
                                  )}{" "}
                                  · {entry.memo}
                                </option>
                              ))}
                          </select>
                        </Field>
                        <button
                          className={secondary}
                          disabled={state.busy || !selectedMatches[line.id]}
                          onClick={() =>
                            void state.run(
                              `/books/reconciliations/${record.id}/match`,
                              {
                                lineId: line.id,
                                ledgerEntryId: selectedMatches[line.id],
                              },
                              "Statement transaction matched.",
                            )
                          }
                        >
                          Match entry
                        </button>
                      </>
                    ) : (
                      <span>Unmatched</span>
                    )}
                  </div>
                ))}
              </div>
            </Panel>
          ))}
        </>
      )}
      {tab === "audit" && (
        <Panel
          title="Immutable ERP audit log"
          actions={
            <button
              className={secondary}
              disabled={state.busy}
              onClick={async () => {
                setAuditError("");
                try {
                  const result = await phase3Request<unknown>(
                    api,
                    company,
                    "/audit?limit=100",
                  );
                  setAudit(
                    Array.isArray(result)
                      ? asRows(result)
                      : asRows(
                          asObject(result).records ||
                            asObject(result).items ||
                            asObject(result).rows,
                        ),
                  );
                } catch (reason) {
                  setAuditError(
                    reason instanceof Error
                      ? reason.message
                      : "Could not load audit log.",
                  );
                }
              }}
            >
              Load latest 100 events
            </button>
          }
        >
          <Notice error={auditError} />
          <DataTable
            rows={audit.map((row) => ({
              ...row,
              details: textValue(row.details),
            }))}
            columns={[
              "createdAt",
              "actor",
              "action",
              "entityType",
              "entityId",
              "details",
            ]}
          />
        </Panel>
      )}
    </div>
  );
}
