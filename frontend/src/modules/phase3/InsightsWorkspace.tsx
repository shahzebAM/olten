import { useEffect, useRef, useState } from "react";
import FinancialReports from "./FinancialReports";
import * as XLSX from "xlsx";
import type { ErpUser } from "../../lib/phase3Access";
import { hasPhase3Access } from "../../lib/phase3Access";
import { DataTable, Field, Form, Notice, Panel } from "./shared";
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
  usePhase3Data,
} from "./api";
import type { JsonRow } from "./api";

type Report = {
  id: string;
  title: string;
  columns: string[];
  rows: JsonRow[];
  generatedAt: string;
  truncated?: boolean;
  note?: string;
};
type Executive = {
  alerts: {
    id: string;
    title: string;
    count: number;
    severity: string;
    reportId?: string;
  }[];
  summary: {
    id: string;
    title: string;
    value: string | number;
    unit?: string;
  }[];
  forecast: {
    method: string;
    status: string;
    reason?: string;
    rows: JsonRow[];
  } | null;
  reports: { id: string; title: string; scope: string }[];
  generatedAt?: string;
};

function ReportViewer({
  api,
  company,
  reportId,
}: {
  api: string;
  company: string;
  reportId: string;
}) {
  const state = usePhase3Data<Report>(
    api,
    company,
    `/reports/${encodeURIComponent(reportId)}`,
  );
  const data = state.data;
  const exportReport = (format: "csv" | "xlsx") => {
    if (!data) return;
    const rows = data.rows.map((row) =>
      Object.fromEntries(
        data.columns.map((column) => {
          const value = row[column];
          const text =
            typeof value === "object" && value !== null
              ? JSON.stringify(value)
              : (value ?? "");
          return [
            column,
            typeof text === "string" && /^[=+@\-\t\r]/.test(text)
              ? `'${text}`
              : text,
          ];
        }),
      ),
    );
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(rows, { header: data.columns }),
      "Report",
    );
    XLSX.writeFile(
      workbook,
      `${company}-${data.id}-${new Date().toISOString().slice(0, 10)}.${format}`,
      { bookType: format },
    );
  };
  return (
    <Panel
      title={data?.title || "Management report"}
      actions={
        <div className="flex gap-2">
          <button
            className={secondary}
            disabled={!data}
            onClick={() => exportReport("csv")}
          >
            Export CSV
          </button>
          <button
            className={secondary}
            disabled={!data}
            onClick={() => exportReport("xlsx")}
          >
            Export Excel
          </button>
        </div>
      }
    >
      <Notice {...state} />
      {data && (
        <>
          <p className="mb-3 text-xs text-slate-500">
            Generated {new Date(data.generatedAt).toLocaleString("en-PH")} ·{" "}
            {data.rows.length} rows · Company and role filtered
          </p>
          <DataTable
            rows={data.rows}
            columns={data.columns.filter(
              (column) => !/(^id$|Id$|_id$)/.test(column),
            )}
          />
          {data.note && (
            <p className="mt-3 text-xs text-slate-500">{data.note}</p>
          )}
          {data.truncated && (
            <p className="mt-2 text-xs text-amber-800">
              This report reached its display limit. The export contains the
              displayed rows.
            </p>
          )}
        </>
      )}
    </Panel>
  );
}

