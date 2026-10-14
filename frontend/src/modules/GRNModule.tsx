import { useState, useEffect, useCallback } from 'react';
import { getApiAuthHeaders } from '../lib/apiSession';

// ---- INTERFACES ----
interface GRNLine { id?: string; poId?: string; poItemId?: string; productId?: number; sku: string; productName: string; batchNumber?: string; expirationDate?: string; orderedQty: number; shippedQty: number; clearedQty: number; receivedQty: number; acceptedQty: number; rejectedQty: number; qcStatus: string; qcNotes?: string; photoUrls?: string[]; quarantineStatus?: string; quarantineReason?: string; pushedToInventory?: boolean; }
interface GoodsReceipt { id: string; grnNumber: string; shipmentId: string; company: string; receivedBy: string; receivedAt: string; status: string; remarks?: string; createdAt: string; lines: GRNLine[]; }
interface Shipment { id: string; shpNumber: string; status: string; }
interface PO { id: string; poNumber: string; items: POItem[]; supplierName?: string; }
interface POItem { id: string; productId: number; sku: string; productName: string; requestedQty: number; unitCost: number; }
interface Props { selectedCompany: string; loginUsername: string; API_BASE_URL: string; onBack: () => void; initialShipment?: Shipment | null; }

const GRN_STATUS: Record<string, string> = { Draft: 'bg-gray-100 text-gray-600', 'In Progress': 'bg-amber-100 text-amber-700', Completed: 'bg-green-100 text-green-700', Cancelled: 'bg-red-100 text-red-700' };
const QC_STATUS: Record<string, string> = { Pending: 'bg-gray-100 text-gray-500', Passed: 'bg-green-100 text-green-700', Failed: 'bg-red-100 text-red-700', Partial: 'bg-amber-100 text-amber-700', Quarantine: 'bg-purple-100 text-purple-700' };

