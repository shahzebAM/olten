import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { expireApiSession, getApiAuthHeaders } from '../lib/apiSession';
import { safeDocumentLink } from '../lib/documentLinks';

type Product = { id: number; name: string; sku: string };
type Supplier = { id: string; legalName: string };
type POItem = {
  id: string;
  productId?: number;
  productName: string;
  sku: string;
  requestedQty: number;
  po?: { poNumber: string };
};
type PurchaseOrder = {
  id: string;
  poNumber: string;
  status: string;
  items: POItem[];
};
type RequisitionItem = {
  id: string;
  productId: number;
  quantity: number;
  product: Product;
};
type Quote = {
  id: string;
  currency: string;
  exchangeRate: number;
  leadTimeDays: number;
  paymentTerms: string;
  validUntil?: string;
  supplier: Supplier;
  items: {
    requisitionItemId: string;
    unitCost: number;
    minimumOrderQty: number;
  }[];
};
type Requisition = {
  id: string;
  prNumber: string;
  purpose: string;
  neededBy?: string;
  status: string;
  rejectionReason?: string;
  purchaseOrder?: { poNumber: string };
  items: RequisitionItem[];
  quotations: Quote[];
};
type ImportFile = {
  id: string;
  importNumber: string;
  title: string;
  status: string;
  notes?: string;
};
type ShipmentLine = {
  id: string;
  shippedQty: number;
  clearedQty: number;
  purchaseOrderItem: POItem;
};
type Expense = {
  id: string;
  category: string;
  description: string;
  amount: number;
  currency: string;
  status: string;
  invoiceReference?: string;
  paidAt?: string;
};
type Shipment = {
  id: string;
  shipmentNumber: string;
  importFileId: string;
  importFile: ImportFile;
  status: string;
  forwarder?: string;
  carrier?: string;
  mode: string;
  blAwbNumber?: string;
  containerReference?: string;
  etd?: string;
  eta?: string;
  revisedEta?: string;
  actualArrival?: string;
  notes?: string;
  isDelayed?: boolean;
  delayDays?: number;
  items: ShipmentLine[];
  clearance?: {
    broker?: string;
    declarationReference?: string;
    entryReference?: string;
    clearanceDate?: string;
    status: string;
  };
  expenses: Expense[];
};
type ReceiptLine = {
  id: string;
  shipmentLineId: string;
  receivedQty: number;
  acceptedQty: number;
  rejectedQty: number;
  heldQty: number;
  placedQty?: number;
  batchNumber?: string;
  expirationDate?: string;
  notes?: string;
  photos: string[];
  shipmentLine: ShipmentLine;
};
type Receipt = {
  id: string;
  grnNumber: string;
  receivedAt: string;
  notes?: string;
  shipment: Shipment;
  items: ReceiptLine[];
};
type Overview = {
  products: Product[];
  suppliers: Supplier[];
  purchaseOrders: PurchaseOrder[];
  requisitions: Requisition[];
  importFiles: ImportFile[];
  shipments: Shipment[];
  receipts: Receipt[];
};
type LinkedDocument = {
  id: number;
  originalName: string;
  documentType: string;
  expiryDate?: string;
  expiryStatus?: string;
  googleDriveLink?: string;
  importFileId?: string;
  shipmentId?: string;
  productId?: number;
  regulatoryStatus: string;
};
type ReceiptDraft = {
  receivedQty: number;
  acceptedQty: number;
  rejectedQty: number;
  heldQty: number;
  batchNumber: string;
  expirationDate: string;
  notes: string;
  photos: string[];
};
const blankOverview: Overview = {
  products: [],
  suppliers: [],
  purchaseOrders: [],
  requisitions: [],
  importFiles: [],
  shipments: [],
  receipts: [],
};
const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-cyan-600 focus:outline-none';
const buttonClass = 'rounded-lg bg-cyan-700 px-4 py-2 text-sm font-bold text-white hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryClass = 'rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-100 disabled:opacity-50';
const panelClass = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm';
const date = (value?: string) => (value ? value.slice(0, 10) : '');
const money = (value: number, currency = 'PHP') =>
  `${currency} ${Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const blankReceipt = (): ReceiptDraft => ({
  receivedQty: 0,
  acceptedQty: 0,
  rejectedQty: 0,
  heldQty: 0,
  batchNumber: '',
  expirationDate: '',
  notes: '',
  photos: [],
});
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1 text-xs font-semibold text-slate-600">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Status({ value }: { value: string }) {
  return <span className="inline-block rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{value}</span>;
}
function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">{children}</p>;
}

function ProductPicker({ products, value, onChange, disabled }: {
  products: Product[]; value: string; onChange: (value: string) => void; disabled: boolean;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const selected = products.find(product => String(product.id) === value);
  const query = (search ?? '').trim().toLowerCase();
  const matches = products.filter(product => `${product.sku} ${product.name}`.toLowerCase().includes(query));

  useEffect(() => {
    inputRef.current?.setCustomValidity(selected ? '' : 'Select a product from the list.');
  }, [selected]);

  useEffect(() => {
    if (open) document.getElementById(`${listId}-${highlighted}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, highlighted, listId, query]);

  function choose(product: Product) {
    onChange(String(product.id));
    setSearch(null);
    setHighlighted(products.indexOf(product));
    setOpen(false);
  }

  return (
    <div className="relative">
      <Field label="Product">
        <input
          ref={inputRef}
          required
          disabled={disabled}
          role="combobox"
          aria-label="Product"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={open && matches[highlighted] ? `${listId}-${highlighted}` : undefined}
          autoComplete="off"
          placeholder="Search by SKU or product name"
          className={inputClass}
          value={search ?? (selected ? `${selected.sku} · ${selected.name}` : '')}
          onFocus={event => {
            setOpen(true);
            setHighlighted(selected ? products.indexOf(selected) : 0);
            event.currentTarget.select();
          }}
          onClick={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={event => {
            setSearch(event.target.value);
            onChange('');
            setHighlighted(0);
            setOpen(true);
          }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setOpen(true);
              setHighlighted(index => matches.length ? (index + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length : 0);
            } else if (event.key === 'Enter' && open) {
              event.preventDefault();
              if (matches[highlighted]) choose(matches[highlighted]);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setOpen(false);
            }
          }}
        />
      </Field>
      {open && !disabled && (
        <div id={listId} role="listbox" aria-label="Products" className="absolute z-40 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-300 bg-white shadow-lg">
          {matches.length ? matches.map((product, index) => (
            <button
              key={product.id}
              id={`${listId}-${index}`}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={index === highlighted}
              className={`block w-full px-3 py-2 text-left text-sm ${index === highlighted ? 'bg-cyan-100 text-cyan-900' : 'text-slate-800 hover:bg-slate-100'}`}
              onMouseDown={event => event.preventDefault()}
              onClick={() => choose(product)}
            >
              {product.sku} · {product.name}
            </button>
          )) : <p role="status" className="px-3 py-2 text-sm text-slate-500">No products found.</p>}
        </div>
      )}
    </div>
  );
}