function ReportDialog({ api, company, reportId, onClose }: {
  api: string; company: string; reportId: string; onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog ref={dialogRef} className="phase3-report-dialog" aria-labelledby="management-report-title"
      onCancel={onClose} onClose={(event) => { if (!event.currentTarget.open) onClose(); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}>
      <div className="phase3-report-dialog-heading">
        <h2 id="management-report-title">Report details</h2>
        <button type="button" autoFocus className={secondary} onClick={onClose}>Close report</button>
      </div>
      <div className="phase3-report-dialog-body">
        <ReportViewer api={api} company={company} reportId={reportId} />
      </div>
    </dialog>
  );
}

function DemandChart({ rows }: { rows: JsonRow[] }) {
  const displayed = rows.slice(0, 6);
  const maximum = Math.max(1, ...displayed.map((row) => Number(row.projectedQuantity) || 0));
  return (
    <figure className="phase3-demand-chart" aria-label="Projected demand for the next 30 days">
      <figcaption className="text-xs font-medium text-slate-500">Next 30 days · projected units</figcaption>
      {displayed.map((row, index) => (
        <div key={`${String(row.sku)}-${index}`} className="phase3-demand-row">
          <span title={textValue(row.productName)}>{textValue(row.sku)}</span>
          <div className="flex items-center gap-3">
            <div className="phase3-demand-track flex-1" role="img" aria-label={`${textValue(row.sku)}: ${textValue(row.projectedQuantity)} projected units`} title={`${textValue(row.productName)} · ${textValue(row.projectedQuantity)} units`}>
              <span style={{ width: `${Math.max(0, Number(row.projectedQuantity) || 0) / maximum * 100}%` }} />
            </div>
            <span className="min-w-8 text-right text-xs font-semibold text-slate-700">{textValue(row.projectedQuantity)}</span>
          </div>
        </div>
      ))}
    </figure>
  );
}

export function ExecutiveWorkspace({
  api,
  company,
  canReadBooks = false,
}: {
  api: string;
  company: string;
  canReadBooks?: boolean;
}) {
  const state = usePhase3Data<Executive>(api, company, "/executive");
  const [reportId, setReportId] = useState("");
  const data = state.data;
  return (
    <div className="space-y-5">
      {canReadBooks && <FinancialReports api={api} company={company} overviewOnly />}
      <div className="phase3-dashboard-heading">
        <div>
          <h2>Business at a glance</h2>
          <p>{data?.generatedAt ? `Updated ${new Date(data.generatedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}` : "Company overview and operational priorities"}</p>
        </div>
        <button
          className={secondary}
          disabled={state.loading}
          onClick={state.refresh}
        >
          Refresh live dashboard
        </button>
      </div>
      <Notice {...state} />
      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {data.summary.map((card) => (
              <div
                key={card.id}
                className="phase3-metric rounded-xl border bg-white p-4 shadow-sm"
              >
                <p className="phase3-metric-label text-sm text-slate-500">{card.title}</p>
                <p className="phase3-metric-value mt-2 text-2xl font-bold text-slate-900">
                  {card.unit === "PHP"
                    ? money(card.value)
                    : `${card.value}${card.unit ? ` ${card.unit}` : ""}`}
                </p>
              </div>
            ))}
          </div>
          <Panel title="Operational alerts">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.alerts.map((alert) => (
                <button
                  key={alert.id}
                  disabled={!alert.reportId}
                  onClick={() => setReportId(alert.reportId || "")}
                  className={`phase3-alert rounded-xl border p-4 text-left disabled:cursor-default ${alert.severity === "critical" || alert.severity === "HIGH" ? "border-rose-200 bg-rose-50" : alert.severity === "info" ? "border-slate-200 bg-slate-50" : "border-amber-200 bg-amber-50"}`}
                >
                  <strong className="text-2xl text-slate-900">
                    {alert.count}
                  </strong>
                  <p className="mt-1 text-sm font-semibold text-slate-700">
                    {alert.title}
                  </p>
                </button>
              ))}
            </div>
          </Panel>
          <Panel title="Demand forecast">
            {data.forecast ? <>
            <p className="mb-3 text-sm text-slate-600">
              {data.forecast.method}
            </p>
            {data.forecast.reason && (
              <p className="mb-3 rounded-lg bg-sky-50 p-3 text-sm text-sky-800">
                {data.forecast.reason}
              </p>
            )}
            {!!data.forecast.rows.length && <DemandChart rows={data.forecast.rows} />}
            <DataTable
              rows={data.forecast.rows}
              columns={[
                "sku",
                "productName",
                "deliveredQuantity",
                "averageDaily",
                "projectedQuantity",
              ]}
            />
            <p className="mt-3 text-xs text-slate-500">
              Projection uses trailing 90 days of delivered quantities to
              estimate the next 30 days. It is a planning estimate.
            </p>
            </> : <p className="text-sm text-slate-500">Demand planning is not available for your current reporting access.</p>}
          </Panel>
          <Panel title="Management reports">
            <div className="phase3-report-links grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.reports.map((report) => (
                <button
                  key={report.id}
                  className={`${reportId === report.id ? primary : secondary} text-left`}
                  aria-pressed={reportId === report.id}
                  onClick={() => setReportId(report.id)}
                >
                  {report.title}
                </button>
              ))}
            </div>
            {!data.reports.length && (
              <p className="text-sm text-slate-500">
                No report scopes are available for this role.
              </p>
            )}
          </Panel>
        </>
      )}
      {reportId && (
        <ReportDialog
          key={reportId}
          api={api}
          company={company}
          reportId={reportId}
          onClose={() => setReportId("")}
        />
      )}
    </div>
  );
}