export default function GRNModule({ selectedCompany, loginUsername, API_BASE_URL, onBack, initialShipment }: Props) {
  const [grns, setGrns] = useState<GoodsReceipt[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [allPos, setAllPos] = useState<PO[]>([]);
  const [filterShipment, setFilterShipment] = useState<string>(initialShipment?.id ?? '');
  const [selectedGrn, setSelectedGrn] = useState<GoodsReceipt | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // Create GRN form
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [grnForm, setGrnForm] = useState({ shipmentId: initialShipment?.id ?? '', remarks: '' });
  const [grnLines, setGrnLines] = useState<GRNLine[]>([]);
  const [nextGrnNumber, setNextGrnNumber] = useState('GRN-...');
  const [selectedPoIds, setSelectedPoIds] = useState<string[]>([]);

  // Line editing
  const [editingLineId, setEditingLineId] = useState<string | null>(null);

  const toast$ = (msg: string, type: 'success' | 'error' = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3500); };
  const h = () => ({ 'Content-Type': 'application/json', ...getApiAuthHeaders() });

  const fetchGrns = useCallback(async (shipmentId?: string) => {
    setLoading(true);
    try {
      const q = shipmentId ? `shipmentId=${shipmentId}` : `company=${encodeURIComponent(selectedCompany)}`;
      const res = await fetch(`${API_BASE_URL}/importation/grn?${q}`, { headers: getApiAuthHeaders() });
      if (res.ok) setGrns(await res.json());
    } catch { toast$('Failed to load GRNs', 'error'); }
    finally { setLoading(false); }
  }, [selectedCompany, API_BASE_URL]);

  const fetchShipments = useCallback(async () => {
    try { const r = await fetch(`${API_BASE_URL}/importation/shipments?company=${encodeURIComponent(selectedCompany)}`, { headers: getApiAuthHeaders() }); if (r.ok) setShipments(await r.json()); } catch { /* silent */ }
  }, [selectedCompany, API_BASE_URL]);

  const fetchPos = useCallback(async () => {
    try { const r = await fetch(`${API_BASE_URL}/procurement/purchase-orders?company=${encodeURIComponent(selectedCompany)}`, { headers: getApiAuthHeaders() }); if (r.ok) setAllPos(await r.json()); } catch { /* silent */ }
  }, [selectedCompany, API_BASE_URL]);

  const fetchNextGrn = useCallback(async () => {
    try { const r = await fetch(`${API_BASE_URL}/importation/grn/next-number?company=${encodeURIComponent(selectedCompany)}`, { headers: getApiAuthHeaders() }); if (r.ok) { const d = await r.json(); setNextGrnNumber(d.grnNumber); } } catch { setNextGrnNumber('GRN-ERROR'); }
  }, [selectedCompany, API_BASE_URL]);

  useEffect(() => { fetchGrns(filterShipment || undefined); fetchShipments(); fetchPos(); }, [fetchGrns, fetchShipments, fetchPos, filterShipment]);

  // Auto-populate lines from selected POs
  const populateLinesFromPos = () => {
    const lines: GRNLine[] = [];
    for (const poId of selectedPoIds) {
      const po = allPos.find(p => p.id === poId);
      if (!po) continue;
      for (const item of po.items) {
        lines.push({ productId: item.productId, sku: item.sku, productName: item.productName, poId: po.id, poItemId: item.id, orderedQty: item.requestedQty, shippedQty: 0, clearedQty: 0, receivedQty: 0, acceptedQty: 0, rejectedQty: 0, qcStatus: 'Pending' });
      }
    }
    setGrnLines(lines);
  };

  useEffect(() => { if (selectedPoIds.length > 0) populateLinesFromPos(); }, [selectedPoIds]);

  const addBlankLine = () => setGrnLines(prev => [...prev, { sku: '', productName: '', orderedQty: 0, shippedQty: 0, clearedQty: 0, receivedQty: 0, acceptedQty: 0, rejectedQty: 0, qcStatus: 'Pending' }]);
  const removeLine = (i: number) => setGrnLines(prev => prev.filter((_, idx) => idx !== i));
  const updateLine = (i: number, field: keyof GRNLine, value: any) => setGrnLines(prev => prev.map((l, idx) => idx === i ? { ...l, [field]: value } : l));

  const createGrn = async () => {
    if (!grnForm.shipmentId) { toast$('Select a shipment', 'error'); return; }
    if (grnLines.length === 0) { toast$('Add at least one line', 'error'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/importation/grn`, { method: 'POST', headers: h(), body: JSON.stringify({ company: selectedCompany, receivedBy: loginUsername, ...grnForm, lines: grnLines }) });
      if (!res.ok) throw new Error((await res.json()).message);
      const created = await res.json();
      toast$('GRN created!');
      setShowCreateModal(false);
      setGrnLines([]);
      setSelectedPoIds([]);
      fetchGrns(filterShipment || undefined);
      setSelectedGrn(created);
    } catch (e: any) { toast$(e.message, 'error'); }
    finally { setLoading(false); }
  };

  const updateGrnLine = async (grnId: string, lineId: string, updates: Partial<GRNLine>) => {
    try {
      const res = await fetch(`${API_BASE_URL}/importation/grn/${grnId}/lines/${lineId}`, { method: 'PATCH', headers: h(), body: JSON.stringify(updates) });
      if (!res.ok) throw new Error((await res.json()).message);
      toast$('Line updated');
      // Refresh selected GRN
      const r2 = await fetch(`${API_BASE_URL}/importation/grn/${grnId}`, { headers: getApiAuthHeaders() });
      if (r2.ok) { const updated = await r2.json(); setSelectedGrn(updated); setGrns(prev => prev.map(g => g.id === grnId ? updated : g)); }
      setEditingLineId(null);
    } catch (e: any) { toast$(e.message, 'error'); }
  };

  const completeGrn = async (grnId: string) => {
    if (!window.confirm('Complete this GRN? Accepted quantities will be pushed to inventory.')) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/importation/grn/${grnId}/complete`, { method: 'POST', headers: h(), body: JSON.stringify({ completedBy: loginUsername }) });
      if (!res.ok) throw new Error((await res.json()).message);
      toast$('GRN completed! Accepted stock has been added to inventory.');
      const r2 = await fetch(`${API_BASE_URL}/importation/grn/${grnId}`, { headers: getApiAuthHeaders() });
      if (r2.ok) { const updated = await r2.json(); setSelectedGrn(updated); setGrns(prev => prev.map(g => g.id === grnId ? updated : g)); }
    } catch (e: any) { toast$(e.message, 'error'); }
    finally { setLoading(false); }
  };

  const fmtDate = (d?: string) => d ? new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

  // Edit line state
  const [lineEdits, setLineEdits] = useState<Partial<GRNLine>>({});

  const openLineEdit = (line: GRNLine & { id?: string }) => {
    setEditingLineId(line.id ?? null);
    setLineEdits({ receivedQty: line.receivedQty, acceptedQty: line.acceptedQty, rejectedQty: line.rejectedQty, qcStatus: line.qcStatus, qcNotes: line.qcNotes, batchNumber: line.batchNumber, expirationDate: line.expirationDate?.split('T')[0], quarantineStatus: line.quarantineStatus, quarantineReason: line.quarantineReason });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {toast && <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-medium ${toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>{toast.msg}</div>}

      {/* HEADER */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center gap-4">
          <button onClick={onBack} className="text-gray-400 hover:text-gray-900"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg></button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-gray-900">Goods Receipt & QC Quarantine</h1>
            <p className="text-xs text-gray-500">{selectedCompany} · GRN receiving, QC inspection, and quarantine management</p>
          </div>
          <select value={filterShipment} onChange={e => { setFilterShipment(e.target.value); setSelectedGrn(null); }} className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white">
            <option value="">All Shipments</option>
            {shipments.map(s => <option key={s.id} value={s.id}>{s.shpNumber}</option>)}
          </select>
          <button onClick={() => { fetchNextGrn(); setGrnLines([]); setSelectedPoIds([]); setGrnForm({ shipmentId: filterShipment || (shipments[0]?.id ?? ''), remarks: '' }); setShowCreateModal(true); }} className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700">+ New GRN</button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 flex gap-6">
        {/* GRN LIST */}
        <div className="w-72 shrink-0 space-y-3">
          {loading && !selectedGrn && <p className="text-center text-gray-400 text-sm py-8">Loading...</p>}
          {!loading && grns.length === 0 && <p className="text-center text-gray-400 text-sm py-8">No GRNs found</p>}
          {grns.map(grn => (
            <button key={grn.id} onClick={() => setSelectedGrn(grn)} className={`w-full text-left rounded-xl border p-4 transition-all ${selectedGrn?.id === grn.id ? 'border-teal-500 bg-teal-50 shadow' : 'border-gray-200 bg-white hover:border-teal-200'}`}>
              <p className="font-mono font-bold text-teal-700 text-sm">{grn.grnNumber}</p>
              <p className="text-xs text-gray-500 mt-0.5">Received by: {grn.receivedBy}</p>
              <p className="text-xs text-gray-400">{fmtDate(grn.receivedAt)}</p>
              <div className="flex items-center justify-between mt-2">
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${GRN_STATUS[grn.status] ?? 'bg-gray-100 text-gray-600'}`}>{grn.status}</span>
                <span className="text-xs text-gray-400">{grn.lines.length} lines</span>
              </div>
              {/* Summary counts */}
              <div className="mt-2 flex gap-2 text-xs">
                <span className="text-green-600">✓ {grn.lines.reduce((s, l) => s + l.acceptedQty, 0)} acc</span>
                {grn.lines.some(l => l.rejectedQty > 0) && <span className="text-red-500">✗ {grn.lines.reduce((s, l) => s + l.rejectedQty, 0)} rej</span>}
                {grn.lines.some(l => l.quarantineStatus === 'Hold') && <span className="text-purple-600">⚑ Hold</span>}
              </div>
            </button>
          ))}
        </div>

        {/* GRN DETAIL */}
        {selectedGrn ? (
          <div className="flex-1 space-y-4">
            {/* Header card */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide">Goods Receipt Note</p>
                  <h2 className="text-2xl font-bold text-teal-700 font-mono">{selectedGrn.grnNumber}</h2>
                  <div className="text-sm text-gray-500 mt-1 space-y-0.5">
                    <p>Received by: <strong>{selectedGrn.receivedBy}</strong> on {fmtDate(selectedGrn.receivedAt)}</p>
                    {selectedGrn.remarks && <p className="text-gray-400">{selectedGrn.remarks}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-3 py-1 rounded-full text-sm font-semibold ${GRN_STATUS[selectedGrn.status] ?? 'bg-gray-100 text-gray-600'}`}>{selectedGrn.status}</span>
                  {selectedGrn.status !== 'Completed' && selectedGrn.status !== 'Cancelled' && (
                    <button onClick={() => completeGrn(selectedGrn.id)} disabled={loading} className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-60">✓ Complete & Push to Inventory</button>
                  )}
                </div>
              </div>
              {/* Qty summary bar */}
              <div className="mt-4 grid grid-cols-2 md:grid-cols-6 gap-3 text-xs">
                {(['orderedQty','shippedQty','clearedQty','receivedQty','acceptedQty','rejectedQty'] as const).map(f => {
                  const total = selectedGrn.lines.reduce((s, l) => s + (l[f] ?? 0), 0);
                  const colors: Record<string, string> = { orderedQty: 'bg-gray-100', shippedQty: 'bg-blue-50', clearedQty: 'bg-teal-50', receivedQty: 'bg-amber-50', acceptedQty: 'bg-green-50', rejectedQty: 'bg-red-50 text-red-700' };
                  const labels: Record<string, string> = { orderedQty: 'Ordered', shippedQty: 'Shipped', clearedQty: 'Cleared', receivedQty: 'Received', acceptedQty: 'Accepted', rejectedQty: 'Rejected' };
                  return (<div key={f} className={`rounded-xl px-3 py-2 text-center ${colors[f] ?? 'bg-gray-50'}`}><p className="opacity-60 text-xs uppercase tracking-wide">{labels[f]}</p><p className="text-lg font-bold">{total}</p></div>);
                })}
              </div>
            </div>

            {/* Lines table */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-semibold text-gray-800">Line Items</h3>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400 inline-block"></span> Passed</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block"></span> Failed</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-400 inline-block"></span> Quarantine</span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>{['SKU','Product','Batch','Expiry','Ordered','Shipped','Cleared','Rcvd','Acc','Rej','QC Status','Quarantine',''].map(h => <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {selectedGrn.lines.map((line, i) => (
                      <>
                        <tr key={`${line.id}-row`} className={`hover:bg-gray-50 ${line.pushedToInventory ? 'opacity-60' : ''}`}>
                          <td className="px-3 py-2 font-mono text-xs text-gray-500">{line.sku}</td>
                          <td className="px-3 py-2 font-medium text-gray-800 text-xs max-w-[150px] truncate">{line.productName}</td>
                          <td className="px-3 py-2 text-xs text-gray-500">{line.batchNumber ?? '—'}</td>
                          <td className="px-3 py-2 text-xs text-gray-500">{line.expirationDate ? fmtDate(line.expirationDate) : '—'}</td>
                          <td className="px-3 py-2 text-center">{line.orderedQty}</td>
                          <td className="px-3 py-2 text-center">{line.shippedQty}</td>
                          <td className="px-3 py-2 text-center">{line.clearedQty}</td>
                          <td className="px-3 py-2 text-center">{line.receivedQty}</td>
                          <td className="px-3 py-2 text-center text-green-700 font-semibold">{line.acceptedQty}</td>
                          <td className="px-3 py-2 text-center text-red-600 font-semibold">{line.rejectedQty}</td>
                          <td className="px-3 py-2"><span className={`px-1.5 py-0.5 rounded-full text-xs font-semibold ${QC_STATUS[line.qcStatus] ?? 'bg-gray-100 text-gray-500'}`}>{line.qcStatus}</span></td>
                          <td className="px-3 py-2">{line.quarantineStatus && <span className={`px-1.5 py-0.5 rounded-full text-xs font-semibold ${line.quarantineStatus === 'Hold' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-500'}`}>{line.quarantineStatus}</span>}</td>
                          <td className="px-3 py-2">
                            {!line.pushedToInventory && selectedGrn.status !== 'Completed' && (
                              <button onClick={() => openLineEdit(line as GRNLine & { id: string })} className="text-xs text-blue-600 hover:underline">Edit QC</button>
                            )}
                            {line.pushedToInventory && <span className="text-xs text-green-600">✓ In Stock</span>}
                          </td>
                        </tr>
                        {/* Inline QC edit row */}
                        {editingLineId === line.id && (
                          <tr key={`${line.id}-edit`} className="bg-blue-50">
                            <td colSpan={13} className="px-4 py-4">
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                {([['receivedQty','Received Qty','number'],['acceptedQty','Accepted Qty','number'],['rejectedQty','Rejected Qty','number'],['batchNumber','Batch Number','text'],['expirationDate','Expiry Date','date']] as [keyof GRNLine, string, string][]).map(([field, label, type]) => (
                                  <div key={field}><label className="block text-xs font-semibold text-gray-600 mb-1">{label}</label><input type={type} value={(lineEdits as any)[field] ?? ''} onChange={e => setLineEdits(p => ({...p, [field]: type === 'number' ? Number(e.target.value) : e.target.value}))} className="w-full border border-blue-200 rounded-lg px-2 py-1.5 text-sm bg-white" /></div>
                                ))}
                                <div><label className="block text-xs font-semibold text-gray-600 mb-1">QC Status</label>
                                  <select value={(lineEdits as any).qcStatus ?? 'Pending'} onChange={e => setLineEdits(p => ({...p, qcStatus: e.target.value}))} className="w-full border border-blue-200 rounded-lg px-2 py-1.5 text-sm bg-white">
                                    {Object.keys(QC_STATUS).map(s => <option key={s}>{s}</option>)}
                                  </select>
                                </div>
                                <div><label className="block text-xs font-semibold text-gray-600 mb-1">Quarantine</label>
                                  <select value={(lineEdits as any).quarantineStatus ?? ''} onChange={e => setLineEdits(p => ({...p, quarantineStatus: e.target.value || null}))} className="w-full border border-blue-200 rounded-lg px-2 py-1.5 text-sm bg-white">
                                    <option value="">None</option>
                                    <option value="Hold">Hold</option>
                                    <option value="Released">Released</option>
                                    <option value="Destroyed">Destroyed</option>
                                  </select>
                                </div>
                                <div className="col-span-2"><label className="block text-xs font-semibold text-gray-600 mb-1">QC Notes</label><input value={(lineEdits as any).qcNotes ?? ''} onChange={e => setLineEdits(p => ({...p, qcNotes: e.target.value}))} className="w-full border border-blue-200 rounded-lg px-2 py-1.5 text-sm bg-white" placeholder="Inspection notes, damage description..." /></div>
                              </div>
                              <div className="flex gap-3 mt-3">
                                <button onClick={() => updateGrnLine(selectedGrn.id, line.id!, lineEdits)} className="px-4 py-2 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700">Save QC Result</button>
                                <button onClick={() => setEditingLineId(null)} className="px-4 py-2 bg-gray-100 text-gray-600 text-xs rounded-lg">Cancel</button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center"><p className="text-lg">Select a GRN to inspect</p><p className="text-sm mt-1">Or create a new one with "+ New GRN"</p></div>
          </div>
        )}
      </div>

      {/* CREATE GRN MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
              <div><h3 className="font-bold text-gray-900">New Goods Receipt</h3><p className="text-xs text-gray-400 font-mono">{nextGrnNumber}</p></div>
              <button onClick={() => setShowCreateModal(false)} className="text-gray-400 text-2xl">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-xs font-semibold text-gray-600 mb-1">Shipment *</label>
                  <select value={grnForm.shipmentId} onChange={e => setGrnForm(p => ({...p, shipmentId: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                    <option value="">— Select Shipment —</option>
                    {shipments.map(s => <option key={s.id} value={s.id}>{s.shpNumber}</option>)}
                  </select>
                </div>
                <div><label className="block text-xs font-semibold text-gray-600 mb-1">Remarks</label><input value={grnForm.remarks} onChange={e => setGrnForm(p => ({...p, remarks: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-2">Auto-populate lines from Purchase Orders</label>
                <div className="max-h-32 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                  {allPos.filter(p => !['Cancelled'].includes((p as any).status)).map(po => (
                    <label key={po.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm">
                      <input type="checkbox" checked={selectedPoIds.includes(po.id)} onChange={e => setSelectedPoIds(prev => e.target.checked ? [...prev, po.id] : prev.filter(x => x !== po.id))} className="accent-teal-600" />
                      <span className="font-mono text-teal-700 text-xs">{po.poNumber}</span>
                      {po.supplierName && <span className="text-gray-500 text-xs">{po.supplierName}</span>}
                      <span className="text-gray-400 text-xs">{po.items?.length ?? 0} items</span>
                    </label>
                  ))}
                  {allPos.length === 0 && <p className="text-center text-gray-400 text-xs py-4">No POs available</p>}
                </div>
              </div>

              {/* Line items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-gray-600">Line Items</label>
                  <button onClick={addBlankLine} className="text-xs px-3 py-1 bg-teal-50 text-teal-700 rounded-lg hover:bg-teal-100">+ Add Blank Line</button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50"><tr>{['SKU','Product Name','Ordered','Shipped','Cleared','Rcvd','Acc','Rej','Batch','Expiry',''].map(h => <th key={h} className="px-2 py-1.5 text-left font-semibold text-gray-500 uppercase whitespace-nowrap">{h}</th>)}</tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {grnLines.map((l, i) => (
                        <tr key={i}>
                          <td className="px-2 py-1"><input value={l.sku} onChange={e => updateLine(i, 'sku', e.target.value)} className="w-20 border border-gray-200 rounded px-1.5 py-1 text-xs" /></td>
                          <td className="px-2 py-1"><input value={l.productName} onChange={e => updateLine(i, 'productName', e.target.value)} className="w-36 border border-gray-200 rounded px-1.5 py-1 text-xs" /></td>
                          {(['orderedQty','shippedQty','clearedQty','receivedQty','acceptedQty','rejectedQty'] as const).map(f => <td key={f} className="px-2 py-1"><input type="number" value={l[f] ?? 0} min={0} onChange={e => updateLine(i, f, Number(e.target.value))} className="w-14 border border-gray-200 rounded px-1.5 py-1 text-xs text-center" /></td>)}
                          <td className="px-2 py-1"><input value={l.batchNumber ?? ''} onChange={e => updateLine(i, 'batchNumber', e.target.value)} className="w-20 border border-gray-200 rounded px-1.5 py-1 text-xs" placeholder="Batch" /></td>
                          <td className="px-2 py-1"><input type="date" value={l.expirationDate ?? ''} onChange={e => updateLine(i, 'expirationDate', e.target.value)} className="w-28 border border-gray-200 rounded px-1.5 py-1 text-xs" /></td>
                          <td className="px-2 py-1"><button onClick={() => removeLine(i)} className="text-red-400 hover:text-red-600 text-base">×</button></td>
                        </tr>
                      ))}
                      {grnLines.length === 0 && <tr><td colSpan={11} className="text-center text-gray-400 py-4 text-xs">Select POs above or add blank lines</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={() => setShowCreateModal(false)} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg">Cancel</button>
              <button onClick={createGrn} disabled={loading} className="px-5 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-60">{loading ? 'Creating...' : 'Create GRN'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
