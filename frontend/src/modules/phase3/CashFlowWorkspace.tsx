import { useState } from "react";
import { DataTable, Field, Form, Notice, Panel } from "./shared";
import { formValue, input, secondary, today, usePhase3Data } from "./api";
import { ReportMoney } from "./FinancialReports";

type CashEntry = {
  id: string;
  journal: string;
  date: string;
  amount: string;
  classification: null | {
    version: number;
    operating: string;
    investing: string;
    financing: string;
    transfer: string;
    reason: string;
    actor: string;
  };
};
type Account = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  type: string;
  cash: boolean;
  version: number;
};
type CashData = {
  accounts: Account[];
  entries: CashEntry[];
  pagination: { page: number; count: number; pages: number };
};
const categories = ["operating", "investing", "financing", "transfer"] as const;

function ClassificationForm({
  entry,
  busy,
  submit,
}: {
  entry: CashEntry;
  busy: boolean;
  submit: (body: unknown) => Promise<unknown>;
}) {
  const used = categories.filter(
    (key) => entry.classification && Number(entry.classification[key]) !== 0,
  );
  const [category, setCategory] = useState<string>(
    used.length === 1 ? used[0] : entry.classification ? "split" : "operating",
  );
  return (
    <Form
      title="Classify selected cash entry"
      button="Save classification version"
      disabled={busy}
      onSubmit={async (form) => {
        const amounts = Object.fromEntries(
          categories.map((key) => [
            key,
            category === "split"
              ? formValue(form, key) || "0"
              : category === key
                ? entry.amount
                : "0",
          ]),
        );
        await submit({
          ledgerEntryId: entry.id,
          expectedVersion: entry.classification?.version ?? 0,
          reason: formValue(form, "reason"),
          ...amounts,
        });
      }}
    >
      <p>
        {entry.journal} · <ReportMoney value={entry.amount} /> · Version{" "}
        {entry.classification?.version ?? 0}. Positive amounts are receipts;
        negative amounts are payments.
      </p>
      <Field label="Cash-flow category">
        <select
          className={input}
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          {categories.map((key) => (
            <option key={key} value={key}>
              {key === "transfer" ? "Internal transfer" : key}
            </option>
          ))}
          <option value="split">Split across categories</option>
        </select>
      </Field>
      {category === "split" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {categories.map((key) => (
            <Field key={key} label={key}>
              <input
                className={input}
                type="number"
                step="0.01"
                name={key}
                defaultValue={entry.classification?.[key] ?? "0.00"}
              />
            </Field>
          ))}
        </div>
      )}
      <Field label="Classification reason">
        <input
          required
          name="reason"
          defaultValue={entry.classification?.reason ?? ""}
          className={input}
        />
      </Field>
      <p className="text-xs text-slate-500">
        Saving appends an audited version. Earlier classifications and the
        original journal remain unchanged. An internal transfer is complete only
        when its selected cash entries reconcile to zero in the same journal.
      </p>
    </Form>
  );
}