type Asset = {
  id: string;
  serialNumber: string;
  warrantyUntil?: string;
  warrantyStatus?: string;
  nextMaintenanceAt?: string;
  intervalMonths: number;
  product?: { name: string; sku: string };
  customer?: { name: string };
  status: string;
};
type Visit = {
  id: string;
  number: string;
  type: string;
  status: string;
  dueDate: string;
  technician: string;
  notes?: string;
  cost: string;
  parts?: { description: string; quantity: number; unitCost: string }[];
  asset?: Asset;
};
type Eligible = {
  deliveryId: string;
  delNumber: string;
  productId: number;
  sku: string;
  productName: string;
  customerName: string;
  serialNumber: string;
};
type ServiceData = {
  assets: Asset[];
  visits: Visit[];
  eligibleSerials: Eligible[];
};

function VisitUpdate({
  visit,
  busy,
  save,
}: {
  visit: Visit;
  busy: boolean;
  save: (id: string, body: unknown) => Promise<boolean>;
}) {
  const [parts, setParts] = useState<
    { description: string; quantity: string; unitCost: string }[]
  >(() =>
    (visit.parts || []).map((part) => ({
      ...part,
      quantity: String(part.quantity),
    })),
  );
  const [partsChanged, setPartsChanged] = useState(false);
  return (
    <Form
      title={`Update service visit ${visit.number}`}
      disabled={busy}
      button="Save service update"
      onSubmit={async (form) => {
        await save(visit.id, {
          status: formValue(form, "status"),
          notes: formValue(form, "notes"),
          ...(formValue(form, "cost") ? { cost: formValue(form, "cost") } : {}),
          ...(partsChanged
            ? {
                parts: parts.map((part) => ({
                  ...part,
                  quantity: Number(part.quantity),
                })),
              }
            : {}),
        });
      }}
    >
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Visit status">
          <select name="status" defaultValue={visit.status} className={input}>
            {["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"].map(
              (status) => (
                <option key={status}>{status}</option>
              ),
            )}
          </select>
        </Field>
        <Field label="Repair / maintenance notes">
          <textarea
            name="notes"
            defaultValue={visit.notes || ""}
            className={input}
          />
        </Field>
        <Field label="Total service cost, including parts (PHP)">
          <input
            name="cost"
            type="number"
            min="0"
            step="0.01"
            placeholder="Defaults to parts total"
            className={input}
          />
        </Field>
      </div>
      {parts.map((part, index) => (
        <div key={index} className="grid gap-3 sm:grid-cols-4">
          {(["description", "quantity", "unitCost"] as const).map((key) => (
            <Field
              key={key}
              label={
                {
                  description: "Part description",
                  quantity: "Quantity",
                  unitCost: "Unit cost (PHP)",
                }[key]
              }
            >
              <input
                required
                type={key === "description" ? "text" : "number"}
                min={key === "quantity" ? "1" : "0"}
                step={key === "quantity" ? "1" : "0.01"}
                className={input}
                value={part[key]}
                onChange={(event) => {
                  setPartsChanged(true);
                  setParts((previous) =>
                    previous.map((row, position) =>
                      position === index
                        ? { ...row, [key]: event.target.value }
                        : row,
                    ),
                  );
                }}
              />
            </Field>
          ))}
          <button
            type="button"
            className={`${secondary} self-end`}
            onClick={() => {
              setPartsChanged(true);
              setParts((previous) =>
                previous.filter((_, position) => position !== index),
              );
            }}
          >
            Remove part
          </button>
        </div>
      ))}
      <button
        type="button"
        className={secondary}
        onClick={() => {
          setPartsChanged(true);
          setParts((previous) => [
            ...previous,
            { description: "", quantity: "1", unitCost: "" },
          ]);
        }}
      >
        Add replacement part
      </button>
    </Form>
  );
}

