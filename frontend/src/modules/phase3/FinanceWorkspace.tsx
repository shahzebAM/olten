import { useRef, useState } from "react";
import type { ErpUser } from "../../lib/phase3Access";
import { hasPhase3Access } from "../../lib/phase3Access";
import { DataTable, Field, Form, Notice, Panel, PartySelect } from "./shared";
import {
  asObject,
  asRows,
  date,
  formValue,
  input,
  money,
  primary,
  secondary,
  textValue,
  today,
  usePhase3Data,
} from "./api";
import type { Balances, FinanceDocument, JsonRow, Party, Product } from "./api";

type ShipmentLine = {
  id: string;
  shippedQty: number;
  purchaseOrderItem?: {
    productId: number;
    sku: string;
    productName: string;
    unitPrice?: string;
  };
};
type Shipment = { id: string; shipmentNumber: string; items: ShipmentLine[] };
type Delivery = {
  id: string;
  delNumber: string;
  status: string;
  pods: unknown[];
  sources: { sourceType: string; documentNumber: string }[];
  order?: { customer?: Party };
  customer?: Party;
};
type Overview = {
  landedCosts: JsonRow[];
  documents: FinanceDocument[];
  payments: JsonRow[];
  paymentRequests: JsonRow[];
  shipments: Shipment[];
  deliveries: Delivery[];
  customers: Party[];
  suppliers: { id: string; name?: string; legalName?: string }[];
  products: Product[];
};
type Expense = {
  category: string;
  description: string;
  amount: string;
  currency: string;
  exchangeRate: string;
};
type ItemCost = {
  shipmentLineId: string;
  quantity: number;
  unitPrice: string;
  currency: string;
  exchangeRate: string;
  weight: string;
  volume: string;
};
type Run = (
  endpoint: string,
  body: unknown,
  message: string,
) => Promise<boolean>;
const grid = "grid gap-4 md:grid-cols-3";