export default function CashFlowWorkspace({
  api,
  company,
  canWrite,
}: {
  api: string;
  company: string;
  canWrite: boolean;
}) {
  const [range, setRange] = useState({
    from: `${today().slice(0, 8)}01`,
    to: today(),
  });
  const [page, setPage] = useState(1),
    [accountId, setAccountId] = useState(""),
    [entryId, setEntryId] = useState("");
  const query = new URLSearchParams({
    ...range,
    page: String(page),
    limit: "50",
  });
  const state = usePhase3Data<CashData>(
    api,
    company,
    `/books/cash-flow/entries?${query}`,
  );
  const data = !state.loading && !state.error ? state.data : null;
  const selected = data?.accounts.find((account) => account.id === accountId),
    entry = data?.entries.find((row) => row.id === entryId);
  return (
    <div className="space-y-5">
      <Panel title="Cash-flow classification">
        <p className="mb-4 text-sm text-slate-500">
          Use Financial statements → Cash Flow to view and export the report.
          Configure the cash/bank accounts here, then classify their posted
          movements. Existing entries begin Unclassified.
        </p>
        <Form
          title="Cash entry period (Asia/Manila)"
          button="Apply period"
          disabled={state.loading || state.busy}
          onSubmit={async (form) => {
            setRange({
              from: formValue(form, "from"),
              to: formValue(form, "to"),
            });
            setPage(1);
            setEntryId("");
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="From">
              <input
                required
                type="date"
                name="from"
                defaultValue={range.from}
                className={input}
              />
            </Field>
            <Field label="Through">
              <input
                required
                type="date"
                name="to"
                defaultValue={range.to}
                className={input}
              />
            </Field>
          </div>
        </Form>
        <Notice {...state} />
        {data && (
          <>
            <DataTable
              rows={data.accounts
                .filter((account) => account.cash)
                .map((account) => ({
                  code: account.code,
                  name: account.name,
                  version: account.version,
                  active: account.active,
                }))}
              columns={["code", "name", "version", "active"]}
            />
            {canWrite && (
              <div className="mt-4 space-y-3">
                <Field label="Choose cash/bank designation account">
                  <select
                    value={accountId}
                    className={input}
                    onChange={(event) => setAccountId(event.target.value)}
                  >
                    <option value="">Select an asset account</option>
                    {data.accounts
                      .filter(
                        (account) => account.type === "ASSET" || account.cash,
                      )
                      .map((account) => (
                        <option value={account.id} key={account.id}>
                          {account.code} · {account.name}
                          {!account.active ? " (archived)" : ""}
                        </option>
                      ))}
                  </select>
                </Field>
                {selected && (
                  <Form
                    key={`${selected.id}-${selected.version}`}
                    title="Cash/bank account designation"
                    button="Save designation"
                    disabled={state.busy}
                    onSubmit={async (form) => {
                      await state.run(
                        "/books/cash-flow/accounts",
                        {
                          accountId: selected.id,
                          expectedVersion: selected.version,
                          active: formValue(form, "active") === "true",
                        },
                        "Cash account designation recorded.",
                      );
                    }}
                  >
                    <Field label="Include this account in cash-flow reports">
                      <select
                        name="active"
                        defaultValue={String(selected.cash)}
                        className={input}
                      >
                        <option value="true" disabled={!selected.active}>
                          Include as cash/bank
                        </option>
                        <option value="false">Exclude from cash/bank</option>
                      </select>
                    </Field>
                    <p className="text-xs text-slate-500">
                      The report uses the current designation set for the chosen
                      period. Changing that set changes its opening and closing
                      cash scope; it does not change any journal.
                    </p>
                  </Form>
                )}
              </div>
            )}
          </>
        )}
      </Panel>
      {data && (
        <Panel title="Posted cash movements">
          <DataTable
            rows={data.entries.map((row) => ({
              journal: row.journal,
              date: row.date,
              amount: row.amount,
              status: row.classification ? "Classified" : "Unclassified",
              version: row.classification?.version ?? 0,
              reason: row.classification?.reason ?? "",
            }))}
            columns={[
              "journal",
              "date",
              "amount",
              "status",
              "version",
              "reason",
            ]}
          />
          <div className="my-4 flex items-center gap-3">
            <button
              className={secondary}
              disabled={page <= 1}
              onClick={() => {
                setPage(page - 1);
                setEntryId("");
              }}
            >
              Previous entries
            </button>
            <span>
              Page {data.pagination.page} of {data.pagination.pages} ·{" "}
              {data.pagination.count} entries
            </span>
            <button
              className={secondary}
              disabled={page >= data.pagination.pages}
              onClick={() => {
                setPage(page + 1);
                setEntryId("");
              }}
            >
              Next entries
            </button>
          </div>
          {canWrite && (
            <>
              <Field label="Choose posted cash entry">
                <select
                  value={entryId}
                  className={input}
                  onChange={(event) => setEntryId(event.target.value)}
                >
                  <option value="">Select entry on this page</option>
                  {data.entries.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.journal} · PHP {row.amount} ·{" "}
                      {row.classification ? "Classified" : "Unclassified"}
                    </option>
                  ))}
                </select>
              </Field>
              {entry && (
                <ClassificationForm
                  key={`${entry.id}-${entry.classification?.version ?? 0}`}
                  entry={entry}
                  busy={state.busy}
                  submit={(body) =>
                    state.run(
                      "/books/cash-flow/classifications",
                      body,
                      "Cash-flow classification version recorded.",
                    )
                  }
                />
              )}
            </>
          )}
        </Panel>
      )}
    </div>
  );
}