export function ServiceWorkspace({
  api,
  company,
  canWrite,
}: {
  api: string;
  company: string;
  canWrite: boolean;
}) {
  const state = usePhase3Data<ServiceData>(api, company, "/service");
  const data = state.data;
  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <button
          className={secondary}
          disabled={state.loading || state.busy}
          onClick={state.refresh}
        >
          Refresh devices & service
        </button>
      </div>
      <Notice {...state} />
      {data && (
        <>
          <Panel title="Delivered medical devices & warranties">
            {canWrite && (
              <Form
                title="Register delivered serial number"
                disabled={state.busy}
                onSubmit={async (form) => {
                  const selected =
                    data.eligibleSerials[Number(formValue(form, "serial"))];
                  if (!selected) return;
                  await state.run(
                    "/service/assets",
                    {
                      deliveryId: selected.deliveryId,
                      productId: selected.productId,
                      serialNumber: selected.serialNumber,
                      intervalMonths: Number(formValue(form, "interval")),
                      ...(formValue(form, "warranty")
                        ? { warrantyUntil: formValue(form, "warranty") }
                        : {}),
                    },
                    "Device registered with warranty and preventive maintenance schedule.",
                  );
                }}
              >
                <div className="grid gap-4 md:grid-cols-3">
                  <Field label="Verified delivered serial">
                    <select required name="serial" className={input}>
                      <option value="">Select delivered device</option>
                      {data.eligibleSerials.map((record, index) => (
                        <option
                          key={`${record.deliveryId}-${record.serialNumber}`}
                          value={index}
                        >
                          {record.serialNumber} · {record.sku} ·{" "}
                          {record.customerName} · {record.delNumber}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Warranty expires">
                    <input name="warranty" type="date" className={input} />
                  </Field>
                  <Field label="Preventive maintenance interval (months)">
                    <input
                      required
                      name="interval"
                      type="number"
                      min="1"
                      max="120"
                      defaultValue="6"
                      className={input}
                    />
                  </Field>
                </div>
              </Form>
            )}
            <div className="mt-5">
              <DataTable
                rows={data.assets.map((asset) => ({
                  ...asset,
                  product: `${asset.product?.sku || ""} · ${asset.product?.name || ""}`,
                  customer: asset.customer?.name,
                  warranty: date(asset.warrantyUntil),
                  nextMaintenance: date(asset.nextMaintenanceAt),
                }))}
                columns={[
                  "serialNumber",
                  "product",
                  "customer",
                  "warranty",
                  "warrantyStatus",
                  "nextMaintenance",
                  "status",
                ]}
                searchLabel="Search devices and serial numbers"
              />
            </div>
          </Panel>
          <Panel title="Preventive maintenance & repair logs">
            {canWrite && (
              <Form
                title="Schedule maintenance or repair"
                disabled={state.busy}
                onSubmit={async (form) => {
                  await state.run(
                    "/service/visits",
                    {
                      assetId: formValue(form, "assetId"),
                      type: formValue(form, "type"),
                      dueDate: formValue(form, "due"),
                      technician: formValue(form, "technician"),
                      notes: formValue(form, "notes"),
                    },
                    "Service visit scheduled.",
                  );
                }}
              >
                <div className="grid gap-4 md:grid-cols-3">
                  <Field label="Device">
                    <select required name="assetId" className={input}>
                      <option value="">Select device</option>
                      {data.assets.map((asset) => (
                        <option value={asset.id} key={asset.id}>
                          {asset.serialNumber} · {asset.product?.name} ·{" "}
                          {asset.customer?.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Service type">
                    <select name="type" className={input}>
                      <option value="PM">Preventive maintenance</option>
                      <option value="REPAIR">Repair</option>
                    </select>
                  </Field>
                  <Field label="Due date">
                    <input required name="due" type="date" className={input} />
                  </Field>
                  <Field label="Assigned technician">
                    <input required name="technician" className={input} />
                  </Field>
                  <Field label="Visit notes">
                    <textarea name="notes" className={input} />
                  </Field>
                </div>
              </Form>
            )}
            <div className="mt-5 space-y-4">
              {data.visits.map((visit) => (
                <div key={visit.id} className="rounded-xl border p-4">
                  <p className="font-semibold">
                    {visit.number} · {visit.asset?.serialNumber} · {visit.type}{" "}
                    · {visit.status}
                  </p>
                  <p className="my-2 text-sm text-slate-600">
                    Due {date(visit.dueDate)} · {visit.technician} ·{" "}
                    {money(visit.cost)}
                  </p>
                  {visit.notes && (
                    <p className="mb-3 whitespace-pre-wrap text-sm">
                      {visit.notes}
                    </p>
                  )}
                  {!!visit.parts?.length && (
                    <details className="mb-3 rounded-lg border p-3">
                      <summary className="cursor-pointer text-sm font-semibold">
                        Recorded service parts
                      </summary>
                      <DataTable
                        rows={visit.parts}
                        columns={["description", "quantity", "unitCost"]}
                      />
                    </details>
                  )}
                  {canWrite &&
                    !["COMPLETED", "CANCELLED"].includes(visit.status) && (
                      <VisitUpdate
                        visit={visit}
                        busy={state.busy}
                        save={(id, body) =>
                          state.run(
                            `/service/visits/${id}/status`,
                            body,
                            "Service log saved. Completed maintenance updates the next due date.",
                          )
                        }
                      />
                    )}
                </div>
              ))}
              {!data.visits.length && (
                <p className="text-sm text-slate-500">
                  No service visits scheduled.
                </p>
              )}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

type OcrDocument = {
  id: number;
  originalName: string;
  mimeType: string;
  status: string;
  createdAt: string;
};
type Conversation = {
  question: string;
  answer: string;
  sources: unknown;
  generatedAt: string;
};
export function AiWorkspace({
  api,
  company,
  user,
  onOpenFinance,
}: {
  api: string;
  company: string;
  user?: ErpUser;
  onOpenFinance?: () => void;
}) {
  const roles = user?.modules?.erpRoles || [];
  const canQuery = hasPhase3Access(user, company, "ai");
  const canOcr =
    user?.role === "Super Admin" ||
    (canQuery &&
      user?.modules?.ai_docs === true &&
      roles.some((role) =>
        ["Management", "Purchasing", "Importation", "Finance"].includes(role),
      ));
  const [history, setHistory] = useState<Conversation[]>([]);
  const [documents, setDocuments] = useState<OcrDocument[]>([]);
  const [extracted, setExtracted] = useState<unknown>(null);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = async <T,>(
    path: string,
    body?: unknown,
  ): Promise<T | undefined> => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      return await phase3Request<T>(api, company, path, body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "AI request failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-5">
      <Notice error={error} />
      {canQuery && (
        <Panel title="Executive AI assistant">
          <p className="mb-4 text-sm text-slate-500">
            Ask about this company’s inventory, shipments, finance or service.
            Answers use only reports your role can access and include source
            references.
          </p>
          <div
            aria-live="polite"
            className="mb-4 max-h-[32rem] space-y-4 overflow-auto"
          >
            {!history.length && <div className="phase3-assistant-empty">
              <span aria-hidden="true">✧</span>
              <h3>Your company, in context</h3>
              <p>Ask a question to explore the records and reports available to your role.</p>
            </div>}
            {history.map((message, index) => (
              <article key={index} className="space-y-3">
                <p className="rounded-xl bg-cyan-50 p-4 font-semibold">
                  {message.question}
                </p>
                <div className="rounded-xl border p-4">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {message.answer}
                  </p>
                  <details className="mt-3 text-xs text-slate-500">
                    <summary className="cursor-pointer">
                      Sources · {date(message.generatedAt)}
                    </summary>
                    <pre className="mt-2 whitespace-pre-wrap">
                      {textValue(message.sources)}
                    </pre>
                  </details>
                </div>
              </article>
            ))}
          </div>
          <Form
            title="Ask a question"
            disabled={busy}
            button="Ask assistant"
            onSubmit={async (form) => {
              const question = formValue(form, "question");
              const result = await request<{
                answer: string;
                sources: unknown;
                generatedAt: string;
              }>("/ai/query", { question });
              if (result) {
                setHistory((previous) => [
                  ...previous,
                  { question, ...result },
                ]);
                form.reset();
              }
            }}
          >
            <Field label="Your question">
              <textarea
                required
                name="question"
                maxLength={2000}
                rows={3}
                className={input}
                placeholder="Which products are likely to need replenishment next month?"
              />
            </Field>
          </Form>
        </Panel>
      )}
      {canOcr && (
        <Panel
          title="Invoice OCR · staff review required"
          actions={
            <button
              className={secondary}
              disabled={busy}
              onClick={async () => {
                const result = await request<
                  OcrDocument[] | { documents: OcrDocument[] }
                >("/ai/documents");
                if (result)
                  setDocuments(
                    Array.isArray(result) ? result : result.documents,
                  );
              }}
            >
              Load uploaded invoices & receipts
            </button>
          }
        >
          <p className="mb-4 text-sm text-slate-500">
            Select an indexed invoice or receipt from the existing document
            workspace. Extracted details stay provisional until staff verify the
            source.
          </p>
          <Form
            title="Read invoice or receipt"
            disabled={busy}
            button="Extract for review"
            onSubmit={async (form) => {
              const result = await request<{ extracted: unknown }>("/ai/ocr", {
                documentId: Number(formValue(form, "documentId")),
              });
              if (result) {
                setExtracted(result.extracted);
                setReviewed(false);
              }
            }}
          >
            <Field label="Uploaded document">
              <select required name="documentId" className={input}>
                <option value="">Load and select document</option>
                {documents.map((document) => (
                  <option key={document.id} value={document.id}>
                    {document.originalName} · {document.status}
                  </option>
                ))}
              </select>
            </Field>
          </Form>
          {extracted !== null && (
            <div className="mt-5 space-y-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <strong>Verify these values against the original document</strong>
              <DataTable
                rows={asRows(
                  asObject(extracted).items || asObject(extracted).lineItems,
                )}
                columns={["description", "quantity", "unitPrice", "amount"]}
              />
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">
                {JSON.stringify(extracted, null, 2)}
              </pre>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(event) => setReviewed(event.target.checked)}
                />
                I have reviewed the extracted information against the source.
              </label>
              {onOpenFinance && (
                <button
                  className={primary}
                  disabled={!reviewed}
                  onClick={onOpenFinance}
                >
                  Open Finance to enter verified bill
                </button>
              )}
              <p className="text-xs text-amber-900">
                Review does not create or post accounting entries. Enter
                verified information in the bill form before requesting
                approval.
              </p>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
