import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { expireApiSession, getApiAuthHeaders } from '../lib/apiSession';
import { useInvisibleScanner } from '../lib/useInvisibleScanner';

type View = 'warehouse' | 'orders' | 'delivery';
type Product = { id: number; sku: string; name: string; currentStock: number; expiryControlled: boolean; serialControlled: boolean };
type Bin = {
  id: string;
  warehouseId: string;
  code: string;
  building: string;
  floor: string;
  zone: string;
  rack: string;
  shelf: string;
  bin: string;
};
type Lot = {
  id: string;
  productId: number;
  product: Product;
  warehouseId: string;
  binId?: string;
  bin?: Bin;
  quantity: number;
  reservedQty: number;
  availableQty: number;
  status: string;
  effectiveStatus: string;
  batchNumber?: string;
  serialNumber?: string;
  expirationDate?: string;
};
type OrderLine = {
  id: string;
  productId: number;
  product: Product;
  quantity: number;
  reservedQty: number;
  incomingQty: number;
  deliveredQty: number;
  remainingQty: number;
  reservations: { id: string; quantity: number; dispatchedQty: number; releasedQty: number; lot: Lot }[];
  incoming: { id: string; quantity: number; shipmentLineId: string }[];
};
type Order = {
  id: string;
  soNumber: string;
  customerId: string;
  customer: { name: string };
  hospitalPoNumber: string;
  status: string;
  sourceOrderSlipId?: string;
  sourceOsNumber?: string;
  items: OrderLine[];
};
type DeliveryItem = {
  id: string;
  orderLineId: string;
  quantity: number;
  deliveredQty: number;
  product: Product;
  orderLine: OrderLine;
  picks: Pick[];
};
type Pick = { id: string; lotId: string; lot: Lot; quantity: number; verifiedQty: number; deliveryItemId: string };
type Pod = {
  id: string;
  recipient: string;
  receivedAt: string;
  receiptUrl?: string;
  documentId?: number;
  notes?: string;
  items: { deliveryItemId: string; quantity: number }[];
};
type Delivery = {
  id: string;
  delNumber: string;
  orderId: string;
  order: Order;
  customer?: { name: string };
  status: string;
  scheduledAt?: string;
  carrier?: string;
  trackingNumber?: string;
  notes?: string;
  items: DeliveryItem[];
  picks: Pick[];
  pods: Pod[];
  sources: { id: string; sourceType: string; documentNumber: string }[];
};
type CountLine = { id: string; lotId: string; lot: Lot; expectedQty: number; expectedReservedQty: number; countedQty?: number | null };
type Count = { id: string; adjNumber: string; status: string; notes?: string; lines: CountLine[] };
type Shipment = {
  id: string;
  shipmentNumber: string;
  status: string;
  items: {
    id: string;
    shippedQty: number;
    receivedQty?: number;
    purchaseOrderItem: { productId: number; sku: string; productName: string };
  }[];
};
type Overview = {
  products: Product[];
  warehouses: { id: number | string; name: string }[];
  bins: Bin[];
  lots: Lot[];
  orders: Order[];
  deliveries: Delivery[];
  cycleCounts: Count[];
  customers: { id: string; name: string }[];
  shipments: Shipment[];
  qcBalances: {
    receiptLineId: string;
    grnNumber: string;
    productId: number;
    sku: string;
    productName: string;
    quarantineQty: number;
    rejectedQty: number;
    acceptedUnplacedQty: number;
    batchNumber?: string;
    expirationDate?: string;
  }[];
};
type ReceivingReceipt = {
  id: string;
  poNumber: string;
  supplierName?: string;
  items: {
    id: string;
    productId: number;
    sku: string;
    productName: string;
    confirmedQty: number;
    batchNumber?: string;
    expirationDate?: string;
  }[];
};
const empty: Overview = {
  products: [],
  warehouses: [],
  bins: [],
  lots: [],
  orders: [],
  deliveries: [],
  cycleCounts: [],
  customers: [],
  shipments: [],
  qcBalances: [],
};
const input =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-cyan-600 focus:outline-none disabled:bg-slate-100';
const primary =
  'rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-50';
const secondary =
  'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50';