export default function ImportationModule({
  selectedCompany,
  API_BASE_URL,
  canApprove,
  onBack,
}: {
  selectedCompany: string;
  API_BASE_URL: string;
  canApprove: boolean;
  onBack: () => void;
}) {
  const [tab, setTab] = useState('Requisitions');
  const [data, setData] = useState<Overview>(blankOverview);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [requestId, setRequestId] = useState('');
  const [shipmentId, setShipmentId] = useState('');
  const [prForm, setPrForm] = useState({ purpose: '', neededBy: '' });
  const nextPrItemId = useRef(1);
  const [prItems, setPrItems] = useState([{ rowId: 0, productId: '', quantity: 1 }]);
  const [quoteForm, setQuoteForm] = useState({
    supplierId: '',
    currency: 'USD',
    exchangeRate: 1,
    leadTimeDays: 0,
    paymentTerms: '',
    validUntil: '',
    notes: '',
  });
  const [quoteItems, setQuoteItems] = useState<Record<string, { unitCost: number; minimumOrderQty: number }>>({});
  const [rejectReason, setRejectReason] = useState('');
  const [fileForm, setFileForm] = useState({ title: '', notes: '' });
  const [shipmentForm, setShipmentForm] = useState({
    importFileId: '',
    forwarder: '',
    carrier: '',
    mode: 'Sea',
    blAwbNumber: '',
    containerReference: '',
    etd: '',
    eta: '',
    revisedEta: '',
    notes: '',
  });
  const [shipmentItems, setShipmentItems] = useState([{ purchaseOrderItemId: '', shippedQty: 1 }]);
  const [editingShipment, setEditingShipment] = useState('');
  const [logistics, setLogistics] = useState({
    forwarder: '',
    carrier: '',
    mode: 'Sea',
    blAwbNumber: '',
    containerReference: '',
    etd: '',
    eta: '',
    revisedEta: '',
    actualArrival: '',
    status: 'Planned',
    notes: '',
  });
  const [clearanceState, writeClearance] = useState({
    broker: '',
    declarationReference: '',
    entryReference: '',
    clearanceDate: '',
    status: 'Pending',
  });
  const [clearanceShipmentId, setClearanceShipmentId] = useState('');
  const [clearedItems, setClearedItems] = useState<Record<string, number>>({});
  const [expense, setExpense] = useState({
    category: 'Duties',
    description: '',
    currency: 'PHP',
    amount: 0,
    status: 'Estimated',
    invoiceReference: '',
    paidAt: '',
  });
  const [editingExpense, setEditingExpense] = useState('');
  const [receiptForm, setReceiptForm] = useState({ receivedAt: '', notes: '' });
  const [receiptItems, setReceiptItems] = useState<Record<string, ReceiptDraft>>({});
  const [qcLine, setQcLine] = useState<ReceiptLine | null>(null);
  const [qcDraft, setQcDraft] = useState({
    acceptedQty: 0,
    rejectedQty: 0,
    heldQty: 0,
    notes: '',
  });
  const [documents, setDocuments] = useState<LinkedDocument[]>([]);
  const [docsError, setDocsError] = useState('');
  const [docsLoading, setDocsLoading] = useState(true);
  const [documentId, setDocumentId] = useState<number | null>(null);
  const [documentForm, setDocumentForm] = useState({
    importFileId: '',
    shipmentId: '',
    productId: '',
    regulatoryStatus: 'NOT_REQUESTED',
    documentType: '',
  });
  const requisition = data.requisitions.find((item) => item.id === requestId) || data.requisitions[0];
  const shipment = data.shipments.find((item) => item.id === shipmentId) || data.shipments[0];
  const clearance =
    clearanceShipmentId === shipment?.id
      ? clearanceState
      : {
          broker: shipment?.clearance?.broker || '',
          declarationReference: shipment?.clearance?.declarationReference || '',
          entryReference: shipment?.clearance?.entryReference || '',
          clearanceDate: date(shipment?.clearance?.clearanceDate),
          status: shipment?.clearance?.status || 'Pending',
        };
  function setClearance(next: typeof clearanceState) {
    setClearanceShipmentId(shipment?.id || '');
    writeClearance(next);
  }
  const poOptions = data.purchaseOrders.flatMap((po) => po.items.map((item) => ({ ...item, poNumber: po.poNumber })));

  const api = useCallback(
    async <T,>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> => {
      const response = await fetch(`${API_BASE_URL}${path}`, {
        method,
        headers: {
          ...getApiAuthHeaders(),
          'x-company': selectedCompany,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
      if (response.status === 401) expireApiSession();
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload && typeof payload === 'object' && 'message' in payload ? (payload as { message: unknown }).message : null;
        throw new Error(Array.isArray(message) ? message.join('; ') : typeof message === 'string' ? message : `Request failed (HTTP ${response.status}).`);
      }
      return payload as T;
    },
    [API_BASE_URL, selectedCompany],
  );
  const load = useCallback(
    (signal?: AbortSignal) =>
      api<Overview>('/importation/overview', 'GET', undefined, signal)
        .then((snapshot) => {
          if (!signal?.aborted) {
            setData(snapshot);
            setError('');
          }
        })
        .catch((e: unknown) => {
          if (!signal?.aborted) setError(e instanceof Error ? e.message : 'Unable to load importation records.');
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false);
        }),
    [api],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const loadDocuments = useCallback(
    (signal?: AbortSignal) =>
      api<LinkedDocument[]>('/api/docs/import-links', 'GET', undefined, signal)
        .then((files) => {
          if (!signal?.aborted) {
            setDocuments(files);
            setDocsError('');
          }
        })
        .catch((e: unknown) => {
          if (!signal?.aborted) setDocsError(e instanceof Error ? e.message : 'Document access requires AI Docs permission.');
        })
        .finally(() => {
          if (!signal?.aborted) setDocsLoading(false);
        }),
    [api],
  );
  useEffect(() => {
    if (tab !== 'Documents') return;
    const controller = new AbortController();
    void loadDocuments(controller.signal);
    return () => controller.abort();
  }, [tab, loadDocuments]);
  async function mutate(path: string, body: unknown, message: string, method = 'POST', after?: () => void) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(path, method, body);
      after?.();
      setNotice(message);
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save changes.');
      return false;
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent, action: () => Promise<unknown>) {
    event.preventDefault();
    if (!busy) void action();
  }
  function editShipment(item: Shipment) {
    setEditingShipment(item.id);
    setLogistics({
      forwarder: item.forwarder || '',
      carrier: item.carrier || '',
      mode: item.mode,
      blAwbNumber: item.blAwbNumber || '',
      containerReference: item.containerReference || '',
      etd: date(item.etd),
      eta: date(item.eta),
      revisedEta: date(item.revisedEta),
      actualArrival: date(item.actualArrival),
      status: item.status,
      notes: item.notes || '',
    });
  }
  function selectShipment(id: string) {
    setShipmentId(id);
    setClearedItems({});
    setReceiptItems({});
    setEditingExpense('');
    setExpense({
      category: 'Duties',
      description: '',
      currency: 'PHP',
      amount: 0,
      status: 'Estimated',
      invoiceReference: '',
      paidAt: '',
    });
    const item = data.shipments.find((s) => s.id === id);
    setClearanceShipmentId(id);
    writeClearance({
      broker: item?.clearance?.broker || '',
      declarationReference: item?.clearance?.declarationReference || '',
      entryReference: item?.clearance?.entryReference || '',
      clearanceDate: date(item?.clearance?.clearanceDate),
      status: item?.clearance?.status || 'Pending',
    });
  }
  function updateReceipt(id: string, patch: Partial<ReceiptDraft>) {
    setReceiptItems((previous) => ({
      ...previous,
      [id]: { ...(previous[id] || blankReceipt()), ...patch },
    }));
  }
  async function addPhotos(id: string, files: FileList | null) {
    if (!files) return;
    const existing = receiptItems[id]?.photos || [];
    if (
      existing.length + files.length > 6 ||
      Array.from(files).some((file) => file.size > 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    ) {
      setError('Use up to six JPEG, PNG or WebP photos per line, maximum 1 MB each.');
      return;
    }
    try {
      const photos = await Promise.all(
        Array.from(files).map(
          (file) =>
            new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Unable to read photo.')));
              reader.onerror = () => reject(new Error('Unable to read photo.'));
              reader.readAsDataURL(file);
            }),
        ),
      );
      updateReceipt(id, { photos: [...existing, ...photos] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to read photo.');
    }
  }
  function shipmentSelector() {
    return (
      <Field label="Shipment">
        <select className={inputClass} value={shipment?.id || ''} onChange={(e) => selectShipment(e.target.value)}>
          <option value="" disabled>
            Select shipment
          </option>
          {data.shipments.map((item) => (
            <option key={item.id} value={item.id}>
              {item.shipmentNumber} · {item.importFile?.importNumber}
            </option>
          ))}
        </select>
      </Field>
    );
  }
  const receiptTotal = (lineId: string) =>
    data.receipts
      .flatMap((item) => item.items)
      .filter((item) => item.shipmentLineId === lineId)
      .reduce((sum, item) => sum + item.receivedQty, 0);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <button className="text-sm font-bold text-cyan-700" onClick={onBack}>
              ← Workspace
            </button>
            <h1 className="mt-2 text-2xl font-black">Importation & Receiving</h1>
            <p className="text-sm text-slate-500">{selectedCompany} · Purchase requests through quality controlled receiving</p>
          </div>
          <button
            className={secondaryClass}
            disabled={loading || busy}
            onClick={() => {
              setLoading(true);
              void load();
            }}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
        {error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            {notice}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ['Purchase requests', data.requisitions.filter((item) => item.status === 'Submitted').length],
            ['Active shipments', data.shipments.filter((item) => item.status !== 'Closed').length],
            ['Delayed shipments', data.shipments.filter((item) => item.isDelayed).length],
            ['QC hold / rejected', data.receipts.flatMap((item) => item.items).reduce((sum, item) => sum + item.heldQty + item.rejectedQty, 0)],
          ].map(([label, value]) => (
            <div key={label} className={panelClass}>
              <p className="text-xs font-semibold text-slate-500">{label}</p>
              <strong className="text-2xl">{value}</strong>
            </div>
          ))}
        </div>
        <nav aria-label="Importation workflow" className="flex gap-2 overflow-x-auto">
          {['Requisitions', 'Shipments', 'Customs', 'GRN & QC', 'Documents'].map((name) => (
            <button
              key={name}
              onClick={() => {
                setTab(name);
                if (name === 'Documents') setDocsLoading(true);
              }}
              className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-bold ${tab === name ? 'bg-cyan-700 text-white' : 'border border-slate-200 bg-white'}`}
            >
              {name}
            </button>
          ))}
        </nav>
        {loading && !data.requisitions.length && !data.shipments.length && (
          <p role="status" className="text-sm text-slate-500">
            Loading importation workspace…
          </p>
        )}
        <fieldset disabled={busy || loading} className="min-w-0 space-y-5 disabled:opacity-70">
          {tab === 'Requisitions' && (
            <>
              <details className={panelClass}>
                <summary className="cursor-pointer font-bold">Create purchase requisition</summary>
                <form
                  className="mt-4 space-y-4"
                  onSubmit={(event) =>
                    submit(event, () =>
                      mutate(
                        '/importation/requisitions',
                        {
                          ...prForm,
                          neededBy: prForm.neededBy || undefined,
                          items: prItems.map((item) => ({
                            productId: Number(item.productId),
                            quantity: item.quantity,
                          })),
                        },
                        'Purchase requisition created.',
                        'POST',
                        () => {
                          setPrForm({ purpose: '', neededBy: '' });
                          setPrItems([{ rowId: nextPrItemId.current++, productId: '', quantity: 1 }]);
                        },
                      ),
                    )
                  }
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Purpose">
                      <input
                        required
                        maxLength={1000}
                        className={inputClass}
                        value={prForm.purpose}
                        onChange={(e) => setPrForm({ ...prForm, purpose: e.target.value })}
                      />
                    </Field>
                    <Field label="Needed by">
                      <input type="date" className={inputClass} value={prForm.neededBy} onChange={(e) => setPrForm({ ...prForm, neededBy: e.target.value })} />
                    </Field>
                  </div>
                  {prItems.map((item, index) => (
                    <div key={item.rowId} className="flex items-end gap-3">
                      <div className="flex-1">
                        <ProductPicker
                          products={data.products}
                          value={item.productId}
                          disabled={busy || loading}
                          onChange={productId => setPrItems(prItems.map((line, i) => i === index ? { ...line, productId } : line))}
                        />
                      </div>
                      <div className="w-28">
                        <Field label="Quantity">
                          <input
                            required
                            type="number"
                            min="1"
                            step="1"
                            className={inputClass}
                            value={item.quantity}
                            onChange={(e) =>
                              setPrItems(
                                prItems.map((line, i) =>
                                  i === index
                                    ? {
                                        ...line,
                                        quantity: Number(e.target.value),
                                      }
                                    : line,
                                ),
                              )
                            }
                          />
                        </Field>
                      </div>
                      <button
                        type="button"
                        className={secondaryClass}
                        disabled={prItems.length === 1}
                        onClick={() => setPrItems(prItems.filter((_, i) => i !== index))}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <div className="flex gap-3">
                    <button type="button" className={secondaryClass} onClick={() => setPrItems([...prItems, { rowId: nextPrItemId.current++, productId: '', quantity: 1 }])}>
                      Add item
                    </button>
                    <button className={buttonClass}>Save requisition</button>
                  </div>
                </form>
              </details>
              {!data.requisitions.length ? (
                <Empty>No requisitions yet. Create a purchase request to begin.</Empty>
              ) : (
                <div className="grid items-start gap-5 lg:grid-cols-[260px_1fr]">
                  <div className={panelClass}>
                    <h2 className="mb-3 font-bold">Purchase requests</h2>
                    <div className="space-y-2">
                      {data.requisitions.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => {
                            setRequestId(item.id);
                            setQuoteItems({});
                          }}
                          className={`w-full rounded-lg border p-3 text-left text-sm ${requisition?.id === item.id ? 'border-cyan-600 bg-cyan-50' : 'border-slate-200'}`}
                        >
                          <strong className="block">{item.prNumber}</strong>
                          <span className="my-1 block truncate">{item.purpose}</span>
                          <Status value={item.status} />
                        </button>
                      ))}
                    </div>
                  </div>
                  {requisition && (
                    <div className="min-w-0 space-y-5">
                      <section className={panelClass}>
                        <div className="flex flex-wrap items-center gap-3">
                          <h2 className="font-bold">{requisition.prNumber}</h2>
                          <Status value={requisition.status} />
                          {requisition.purchaseOrder && (
                            <span className="text-sm font-bold text-emerald-700">Generated {requisition.purchaseOrder.poNumber}</span>
                          )}
                        </div>
                        <p className="mt-2 text-sm">{requisition.purpose}</p>
                        {requisition.neededBy && <p className="text-xs text-slate-500">Needed by {date(requisition.neededBy)}</p>}
                        {requisition.rejectionReason && <p className="text-sm text-red-700">{requisition.rejectionReason}</p>}
                        <ul className="mt-3 space-y-1 text-sm">
                          {requisition.items.map((item) => (
                            <li key={item.id}>
                              {item.product?.sku} · {item.product?.name} <strong>× {item.quantity}</strong>
                            </li>
                          ))}
                        </ul>
                        {requisition.status === 'Draft' && (
                          <button
                            className={`${buttonClass} mt-4`}
                            disabled={!requisition.quotations.length}
                            onClick={() => void mutate(`/importation/requisitions/${requisition.id}/submit`, {}, 'Requisition submitted for approval.')}
                          >
                            Submit for approval
                          </button>
                        )}
                        {requisition.status === 'Submitted' && canApprove && (
                          <form
                            className="mt-4 flex gap-2"
                            onSubmit={(e) =>
                              submit(e, () => mutate(`/importation/requisitions/${requisition.id}/reject`, { reason: rejectReason }, 'Requisition rejected.'))
                            }
                          >
                            <input
                              required
                              aria-label="Rejection reason"
                              placeholder="Rejection reason"
                              className={inputClass}
                              value={rejectReason}
                              onChange={(e) => setRejectReason(e.target.value)}
                            />
                            <button className={secondaryClass}>Reject</button>
                          </form>
                        )}
                      </section>
                      <section className={panelClass}>
                        <h2 className="mb-3 font-bold">Supplier quotation comparison</h2>
                        <p className="mb-3 text-xs text-slate-500">
                          PHP equivalents use the entered exchange rate. Approval creates a PO in the existing Procurement module.
                        </p>
                        {!requisition.quotations.length ? (
                          <Empty>No supplier quotations recorded.</Empty>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[550px] border-collapse text-sm">
                              <thead>
                                <tr className="bg-slate-50">
                                  <th className="p-3 text-left">Comparison</th>
                                  {requisition.quotations.map((quote) => (
                                    <th key={quote.id} className="p-3 text-left">
                                      {quote.supplier?.legalName}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {requisition.items.map((item) => (
                                  <tr key={item.id} className="border-t border-slate-100">
                                    <td className="p-3">
                                      {item.product?.name} × {item.quantity}
                                    </td>
                                    {requisition.quotations.map((quote) => {
                                      const line = quote.items.find((q) => q.requisitionItemId === item.id);
                                      return (
                                        <td className="p-3" key={quote.id}>
                                          {line ? (
                                            <>
                                              {money(line.unitCost, quote.currency)} / unit
                                              <br />
                                              <span className="text-xs text-slate-500">
                                                MOQ {line.minimumOrderQty}
                                                {line.minimumOrderQty > item.quantity ? ' · exceeds requested quantity' : ''}
                                              </span>
                                            </>
                                          ) : (
                                            '—'
                                          )}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                ))}
                                {['Total', 'PHP equivalent', 'Lead time', 'Payment terms', 'Valid until', 'Approval'].map((row) => (
                                  <tr className="border-t border-slate-100" key={row}>
                                    <td className="p-3 font-semibold">{row}</td>
                                    {requisition.quotations.map((quote) => {
                                      const total = quote.items.reduce(
                                        (sum, line) =>
                                          sum + line.unitCost * (requisition.items.find((item) => item.id === line.requisitionItemId)?.quantity || 0),
                                        0,
                                      );
                                      return (
                                        <td key={quote.id} className="p-3">
                                          {row === 'Total' ? (
                                            money(total, quote.currency)
                                          ) : row === 'PHP equivalent' ? (
                                            money(total * quote.exchangeRate)
                                          ) : row === 'Lead time' ? (
                                            `${quote.leadTimeDays} days`
                                          ) : row === 'Payment terms' ? (
                                            quote.paymentTerms
                                          ) : row === 'Valid until' ? (
                                            date(quote.validUntil) || '—'
                                          ) : requisition.status === 'Submitted' && canApprove ? (
                                            <button
                                              className={buttonClass}
                                              onClick={() =>
                                                void mutate(
                                                  `/importation/requisitions/${requisition.id}/approve`,
                                                  { quotationId: quote.id },
                                                  'Quotation approved and purchase order generated.',
                                                )
                                              }
                                            >
                                              Approve & create PO
                                            </button>
                                          ) : (
                                            '—'
                                          )}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </section>
                      {requisition.status === 'Draft' && (
                        <details className={panelClass}>
                          <summary className="cursor-pointer font-bold">Add supplier quotation</summary>
                          <form
                            className="mt-4 space-y-4"
                            onSubmit={(e) =>
                              submit(e, () =>
                                mutate(
                                  `/importation/requisitions/${requisition.id}/quotations`,
                                  {
                                    ...quoteForm,
                                    validUntil: quoteForm.validUntil || undefined,
                                    items: requisition.items.map((item) => ({
                                      requisitionItemId: item.id,
                                      ...(quoteItems[item.id] || {
                                        unitCost: 0,
                                        minimumOrderQty: 1,
                                      }),
                                    })),
                                  },
                                  'Supplier quotation recorded.',
                                  'POST',
                                  () => setQuoteItems({}),
                                ),
                              )
                            }
                          >
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                              <Field label="Supplier">
                                <select
                                  required
                                  className={inputClass}
                                  value={quoteForm.supplierId}
                                  onChange={(e) =>
                                    setQuoteForm({
                                      ...quoteForm,
                                      supplierId: e.target.value,
                                    })
                                  }
                                >
                                  <option value="">Select supplier</option>
                                  {data.suppliers.map((item) => (
                                    <option key={item.id} value={item.id}>
                                      {item.legalName}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                              <Field label="Currency (ISO code)">
                                <input
                                  required
                                  pattern="[A-Z]{3}"
                                  maxLength={3}
                                  className={inputClass}
                                  value={quoteForm.currency}
                                  onChange={(e) =>
                                    setQuoteForm({
                                      ...quoteForm,
                                      currency: e.target.value.toUpperCase(),
                                    })
                                  }
                                />
                              </Field>
                              <Field label="PHP per 1 currency unit">
                                <input
                                  required
                                  type="number"
                                  min="0.000001"
                                  step="0.000001"
                                  className={inputClass}
                                  value={quoteForm.exchangeRate}
                                  onChange={(e) =>
                                    setQuoteForm({
                                      ...quoteForm,
                                      exchangeRate: Number(e.target.value),
                                    })
                                  }
                                />
                              </Field>
                              <Field label="Lead time (days)">
                                <input
                                  required
                                  type="number"
                                  min="0"
                                  step="1"
                                  className={inputClass}
                                  value={quoteForm.leadTimeDays}
                                  onChange={(e) =>
                                    setQuoteForm({
                                      ...quoteForm,
                                      leadTimeDays: Number(e.target.value),
                                    })
                                  }
                                />
                              </Field>
                              <Field label="Payment terms">
                                <input
                                  required
                                  className={inputClass}
                                  value={quoteForm.paymentTerms}
                                  onChange={(e) =>
                                    setQuoteForm({
                                      ...quoteForm,
                                      paymentTerms: e.target.value,
                                    })
                                  }
                                />
                              </Field>
                              <Field label="Valid until">
                                <input
                                  type="date"
                                  className={inputClass}
                                  value={quoteForm.validUntil}
                                  onChange={(e) =>
                                    setQuoteForm({
                                      ...quoteForm,
                                      validUntil: e.target.value,
                                    })
                                  }
                                />
                              </Field>
                            </div>
                            {requisition.items.map((item) => (
                              <div className="grid items-center gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-3" key={item.id}>
                                <span className="text-sm">
                                  {item.product?.name} × {item.quantity}
                                </span>
                                <Field label="Unit cost">
                                  <input
                                    required
                                    type="number"
                                    min="0"
                                    step="0.0001"
                                    className={inputClass}
                                    value={quoteItems[item.id]?.unitCost ?? 0}
                                    onChange={(e) =>
                                      setQuoteItems({
                                        ...quoteItems,
                                        [item.id]: {
                                          unitCost: Number(e.target.value),
                                          minimumOrderQty: quoteItems[item.id]?.minimumOrderQty ?? 1,
                                        },
                                      })
                                    }
                                  />
                                </Field>
                                <Field label="Minimum order quantity">
                                  <input
                                    required
                                    type="number"
                                    min="1"
                                    step="1"
                                    className={inputClass}
                                    value={quoteItems[item.id]?.minimumOrderQty ?? 1}
                                    onChange={(e) =>
                                      setQuoteItems({
                                        ...quoteItems,
                                        [item.id]: {
                                          unitCost: quoteItems[item.id]?.unitCost ?? 0,
                                          minimumOrderQty: Number(e.target.value),
                                        },
                                      })
                                    }
                                  />
                                </Field>
                              </div>
                            ))}
                            <Field label="Notes">
                              <textarea
                                className={inputClass}
                                value={quoteForm.notes}
                                onChange={(e) =>
                                  setQuoteForm({
                                    ...quoteForm,
                                    notes: e.target.value,
                                  })
                                }
                              />
                            </Field>
                            <button className={buttonClass}>Save quotation</button>
                          </form>
                        </details>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          {tab === 'Customs' &&
            (!shipment ? (
              <Empty>Create a shipment before recording customs clearance.</Empty>
            ) : (
              <>
                <section className={panelClass}>
                  {shipmentSelector()}
                  <div className="mt-3 flex gap-2">
                    <Status value={shipment.status} />
                    <Status value={shipment.clearance?.status || 'Pending clearance'} />
                  </div>
                </section>
                <section className={panelClass}>
                  <h2 className="mb-3 font-bold">Broker & clearance</h2>
                  <form
                    className="space-y-4"
                    onSubmit={(e) =>
                      submit(e, () =>
                        mutate(
                          `/importation/shipments/${shipment.id}/clearance`,
                          {
                            broker: clearance.broker,
                            declarationReference: clearance.declarationReference,
                            entryReference: clearance.entryReference,
                            clearanceDate: clearance.clearanceDate || undefined,
                            status: clearance.status,
                            items: shipment.items.map((item) => ({
                              shipmentLineId: item.id,
                              clearedQty: clearedItems[item.id] ?? item.clearedQty,
                            })),
                          },
                          'Customs clearance updated.',
                          'PATCH',
                        ),
                      )
                    }
                  >
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {(['broker', 'declarationReference', 'entryReference'] as const).map((key) => (
                        <Field
                          key={key}
                          label={
                            {
                              broker: 'Customs broker',
                              declarationReference: 'Declaration reference',
                              entryReference: 'Entry reference',
                            }[key]
                          }
                        >
                          <input
                            className={inputClass}
                            placeholder={shipment.clearance?.[key] || ''}
                            value={clearance[key]}
                            onChange={(e) =>
                              setClearance({
                                ...clearance,
                                [key]: e.target.value,
                              })
                            }
                          />
                        </Field>
                      ))}
                      <Field label="Clearance date">
                        <input
                          type="date"
                          className={inputClass}
                          value={clearance.clearanceDate}
                          onChange={(e) =>
                            setClearance({
                              ...clearance,
                              clearanceDate: e.target.value,
                            })
                          }
                        />
                      </Field>
                      <Field label="Clearance status">
                        <select
                          className={inputClass}
                          value={clearance.status}
                          onChange={(e) =>
                            setClearance({
                              ...clearance,
                              status: e.target.value,
                            })
                          }
                        >
                          {['Pending', 'In Progress', 'Cleared'].map((value) => (
                            <option key={value}>{value}</option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="bg-slate-50">
                            <th className="p-3">PO / product</th>
                            <th className="p-3">Shipped</th>
                            <th className="p-3">Cleared quantity (cumulative)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {shipment.items.map((item) => (
                            <tr key={item.id} className="border-t border-slate-100">
                              <td className="p-3">
                                {item.purchaseOrderItem?.po?.poNumber} · {item.purchaseOrderItem?.productName}
                              </td>
                              <td className="p-3">{item.shippedQty}</td>
                              <td className="p-3">
                                <input
                                  aria-label={`Cleared quantity for ${item.purchaseOrderItem?.productName}`}
                                  required
                                  type="number"
                                  min={receiptTotal(item.id)}
                                  max={item.shippedQty}
                                  step="1"
                                  className={inputClass}
                                  value={clearedItems[item.id] ?? item.clearedQty}
                                  onChange={(e) =>
                                    setClearedItems({
                                      ...clearedItems,
                                      [item.id]: Number(e.target.value),
                                    })
                                  }
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <button className={buttonClass}>Save clearance</button>
                  </form>
                </section>
                <section className={panelClass}>
                  <h2 className="mb-3 font-bold">Itemized import expenses</h2>
                  {!shipment.expenses.length ? (
                    <Empty>No expenses recorded.</Empty>
                  ) : (
                    <div className="mb-4 overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50">
                          <tr>
                            {['Category / description', 'Amount', 'Status', 'Invoice / paid date', ''].map((label, i) => (
                              <th key={i} className="p-3">
                                {label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {shipment.expenses.map((item) => (
                            <tr key={item.id} className="border-t border-slate-100">
                              <td className="p-3">
                                {item.category}
                                <p className="text-xs text-slate-500">{item.description}</p>
                              </td>
                              <td className="p-3">{money(item.amount, item.currency)}</td>
                              <td className="p-3">
                                <Status value={item.status} />
                              </td>
                              <td className="p-3">
                                {item.invoiceReference || '—'}
                                <p className="text-xs">{date(item.paidAt)}</p>
                              </td>
                              <td className="p-3">
                                <button
                                  className={secondaryClass}
                                  onClick={() => {
                                    setEditingExpense(item.id);
                                    setExpense({
                                      category: item.category,
                                      description: item.description,
                                      currency: item.currency,
                                      amount: Number(item.amount),
                                      status: item.status,
                                      invoiceReference: item.invoiceReference || '',
                                      paidAt: date(item.paidAt),
                                    });
                                  }}
                                >
                                  Edit
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <form
                    className="space-y-4"
                    onSubmit={(e) =>
                      submit(e, () =>
                        mutate(
                          editingExpense ? `/importation/expenses/${editingExpense}` : `/importation/shipments/${shipment.id}/expenses`,
                          { ...expense, paidAt: expense.paidAt || undefined },
                          editingExpense ? 'Import expense updated.' : 'Import expense recorded.',
                          editingExpense ? 'PATCH' : 'POST',
                          () => {
                            setEditingExpense('');
                            setExpense({
                              category: 'Duties',
                              description: '',
                              currency: 'PHP',
                              amount: 0,
                              status: 'Estimated',
                              invoiceReference: '',
                              paidAt: '',
                            });
                          },
                        ),
                      )
                    }
                  >
                    <h3 className="font-semibold">{editingExpense ? 'Edit expense' : 'Add expense'}</h3>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <Field label="Category">
                        <select className={inputClass} value={expense.category} onChange={(e) => setExpense({ ...expense, category: e.target.value })}>
                          {['Duties', 'Taxes', 'Brokerage', 'Port Handling', 'Storage', 'Demurrage', 'Other'].map((value) => (
                            <option key={value}>{value}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Description">
                        <input
                          required
                          className={inputClass}
                          value={expense.description}
                          onChange={(e) =>
                            setExpense({
                              ...expense,
                              description: e.target.value,
                            })
                          }
                        />
                      </Field>
                      <Field label="Currency (ISO code)">
                        <input
                          required
                          pattern="[A-Z]{3}"
                          maxLength={3}
                          className={inputClass}
                          value={expense.currency}
                          onChange={(e) =>
                            setExpense({
                              ...expense,
                              currency: e.target.value.toUpperCase(),
                            })
                          }
                        />
                      </Field>
                      <Field label="Amount">
                        <input
                          required
                          type="number"
                          min="0"
                          step="0.01"
                          className={inputClass}
                          value={expense.amount}
                          onChange={(e) =>
                            setExpense({
                              ...expense,
                              amount: Number(e.target.value),
                            })
                          }
                        />
                      </Field>
                      <Field label="Status">
                        <select className={inputClass} value={expense.status} onChange={(e) => setExpense({ ...expense, status: e.target.value })}>
                          {['Estimated', 'Accrued', 'Invoiced', 'Paid'].map((value) => (
                            <option key={value}>{value}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Invoice reference">
                        <input
                          className={inputClass}
                          value={expense.invoiceReference}
                          onChange={(e) =>
                            setExpense({
                              ...expense,
                              invoiceReference: e.target.value,
                            })
                          }
                        />
                      </Field>
                      <Field label="Paid date">
                        <input
                          type="date"
                          required={expense.status === 'Paid'}
                          className={inputClass}
                          value={expense.paidAt}
                          onChange={(e) => setExpense({ ...expense, paidAt: e.target.value })}
                        />
                      </Field>
                    </div>
                    <div className="flex gap-3">
                      <button className={buttonClass}>{editingExpense ? 'Save expense' : 'Add expense'}</button>
                      {editingExpense && (
                        <button
                          type="button"
                          className={secondaryClass}
                          onClick={() => {
                            setEditingExpense('');
                            setExpense({
                              category: 'Duties',
                              description: '',
                              currency: 'PHP',
                              amount: 0,
                              status: 'Estimated',
                              invoiceReference: '',
                              paidAt: '',
                            });
                          }}
                        >
                          Cancel edit
                        </button>
                      )}
                    </div>
                  </form>
                </section>
              </>
            ))}
          {tab === 'GRN & QC' && (
            <>
              {!shipment ? (
                <Empty>Create and clear a shipment before receiving goods.</Empty>
              ) : (
                <>
                  <section className={panelClass}>
                    {shipmentSelector()}
                    <p className="mt-3 text-xs text-slate-500">
                      Only cleared quantities can be received. Accepted stock enters Physical Receiving in Master Inventory. Rejected and held quantities stay
                      in quarantine.
                    </p>
                  </section>
                  <details className={panelClass}>
                    <summary className="cursor-pointer font-bold">Record goods receipt & QC inspection</summary>
                    <form
                      className="mt-4 space-y-4"
                      onSubmit={(e) =>
                        submit(e, async () => {
                          const items = shipment.items
                            .map((item) => ({
                              shipmentLineId: item.id,
                              ...(receiptItems[item.id] || blankReceipt()),
                            }))
                            .filter((item) => item.receivedQty > 0 || item.notes.trim() || item.photos.length)
                            .map((item) => ({
                              ...item,
                              expirationDate: item.expirationDate || undefined,
                            }));
                          if (!items.length) {
                            setError('Enter a received quantity or document a missing item with notes or photos.');
                            return;
                          }
                          if (items.some((item) => item.acceptedQty + item.rejectedQty + item.heldQty !== item.receivedQty)) {
                            setError('Accepted, rejected and held quantities must equal received quantity for each line.');
                            return;
                          }
                          return mutate(
                            `/importation/shipments/${shipment.id}/receipts`,
                            {
                              ...receiptForm,
                              receivedAt: receiptForm.receivedAt || undefined,
                              items,
                            },
                            'Goods receipt saved. Accepted quantities are ready for stock placement.',
                            'POST',
                            () => {
                              setReceiptItems({});
                              setReceiptForm({ receivedAt: '', notes: '' });
                            },
                          );
                        })
                      }
                    >
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Received date (defaults to today)">
                          <input
                            type="date"
                            className={inputClass}
                            value={receiptForm.receivedAt}
                            onChange={(e) =>
                              setReceiptForm({
                                ...receiptForm,
                                receivedAt: e.target.value,
                              })
                            }
                          />
                        </Field>
                        <Field label="Receipt notes">
                          <input
                            className={inputClass}
                            value={receiptForm.notes}
                            onChange={(e) =>
                              setReceiptForm({
                                ...receiptForm,
                                notes: e.target.value,
                              })
                            }
                          />
                        </Field>
                      </div>
                      {shipment.items.map((item) => {
                        const draft = receiptItems[item.id] || blankReceipt();
                        const remaining = item.clearedQty - receiptTotal(item.id);
                        return (
                          <section key={item.id} className="space-y-3 rounded-xl border border-slate-200 p-4">
                            <div>
                              <h3 className="text-sm font-bold">
                                {item.purchaseOrderItem?.po?.poNumber} · {item.purchaseOrderItem?.productName}
                              </h3>
                              <p className="text-xs text-slate-500">
                                Ordered {item.purchaseOrderItem?.requestedQty} · Shipped {item.shippedQty} · Cleared {item.clearedQty} · Previously received{' '}
                                {receiptTotal(item.id)} · Remaining cleared {remaining}
                              </p>
                            </div>
                            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                              {(['receivedQty', 'acceptedQty', 'rejectedQty', 'heldQty'] as const).map((key) => (
                                <Field
                                  label={
                                    {
                                      receivedQty: 'Received',
                                      acceptedQty: 'Accepted',
                                      rejectedQty: 'Rejected',
                                      heldQty: 'Quarantine / hold',
                                    }[key]
                                  }
                                  key={key}
                                >
                                  <input
                                    required
                                    type="number"
                                    min="0"
                                    max={key === 'receivedQty' ? remaining : draft.receivedQty}
                                    step="1"
                                    className={inputClass}
                                    value={draft[key]}
                                    onChange={(e) =>
                                      updateReceipt(item.id, {
                                        [key]: Number(e.target.value),
                                      })
                                    }
                                  />
                                </Field>
                              ))}
                            </div>
                            {draft.receivedQty > 0 && draft.acceptedQty + draft.rejectedQty + draft.heldQty !== draft.receivedQty && (
                              <p className="text-xs text-red-700">Allocate every received unit to accepted, rejected or hold.</p>
                            )}
                            <div className="grid gap-3 sm:grid-cols-2">
                              <Field label="Batch number">
                                <input
                                  className={inputClass}
                                  value={draft.batchNumber}
                                  onChange={(e) =>
                                    updateReceipt(item.id, {
                                      batchNumber: e.target.value,
                                    })
                                  }
                                />
                              </Field>
                              <Field label="Expiration date">
                                <input
                                  type="date"
                                  className={inputClass}
                                  value={draft.expirationDate}
                                  onChange={(e) =>
                                    updateReceipt(item.id, {
                                      expirationDate: e.target.value,
                                    })
                                  }
                                />
                              </Field>
                            </div>
                            <Field label="Damage / missing quantity / inspection notes">
                              <textarea
                                className={inputClass}
                                value={draft.notes}
                                onChange={(e) =>
                                  updateReceipt(item.id, {
                                    notes: e.target.value,
                                  })
                                }
                                placeholder="Record shortages and damaged items; missing goods can be received later."
                              />
                            </Field>
                            <Field label="Damage / missing item photos (up to 6, 1 MB each)">
                              <input
                                type="file"
                                multiple
                                accept="image/jpeg,image/png,image/webp"
                                className={inputClass}
                                onChange={(e) => {
                                  void addPhotos(item.id, e.target.files);
                                  e.target.value = '';
                                }}
                              />
                            </Field>
                            {draft.photos.length > 0 && (
                              <div className="flex flex-wrap gap-3">
                                {draft.photos.map((photo, index) => (
                                  <div key={index}>
                                    <img src={photo} alt={`Inspection evidence ${index + 1}`} className="h-20 w-20 rounded-lg object-cover" />
                                    <button
                                      type="button"
                                      className="text-xs text-red-700"
                                      onClick={() =>
                                        updateReceipt(item.id, {
                                          photos: draft.photos.filter((_, i) => i !== index),
                                        })
                                      }
                                    >
                                      Remove
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </section>
                        );
                      })}
                      <button className={buttonClass}>Save goods receipt</button>
                    </form>
                  </details>
                </>
              )}
              <section className={panelClass}>
                <h2 className="mb-3 font-bold">Goods receipts & quarantine ledger</h2>
                {!data.receipts.length ? (
                  <Empty>No goods receipts yet.</Empty>
                ) : (
                  <div className="space-y-4">
                    {data.receipts.map((receipt) => (
                      <div key={receipt.id} className="rounded-xl border border-slate-200 p-4">
                        <div className="mb-3 flex flex-wrap justify-between gap-2">
                          <strong>{receipt.grnNumber}</strong>
                          <span className="text-xs text-slate-500">
                            {receipt.shipment?.shipmentNumber} · {date(receipt.receivedAt)}
                          </span>
                        </div>
                        {receipt.notes && <p className="mb-3 text-sm">{receipt.notes}</p>}
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[650px] text-left text-sm">
                            <thead className="bg-slate-50">
                              <tr>
                                {['Product', 'Received', 'Accepted', 'Rejected', 'Hold', 'Batch / expiry', 'QC'].map((label) => (
                                  <th className="p-2" key={label}>
                                    {label}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {receipt.items.map((line) => (
                                <tr className="border-t border-slate-100" key={line.id}>
                                  <td className="p-2">
                                    {line.shipmentLine?.purchaseOrderItem?.productName}
                                    <p className="text-xs text-slate-500">{line.notes}</p>
                                    <div className="mt-1 flex gap-1">
                                      {line.photos?.map((photo, i) =>
                                        /^(data:image\/(jpeg|png|webp);base64,|https:\/\/)/.test(photo) ? (
                                          <a key={i} href={photo} target="_blank" rel="noreferrer">
                                            <img className="h-10 w-10 rounded object-cover" src={photo} alt={`Inspection evidence ${i + 1}`} />
                                          </a>
                                        ) : null,
                                      )}
                                    </div>
                                  </td>
                                  <td className="p-2">{line.receivedQty}</td>
                                  <td className="p-2 text-emerald-700">{line.acceptedQty}</td>
                                  <td className="p-2 text-red-700">{line.rejectedQty}</td>
                                  <td className="p-2 text-amber-700">{line.heldQty}</td>
                                  <td className="p-2 text-xs">
                                    {line.batchNumber || '—'}
                                    <br />
                                    {date(line.expirationDate) || '—'}
                                  </td>
                                  <td className="p-2">
                                    <button
                                      className={secondaryClass}
                                      onClick={() => {
                                        setQcLine(line);
                                        setQcDraft({
                                          acceptedQty: line.acceptedQty,
                                          rejectedQty: line.rejectedQty,
                                          heldQty: line.heldQty,
                                          notes: line.notes || '',
                                        });
                                      }}
                                    >
                                      Reinspect
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
              {qcLine && (
                <section className={panelClass}>
                  <h2 className="mb-3 font-bold">QC reinspection · {qcLine.shipmentLine?.purchaseOrderItem?.productName}</h2>
                  <p className="mb-3 text-xs text-slate-500">
                    Allocation must total {qcLine.receivedQty}. Stock already placed cannot be withdrawn through this form.
                  </p>
                  <form
                    className="space-y-3"
                    onSubmit={(e) =>
                      submit(e, async () => {
                        if (qcDraft.acceptedQty + qcDraft.rejectedQty + qcDraft.heldQty !== qcLine.receivedQty) {
                          setError(`QC allocation must equal ${qcLine.receivedQty}.`);
                          return;
                        }
                        return mutate(`/importation/receipt-lines/${qcLine.id}/qc`, qcDraft, 'QC inspection updated.', 'PATCH', () => setQcLine(null));
                      })
                    }
                  >
                    <div className="grid gap-3 sm:grid-cols-3">
                      {(['acceptedQty', 'rejectedQty', 'heldQty'] as const).map((key) => (
                        <Field
                          key={key}
                          label={
                            {
                              acceptedQty: 'Accepted',
                              rejectedQty: 'Rejected',
                              heldQty: 'Hold / quarantine',
                            }[key]
                          }
                        >
                          <input
                            required
                            type="number"
                            min={key === 'acceptedQty' ? qcLine.placedQty || 0 : 0}
                            max={qcLine.receivedQty}
                            step="1"
                            className={inputClass}
                            value={qcDraft[key]}
                            onChange={(e) =>
                              setQcDraft({
                                ...qcDraft,
                                [key]: Number(e.target.value),
                              })
                            }
                          />
                        </Field>
                      ))}
                    </div>
                    <Field label="Inspection notes">
                      <textarea className={inputClass} value={qcDraft.notes} onChange={(e) => setQcDraft({ ...qcDraft, notes: e.target.value })} />
                    </Field>
                    <div className="flex gap-3">
                      <button className={buttonClass}>Save QC decision</button>
                      <button type="button" className={secondaryClass} onClick={() => setQcLine(null)}>
                        Cancel
                      </button>
                    </div>
                  </form>
                </section>
              )}
            </>
          )}
          {tab === 'Documents' && (
            <section className={panelClass}>
              <h2 className="mb-2 font-bold">Regulatory & import documents</h2>
              <p className="mb-4 text-sm text-slate-500">
                Upload or scan files in the existing AI Document Workspace, then link commercial invoices, packing lists, certificates of origin and FDA / CMDN
                permits here. AI Docs access is required.
              </p>
              {docsError && (
                <div role="alert" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                  {docsError}
                </div>
              )}
              {docsLoading ? (
                <p role="status">Loading documents…</p>
              ) : !documents.length ? (
                <Empty>No accessible documents found.</Empty>
              ) : (
                <>
                  <div className="mb-5 overflow-x-auto">
                    <table className="w-full min-w-[650px] text-left text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          {['Document', 'Type', 'Import file / shipment', 'Regulatory status', 'Expiry', ''].map((label, index) => (
                            <th className="p-3" key={index}>
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {documents.map((document) => {
                          const link = safeDocumentLink(document.googleDriveLink);
                          return (
                            <tr key={document.id} className="border-t border-slate-100">
                              <td className="p-3">
                                {link ? (
                                  <a href={link.href} target="_blank" rel="noreferrer" className="text-cyan-700 underline">
                                    {document.originalName}
                                  </a>
                                ) : (
                                  document.originalName
                                )}
                              </td>
                              <td className="p-3">{document.documentType || '—'}</td>
                              <td className="p-3 text-xs">
                                {data.importFiles.find((item) => item.id === document.importFileId)?.importNumber || '—'}
                                <br />
                                {data.shipments.find((item) => item.id === document.shipmentId)?.shipmentNumber || '—'}
                                {document.productId && <p>{data.products.find((item) => item.id === document.productId)?.name}</p>}
                              </td>
                              <td className="p-3">
                                <Status value={document.regulatoryStatus.replaceAll('_', ' ')} />
                              </td>
                              <td className="p-3 text-xs">
                                {date(document.expiryDate) || '—'}
                                <br />
                                {document.expiryStatus}
                              </td>
                              <td className="p-3">
                                <button
                                  className={secondaryClass}
                                  onClick={() => {
                                    setDocumentId(document.id);
                                    setDocumentForm({
                                      importFileId: document.importFileId || '',
                                      shipmentId: document.shipmentId || '',
                                      productId: document.productId ? String(document.productId) : '',
                                      regulatoryStatus: document.regulatoryStatus,
                                      documentType: document.documentType || '',
                                    });
                                  }}
                                >
                                  Edit links
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {documentId && (
                    <form
                      className="space-y-4 rounded-xl bg-slate-50 p-4"
                      onSubmit={(e) =>
                        submit(e, async () => {
                          const saved = await mutate(
                            `/api/docs/${documentId}/import-links`,
                            {
                              ...documentForm,
                              importFileId: documentForm.importFileId || null,
                              shipmentId: documentForm.shipmentId || null,
                              productId: documentForm.productId ? Number(documentForm.productId) : null,
                            },
                            'Document links updated.',
                            'PATCH',
                          );
                          if (saved) {
                            setDocumentId(null);
                            await loadDocuments();
                          }
                        })
                      }
                    >
                      <h3 className="font-semibold">{documents.find((item) => item.id === documentId)?.originalName}</h3>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Import file">
                          <select
                            className={inputClass}
                            value={documentForm.importFileId}
                            onChange={(e) =>
                              setDocumentForm({
                                ...documentForm,
                                importFileId: e.target.value,
                                shipmentId: '',
                              })
                            }
                          >
                            <option value="">No import file</option>
                            {data.importFiles.map((item) => (
                              <option value={item.id} key={item.id}>
                                {item.importNumber} · {item.title}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Shipment">
                          <select
                            className={inputClass}
                            value={documentForm.shipmentId}
                            onChange={(e) => {
                              const selected = data.shipments.find((item) => item.id === e.target.value);
                              setDocumentForm({
                                ...documentForm,
                                shipmentId: e.target.value,
                                importFileId: selected?.importFileId || documentForm.importFileId,
                              });
                            }}
                          >
                            <option value="">No shipment</option>
                            {data.shipments
                              .filter((item) => !documentForm.importFileId || item.importFileId === documentForm.importFileId)
                              .map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.shipmentNumber}
                                </option>
                              ))}
                          </select>
                        </Field>
                        <Field label="Product">
                          <select
                            className={inputClass}
                            value={documentForm.productId}
                            onChange={(e) =>
                              setDocumentForm({
                                ...documentForm,
                                productId: e.target.value,
                              })
                            }
                          >
                            <option value="">No product</option>
                            {data.products.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.sku} · {item.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Regulatory status">
                          <select
                            className={inputClass}
                            value={documentForm.regulatoryStatus}
                            onChange={(e) =>
                              setDocumentForm({
                                ...documentForm,
                                regulatoryStatus: e.target.value,
                              })
                            }
                          >
                            {['NOT_REQUESTED', 'REQUESTED', 'RECEIVED', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'EXPIRED'].map((value) => (
                              <option key={value} value={value}>
                                {value.replaceAll('_', ' ')}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Document type">
                          <input
                            className={inputClass}
                            value={documentForm.documentType}
                            onChange={(e) =>
                              setDocumentForm({
                                ...documentForm,
                                documentType: e.target.value,
                              })
                            }
                            placeholder="Commercial invoice, FDA / CMDN permit…"
                          />
                        </Field>
                      </div>
                      <div className="flex gap-3">
                        <button className={buttonClass}>Save document links</button>
                        <button type="button" className={secondaryClass} onClick={() => setDocumentId(null)}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                </>
              )}
            </section>
          )}
          {tab === 'Shipments' && (
            <>
              <div className="grid items-start gap-5 lg:grid-cols-2">
                <details className={panelClass}>
                  <summary className="cursor-pointer font-bold">Create import file</summary>
                  <form
                    className="mt-4 space-y-3"
                    onSubmit={(e) =>
                      submit(e, () =>
                        mutate('/importation/import-files', fileForm, 'Import file created.', 'POST', () => setFileForm({ title: '', notes: '' })),
                      )
                    }
                  >
                    <Field label="Title">
                      <input required className={inputClass} value={fileForm.title} onChange={(e) => setFileForm({ ...fileForm, title: e.target.value })} />
                    </Field>
                    <Field label="Notes">
                      <textarea className={inputClass} value={fileForm.notes} onChange={(e) => setFileForm({ ...fileForm, notes: e.target.value })} />
                    </Field>
                    <button className={buttonClass}>Create import file</button>
                  </form>
                </details>
                <details className={panelClass}>
                  <summary className="cursor-pointer font-bold">Create shipment (partial or consolidated POs)</summary>
                  <form
                    className="mt-4 space-y-4"
                    onSubmit={(e) =>
                      submit(e, () =>
                        mutate(
                          '/importation/shipments',
                          {
                            ...shipmentForm,
                            etd: shipmentForm.etd || undefined,
                            eta: shipmentForm.eta || undefined,
                            revisedEta: shipmentForm.revisedEta || undefined,
                            items: shipmentItems,
                          },
                          'Shipment created.',
                          'POST',
                          () => setShipmentItems([{ purchaseOrderItemId: '', shippedQty: 1 }]),
                        ),
                      )
                    }
                  >
                    <Field label="Import file">
                      <select
                        required
                        className={inputClass}
                        value={shipmentForm.importFileId}
                        onChange={(e) =>
                          setShipmentForm({
                            ...shipmentForm,
                            importFileId: e.target.value,
                          })
                        }
                      >
                        <option value="">Select import file</option>
                        {data.importFiles
                          .filter((file) => file.status !== 'Closed')
                          .map((file) => (
                            <option key={file.id} value={file.id}>
                              {file.importNumber} · {file.title}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {(['forwarder', 'carrier', 'blAwbNumber', 'containerReference'] as const).map((key) => (
                        <Field
                          key={key}
                          label={
                            {
                              forwarder: 'Forwarder',
                              carrier: 'Carrier',
                              blAwbNumber: 'BL / AWB number',
                              containerReference: 'Container reference',
                            }[key]
                          }
                        >
                          <input
                            className={inputClass}
                            value={shipmentForm[key]}
                            onChange={(e) =>
                              setShipmentForm({
                                ...shipmentForm,
                                [key]: e.target.value,
                              })
                            }
                          />
                        </Field>
                      ))}
                      <Field label="Shipping mode">
                        <select
                          className={inputClass}
                          value={shipmentForm.mode}
                          onChange={(e) =>
                            setShipmentForm({
                              ...shipmentForm,
                              mode: e.target.value,
                            })
                          }
                        >
                          {['Sea', 'Air', 'Land'].map((mode) => (
                            <option key={mode}>{mode}</option>
                          ))}
                        </select>
                      </Field>
                      {(['etd', 'eta', 'revisedEta'] as const).map((key) => (
                        <Field
                          label={
                            {
                              etd: 'ETD',
                              eta: 'ETA',
                              revisedEta: 'Revised ETA',
                            }[key]
                          }
                          key={key}
                        >
                          <input
                            type="date"
                            className={inputClass}
                            value={shipmentForm[key]}
                            onChange={(e) =>
                              setShipmentForm({
                                ...shipmentForm,
                                [key]: e.target.value,
                              })
                            }
                          />
                        </Field>
                      ))}
                    </div>
                    {shipmentItems.map((item, index) => (
                      <div key={index} className="space-y-2 rounded-lg bg-slate-50 p-3">
                        <Field label="Purchase order line">
                          <select
                            required
                            className={inputClass}
                            value={item.purchaseOrderItemId}
                            onChange={(e) =>
                              setShipmentItems(
                                shipmentItems.map((line, i) =>
                                  i === index
                                    ? {
                                        ...line,
                                        purchaseOrderItemId: e.target.value,
                                      }
                                    : line,
                                ),
                              )
                            }
                          >
                            <option value="">Select PO item</option>
                            {poOptions.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.poNumber} · {option.sku} · {option.productName} (ordered {option.requestedQty})
                              </option>
                            ))}
                          </select>
                        </Field>
                        <div className="flex items-end gap-3">
                          <div className="flex-1">
                            <Field label="Shipped quantity">
                              <input
                                required
                                type="number"
                                min="1"
                                step="1"
                                className={inputClass}
                                value={item.shippedQty}
                                onChange={(e) =>
                                  setShipmentItems(
                                    shipmentItems.map((line, i) =>
                                      i === index
                                        ? {
                                            ...line,
                                            shippedQty: Number(e.target.value),
                                          }
                                        : line,
                                    ),
                                  )
                                }
                              />
                            </Field>
                          </div>
                          <button
                            type="button"
                            className={secondaryClass}
                            disabled={shipmentItems.length === 1}
                            onClick={() => setShipmentItems(shipmentItems.filter((_, i) => i !== index))}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                    <Field label="Notes">
                      <textarea
                        className={inputClass}
                        value={shipmentForm.notes}
                        onChange={(e) =>
                          setShipmentForm({
                            ...shipmentForm,
                            notes: e.target.value,
                          })
                        }
                      />
                    </Field>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        className={secondaryClass}
                        onClick={() => setShipmentItems([...shipmentItems, { purchaseOrderItemId: '', shippedQty: 1 }])}
                      >
                        Add PO item
                      </button>
                      <button className={buttonClass}>Create shipment</button>
                    </div>
                  </form>
                </details>
              </div>
              <section className={panelClass}>
                <h2 className="mb-3 font-bold">Import files</h2>
                {!data.importFiles.length ? (
                  <Empty>No import files yet.</Empty>
                ) : (
                  <div className="space-y-2">
                    {data.importFiles.map((file) => (
                      <div key={file.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
                        <div>
                          <strong className="text-sm">
                            {file.importNumber} · {file.title}
                          </strong>
                          <p className="text-xs text-slate-500">
                            {file.notes} · {data.shipments.filter((item) => item.importFileId === file.id).length} shipments
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Status value={file.status} />
                          <button
                            className={secondaryClass}
                            onClick={() =>
                              void mutate(
                                `/importation/import-files/${file.id}`,
                                {
                                  status: file.status === 'Closed' ? 'Open' : 'Closed',
                                },
                                'Import file status updated.',
                                'PATCH',
                              )
                            }
                          >
                            {file.status === 'Closed' ? 'Reopen' : 'Close file'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
              <section className={panelClass}>
                <h2 className="mb-3 font-bold">Shipment tracker</h2>
                {!data.shipments.length ? (
                  <Empty>No shipments yet.</Empty>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[750px] text-left text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          {['Shipment / import file', 'Logistics', 'Dates', 'Status', 'Actions'].map((label) => (
                            <th className="p-3" key={label}>
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.shipments.map((item) => (
                          <tr key={item.id} className="border-t border-slate-100">
                            <td className="p-3">
                              <strong>{item.shipmentNumber}</strong>
                              <p className="text-xs text-slate-500">{item.importFile?.importNumber}</p>
                              {item.items.map((line) => (
                                <p key={line.id} className="mt-1 text-xs">
                                  {line.purchaseOrderItem?.po?.poNumber} · {line.purchaseOrderItem?.productName}: {line.shippedQty} shipped
                                </p>
                              ))}
                            </td>
                            <td className="p-3">
                              {item.mode} · {item.forwarder || 'No forwarder'}
                              <p className="text-xs">
                                {item.carrier} · {item.blAwbNumber}
                              </p>
                              <p className="text-xs">{item.containerReference}</p>
                            </td>
                            <td className="p-3 text-xs">
                              ETD: {date(item.etd) || '—'}
                              <br />
                              ETA: {date(item.eta) || '—'}
                              <br />
                              Revised: {date(item.revisedEta) || '—'}
                              <br />
                              Arrival: {date(item.actualArrival) || '—'}
                            </td>
                            <td className="p-3">
                              <Status value={item.status} />
                              {item.isDelayed && (
                                <p role="status" className="mt-2 font-semibold text-red-700">
                                  Delayed {item.delayDays} day(s)
                                </p>
                              )}
                            </td>
                            <td className="space-y-2 p-3">
                              <button className={secondaryClass} onClick={() => editShipment(item)}>
                                Edit tracking
                              </button>
                              <button
                                className={secondaryClass}
                                onClick={() => {
                                  selectShipment(item.id);
                                  setTab('Customs');
                                }}
                              >
                                Customs
                              </button>
                              <button
                                className={secondaryClass}
                                onClick={() => {
                                  selectShipment(item.id);
                                  setTab('GRN & QC');
                                }}
                              >
                                Receive / QC
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
              {editingShipment && (
                <section className={panelClass}>
                  <h2 className="mb-3 font-bold">Edit {data.shipments.find((item) => item.id === editingShipment)?.shipmentNumber}</h2>
                  <form
                    className="space-y-4"
                    onSubmit={(e) =>
                      submit(e, () =>
                        mutate(`/importation/shipments/${editingShipment}`, logistics, 'Shipment tracking updated.', 'PATCH', () => setEditingShipment('')),
                      )
                    }
                  >
                    <div className="grid gap-3 sm:grid-cols-3">
                      {(['forwarder', 'carrier', 'blAwbNumber', 'containerReference', 'notes'] as const).map((key) => (
                        <Field
                          key={key}
                          label={
                            {
                              forwarder: 'Forwarder',
                              carrier: 'Carrier',
                              blAwbNumber: 'BL / AWB number',
                              containerReference: 'Container reference',
                              notes: 'Notes',
                            }[key]
                          }
                        >
                          <input
                            className={inputClass}
                            value={logistics[key]}
                            onChange={(e) =>
                              setLogistics({
                                ...logistics,
                                [key]: e.target.value,
                              })
                            }
                          />
                        </Field>
                      ))}
                      <Field label="Mode">
                        <select className={inputClass} value={logistics.mode} onChange={(e) => setLogistics({ ...logistics, mode: e.target.value })}>
                          {['Sea', 'Air', 'Land'].map((value) => (
                            <option key={value}>{value}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Status">
                        <select
                          className={inputClass}
                          value={logistics.status}
                          onChange={(e) =>
                            setLogistics({
                              ...logistics,
                              status: e.target.value,
                            })
                          }
                        >
                          {['Planned', 'In Transit', 'Arrived', 'Closed'].map((value) => (
                            <option key={value}>{value}</option>
                          ))}
                        </select>
                      </Field>
                      {(['etd', 'eta', 'revisedEta', 'actualArrival'] as const).map((key) => (
                        <Field
                          key={key}
                          label={
                            {
                              etd: 'ETD',
                              eta: 'ETA',
                              revisedEta: 'Revised ETA',
                              actualArrival: 'Actual arrival',
                            }[key]
                          }
                        >
                          <input
                            type="date"
                            className={inputClass}
                            value={logistics[key]}
                            onChange={(e) =>
                              setLogistics({
                                ...logistics,
                                [key]: e.target.value,
                              })
                            }
                          />
                        </Field>
                      ))}
                    </div>
                    <div className="flex gap-3">
                      <button className={buttonClass}>Save tracking</button>
                      <button type="button" className={secondaryClass} onClick={() => setEditingShipment('')}>
                        Cancel
                      </button>
                    </div>
                  </form>
                </section>
              )}
            </>
          )}
        </fieldset>
        {busy && (
          <p role="status" className="text-sm font-semibold text-cyan-700">
            Saving changes…
          </p>
        )}
      </main>
    </div>
  );
}