function LandedCostForm({
  shipments,
  run,
  busy,
}: {
  shipments: Shipment[];
  run: Run;
  busy: boolean;
}) {
  const [shipmentId, setShipmentId] = useState("");
  const [items, setItems] = useState<ItemCost[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const shipment = shipments.find((record) => record.id === shipmentId);
  const updateItem = (index: number, key: keyof ItemCost, value: string) =>
    setItems((previous) =>
      previous.map((item, position) =>
        position === index ? { ...item, [key]: value } : item,
      ),
    );
  return (
    <Form
      title="Calculate provisional landed cost"
      disabled={busy}
      button="Calculate allocation"
      onSubmit={async (form) => {
        await run(
          "/landed-costs",
          {
            shipmentId,
            allocationMethod: formValue(form, "allocationMethod"),
            items: items.map(({ weight, volume, ...item }) => ({
              ...item,
              ...(weight ? { weight } : {}),
              ...(volume ? { volume } : {}),
            })),
            expenses,
          },
          "Provisional allocation calculated. Review it before Finance approval.",
        );
      }}
    >
      <div className={grid}>
        <Field label="Shipment">
          <select
            required
            className={input}
            value={shipmentId}
            onChange={(event) => {
              const selected = shipments.find(
                (record) => record.id === event.target.value,
              );
              setShipmentId(event.target.value);
              setItems(
                (selected?.items || []).map((line) => ({
                  shipmentLineId: line.id,
                  quantity: line.shippedQty,
                  unitPrice: String(line.purchaseOrderItem?.unitPrice || ""),
                  currency: "PHP",
                  exchangeRate: "1",
                  weight: "",
                  volume: "",
                })),
              );
            }}
          >
            <option value="">Select shipment</option>
            {shipments.map((record) => (
              <option key={record.id} value={record.id}>
                {record.shipmentNumber}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Allocate expenses by">
          <select name="allocationMethod" className={input}>
            <option value="VALUE">Item value</option>
            <option value="WEIGHT">Weight</option>
            <option value="VOLUME">Volume</option>
            <option value="QUANTITY">Quantity</option>
          </select>
        </Field>
      </div>
      <p className="text-sm text-slate-500">
        Enter supplier invoice unit amounts and locked FX rates (PHP per foreign
        unit). Weight and volume are per unit, multiplied by shipment
        quantities. The server calculates the allocation and rounding.
      </p>
      {items.map((item, index) => (
        <div
          key={item.shipmentLineId}
          className="rounded-lg border border-slate-200 bg-white p-3"
        >
          <p className="mb-3 font-semibold">
            {shipment?.items[index]?.purchaseOrderItem?.sku} ·{" "}
            {shipment?.items[index]?.purchaseOrderItem?.productName} ·{" "}
            {item.quantity} units
          </p>
          <div className="grid gap-3 sm:grid-cols-5">
            <Field label="Unit invoice price">
              <input
                required
                type="number"
                step="0.000001"
                min="0"
                className={input}
                value={item.unitPrice}
                onChange={(event) =>
                  updateItem(index, "unitPrice", event.target.value)
                }
              />
            </Field>
            <Field label="Currency">
              <input
                required
                maxLength={3}
                className={input}
                value={item.currency}
                onChange={(event) =>
                  updateItem(
                    index,
                    "currency",
                    event.target.value.toUpperCase(),
                  )
                }
              />
            </Field>
            <Field label="PHP exchange rate">
              <input
                required
                type="number"
                step="0.000001"
                min="0.000001"
                className={input}
                value={item.exchangeRate}
                onChange={(event) =>
                  updateItem(index, "exchangeRate", event.target.value)
                }
              />
            </Field>
            <Field label="Unit weight (kg)">
              <input
                type="number"
                step="0.000001"
                min="0"
                className={input}
                value={item.weight}
                onChange={(event) =>
                  updateItem(index, "weight", event.target.value)
                }
              />
            </Field>
            <Field label="Unit volume (m³)">
              <input
                type="number"
                step="0.000001"
                min="0"
                className={input}
                value={item.volume}
                onChange={(event) =>
                  updateItem(index, "volume", event.target.value)
                }
              />
            </Field>
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Freight, insurance, duties and fees</h3>
        <button
          type="button"
          className={secondary}
          onClick={() =>
            setExpenses((previous) => [
              ...previous,
              {
                category: "FREIGHT",
                description: "",
                amount: "",
                currency: "PHP",
                exchangeRate: "1",
              },
            ])
          }
        >
          Add expense
        </button>
      </div>
      {expenses.map((expense, index) => (
        <div
          key={index}
          className="grid gap-3 rounded-lg border p-3 sm:grid-cols-3"
        >
          <Field label="Category">
            <select
              className={input}
              value={expense.category}
              onChange={(event) =>
                setExpenses((previous) =>
                  previous.map((row, position) =>
                    position === index
                      ? { ...row, category: event.target.value }
                      : row,
                  ),
                )
              }
            >
              {[
                "FREIGHT",
                "INSURANCE",
                "CUSTOMS_DUTY",
                "PORT",
                "BROKERAGE",
                "OTHER",
              ].map((category) => (
                <option key={category}>{category}</option>
              ))}
            </select>
          </Field>
          {(["description", "amount", "currency", "exchangeRate"] as const).map(
            (key) => (
              <Field
                key={key}
                label={key === "exchangeRate" ? "PHP exchange rate" : key}
              >
                <input
                  required
                  className={input}
                  type={
                    key === "amount" || key === "exchangeRate"
                      ? "number"
                      : "text"
                  }
                  step={key === "amount" ? "0.01" : "0.000001"}
                  min={key === "exchangeRate" ? "0.000001" : "0"}
                  maxLength={key === "currency" ? 3 : undefined}
                  value={expense[key]}
                  onChange={(event) =>
                    setExpenses((previous) =>
                      previous.map((row, position) =>
                        position === index
                          ? {
                              ...row,
                              [key]:
                                key === "currency"
                                  ? event.target.value.toUpperCase()
                                  : event.target.value,
                            }
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
            className={secondary}
            onClick={() =>
              setExpenses((previous) =>
                previous.filter((_, position) => position !== index),
              )
            }
          >
            Remove expense
          </button>
        </div>
      ))}
    </Form>
  );
}

function BillForm({
  suppliers,
  run,
  busy,
}: {
  suppliers: Party[];
  run: Run;
  busy: boolean;
}) {
  const [lines, setLines] = useState([
    {
      description: "",
      quantity: "1",
      unitPrice: "",
      taxRate: "0",
      accountCode: "5000",
    },
  ]);
  return (
    <Form
      title="Create supplier bill / import expense bill"
      disabled={busy}
      onSubmit={async (form) => {
        await run(
          "/bills",
          {
            supplierId: formValue(form, "supplierId"),
            invoiceReference: formValue(form, "reference"),
            currency: formValue(form, "currency"),
            exchangeRate: formValue(form, "rate"),
            issueDate: formValue(form, "issue"),
            dueDate: formValue(form, "due"),
            ...(formValue(form, "expense")
              ? { importExpenseId: formValue(form, "expense") }
              : {}),
            items: lines.map((line) => ({
              ...line,
              quantity: Number(line.quantity),
              taxRate: (Number(line.taxRate) / 100).toFixed(6),
            })),
          },
          "Draft bill created. Post it after review.",
        );
      }}
    >
      <div className={grid}>
        <Field label="Supplier">
          <PartySelect parties={suppliers} name="supplierId" />
        </Field>
        <Field label="Supplier invoice reference">
          <input required name="reference" className={input} />
        </Field>
        <Field label="Linked import expense ID (optional)">
          <input name="expense" className={input} />
        </Field>
        <Field label="Currency">
          <input
            required
            name="currency"
            defaultValue="PHP"
            maxLength={3}
            className={input}
          />
        </Field>
        <Field label="PHP exchange rate">
          <input
            required
            name="rate"
            defaultValue="1"
            min="0.000001"
            step="0.000001"
            type="number"
            className={input}
          />
        </Field>
        <Field label="Invoice date">
          <input
            required
            name="issue"
            defaultValue={today()}
            type="date"
            className={input}
          />
        </Field>
        <Field label="Due date">
          <input required name="due" type="date" className={input} />
        </Field>
      </div>
      {lines.map((line, index) => (
        <div
          key={index}
          className="grid gap-3 rounded-lg border bg-white p-3 sm:grid-cols-5"
        >
          {(
            [
              "description",
              "quantity",
              "unitPrice",
              "taxRate",
              "accountCode",
            ] as const
          ).map((key) => (
            <Field
              label={
                {
                  description: "Description",
                  quantity: "Quantity",
                  unitPrice: "Unit price",
                  taxRate: "VAT rate (%)",
                  accountCode: "Expense account code",
                }[key]
              }
              key={key}
            >
              <input
                required
                type={
                  ["quantity", "unitPrice", "taxRate"].includes(key)
                    ? "number"
                    : "text"
                }
                min={key === "quantity" ? "1" : "0"}
                max={key === "taxRate" ? "100" : undefined}
                step={
                  key === "quantity"
                    ? "1"
                    : key === "taxRate"
                      ? "0.0001"
                      : "0.000001"
                }
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
          {lines.length > 1 && (
            <button
              type="button"
              className={secondary}
              onClick={() =>
                setLines((previous) =>
                  previous.filter((_, position) => position !== index),
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
            {
              description: "",
              quantity: "1",
              unitPrice: "",
              taxRate: "0",
              accountCode: "5000",
            },
          ])
        }
      >
        Add bill line
      </button>
    </Form>
  );
}

function PaymentForm({
  direction,
  parties,
  documents,
  run,
  busy,
  requests,
}: {
  direction: string;
  parties: Party[];
  documents: FinanceDocument[];
  run: Run;
  busy: boolean;
  requests: JsonRow[];
}) {
  const [partyId, setPartyId] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [kind, setKind] = useState("payment");
  const token = useRef(crypto.randomUUID());
  const eligible = documents.filter(
    (record) =>
      record.partyId === partyId &&
      record.status === "POSTED" &&
      Number(record.outstanding) > 0 &&
      ["INVOICE", "BILL"].includes(record.kind),
  );
  const total = eligible.reduce(
    (sum, record) => sum + (Number(amounts[record.id]) || 0),
    0,
  );
  const allocations = () =>
    eligible
      .filter((record) => Number(amounts[record.id]) > 0)
      .map((record) => ({ documentId: record.id, amount: amounts[record.id] }));
  return (
    <Form
      title={
        direction === "AR"
          ? "Allocate customer payment"
          : "Allocate supplier payment / request approval"
      }
      disabled={busy}
      button={kind === "request" ? "Submit payment request" : "Record payment"}
      onSubmit={async (form) => {
        const payload =
          kind === "request"
            ? {
                supplierId: partyId,
                dueDate: formValue(form, "due"),
                notes: formValue(form, "notes"),
                allocations: allocations(),
              }
            : {
                direction,
                partyId,
                amount: formValue(form, "amount"),
                paidAt: formValue(form, "paidAt"),
                method: formValue(form, "method"),
                reference: formValue(form, "reference"),
                idempotencyKey: token.current,
                allocations: allocations(),
                ...(formValue(form, "requestId")
                  ? { paymentRequestId: formValue(form, "requestId") }
                  : {}),
              };
        if (
          await run(
            kind === "request" ? "/payment-requests" : "/payments",
            payload,
            kind === "request"
              ? "Payment request submitted for approval."
              : "Payment posted with allocations.",
          )
        ) {
          token.current = crypto.randomUUID();
          setAmounts({});
        }
      }}
    >
      <div className={grid}>
        <Field label={direction === "AR" ? "Customer" : "Supplier"}>
          <PartySelect
            parties={parties}
            value={partyId}
            onChange={(value) => {
              setPartyId(value);
              setAmounts({});
              token.current = crypto.randomUUID();
            }}
          />
        </Field>
        {direction === "AP" && (
          <Field label="Action">
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value)}
              className={input}
            >
              <option value="payment">Record approved payment</option>
              <option value="request">Submit payment request</option>
            </select>
          </Field>
        )}
      </div>
      {eligible.length ? (
        <div className="space-y-3">
          {eligible.map((record) => (
            <div
              key={record.id}
              className="grid items-center gap-3 sm:grid-cols-3"
            >
              <span>
                {record.number} · Due {date(record.dueDate)}
              </span>
              <span>Outstanding {money(record.outstanding)}</span>
              <Field label={`Allocate to ${record.number}`}>
                <input
                  className={input}
                  type="number"
                  min="0"
                  max={record.outstanding}
                  step="0.01"
                  value={amounts[record.id] || ""}
                  onChange={(event) =>
                    setAmounts((previous) => ({
                      ...previous,
                      [record.id]: event.target.value,
                    }))
                  }
                />
              </Field>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-500">
          Select a party with posted outstanding invoices or bills.
        </p>
      )}
      <p className="font-semibold">Allocated total: {money(total)}</p>
      {kind === "request" ? (
        <div className={grid}>
          <Field label="Requested payment due">
            <input required name="due" type="date" className={input} />
          </Field>
          <Field label="Request notes">
            <input name="notes" className={input} />
          </Field>
        </div>
      ) : (
        <div className={grid}>
          <Field label="Payment amount (PHP)">
            <input
              required
              name="amount"
              type="number"
              min="0.01"
              step="0.01"
              className={input}
            />
          </Field>
          <Field label="Payment date">
            <input
              required
              name="paidAt"
              type="date"
              defaultValue={today()}
              className={input}
            />
          </Field>
          <Field label="Method">
            <select name="method" className={input}>
              <option>Bank transfer</option>
              <option>Cash</option>
              <option>Cheque</option>
              <option>Other</option>
            </select>
          </Field>
          <Field label="Payment reference">
            <input required name="reference" className={input} />
          </Field>
          {direction === "AP" && (
            <Field label="Approved payment request">
              <select name="requestId" className={input}>
                <option value="">No linked request</option>
                {requests
                  .filter(
                    (record) =>
                      record.supplierId === partyId &&
                      record.status === "APPROVED",
                  )
                  .map((record) => (
                    <option key={String(record.id)} value={String(record.id)}>
                      {String(record.number)} · {money(record.amount)}
                    </option>
                  ))}
              </select>
            </Field>
          )}
        </div>
      )}
      <p className="text-xs text-slate-500">
        The entire payment must be allocated exactly. The server checks party,
        currency, approval and outstanding balances before posting.
      </p>
    </Form>
  );
}

export default function FinanceWorkspace({
  api,
  company,
  user,
  initialDeliveryId,
}: {
  api: string;
  company: string;
  user?: ErpUser;
  initialDeliveryId?: string;
}) {
  const finance = hasPhase3Access(user, company, "finance");
  const landed = hasPhase3Access(user, company, "landed");
  const write = hasPhase3Access(user, company, "finance", true);
  const landedWrite = hasPhase3Access(user, company, "landed", true);
  const [requestedTab, setTab] = useState(finance ? "documents" : "landed");
  const tab = !finance
    ? "landed"
    : requestedTab === "landed" && !landed
      ? "documents"
      : requestedTab;
  const [direction, setDirection] = useState("AR");
  const memoSubmission = useRef<{ signature: string; key: string } | null>(null);
  const state = usePhase3Data<Overview>(api, company, "/finance/overview");
  const balances = usePhase3Data<Balances>(
    api,
    company,
    `/balances?direction=${direction}`,
    finance,
  );
  const run: Run = async (endpoint, body, message) => {
    const ok = await state.run(endpoint, body, message);
    if (ok) balances.refresh();
    return ok;
  };
  const data = state.data;
  const suppliers = (data?.suppliers || []).map((supplier) => ({
    id: supplier.id,
    name: supplier.name || supplier.legalName || supplier.id,
  }));
  const partyNames = new Map(
    [...(data?.customers || []), ...suppliers].map((party) => [
      party.id,
      party.name,
    ]),
  );
  const roles = user?.modules?.erpRoles || [];
  const canApprove =
    user?.role === "Super Admin" ||
    roles.includes("Management") ||
    roles.includes("Finance");
  return (
    <div className="space-y-5">
      <div
        className="phase3-tabs flex flex-wrap gap-2"
        role="group"
        aria-label="Finance sections"
      >
        {[
          [landed, "landed", "Landed costs"],
          [finance, "documents", "Invoices & bills"],
          [finance, "balances", "Payments & aging"],
        ]
          .filter(([allowed]) => allowed)
          .map(([, id, title]) => (
            <button
              key={String(id)}
              className={tab === id ? primary : secondary}
              aria-pressed={tab === id}
              onClick={() => setTab(String(id))}
            >
              {title}
            </button>
          ))}
        <button
          className={`${secondary} ml-auto`}
          disabled={state.loading || state.busy}
          onClick={() => {
            state.refresh();
            balances.refresh();
          }}
        >
          Refresh
        </button>
      </div>
      <Notice {...state} />
      <Notice error={balances.error} />
      {data && tab === "landed" && landed && (
        <>
          <Panel title="Shipment landed costs">
            {landedWrite && (
              <LandedCostForm
                shipments={data.shipments || []}
                run={run}
                busy={state.busy}
              />
            )}
            <div className="mt-5 space-y-4">
              {data.landedCosts.map((record) => (
                <div key={String(record.id)} className="rounded-xl border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p>
                      <strong>{String(record.number)}</strong> ·{" "}
                      {String(record.status)} ·{" "}
                      {String(record.allocationMethod)} · {money(record.total)}
                    </p>
                    {record.status !== "FINAL" && landedWrite && canApprove && (
                      <button
                        className={primary}
                        disabled={state.busy}
                        onClick={() =>
                          void run(
                            `/landed-costs/${record.id}/finalize`,
                            {},
                            "Landed cost approved. Product reference costs and cost history updated.",
                          )
                        }
                      >
                        Finance approve final cost
                      </button>
                    )}
                  </div>
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-semibold text-cyan-700">
                      Review item allocation and source invoices
                    </summary>
                    <DataTable
                      rows={asRows(asObject(record.data).allocations)}
                      columns={[
                        "productId",
                        "quantity",
                        "baseCost",
                        "allocatedExpenses",
                        "unitCost",
                      ]}
                    />
                    <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs">
                      {JSON.stringify(record.data, null, 2)}
                    </pre>
                  </details>
                </div>
              ))}
              {!data.landedCosts.length && (
                <p className="mt-4 text-sm text-slate-500">
                  No landed costs calculated yet.
                </p>
              )}
            </div>
          </Panel>
        </>
      )}
      {data && tab === "documents" && finance && (
        <>
          <Panel title="Customer invoices & supplier bills">
            <p className="mb-4 text-sm text-slate-500">
              Customer invoices use confirmed POD quantities and an active Final
              Order. Posting creates balanced accounting entries. Existing
              manual inventory costs and tier prices stay independent.
            </p>
            {write && (
              <div className="space-y-4">
                <Form
                  title="Create invoice from confirmed POD + Final Order"
                  disabled={state.busy}
                  onSubmit={async (form) => {
                    await run(
                      "/invoices/from-delivery",
                      {
                        deliveryId: formValue(form, "deliveryId"),
                        dueDate: formValue(form, "dueDate"),
                      },
                      "Invoice draft prepared from confirmed delivered quantities.",
                    );
                  }}
                >
                  <div className={grid}>
                    <Field label="Delivered order">
                      <select
                        required
                        name="deliveryId"
                        defaultValue={initialDeliveryId || ""}
                        className={input}
                      >
                        <option value="">Select delivery</option>
                        {data.deliveries
                          .filter(
                            (record) =>
                              record.pods?.length &&
                              record.sources?.some(
                                (source) =>
                                  source.sourceType === "FO" ||
                                  source.documentNumber?.startsWith("FO"),
                              ),
                          )
                          .map((record) => (
                            <option key={record.id} value={record.id}>
                              {record.delNumber} ·{" "}
                              {record.customer?.name ||
                                record.order?.customer?.name}{" "}
                              · {record.status}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label="Invoice due date">
                      <input
                        required
                        name="dueDate"
                        type="date"
                        className={input}
                      />
                    </Field>
                  </div>
                </Form>
                <BillForm suppliers={suppliers} run={run} busy={state.busy} />
                <Form
                  title="Authorize credit or debit memo"
                  disabled={state.busy}
                  onSubmit={async (form) => {
                    const details = {
                      documentId: formValue(form, "documentId"),
                      kind: formValue(form, "kind"),
                      amount: formValue(form, "amount"),
                      reason: formValue(form, "reason").trim(),
                    };
                    const signature = JSON.stringify(details);
                    if (memoSubmission.current?.signature !== signature)
                      memoSubmission.current = { signature, key: crypto.randomUUID() };
                    const ok = await run(
                      "/memos",
                      {
                        ...details,
                        submissionKey: memoSubmission.current.key,
                      },
                      "Authorized memo posted and balances adjusted.",
                    );
                    if (ok) memoSubmission.current = null;
                  }}
                >
                  <div className={grid}>
                    <Field label="Original posted invoice / bill">
                      <select required name="documentId" className={input}>
                        <option value="">Select document</option>
                        {data.documents
                          .filter(
                            (record) =>
                              record.status === "POSTED" &&
                              ["INVOICE", "BILL"].includes(record.kind),
                          )
                          .map((record) => (
                            <option key={record.id} value={record.id}>
                              {record.number} · {partyNames.get(record.partyId)}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label="Memo type">
                      <select name="kind" className={input}>
                        <option value="CREDIT_MEMO">Credit memo</option>
                        <option value="DEBIT_MEMO">Debit memo</option>
                      </select>
                    </Field>
                    <Field label="Amount (PHP)">
                      <input
                        required
                        name="amount"
                        type="number"
                        min="0.01"
                        step="0.01"
                        className={input}
                      />
                    </Field>
                    <Field label="Authorization reason">
                      <input required name="reason" className={input} />
                    </Field>
                  </div>
                </Form>
              </div>
            )}
            <div className="mt-5">
              <DataTable
                rows={data.documents.map((record) => ({
                  ...record,
                  party: partyNames.get(record.partyId) || record.partyId,
                  due: date(record.dueDate),
                  amount: money(record.total),
                }))}
                columns={[
                  "number",
                  "kind",
                  "direction",
                  "party",
                  "status",
                  "due",
                  "amount",
                ]}
                searchLabel="Search invoices and bills"
                actions={(row) => (
                  <div className="space-y-2">
                    <details className="text-sm">
                      <summary className="cursor-pointer font-semibold text-cyan-700">
                        Review source & lines
                      </summary>
                      <pre className="mt-2 max-h-64 min-w-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs">
                        {JSON.stringify(row.data, null, 2)}
                      </pre>
                    </details>
                    {row.status === "DRAFT" && write ? (
                      <button
                        disabled={state.busy}
                        className={secondary}
                        onClick={() =>
                          void run(
                            `/documents/${row.id}/post`,
                            {},
                            "Document approved and posted to the ledger.",
                          )
                        }
                      >
                        Approve & post
                      </button>
                    ) : null}
                  </div>
                )}
              />
            </div>
          </Panel>
        </>
      )}
      {data && tab === "balances" && finance && (
        <>
          <Panel
            title="Receivables, payables & aging"
            actions={
              <select
                aria-label="Balance direction"
                value={direction}
                onChange={(event) => setDirection(event.target.value)}
                className={`${input} !w-auto`}
              >
                <option value="AR">Customer receivables</option>
                {(canApprove || roles.includes("Auditor")) && (
                  <option value="AP">Supplier payables</option>
                )}
              </select>
            }
          >
            <div className="phase3-balance-total">
              <small>
                {direction === "AR" ? "Customer receivables outstanding" : "Supplier payables outstanding"}
              </small>
              <strong>
                {balances.data ? money(balances.data.totalOutstanding) : balances.loading ? "Loading…" : "Unavailable"}
              </strong>
            </div>
            <DataTable
              rows={
                asRows(balances.data?.aging).length
                  ? asRows(balances.data?.aging)
                  : Object.entries(asObject(balances.data?.aging)).map(
                      ([bucket, amount]) => ({
                        bucket,
                        amount:
                          typeof amount === "object"
                            ? textValue(amount)
                            : money(amount),
                      }),
                    )
              }
              columns={
                asRows(balances.data?.aging).length
                  ? Object.keys(asRows(balances.data?.aging)[0])
                  : ["bucket", "amount"]
              }
            />
            <div className="mt-5">
              <DataTable
                rows={(balances.data?.documents || []).map((record) => ({
                  ...record,
                  party: partyNames.get(record.partyId),
                  due: date(record.dueDate),
                  balance: money(record.outstanding),
                }))}
                columns={["number", "party", "due", "balance"]}
                searchLabel="Search outstanding documents"
              />
            </div>
            {write && (
              <div className="mt-5">
                <PaymentForm
                  key={direction}
                  direction={direction}
                  parties={direction === "AR" ? data.customers : suppliers}
                  documents={balances.data?.documents || []}
                  run={run}
                  busy={state.busy}
                  requests={data.paymentRequests}
                />
              </div>
            )}
          </Panel>
          <Panel title="Supplier payment requests">
            <DataTable
              rows={data.paymentRequests.map((record) => ({
                ...record,
                supplier: partyNames.get(String(record.supplierId)),
                requested: money(record.amount),
              }))}
              columns={["number", "supplier", "requested", "dueDate", "status"]}
              actions={(record) =>
                record.status === "SUBMITTED" && write && canApprove ? (
                  <div className="flex gap-2">
                    <button
                      className={secondary}
                      disabled={state.busy}
                      onClick={() =>
                        void run(
                          `/payment-requests/${record.id}/decision`,
                          { decision: "APPROVED" },
                          "Payment request approved within your company limit.",
                        )
                      }
                    >
                      Approve
                    </button>
                    <button
                      className={secondary}
                      disabled={state.busy}
                      onClick={() => {
                        const reason = window.prompt(
                          "Reason for rejecting this request",
                        );
                        if (reason?.trim())
                          void run(
                            `/payment-requests/${record.id}/decision`,
                            { decision: "REJECTED", reason },
                            "Payment request rejected.",
                          );
                      }}
                    >
                      Reject
                    </button>
                  </div>
                ) : null
              }
            />
            <p className="mt-3 text-xs text-slate-500">
              Finance approval requires a configured company limit. Management
              and Super Admin approval follows the server authorization policy.
            </p>
          </Panel>
          <Panel title="Posted payments">
            <DataTable
              rows={data.payments.map((record) => ({
                ...record,
                party: partyNames.get(String(record.partyId)),
                paid: money(record.amount),
              }))}
              columns={[
                "number",
                "direction",
                "party",
                "paid",
                "paidAt",
                "method",
                "reference",
              ]}
              searchLabel="Search payment history"
            />
          </Panel>
        </>
      )}
    </div>
  );
}