const panel = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm';
const date = (value?: string) => (value ? value.slice(0, 10) : '—');
const dispatchTime = (value?: string) => value ? new Date(value).toLocaleString('en-PH', {
  timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
}) : '—';
const labelProduct = (product: Product) => `${product.sku} · ${product.name}`;
const dataOf = (event: FormEvent<HTMLFormElement>) => new FormData(event.currentTarget);
const textOf = (data: FormData, name: string) => String(data.get(name) || '').trim();
const numberOf = (data: FormData, name: string) => Number(data.get(name));
function receiptLink(value?: string) {
  try {
    const url = new URL(value || '');
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1 text-xs font-semibold text-slate-600">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Status({ value }: { value: string }) {
  return <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{value}</span>;
}
function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">{children}</p>;
}
function SearchChoice<T extends { id: string | number }>({
  options,
  name,
  label,
  placeholder,
  optionLabel,
  onSelect,
}: {
  options: T[];
  name: string;
  label: string;
  placeholder: string;
  optionLabel: (option: T) => string;
  onSelect?: (option?: T) => void;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<T['id']>();
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const selected = options.find((option) => option.id === selectedId);
  const matches = options.filter((option) => optionLabel(option).toLowerCase().includes(query.trim().toLowerCase())).slice(0, 30);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.setCustomValidity(selected ? '' : 'Select an option from the search results.');
  }, [selected]);
  useEffect(() => {
    if (open) document.getElementById(`${id}-${highlighted}`)?.scrollIntoView({ block: 'nearest' });
  }, [id, open, highlighted]);
  useEffect(() => {
    const form = ref.current?.form;
    const reset = () => {
      setQuery('');
      setSelectedId(undefined);
      setHighlighted(0);
      setOpen(false);
    };
    form?.addEventListener('reset', reset);
    return () => form?.removeEventListener('reset', reset);
  }, []);
  function choose(option: T) {
    setQuery(optionLabel(option));
    setSelectedId(option.id);
    setHighlighted(0);
    setOpen(false);
    onSelect?.(option);
  }
  return (
    <div className="relative">
      <Field label={label}>
        <input
          ref={ref}
          required
          className={input}
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          aria-activedescendant={open && matches[highlighted] ? `${id}-${highlighted}` : undefined}
          aria-autocomplete="list"
          value={query}
          placeholder={placeholder}
          autoComplete="off"
          onChange={(event) => {
            setQuery(event.target.value);
            setSelectedId(undefined);
            setHighlighted(0);
            setOpen(true);
            onSelect?.(undefined);
          }}
          onFocus={(event) => {
            setHighlighted(0);
            setOpen(true);
            event.currentTarget.select();
          }}
          onBlur={() => setOpen(false)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setOpen(true);
              setHighlighted((index) =>
                matches.length ? (index + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length : 0,
              );
            } else if (event.key === 'Enter' && open && matches[highlighted]) {
              event.preventDefault();
              choose(matches[highlighted]);
            } else if (event.key === 'Escape') setOpen(false);
          }}
        />
      </Field>
      <input type="hidden" name={name} value={selected?.id ?? ''} />
      {open && (
        <div
          id={id}
          role="listbox"
          aria-label={`${label} search results`}
          className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-300 bg-white shadow-lg"
        >
          {matches.length ? (
            matches.map((option, index) => (
              <button
                key={option.id}
                id={`${id}-${index}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={index === highlighted}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
                className={`block w-full px-3 py-2 text-left text-sm hover:bg-cyan-50 ${index === highlighted ? 'bg-cyan-50' : ''}`}
              >
                {optionLabel(option)}
              </button>
            ))
          ) : (
            <p className="px-3 py-2 text-sm text-slate-500">No matches found.</p>
          )}
        </div>
      )}
    </div>
  );
}
function ProductChoice({
  products,
  name = 'productId',
  onSelect,
}: {
  products: Product[];
  name?: string;
  onSelect?: (product?: Product) => void;
}) {
  return (
    <SearchChoice
      options={products}
      name={name}
      label="Product"
      placeholder="Search SKU or product name"
      optionLabel={labelProduct}
      onSelect={onSelect}
    />
  );
}
function FacilityFields({ data, prefix = '', initial = 'MASTER' }: { data: Overview; prefix?: string; initial?: string }) {
  const [warehouseId, setWarehouseId] = useState(initial);
  return (
    <>
      <Field label="Facility">
        <select
          required
          name={`${prefix}warehouseId`}
          className={input}
          value={warehouseId}
          onChange={(event) => setWarehouseId(event.target.value)}
        >
          <option value="MASTER">Office / Master stock</option>
          {data.warehouses.map((warehouse) => (
            <option key={warehouse.id} value={String(warehouse.id)}>
              {warehouse.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Bin">
        <select name={`${prefix}binId`} key={warehouseId} className={input} defaultValue="">
          <option value="">Unassigned bin</option>
          {data.bins
            .filter((bin) => bin.warehouseId === warehouseId)
            .map((bin) => (
              <option key={bin.id} value={bin.id}>
                {bin.code}
              </option>
            ))}
        </select>
      </Field>
    </>
  );
}
function LotIdentity({ lot }: { lot: Lot }) {
  return (
    <span className="text-xs text-slate-500">
      {lot.warehouseId === 'MASTER' ? 'Office' : `Facility ${lot.warehouseId}`} · {lot.bin?.code || 'Unassigned bin'} · Batch{' '}
      {lot.batchNumber || '—'} · Serial {lot.serialNumber || '—'} · Expiry {date(lot.expirationDate)}
    </span>
  );
}

export default function FulfillmentModule({
  selectedCompany,
  API_BASE_URL,
  initialView = 'warehouse',
  canApprove,
  canWarehouse,
  canSales,
  embedded = false,
  onCreateOrderSlip,
  onOpenFinance,
  onBack,
}: {
  selectedCompany: string;
  API_BASE_URL: string;
  initialView?: View;
  canApprove: boolean;
  canWarehouse: boolean;
  canSales: boolean;
  embedded?: boolean;
  onCreateOrderSlip?: () => void;
  onOpenFinance?: (deliveryId: string) => void;
  onBack: () => void;
}) {
  const [view, setView] = useState<View>(initialView);
  const [data, setData] = useState<Overview>(empty);
  const [receiving, setReceiving] = useState<ReceivingReceipt[]>([]);
  const [receivingLineId, setReceivingLineId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(0);
  const [lotId, setLotId] = useState('');
  const [countId, setCountId] = useState('');
  const [countLineId, setCountLineId] = useState('');
  const [orderId, setOrderId] = useState('');
  const [deliveryId, setDeliveryId] = useState('');
  const [pickId, setPickId] = useState('');
  const [controlProduct, setControlProduct] = useState<Product>();
  const [selectedLots, setSelectedLots] = useState<string[]>([]);
  const [scannerMode, setScannerMode] = useState<'transfer' | 'count'>('transfer');
  const [transferScan, setTransferScan] = useState('');
  const [countScan, setCountScan] = useState('');
  const [pickScan, setPickScan] = useState('');
  const [incomingLineId, setIncomingLineId] = useState('');
  const api = useCallback(
    async <T,>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> => {
      const isFile = body instanceof FormData;
      const response = await fetch(`${API_BASE_URL}${path.startsWith('/importation/') ? path : `/fulfillment${path}`}`, {
        method,
        headers: {
          ...getApiAuthHeaders(),
          'x-company': selectedCompany,
          ...(body === undefined || isFile ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : isFile ? body : JSON.stringify(body),
        signal,
      });
      if (response.status === 401) expireApiSession();
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload && typeof payload === 'object' && 'message' in payload ? (payload as { message: unknown }).message : null;
        throw new Error(
          Array.isArray(message) ? message.join('; ') : typeof message === 'string' ? message : `Request failed (HTTP ${response.status}).`,
        );
      }
      return payload as T;
    },
    [API_BASE_URL, selectedCompany],
  );
  const load = useCallback(
    (signal?: AbortSignal) =>
      Promise.all([
        api<Overview>('/overview', 'GET', undefined, signal),
        canWarehouse ? api<ReceivingReceipt[]>('/importation/receiving-queue', 'GET', undefined, signal) : Promise.resolve([]),
      ])
        .then(([snapshot, receipts]) => {
          if (!signal?.aborted) {
            setData({
              ...snapshot,
              deliveries: snapshot.deliveries.map((item) => ({
                ...item,
                order: { ...item.order, customer: item.customer || item.order.customer },
                picks: item.items.flatMap((line) => line.picks || []),
              })),
            });
            setReceiving(receipts);
            setError('');
          }
        })
        .catch((failure: unknown) => {
          if (!signal?.aborted) setError(failure instanceof Error ? failure.message : 'Unable to load fulfillment records.');
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false);
        }),
    [api, canWarehouse],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  async function mutate(path: string, body: unknown, message: string, method = 'POST', after?: () => void) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(path, method, body);
      after?.();
      setNotice(message);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to save changes.');
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>, action: (values: FormData, form: HTMLFormElement) => void) {
    event.preventDefault();
    if (!busy) action(dataOf(event), event.currentTarget);
  }
  const lot = data.lots.find((item) => item.id === lotId);
  const count = data.cycleCounts.find((item) => item.id === countId);
  const countLine = count?.lines.find((item) => item.id === countLineId);
  const order = data.orders.find((item) => item.id === orderId);
  const delivery = data.deliveries.find((item) => item.id === deliveryId);
  const pick = delivery?.picks.find((item) => item.id === pickId);
  const receivingLine = receiving
    .flatMap((receipt) => receipt.items.map((item) => ({ ...item, receiptId: receipt.id, grnNumber: receipt.poNumber })))
    .find((item) => item.id === receivingLineId);
  const activeLot = view === 'delivery' ? pick?.lot : scannerMode === 'count' ? countLine?.lot : lot;
  useInvisibleScanner(
    (sku, raw) => {
      if (!activeLot || activeLot.product.sku.toLowerCase() !== sku.toLowerCase()) {
        setError('Scanned SKU does not match the selected stock line.');
        return true;
      }
      if (view === 'delivery') setPickScan(raw);
      else if (scannerMode === 'count') setCountScan(raw);
      else setTransferScan(raw);
      setError('');
      setNotice(`SKU ${sku} matched. Confirm the displayed bin, batch and serial before recording.`);
      return true;
    },
    !busy && !loading && (view === 'warehouse' || view === 'delivery'),
  );
  const filteredLots = data.lots.filter((item) =>
    `${labelProduct(item.product)} ${item.bin?.code || ''} ${item.batchNumber || ''} ${item.serialNumber || ''} ${item.effectiveStatus}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  const selectableOrders = data.orders.filter((item) => item.status !== 'Cancelled' && item.status !== 'Completed');
  const isIssued = delivery && ['Dispatched', 'PartiallyDelivered', 'Delivered'].includes(delivery.status);
  const canEditDelivery = delivery && !isIssued && delivery.status !== 'Cancelled';
  function print() {
    window.print();
  }
  function refresh() {
    setLoading(true);
    void load();
  }
  const Content = embedded ? 'div' : 'main';

  return (
    <div className={embedded ? 'text-slate-800' : 'min-h-screen bg-slate-50 text-slate-800'}>
      {view === 'delivery' && delivery && (
        <style>{`@media print { body * { visibility: hidden; } #fulfillment-print, #fulfillment-print * { visibility: visible; } #fulfillment-print { position: absolute; inset: 0; width: 100%; } .fulfillment-no-print { display: none !important; } }`}</style>
      )}
      <header hidden={embedded} className="border-b border-slate-200 bg-white px-5 py-6 sm:px-10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div>
            <button type="button" className="mb-3 text-sm font-semibold text-cyan-700" onClick={onBack}>
              ← Workspace
            </button>
            <h1 className="text-2xl font-bold">Warehouse, Customer Orders & Delivery</h1>
            <p className="mt-1 text-sm text-slate-500">{selectedCompany} · Stock is reserved at approval and issued at dispatch.</p>
          </div>
          <button
            type="button"
            className={secondary}
            disabled={busy || loading}
            onClick={refresh}
          >
            Refresh
          </button>
        </div>
      </header>
      <Content className={embedded ? 'space-y-5' : 'mx-auto max-w-7xl space-y-5 px-5 py-6 sm:px-10'}>
        <nav className="flex flex-wrap gap-2" aria-label="Fulfillment modules">
          {(
            [
              ['warehouse', 'Warehouse & Cycle Counts', canWarehouse && !embedded],
              ['orders', 'Customer Orders & Fulfillment', canSales],
              ['delivery', 'Delivery & POD', canSales || canWarehouse],
            ] as const
          )
            .filter(([, , allowed]) => allowed)
            .map(([tab, label]) => (
              <button
                type="button"
                key={tab}
                aria-current={view === tab ? 'page' : undefined}
                className={view === tab ? primary : secondary}
                onClick={() => {
                  setView(tab);
                  setError('');
                  setNotice('');
                }}
              >
                {label}
              </button>
            ))}
          {embedded && <button type="button" className={secondary} disabled={busy || loading} onClick={refresh}>Refresh</button>}
        </nav>
        {error && (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            {notice}
          </div>
        )}
        {loading && <p role="status">Loading fulfillment records…</p>}
        <fieldset disabled={busy || loading} className="min-w-0 space-y-5 disabled:opacity-70">
          {view === 'warehouse' && canWarehouse && (
            <>
              <section className="grid grid-cols-2 gap-3 md:grid-cols-6">
                {['AVAILABLE', 'RESERVED', 'QUARANTINE', 'DAMAGED', 'EXPIRED', 'REJECTED'].map((status) => (
                  <div key={status} className={panel}>
                    <p className="text-xs font-semibold capitalize text-slate-500">{status.toLowerCase()}</p>
                    <p className="mt-2 text-2xl font-bold">
                      {data.lots.reduce(
                        (sum, item) =>
                          sum +
                          (status === 'RESERVED'
                            ? item.reservedQty
                            : status === 'AVAILABLE'
                              ? item.availableQty
                              : item.effectiveStatus === status
                                ? item.quantity
                                : 0),
                        0,
                      ) +
                        data.qcBalances.reduce(
                          (sum, item) =>
                            sum + (status === 'QUARANTINE' ? item.quarantineQty : status === 'REJECTED' ? item.rejectedQty : 0),
                          0,
                        )}
                    </p>
                  </div>
                ))}
              </section>
              <p className="text-sm text-slate-500">
                Balances below cover registered lots. Existing unassigned stock can be registered without increasing physical stock. Expiry
                is evaluated using the Philippine date.
              </p>
              <div className="grid gap-5 lg:grid-cols-2">
                <details className={panel}>
                  <summary className="cursor-pointer font-bold">Place QC-accepted goods in a bin</summary>
                  <form
                    className="mt-4 grid gap-3 sm:grid-cols-2"
                    onSubmit={(event) =>
                      submit(event, (values, form) => {
                        if (!receivingLine) return;
                        void mutate(
                          `/importation/receipts/${receivingLine.receiptId}/place`,
                          {
                            placements: [
                              {
                                receiptLineId: receivingLine.id,
                                warehouseId: textOf(values, 'warehouseId'),
                                binId: textOf(values, 'binId') || undefined,
                                quantity: numberOf(values, 'quantity'),
                                serialNumber: textOf(values, 'serialNumber') || undefined,
                              },
                            ],
                          },
                          'QC-accepted stock placed and registered in its destination bin.',
                          'POST',
                          () => {
                            form.reset();
                            setReceivingLineId('');
                          },
                        );
                      })
                    }
                  >
                    <Field label="Accepted GRN item">
                      <select
                        required
                        className={input}
                        value={receivingLineId}
                        onChange={(event) => setReceivingLineId(event.target.value)}
                      >
                        <option value="">Select accepted goods</option>
                        {receiving.flatMap((receipt) =>
                          receipt.items.map((item) => (
                            <option key={item.id} value={item.id}>
                              {receipt.poNumber} · {item.sku} · {item.confirmedQty} unplaced
                            </option>
                          )),
                        )}
                      </select>
                    </Field>
                    <FacilityFields data={data} />
                    <Field label="Quantity to place">
                      <input required type="number" name="quantity" min="1" max={receivingLine?.confirmedQty} step="1" className={input} />
                    </Field>
                    <Field label="Serial number (one unit per placement)">
                      <input
                        name="serialNumber"
                        className={input}
                        required={Boolean(data.products.find((product) => product.id === receivingLine?.productId)?.serialControlled)}
                      />
                    </Field>
                    {receivingLine && (
                      <p className="text-xs text-slate-500 sm:col-span-2">
                        {receivingLine.productName} · Batch {receivingLine.batchNumber || '—'} · Expiry {date(receivingLine.expirationDate)}
                        . Batch and expiry are retained from the GRN.
                      </p>
                    )}
                    <button className={primary}>Confirm bin placement</button>
                  </form>
                </details>
                <details className={panel}>
                  <summary className="cursor-pointer font-bold">Create a six-level bin</summary>
                  <form
                    className="mt-4 grid gap-3 sm:grid-cols-2"
                    onSubmit={(event) =>
                      submit(
                        event,
                        (values, form) =>
                          void mutate(
                            '/bins',
                            {
                              warehouseId: textOf(values, 'warehouseId'),
                              ...Object.fromEntries(
                                ['building', 'floor', 'zone', 'rack', 'shelf', 'bin'].map((key) => [key, textOf(values, key)]),
                              ),
                            },
                            'Bin created.',
                            'POST',
                            () => form.reset(),
                          ),
                      )
                    }
                  >
                    <Field label="Facility">
                      <select className={input} required name="warehouseId">
                        <option value="MASTER">Office / Master stock</option>
                        {data.warehouses.map((item) => (
                          <option key={item.id} value={String(item.id)}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {['building', 'floor', 'zone', 'rack', 'shelf', 'bin'].map((key, index) => (
                      <Field key={key} label={key[0].toUpperCase() + key.slice(1)}>
                        <input
                          className={input}
                          required
                          name={key}
                          placeholder={['WH1', 'F2', 'ZA', 'R03', 'S02', 'B04'][index]}
                          maxLength={30}
                          pattern="[A-Za-z0-9_]+"
                        />
                      </Field>
                    ))}
                    <button className={primary}>Create bin</button>
                  </form>
                </details>
                <details className={panel}>
                  <summary className="cursor-pointer font-bold">Product tracking controls</summary>
                  <form
                    className="mt-4 space-y-3"
                    onSubmit={(event) =>
                      submit(
                        event,
                        (values) =>
                          void mutate(
                            `/products/${numberOf(values, 'productId')}/controls`,
                            { expiryControlled: values.has('expiryControlled'), serialControlled: values.has('serialControlled') },
                            'Product tracking controls updated.',
                            'PATCH',
                          ),
                      )
                    }
                  >
                    <ProductChoice products={data.products} onSelect={setControlProduct} />
                    <div key={controlProduct?.id || 'blank'} className="flex flex-wrap gap-4">
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="expiryControlled" defaultChecked={controlProduct?.expiryControlled} /> Require batch
                        and expiry
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="serialControlled" defaultChecked={controlProduct?.serialControlled} /> Require a unique
                        serial
                      </label>
                    </div>
                    <p className="text-xs text-slate-500">
                      Register existing stock with the required metadata before reserving controlled products.
                    </p>
                    <button className={primary} disabled={!canApprove}>
                      Save controls
                    </button>
                    {!canApprove && (
                      <p className="text-xs text-slate-500">An administrator or warehouse approver can change product controls.</p>
                    )}
                  </form>
                </details>
                <details className={panel}>
                  <summary className="cursor-pointer font-bold">Register existing stock in a bin / batch</summary>
                  <form
                    className="mt-4 grid gap-3 sm:grid-cols-2"
                    onSubmit={(event) =>
                      submit(
                        event,
                        (values, form) =>
                          void mutate(
                            '/lots/register',
                            {
                              productId: numberOf(values, 'productId'),
                              warehouseId: textOf(values, 'warehouseId'),
                              binId: textOf(values, 'binId') || undefined,
                              quantity: numberOf(values, 'quantity'),
                              batchNumber: textOf(values, 'batchNumber') || undefined,
                              expirationDate: textOf(values, 'expirationDate') || undefined,
                              serialNumber: textOf(values, 'serialNumber') || undefined,
                              status: textOf(values, 'status'),
                            },
                            'Existing stock registered. Physical total is unchanged.',
                            'POST',
                            () => form.reset(),
                          ),
                      )
                    }
                  >
                    <ProductChoice products={data.products} />
                    <FacilityFields data={data} />
                    <Field label="Quantity">
                      <input required type="number" name="quantity" min="1" step="1" className={input} />
                    </Field>
                    <Field label="Batch number">
                      <input name="batchNumber" className={input} />
                    </Field>
                    <Field label="Expiry date">
                      <input name="expirationDate" type="date" className={input} />
                    </Field>
                    <Field label="Serial number (one unit)">
                      <input name="serialNumber" className={input} />
                    </Field>
                    <Field label="Stock condition">
                      <select name="status" className={input}>
                        {['AVAILABLE', 'QUARANTINE', 'DAMAGED', 'REJECTED'].map((status) => (
                          <option key={status}>{status}</option>
                        ))}
                      </select>
                    </Field>
                    <p className="text-xs text-slate-500 sm:col-span-2">
                      This assigns stock already on hand. Use existing Receiving for newly received goods.
                    </p>
                    <button className={primary}>Register stock</button>
                  </form>
                </details>
                <details className={panel}>
                  <summary className="cursor-pointer font-bold">Warehouse bin hierarchy ({data.bins.length})</summary>
                  <div className="mt-3 max-h-72 space-y-2 overflow-auto">
                    {data.bins.length ? (
                      data.bins.map((bin) => (
                        <div key={bin.id} className="rounded-lg border border-slate-200 p-3">
                          <p className="font-mono text-sm font-bold">{bin.code}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {bin.warehouseId === 'MASTER'
                              ? 'Office'
                              : data.warehouses.find((item) => String(item.id) === bin.warehouseId)?.name}{' '}
                            · {[bin.building, bin.floor, bin.zone, bin.rack, bin.shelf, bin.bin].join(' → ')}
                          </p>
                        </div>
                      ))
                    ) : (
                      <Empty>No bins yet.</Empty>
                    )}
                  </div>
                </details>
              </div>
              {data.qcBalances.some((line) => line.quarantineQty || line.rejectedQty || line.acceptedUnplacedQty) && (
                <details className={panel}>
                  <summary className="cursor-pointer font-bold">Receiving quarantine, rejected & accepted stock awaiting placement</summary>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b text-xs text-slate-500">
                          {['GRN / product', 'Batch / expiry', 'Quarantine', 'Rejected', 'Accepted, unplaced'].map((title) => (
                            <th key={title} className="px-2 py-3">
                              {title}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.qcBalances
                          .filter((line) => line.quarantineQty || line.rejectedQty || line.acceptedUnplacedQty)
                          .map((line) => (
                            <tr key={line.receiptLineId} className="border-b border-slate-100">
                              <td className="px-2 py-3">
                                {line.grnNumber} · {line.sku} · {line.productName}
                              </td>
                              <td className="px-2 py-3">
                                {line.batchNumber || '—'} · {date(line.expirationDate)}
                              </td>
                              <td className="px-2 py-3">{line.quarantineQty}</td>
                              <td className="px-2 py-3">{line.rejectedQty}</td>
                              <td className="px-2 py-3">{line.acceptedUnplacedQty}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
              <section className={panel}>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 className="font-bold">Bin / batch stock</h2>
                    <p className="mt-1 text-xs text-slate-500">
                      Select lots for a physical count, or select one row to transfer or change condition.
                    </p>
                  </div>
                  <Field label="Search stock">
                    <input
                      className={input}
                      value={filter}
                      onChange={(event) => {
                        setFilter(event.target.value);
                        setPage(0);
                      }}
                      placeholder="SKU, product, batch, serial or bin"
                    />
                  </Field>
                </div>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs text-slate-500">
                        {['Count', 'Product / location', 'Condition', 'On hand', 'Reserved', 'Available', ''].map((title, index) => (
                          <th className="px-2 py-3" key={index}>
                            {title}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLots.slice(page * 50, page * 50 + 50).map((item) => (
                        <tr key={item.id} className={`border-b border-slate-100 ${lotId === item.id ? 'bg-cyan-50' : ''}`}>
                          <td className="px-2 py-3">
                            <input
                              type="checkbox"
                              aria-label={`Count ${item.product.sku} ${item.batchNumber || item.id}`}
                              checked={selectedLots.includes(item.id)}
                              onChange={(event) =>
                                setSelectedLots(
                                  event.target.checked ? [...selectedLots, item.id] : selectedLots.filter((id) => id !== item.id),
                                )
                              }
                            />
                          </td>
                          <td className="px-2 py-3">
                            <p className="font-semibold">{labelProduct(item.product)}</p>
                            <LotIdentity lot={item} />
                          </td>
                          <td className="px-2 py-3">
                            <Status value={item.effectiveStatus} />
                          </td>
                          <td className="px-2 py-3">{item.quantity}</td>
                          <td className="px-2 py-3">{item.reservedQty}</td>
                          <td className="px-2 py-3">{item.availableQty}</td>
                          <td className="px-2 py-3">
                            <button
                              type="button"
                              className={secondary}
                              onClick={() => {
                                setLotId(item.id);
                                setTransferScan('');
                                setScannerMode('transfer');
                              }}
                            >
                              Select lot
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!filteredLots.length && <Empty>No registered lots match this search.</Empty>}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <button type="button" className={secondary} disabled={page === 0} onClick={() => setPage(page - 1)}>
                      Previous
                    </button>
                    <span className="text-xs">
                      {filteredLots.length ? page * 50 + 1 : 0}–{Math.min((page + 1) * 50, filteredLots.length)} of {filteredLots.length}
                    </span>
                    <button
                      type="button"
                      className={secondary}
                      disabled={(page + 1) * 50 >= filteredLots.length}
                      onClick={() => setPage(page + 1)}
                    >
                      Next
                    </button>
                  </div>
                  <button
                    type="button"
                    disabled={!selectedLots.length}
                    className={primary}
                    onClick={() =>
                      void mutate(
                        '/cycle-counts',
                        { lotIds: selectedLots, notes: 'Physical warehouse cycle count' },
                        'Cycle count created.',
                        'POST',
                        () => setSelectedLots([]),
                      )
                    }
                  >
                    Start count for {selectedLots.length} selected lots
                  </button>
                </div>
              </section>
              {lot && (
                <section className={panel}>
                  <h2 className="font-bold">Selected lot: {labelProduct(lot.product)}</h2>
                  <LotIdentity lot={lot} />
                  <div className="mt-4 grid gap-5 lg:grid-cols-2">
                    <form
                      className="space-y-3"
                      onSubmit={(event) =>
                        submit(
                          event,
                          (values) =>
                            void mutate(`/lots/${lot.id}/status`, { status: textOf(values, 'status') }, 'Stock condition updated.'),
                        )
                      }
                    >
                      <Field label="New stock condition">
                        <select key={`${lot.id}-${lot.status}`} name="status" defaultValue={lot.status} className={input}>
                          {['AVAILABLE', 'QUARANTINE', 'DAMAGED', 'REJECTED'].map((status) => (
                            <option key={status}>{status}</option>
                          ))}
                        </select>
                      </Field>
                      <button className={secondary}>Change condition</button>
                    </form>
                    <form
                      key={lot.id}
                      className="grid gap-3 sm:grid-cols-2"
                      onSubmit={(event) =>
                        submit(
                          event,
                          (values) =>
                            void mutate(
                              '/transfers',
                              {
                                lotId: lot.id,
                                quantity: numberOf(values, 'quantity'),
                                destinationWarehouseId: textOf(values, 'destinationwarehouseId'),
                                destinationBinId: textOf(values, 'destinationbinId') || undefined,
                                scan: transferScan,
                              },
                              'Stock transferred. Ledger updated.',
                              'POST',
                              () => setTransferScan(''),
                            ),
                        )
                      }
                    >
                      <FacilityFields data={data} prefix="destination" initial={lot.warehouseId} />
                      <Field label="Transfer quantity">
                        <input
                          required
                          name="quantity"
                          type="number"
                          min="1"
                          step="1"
                          max={lot.quantity - lot.reservedQty}
                          className={input}
                        />
                      </Field>
                      <Field label="Scan product sticker">
                        <input
                          required
                          className={input}
                          value={transferScan}
                          onFocus={() => setScannerMode('transfer')}
                          onChange={(event) => setTransferScan(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') event.preventDefault();
                          }}
                          placeholder="Scan SKU, then confirm transfer"
                        />
                      </Field>
                      <p className="text-xs text-slate-500 sm:col-span-2">
                        Confirm the selected batch, serial and source bin before moving this stock.
                      </p>
                      <button className={primary}>Confirm transfer</button>
                    </form>
                  </div>
                </section>
              )}
              <section className={panel}>
                <h2 className="font-bold">Cycle counts & recount approvals</h2>
                <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_2fr]">
                  <div className="space-y-2">
                    {data.cycleCounts.length ? (
                      data.cycleCounts.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={`w-full rounded-lg border p-3 text-left ${countId === item.id ? 'border-cyan-600 bg-cyan-50' : 'border-slate-200'}`}
                          onClick={() => {
                            setCountId(item.id);
                            setCountLineId('');
                            setCountScan('');
                          }}
                        >
                          <span className="block text-sm font-bold">{item.adjNumber}</span>
                          <Status value={item.status} />
                        </button>
                      ))
                    ) : (
                      <Empty>Select registered lots above to start a count.</Empty>
                    )}
                  </div>
                  {count ? (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        {count.lines.map((line) => (
                          <button
                            key={line.id}
                            type="button"
                            className={`block w-full rounded-lg border p-3 text-left ${countLineId === line.id ? 'border-cyan-600 bg-cyan-50' : 'border-slate-200'}`}
                            onClick={() => {
                              setCountLineId(line.id);
                              setCountScan('');
                              setScannerMode('count');
                            }}
                          >
                            <p className="text-sm font-semibold">{labelProduct(line.lot.product)}</p>
                            <LotIdentity lot={line.lot} />
                            <p className="mt-2 text-sm">
                              Expected {line.expectedQty} · Reserved {line.expectedReservedQty} · Counted {line.countedQty ?? '—'}
                              {line.countedQty != null ? ` · Variance ${line.countedQty - line.expectedQty}` : ''}
                            </p>
                          </button>
                        ))}
                      </div>
                      {countLine && ['Draft', 'RecountRequired'].includes(count.status) && (
                        <form
                          key={countLine.id}
                          className="grid gap-3 sm:grid-cols-2"
                          onSubmit={(event) =>
                            submit(
                              event,
                              (values) =>
                                void mutate(
                                  `/cycle-counts/${count.id}/lines/${countLine.id}`,
                                  { countedQty: numberOf(values, 'countedQty'), scan: countScan },
                                  'Physical count recorded.',
                                  'PATCH',
                                  () => setCountScan(''),
                                ),
                            )
                          }
                        >
                          <Field label="Physical quantity">
                            <input
                              className={input}
                              required
                              type="number"
                              min="0"
                              step="1"
                              name="countedQty"
                              defaultValue={countLine.countedQty ?? ''}
                            />
                          </Field>
                          <Field label="Scan counted product">
                            <input
                              className={input}
                              required
                              value={countScan}
                              onFocus={() => setScannerMode('count')}
                              onChange={(event) => setCountScan(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') event.preventDefault();
                              }}
                            />
                          </Field>
                          <button className={primary}>Record count</button>
                        </form>
                      )}
                      {['Draft', 'RecountRequired'].includes(count.status) && (
                        <button
                          type="button"
                          className={primary}
                          onClick={() => void mutate(`/cycle-counts/${count.id}/submit`, {}, 'Cycle count submitted for approval.')}
                        >
                          Submit completed count
                        </button>
                      )}
                      {count.status === 'Submitted' && canApprove && (
                        <div className="space-y-3">
                          <button
                            type="button"
                            className={primary}
                            onClick={() =>
                              void mutate(`/cycle-counts/${count.id}/approve`, {}, 'Count approved. ADJ stock ledger entries created.')
                            }
                          >
                            Approve adjustment
                          </button>
                          <form
                            className="flex gap-2"
                            onSubmit={(event) =>
                              submit(
                                event,
                                (values) =>
                                  void mutate(
                                    `/cycle-counts/${count.id}/recount`,
                                    { reason: textOf(values, 'reason') },
                                    'Recount requested. Count quantities must be recorded again.',
                                  ),
                              )
                            }
                          >
                            <input required name="reason" aria-label="Recount reason" placeholder="Reason for recount" className={input} />
                            <button className={secondary}>Request recount</button>
                          </form>
                        </div>
                      )}
                      {count.status === 'Submitted' && !canApprove && (
                        <p className="text-xs text-slate-500">An administrator must approve or request a recount.</p>
                      )}
                    </div>
                  ) : (
                    <Empty>Select a cycle count to record or review quantities.</Empty>
                  )}
                </div>
              </section>
            </>
          )}
          {view === 'orders' && canSales && (
            <>
              <section className={panel}>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="max-w-3xl">
                    <h2 className="font-bold">One Order Slip, one fulfillment record</h2>
                    <p className="mt-2 text-sm text-slate-500">
                      Create the order in Create Order Slip, use Approve & reserve, then generate your FO/P.O. or Packing List (PL).
                      Track reservations, partial deliveries and POD against that same order here.
                    </p>
                  </div>
                  {onCreateOrderSlip && (
                    <button type="button" className={primary} onClick={onCreateOrderSlip}>
                      Create Order Slip
                    </button>
                  )}
                </div>
              </section>
              <p className="text-sm text-slate-500">
                Order slips enter this tracker when approved and reserved in Create Order Slip or the O.S. Ledger. Incoming quantities are
                planned supply and become reservable only after receiving and QC.
              </p>
              <section className={panel}>
                <h2 className="font-bold">Customer order tracker</h2>
                <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_2fr]">
                  <div className="max-h-[36rem] space-y-2 overflow-auto">
                    {data.orders.length ? (
                      data.orders.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={`block w-full rounded-lg border p-3 text-left ${item.id === orderId ? 'border-cyan-600 bg-cyan-50' : 'border-slate-200'}`}
                          onClick={() => {
                            setOrderId(item.id);
                            setIncomingLineId('');
                          }}
                        >
                          <p className="text-sm font-bold">{item.soNumber}</p>
                          <p className="mb-2 text-xs text-slate-500">
                            {item.customer?.name}{item.sourceOsNumber ? ` · ${item.sourceOsNumber}` : ''}
                            {item.hospitalPoNumber ? ` · PO reference ${item.hospitalPoNumber}` : ''}
                          </p>
                          <Status value={item.status} />
                        </button>
                      ))
                    ) : (
                      <Empty>No customer orders yet. Approve & reserve an Order Slip to begin.</Empty>
                    )}
                  </div>
                  {order ? (
                    <div className="space-y-4">
                      <div>
                        <h3 className="font-bold">
                          {order.soNumber} · {order.customer?.name}
                        </h3>
                        <p className="mt-1 text-sm text-slate-500">
                          PO reference {order.hospitalPoNumber || '—'}
                          {order.sourceOsNumber ? ` · ${order.sourceOsNumber}` : order.sourceOrderSlipId ? ' · Linked to an approved order slip' : ''}
                        </p>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead>
                            <tr className="border-b text-xs text-slate-500">
                              {['Product', 'Ordered', 'Reserved', 'Incoming', 'Delivered', 'Remaining'].map((title) => (
                                <th key={title} className="px-2 py-3">
                                  {title}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {order.items.map((line) => (
                              <tr key={line.id} className="border-b border-slate-100">
                                <td className="px-2 py-3">{labelProduct(line.product)}</td>
                                <td className="px-2 py-3">{line.quantity}</td>
                                <td className="px-2 py-3">{line.reservedQty}</td>
                                <td className="px-2 py-3">{line.incomingQty}</td>
                                <td className="px-2 py-3">{line.deliveredQty}</td>
                                <td className="px-2 py-3">{line.remainingQty}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {!['Cancelled', 'Completed'].includes(order.status) && (
                        <>
                          <div className="flex flex-wrap gap-2">
                            {canApprove && (
                              <button
                                type="button"
                                className={primary}
                                onClick={() =>
                                  void mutate(
                                    `/orders/${order.id}/reserve`,
                                    {},
                                    'Available stock reserved in FEFO order. Any shortage remains open.',
                                  )
                                }
                              >
                                Approve / reserve available stock
                              </button>
                            )}
                            <button
                              type="button"
                              className={secondary}
                              onClick={() => {
                                if (window.confirm('Cancel this customer order and release its undelivered reservations?'))
                                  void mutate(
                                    `/orders/${order.id}/cancel`,
                                    {},
                                    'Customer order cancelled and eligible reservations released.',
                                  );
                              }}
                            >
                              Cancel order & release stock
                            </button>
                          </div>
                          <details className="rounded-lg border border-slate-200 p-3">
                            <summary className="cursor-pointer text-sm font-semibold">Link incoming shipment quantities</summary>
                            <form
                              className="mt-3 grid gap-3 sm:grid-cols-2"
                              onSubmit={(event) =>
                                submit(
                                  event,
                                  (values) =>
                                    void mutate(
                                      `/orders/${order.id}/incoming`,
                                      {
                                        orderLineId: textOf(values, 'orderLineId'),
                                        shipmentLineId: textOf(values, 'shipmentLineId'),
                                        quantity: numberOf(values, 'quantity'),
                                      },
                                      'Incoming shipment allocation updated.',
                                    ),
                                )
                              }
                            >
                              <Field label="Customer order item">
                                <select
                                  required
                                  className={input}
                                  name="orderLineId"
                                  value={incomingLineId}
                                  onChange={(event) => setIncomingLineId(event.target.value)}
                                >
                                  <option value="">Select product</option>
                                  {order.items.map((line) => (
                                    <option key={line.id} value={line.id}>
                                      {labelProduct(line.product)}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                              <Field label="Incoming shipment item">
                                <select required name="shipmentLineId" key={incomingLineId} className={input} defaultValue="">
                                  <option value="">Select matching shipment item</option>
                                  {data.shipments.flatMap((shipment) =>
                                    shipment.items
                                      .filter(
                                        (line) =>
                                          line.purchaseOrderItem.productId ===
                                          order.items.find((item) => item.id === incomingLineId)?.productId,
                                      )
                                      .map((line) => (
                                        <option key={line.id} value={line.id}>
                                          {shipment.shipmentNumber} · {line.purchaseOrderItem.sku} · {line.shippedQty} shipped
                                        </option>
                                      )),
                                  )}
                                </select>
                              </Field>
                              <Field label="Allocation quantity (0 releases the selected allocation)">
                                <input required name="quantity" type="number" min="0" step="1" className={input} />
                              </Field>
                              <button className={secondary}>Save incoming allocation</button>
                            </form>
                            <div className="mt-3 space-y-2">
                              {order.items.flatMap((line) =>
                                (line.incoming || []).map((allocation) => (
                                  <div
                                    key={allocation.id}
                                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3"
                                  >
                                    <p className="text-xs">
                                      {line.product.sku} ·{' '}
                                      {data.shipments.find((shipment) =>
                                        shipment.items.some((item) => item.id === allocation.shipmentLineId),
                                      )?.shipmentNumber || 'Previous shipment'}{' '}
                                      · {allocation.quantity} planned
                                    </p>
                                    <button
                                      type="button"
                                      className={secondary}
                                      onClick={() =>
                                        void mutate(
                                          `/orders/${order.id}/incoming`,
                                          { orderLineId: line.id, shipmentLineId: allocation.shipmentLineId, quantity: 0 },
                                          'Incoming shipment allocation released.',
                                        )
                                      }
                                    >
                                      Release incoming allocation
                                    </button>
                                  </div>
                                )),
                              )}
                            </div>
                          </details>
                          <DeliveryDraft
                            order={order}
                            onCreate={(items) =>
                              void mutate(
                                '/deliveries',
                                { orderId: order.id, items },
                                'Partial delivery created. Open Delivery & POD to prepare the FEFO picking list.',
                              )
                            }
                          />
                        </>
                      )}
                      {order.items.some((line) => line.reservations?.length) && (
                        <details className="rounded-lg border border-slate-200 p-3">
                          <summary className="cursor-pointer text-sm font-semibold">Reserved bins and batches</summary>
                          <div className="mt-3 space-y-2">
                            {order.items.flatMap((line) =>
                              (line.reservations || []).map((reservation) => (
                                <div key={reservation.id} className="border-b border-slate-100 py-2">
                                  <p className="text-sm font-semibold">
                                    {line.product.sku} · {reservation.quantity - reservation.dispatchedQty - reservation.releasedQty}{' '}
                                    reserved
                                  </p>
                                  <LotIdentity lot={reservation.lot} />
                                </div>
                              )),
                            )}
                          </div>
                        </details>
                      )}
                    </div>
                  ) : (
                    <Empty>Select a customer order to inspect allocations and balances.</Empty>
                  )}
                </div>
              </section>
            </>
          )}
          {view === 'delivery' && (canSales || canWarehouse) && (
            <>
              <details className={panel}>
                <summary className="cursor-pointer font-bold">Create a partial delivery from reserved stock</summary>
                <div className="mt-4 space-y-4">
                  <Field label="Customer order">
                    <select value={orderId} className={input} onChange={(event) => setOrderId(event.target.value)}>
                      <option value="">Select customer order</option>
                      {selectableOrders.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.soNumber} · {item.customer?.name} · {item.hospitalPoNumber}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {order && (
                    <DeliveryDraft
                      order={order}
                      onCreate={(items) => void mutate('/deliveries', { orderId: order.id, items }, 'Partial delivery created.')}
                    />
                  )}
                </div>
              </details>
              <section className={panel}>
                <h2 className="font-bold">Dispatch & proof of delivery</h2>
                <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_2fr]">
                  <div className="max-h-[42rem] space-y-2 overflow-auto">
                    {data.deliveries.length ? (
                      data.deliveries.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={`block w-full rounded-lg border p-3 text-left ${item.id === deliveryId ? 'border-cyan-600 bg-cyan-50' : 'border-slate-200'}`}
                          onClick={() => {
                            setDeliveryId(item.id);
                            setPickId('');
                            setPickScan('');
                          }}
                        >
                          <p className="text-sm font-bold">{item.delNumber}</p>
                          <p className="mb-2 text-xs text-slate-500">
                            {item.order?.customer?.name} · {dispatchTime(item.scheduledAt)} · {item.carrier || 'Carrier pending'}
                          </p>
                          <Status value={item.status} />
                        </button>
                      ))
                    ) : (
                      <Empty>FOs, packing lists and partial delivery requests appear here.</Empty>
                    )}
                  </div>
                  {delivery ? (
                    <div className="space-y-4">
                      <div id="fulfillment-print" className="space-y-4">
                        <div className="flex flex-wrap justify-between gap-3">
                          <div>
                            <h3 className="text-lg font-bold">{delivery.delNumber} · FEFO picking / POD</h3>
                            <p className="text-sm text-slate-500">
                              {selectedCompany} · {delivery.order?.customer?.name} · {delivery.order?.soNumber}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {(delivery.sources || []).map((source) => source.documentNumber).join(' · ') || 'Customer order delivery'} ·{' '}
                              {delivery.carrier || 'Carrier pending'} · {dispatchTime(delivery.scheduledAt)}
                            </p>
                          </div>
                          <button type="button" className={`${secondary} fulfillment-no-print`} onClick={print}>
                            Print picking list / POD
                          </button>
                          {onOpenFinance && delivery.pods?.length > 0 && delivery.sources?.some(source => source.sourceType === 'FO') && <button type="button" className={`${primary} fulfillment-no-print`} onClick={() => onOpenFinance(delivery.id)}>Create invoice from POD</button>}
                        </div>
                        <Status value={delivery.status} />
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-sm">
                            <thead>
                              <tr className="border-b text-xs text-slate-500">
                                <th className="px-2 py-3">Product</th>
                                <th className="px-2 py-3">Dispatch qty</th>
                                <th className="px-2 py-3">POD received</th>
                              </tr>
                            </thead>
                            <tbody>
                              {delivery.items.map((line) => (
                                <tr key={line.id} className="border-b border-slate-100">
                                  <td className="px-2 py-3">{labelProduct(line.product || line.orderLine.product)}</td>
                                  <td className="px-2 py-3">{line.quantity}</td>
                                  <td className="px-2 py-3">{line.deliveredQty}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="space-y-2">
                          {delivery.picks.map((line) => (
                            <div
                              key={line.id}
                              className={`rounded-lg border p-3 ${line.id === pickId ? 'border-cyan-600 bg-cyan-50' : 'border-slate-200'}`}
                            >
                              <p className="text-sm font-semibold">
                                {labelProduct(line.lot.product)} · Pick {line.quantity} · Verified {line.verifiedQty || 0}
                              </p>
                              <LotIdentity lot={line.lot} />
                              {canEditDelivery && (
                                <button
                                  type="button"
                                  className={`${secondary} fulfillment-no-print mt-2 block`}
                                  onClick={() => {
                                    setPickId(line.id);
                                    setPickScan('');
                                  }}
                                >
                                  Verify this pick
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                        {(delivery.pods || []).map((pod) => (
                          <div key={pod.id} className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                            <p className="text-sm font-semibold">
                              Received by {pod.recipient} · {new Date(pod.receivedAt).toLocaleString('en-PH')}
                            </p>
                            <p className="mt-1 text-xs">
                              {pod.notes}
                              {pod.documentId ? ` · Document #${pod.documentId}` : ''}
                            </p>
                            {receiptLink(pod.receiptUrl) && (
                              <a
                                href={receiptLink(pod.receiptUrl)!}
                                className="text-sm font-semibold text-cyan-700 underline"
                                target="_blank"
                                rel="noreferrer"
                              >
                                View signed POD
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                      {canEditDelivery && (
                        <>
                          <form
                            key={`${delivery.id}-${delivery.scheduledAt || ''}`}
                            className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-2"
                            onSubmit={(event) =>
                              submit(
                                event,
                                (values) =>
                                  void mutate(
                                    `/deliveries/${delivery.id}/schedule`,
                                    {
                                      scheduledAt: new Date(textOf(values, 'scheduledAt')).toISOString(),
                                      carrier: textOf(values, 'carrier'),
                                      trackingNumber: textOf(values, 'trackingNumber'),
                                      notes: textOf(values, 'notes'),
                                    },
                                    'Dispatch schedule updated.',
                                    'PATCH',
                                  ),
                              )
                            }
                          >
                            <Field label="Dispatch date and time">
                              <input
                                required
                                name="scheduledAt"
                                type="datetime-local"
                                defaultValue={delivery.scheduledAt ? localDateTime(delivery.scheduledAt) : ''}
                                className={input}
                              />
                            </Field>
                            <Field label="Carrier / driver">
                              <input required name="carrier" defaultValue={delivery.carrier || ''} className={input} />
                            </Field>
                            <Field label="Tracking / vehicle reference">
                              <input name="trackingNumber" defaultValue={delivery.trackingNumber || ''} className={input} />
                            </Field>
                            <Field label="Dispatch notes">
                              <input name="notes" defaultValue={delivery.notes || ''} className={input} />
                            </Field>
                            <button className={secondary}>Save schedule</button>
                          </form>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className={primary}
                              onClick={() =>
                                void mutate(`/deliveries/${delivery.id}/pick-list`, {}, 'FEFO picking list generated from reserved stock.')
                              }
                            >
                              Generate FEFO picking list
                            </button>
                            <button
                              type="button"
                              className={secondary}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    'Cancel this unissued delivery? Its customer order reservations remain available for a later delivery.',
                                  )
                                )
                                  void mutate(`/deliveries/${delivery.id}/cancel`, {}, 'Draft delivery cancelled.');
                              }}
                            >
                              Cancel draft delivery
                            </button>
                          </div>
                          {pick && (
                            <form
                              key={pick.id}
                              className="grid gap-3 rounded-lg border border-cyan-200 bg-cyan-50 p-4 sm:grid-cols-2"
                              onSubmit={(event) =>
                                submit(
                                  event,
                                  (values) =>
                                    void mutate(
                                      `/deliveries/${delivery.id}/picks/${pick.id}/verify`,
                                      {
                                        scan: pickScan,
                                        quantity: numberOf(values, 'quantity'),
                                        batchNumber: textOf(values, 'batchNumber') || undefined,
                                        serialNumber: textOf(values, 'serialNumber') || undefined,
                                        binId: textOf(values, 'binId') || undefined,
                                      },
                                      'Pick verified against SKU, quantity and lot identity.',
                                      'POST',
                                      () => setPickScan(''),
                                    ),
                                )
                              }
                            >
                              <p className="text-sm font-semibold sm:col-span-2">
                                Verify {pick.lot.product.sku}: inspect the physical bin, batch and serial. A product sticker confirms SKU
                                only.
                              </p>
                              <Field label="Scan product sticker">
                                <input
                                  className={input}
                                  required
                                  value={pickScan}
                                  onChange={(event) => setPickScan(event.target.value)}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') event.preventDefault();
                                  }}
                                />
                              </Field>
                              <Field label="Verified quantity">
                                <input
                                  className={input}
                                  required
                                  name="quantity"
                                  type="number"
                                  min="1"
                                  step="1"
                                  max={pick.quantity}
                                  defaultValue={pick.quantity}
                                />
                              </Field>
                              <Field label={`Physical batch (expected ${pick.lot.batchNumber || 'none'})`}>
                                <input className={input} name="batchNumber" required={Boolean(pick.lot.batchNumber)} />
                              </Field>
                              <Field label={`Physical serial (expected ${pick.lot.serialNumber || 'none'})`}>
                                <input className={input} name="serialNumber" required={Boolean(pick.lot.serialNumber)} />
                              </Field>
                              <Field label="Confirm physical bin">
                                <select className={input} name="binId" required={Boolean(pick.lot.binId)} defaultValue="">
                                  <option value="">{pick.lot.binId ? 'Select the inspected bin' : 'Unassigned bin'}</option>
                                  {data.bins
                                    .filter((bin) => bin.warehouseId === pick.lot.warehouseId)
                                    .map((bin) => (
                                      <option key={bin.id} value={bin.id}>
                                        {bin.code}
                                      </option>
                                    ))}
                                </select>
                              </Field>
                              <button className={primary}>Confirm verified pick</button>
                            </form>
                          )}
                          <button
                            type="button"
                            className={primary}
                            disabled={!delivery.picks.length || delivery.picks.some((line) => line.verifiedQty !== line.quantity)}
                            onClick={() => {
                              if (window.confirm('Dispatch this delivery now? This issues its verified quantities from physical stock.'))
                                void mutate(
                                  `/deliveries/${delivery.id}/dispatch`,
                                  {},
                                  'Delivery dispatched. Physical stock and stock ledger updated once.',
                                );
                            }}
                          >
                            Dispatch verified stock
                          </button>
                        </>
                      )}
                      {isIssued && delivery.status !== 'Delivered' && (
                        <details className="rounded-lg border border-slate-200 p-4" open>
                          <summary className="cursor-pointer text-sm font-bold">Record signed proof of delivery</summary>
                          <form
                            key={`${delivery.id}-${delivery.pods?.length || 0}`}
                            className="mt-4 space-y-3"
                            onSubmit={(event) =>
                              submit(event, (values, form) => {
                                const items = delivery.items
                                  .map((line) => ({ deliveryItemId: line.id, quantity: numberOf(values, `received-${line.id}`) }))
                                  .filter((line) => line.quantity > 0);
                                const body = {
                                  recipient: textOf(values, 'recipient'),
                                  receivedAt: new Date(textOf(values, 'receivedAt')).toISOString(),
                                  notes: textOf(values, 'notes'),
                                  items,
                                  receiptUrl: textOf(values, 'receiptUrl') || undefined,
                                  documentId: textOf(values, 'documentId') ? numberOf(values, 'documentId') : undefined,
                                };
                                const file = values.get('file');
                                if (file instanceof File && file.size > 0) {
                                  if (file.size > 10 * 1024 * 1024 || !['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) {
                                    setError('Choose a PDF, JPEG or PNG signed receipt up to 10 MB.');
                                    return;
                                  }
                                  const upload = new FormData();
                                  upload.set('file', file);
                                  upload.set('recipient', body.recipient);
                                  upload.set('receivedAt', body.receivedAt);
                                  upload.set('notes', body.notes);
                                  upload.set('items', JSON.stringify(items));
                                  void mutate(
                                    `/deliveries/${delivery.id}/pod-upload`,
                                    upload,
                                    'Signed POD uploaded and delivered quantities recorded.',
                                    'POST',
                                    () => form.reset(),
                                  );
                                } else {
                                  void mutate(
                                    `/deliveries/${delivery.id}/pod`,
                                    body,
                                    'POD recorded. Remaining quantities stay open for partial delivery.',
                                    'POST',
                                    () => form.reset(),
                                  );
                                }
                              })
                            }
                          >
                            <div className="grid gap-3 sm:grid-cols-2">
                              <Field label="Recipient / signatory">
                                <input required name="recipient" className={input} />
                              </Field>
                              <Field label="Received date and time">
                                <input
                                  required
                                  type="datetime-local"
                                  name="receivedAt"
                                  step="0.001"
                                  defaultValue={localDateTime(new Date().toISOString(), true)}
                                  className={input}
                                />
                              </Field>
                              <Field label="Upload signed POD (PDF, JPEG, PNG; up to 10 MB)">
                                <input name="file" type="file" accept="application/pdf,image/jpeg,image/png" className={input} />
                              </Field>
                              <Field label="Existing company document ID">
                                <input name="documentId" type="number" min="1" step="1" className={input} />
                              </Field>
                              <Field label="Signed POD HTTPS link">
                                <input name="receiptUrl" type="url" pattern="https://.*" placeholder="https://…" className={input} />
                              </Field>
                              <Field label="Receipt notes">
                                <input name="notes" className={input} />
                              </Field>
                            </div>
                            <p className="text-xs text-slate-500">
                              Attach a signed receipt file, an existing company document, or an HTTPS link. Enter only quantities received
                              on this receipt; previous POD quantities are retained.
                            </p>
                            {delivery.items.map((line) => (
                              <Field
                                key={line.id}
                                label={`${(line.product || line.orderLine.product).sku} · ${line.quantity - line.deliveredQty} awaiting POD`}
                              >
                                <input
                                  name={`received-${line.id}`}
                                  type="number"
                                  min="0"
                                  max={line.quantity - line.deliveredQty}
                                  step="1"
                                  defaultValue="0"
                                  className={input}
                                />
                              </Field>
                            ))}
                            <button className={primary}>Save signed POD</button>
                          </form>
                        </details>
                      )}
                    </div>
                  ) : (
                    <Empty>Select a delivery to prepare picks, dispatch, or record POD.</Empty>
                  )}
                </div>
              </section>
            </>
          )}
        </fieldset>
      </Content>
    </div>
  );
}

function localDateTime(value: string, milliseconds = false) {
  const parsed = new Date(value);
  return new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000).toISOString().slice(0, milliseconds ? 23 : 16);
}
function DeliveryDraft({ order, onCreate }: { order: Order; onCreate: (items: { orderLineId: string; quantity: number }[]) => void }) {
  const [error, setError] = useState('');
  return (
    <form
      key={order.id}
      className="space-y-3 rounded-lg border border-slate-200 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        const values = dataOf(event);
        const items = order.items
          .map((line) => ({ orderLineId: line.id, quantity: numberOf(values, line.id) }))
          .filter((line) => line.quantity > 0);
        if (!items.length) {
          setError('Enter at least one delivery quantity.');
          return;
        }
        setError('');
        onCreate(items);
      }}
    >
      <h3 className="text-sm font-semibold">Create partial delivery</h3>
      <p className="text-xs text-slate-500">
        The server checks active reservations and other staged deliveries before allocating these quantities.
      </p>
      {order.items.map((line) => (
        <Field key={line.id} label={`${line.product.sku} · ${line.remainingQty} remaining · ${line.reservedQty} reserved`}>
          <input type="number" min="0" max={line.remainingQty} step="1" name={line.id} defaultValue="0" className={input} />
        </Field>
      ))}
      {error && (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      )}
      <button className={primary}>Create partial delivery</button>
    </form>
  );
}
