import { DataTable, Notice } from './shared';
import { asObject, asRows, date, money, secondary, usePhase3Data } from './api';
import type { Balances, JsonRow } from './api';

export function CustomerFinanceBalance({
  api,
  company,
  customerId,
}: {
  api: string;
  company: string;
  customerId: string;
}) {
  const state = usePhase3Data<Balances>(
    api,
    company,
    `/balances?direction=AR&partyId=${encodeURIComponent(customerId)}`,
  );
  return (
    <section className="mt-5 rounded-xl border border-cyan-200 bg-cyan-50 p-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="font-bold text-cyan-950">Finance receivables</h4>
        <button
          className={secondary}
          disabled={state.loading}
          onClick={state.refresh}
        >
          Refresh
        </button>
      </div>
      <Notice error={state.error} loading={state.loading} />
      {state.data && (
        <>
          <p className="my-3 text-xl font-bold text-cyan-900">
            {money(state.data.totalOutstanding)} outstanding
          </p>
          <p className="mb-3 text-xs text-slate-500">
            From posted Phase 3 invoices, memos and payment allocations.
            Separate from the legacy customer balance.
          </p>
          <DataTable
            rows={state.data.documents.map((document) => ({
              ...document,
              due: date(document.dueDate),
              outstanding: money(document.outstanding),
            }))}
            columns={['number', 'due', 'outstanding']}
          />
        </>
      )}
    </section>
  );
}

export function ProductCostHistory({
  api,
  company,
  product,
  onClose,
}: {
  api: string;
  company: string;
  product: {
    id: number;
    sku: string;
    name: string;
    purchasePrice: number | string;
    landedCostReference?: number | string | null;
  };
  onClose: () => void;
}) {
  const state = usePhase3Data<unknown>(
    api,
    company,
    `/products/${product.id}/cost-history`,
  );
  const result = asObject(state.data);
  const history = Array.isArray(state.data)
    ? asRows(state.data)
    : asRows(result.history || result.records);
  const savedProduct = asObject(result.product);
  const reference =
    savedProduct.landedCostReference ??
    result.landedCostReference ??
    product.landedCostReference;
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cost-history-title"
    >
      <section className="max-h-[85vh] w-full max-w-4xl overflow-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h3 id="cost-history-title" className="text-xl font-bold">
              Approved landed cost history
            </h3>
            <p className="text-sm text-slate-500">
              {product.sku} · {product.name}
            </p>
          </div>
          <button autoFocus className={secondary} onClick={onClose}>
            Close
          </button>
        </div>
        <Notice error={state.error} loading={state.loading} />
        <div className="my-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg bg-emerald-50 p-4">
            <p className="text-xs text-slate-600">Manual cost price</p>
            <strong>{money(product.purchasePrice)}</strong>
          </div>
          <div className="rounded-lg bg-cyan-50 p-4">
            <p className="text-xs text-slate-600">
              Latest Finance-approved landed unit cost
            </p>
            <strong>
              {reference === null || reference === undefined
                ? 'Not approved yet'
                : money(reference, 6)}
            </strong>
          </div>
        </div>
        <p className="mb-4 text-xs text-slate-500">
          Finance approval records a separate base-cost reference and audit
          history. Manual cost price and customer tier overrides remain
          independent.
        </p>
        <DataTable
          rows={history.map((record: JsonRow) => ({
            ...record,
            approved: date(record.createdAt),
            shipment:
              asObject(record.shipment).shipmentNumber || record.shipmentId,
            landedCost:
              asObject(record.landedCost).number || record.landedCostId,
            unitCost: money(record.unitCost, 6),
          }))}
          columns={[
            'approved',
            'shipment',
            'landedCost',
            'quantity',
            'unitCost',
            'approvedBy',
          ]}
        />
      </section>
    </div>
  );
}
