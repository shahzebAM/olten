import { useState, useEffect, useCallback } from 'react';
import { getApiAuthHeaders } from '../lib/apiSession';

// ---- INTERFACES ----
interface PRItem { id?: string; productId?: number; sku?: string; productName: string; requestedQty: number; unit: string; estimatedCost?: number; notes?: string; }
interface PurchaseRequisition { id: string; prNumber: string; company: string; requestedBy: string; department?: string; purpose?: string; status: string; priority: string; neededBy?: string; approvedBy?: string; approvedAt?: string; rejectedBy?: string; rejectionReason?: string; notes?: string; createdAt: string; items: PRItem[]; quotations: SupplierQuotation[]; }
interface SQItem { id?: string; productId?: number; sku?: string; productName: string; moq: number; quotedQty: number; unitPriceForeign: number; unitPricePhp: number; lineTotal: number; }
interface SupplierQuotation { id: string; sqNumber: string; requisitionId: string; supplierName: string; currency: string; exchangeRate: number; paymentTerms?: string; leadTimeDays?: number; validUntil?: string; status: string; approvedBy?: string; createdBy: string; createdAt: string; items: SQItem[]; }
interface Props { selectedCompany: string; loginUsername: string; API_BASE_URL: string; onBack: () => void; }

const STATUS_COLORS: Record<string, string> = {
  Draft: 'bg-gray-100 text-gray-700',
  'Pending Approval': 'bg-amber-100 text-amber-800',
  Approved: 'bg-green-100 text-green-700',
  Rejected: 'bg-red-100 text-red-700',
  'PO Issued': 'bg-blue-100 text-blue-700',
  Pending: 'bg-gray-100 text-gray-700',
};

const PRIORITY_COLORS: Record<string, string> = {
  Low: 'text-gray-500', Normal: 'text-blue-600', High: 'text-amber-600', Urgent: 'text-red-600',
};

export default function PurchaseRequisitionModule({ selectedCompany, loginUsername, API_BASE_URL, onBack }: Props) {
  const [activeTab, setActiveTab] = useState<'list' | 'create' | 'detail'>('list');
  const [prs, setPrs] = useState<PurchaseRequisition[]>([]);
  const [selectedPr, setSelectedPr] = useState<PurchaseRequisition | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [nextPrNumber, setNextPrNumber] = useState('PR-...');

  // Create form state
  const [form, setForm] = useState({ department: '', purpose: '', priority: 'Normal', neededBy: '', notes: '' });
  const [formItems, setFormItems] = useState<PRItem[]>([{ productName: '', requestedQty: 1, unit: 'pcs' }]);

  // Quotation form state
  const [showSQModal, setShowSQModal] = useState(false);
  const [sqForm, setSqForm] = useState({ supplierName: '', currency: 'PHP', exchangeRate: 1, paymentTerms: '', leadTimeDays: '', validUntil: '', notes: '' });
  const [sqItems, setSqItems] = useState<SQItem[]>([]);

  const toast$ = (msg: string, type: 'success' | 'error' = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3500); };

  const headers = () => ({ 'Content-Type': 'application/json', ...getApiAuthHeaders() });

  const fetchPrs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/procurement/requisitions?company=${encodeURIComponent(selectedCompany)}`, { headers: getApiAuthHeaders() });
      if (res.ok) setPrs(await res.json());
    } catch { toast$('Failed to load requisitions', 'error'); }
    finally { setLoading(false); }
  }, [selectedCompany, API_BASE_URL]);

  const fetchNextNumber = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/procurement/requisitions/next-number?company=${encodeURIComponent(selectedCompany)}`, { headers: getApiAuthHeaders() });
      if (res.ok) { const d = await res.json(); setNextPrNumber(d.prNumber); }
    } catch { setNextPrNumber('PR-ERROR'); }
  }, [selectedCompany, API_BASE_URL]);

  useEffect(() => { if (activeTab === 'list') fetchPrs(); if (activeTab === 'create') { fetchNextNumber(); setForm({ department: '', purpose: '', priority: 'Normal', neededBy: '', notes: '' }); setFormItems([{ productName: '', requestedQty: 1, unit: 'pcs' }]); } }, [activeTab, fetchPrs, fetchNextNumber]);

  const openDetail = async (pr: PurchaseRequisition) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/procurement/requisitions/${pr.id}`, { headers: getApiAuthHeaders() });
      if (res.ok) { setSelectedPr(await res.json()); setActiveTab('detail'); }
    } catch { toast$('Failed to load details', 'error'); }
    finally { setLoading(false); }
  };

  const submitCreate = async () => {
    if (formItems.every(i => !i.productName.trim())) { toast$('Add at least one item', 'error'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/procurement/requisitions`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ company: selectedCompany, requestedBy: loginUsername, ...form, neededBy: form.neededBy || null, items: formItems.filter(i => i.productName.trim()) }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      toast$('Requisition created!');
      setActiveTab('list');
      fetchPrs();
    } catch (e: any) { toast$(e.message || 'Error creating PR', 'error'); }
    finally { setLoading(false); }
  };

  const doAction = async (id: string, action: 'submit' | 'approve' | 'reject', extra?: object) => {
    setLoading(true);
    try {
      const body = action === 'submit' ? {} : action === 'approve' ? { approvedBy: loginUsername } : { rejectedBy: loginUsername };
      const res = await fetch(`${API_BASE_URL}/procurement/requisitions/${id}/${action}`, {
        method: 'PATCH', headers: headers(), body: JSON.stringify({ ...body, ...extra }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      toast$(`Requisition ${action}d successfully`);
      fetchPrs();
      if (selectedPr?.id === id) openDetail({ ...selectedPr, id });
    } catch (e: any) { toast$(e.message || 'Error', 'error'); }
    finally { setLoading(false); }
  };

  const openSQModal = () => {
    if (!selectedPr) return;
    setSqForm({ supplierName: '', currency: 'PHP', exchangeRate: 1, paymentTerms: '', leadTimeDays: '', validUntil: '', notes: '' });
    setSqItems(selectedPr.items.map(i => ({ productName: i.productName, sku: i.sku ?? '', productId: i.productId, moq: 1, quotedQty: i.requestedQty, unitPriceForeign: 0, unitPricePhp: 0, lineTotal: 0 })));
    setShowSQModal(true);
  };

  const submitSQ = async () => {
    if (!selectedPr || !sqForm.supplierName.trim()) { toast$('Supplier name is required', 'error'); return; }
    setLoading(true);
    try {
      const rate = Number(sqForm.exchangeRate) || 1;
      const enrichedItems = sqItems.map(i => ({ ...i, unitPricePhp: i.unitPriceForeign * rate, lineTotal: i.quotedQty * i.unitPriceForeign * rate }));
      const res = await fetch(`${API_BASE_URL}/procurement/supplier-quotations`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ requisitionId: selectedPr.id, ...sqForm, exchangeRate: rate, leadTimeDays: sqForm.leadTimeDays ? Number(sqForm.leadTimeDays) : null, createdBy: loginUsername, items: enrichedItems }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      toast$('Quotation added!');
      setShowSQModal(false);
      openDetail(selectedPr);
    } catch (e: any) { toast$(e.message || 'Error', 'error'); }
    finally { setLoading(false); }
  };

  const approveSQ = async (sqId: string) => {
    if (!selectedPr) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/procurement/supplier-quotations/${sqId}/approve`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ approvedBy: loginUsername }) });
      if (!res.ok) throw new Error((await res.json()).message);
      toast$('Quotation approved!');
      openDetail(selectedPr);
    } catch (e: any) { toast$(e.message || 'Error', 'error'); }
    finally { setLoading(false); }
  };

  const generatePO = async (sqId: string) => {
    if (!selectedPr) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/procurement/supplier-quotations/${sqId}/generate-po`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ user: loginUsername }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      const po = await res.json();
      toast$(`Purchase Order ${po.poNumber} generated successfully!`);
      openDetail(selectedPr);
      fetchPrs();
    } catch (e: any) {
      toast$(e.message || 'Error generating PO', 'error');
    } finally {
      setLoading(false);
    }
  };

  const addItem = () => setFormItems(prev => [...prev, { productName: '', requestedQty: 1, unit: 'pcs' }]);
  const removeItem = (i: number) => setFormItems(prev => prev.filter((_, idx) => idx !== i));
  const updateItem = (i: number, field: keyof PRItem, value: any) => setFormItems(prev => prev.map((item, idx) => idx === i ? { ...item, [field]: value } : item));

  // ---- RENDER ----
  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      {toast && <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-medium ${toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>{toast.msg}</div>}

      {/* HEADER */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-4">
        <button onClick={onBack} className="text-gray-500 hover:text-gray-900 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Purchase Requisitions</h1>
          <p className="text-xs text-gray-500">{selectedCompany} · Internal purchasing requests & supplier quotation comparison</p>
        </div>
        {activeTab !== 'create' && (
          <button onClick={() => setActiveTab('create')} className="ml-auto px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors">+ New Requisition</button>
        )}
        {(activeTab === 'create' || activeTab === 'detail') && (
          <button onClick={() => { setActiveTab('list'); setSelectedPr(null); }} className="ml-auto px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">← Back to List</button>
        )}
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* ===== LIST TAB ===== */}
        {activeTab === 'list' && (
          <div>
            {loading ? <p className="text-center text-gray-400 py-12">Loading...</p> : prs.length === 0 ? (
              <div className="text-center py-20 text-gray-400"><p className="text-lg font-medium">No requisitions yet</p><p className="text-sm mt-1">Click "New Requisition" to create one</p></div>
            ) : (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>{['PR Number', 'Requested By', 'Department', 'Priority', 'Needed By', 'Items', 'Status', ''].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {prs.map(pr => (
                      <tr key={pr.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => openDetail(pr)}>
                        <td className="px-4 py-3 font-mono font-semibold text-indigo-700">{pr.prNumber}</td>
                        <td className="px-4 py-3 text-gray-700">{pr.requestedBy}</td>
                        <td className="px-4 py-3 text-gray-500">{pr.department ?? '—'}</td>
                        <td className="px-4 py-3"><span className={`font-semibold text-xs ${PRIORITY_COLORS[pr.priority] ?? 'text-gray-500'}`}>{pr.priority}</span></td>
                        <td className="px-4 py-3 text-gray-500">{pr.neededBy ? new Date(pr.neededBy).toLocaleDateString() : '—'}</td>
                        <td className="px-4 py-3 text-gray-600">{pr.items.length}</td>
                        <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-semibold ${STATUS_COLORS[pr.status] ?? 'bg-gray-100 text-gray-700'}`}>{pr.status}</span></td>
                        <td className="px-4 py-3 text-right">
                          {pr.status === 'Draft' && <button onClick={e => { e.stopPropagation(); doAction(pr.id, 'submit'); }} className="px-3 py-1 bg-amber-600 text-white text-xs rounded-lg hover:bg-amber-700">Submit</button>}
                          {pr.status === 'Pending Approval' && <button onClick={e => { e.stopPropagation(); doAction(pr.id, 'approve'); }} className="px-3 py-1 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700">Approve</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ===== CREATE TAB ===== */}
        {activeTab === 'create' && (
          <div className="max-w-3xl mx-auto">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-bold text-gray-900">New Purchase Requisition</h2>
                <span className="font-mono text-indigo-600 text-sm font-semibold">{nextPrNumber}</span>
              </div>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div><label className="block text-xs font-semibold text-gray-600 mb-1">Department</label><input value={form.department} onChange={e => setForm(p => ({...p, department: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="e.g. Warehouse" /></div>
                <div><label className="block text-xs font-semibold text-gray-600 mb-1">Priority</label>
                  <select value={form.priority} onChange={e => setForm(p => ({...p, priority: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                    {['Low','Normal','High','Urgent'].map(p => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div><label className="block text-xs font-semibold text-gray-600 mb-1">Needed By</label><input type="date" value={form.neededBy} onChange={e => setForm(p => ({...p, neededBy: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs font-semibold text-gray-600 mb-1">Purpose</label><input value={form.purpose} onChange={e => setForm(p => ({...p, purpose: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Reason for purchase" /></div>
                <div className="col-span-2"><label className="block text-xs font-semibold text-gray-600 mb-1">Notes</label><textarea value={form.notes} onChange={e => setForm(p => ({...p, notes: e.target.value}))} rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none" /></div>
              </div>

              <div className="mt-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-800 text-sm">Items Requested</h3>
                  <button onClick={addItem} className="text-xs px-3 py-1 bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100">+ Add Item</button>
                </div>
                <div className="space-y-2">
                  {formItems.map((item, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-5"><input value={item.productName} onChange={e => updateItem(i, 'productName', e.target.value)} placeholder="Product / Description" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
                      <div className="col-span-2"><input type="number" value={item.requestedQty} min={1} onChange={e => updateItem(i, 'requestedQty', Number(e.target.value))} placeholder="Qty" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
                      <div className="col-span-2"><input value={item.unit} onChange={e => updateItem(i, 'unit', e.target.value)} placeholder="Unit" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
                      <div className="col-span-2"><input type="number" value={item.estimatedCost ?? ''} onChange={e => updateItem(i, 'estimatedCost', e.target.value ? Number(e.target.value) : undefined)} placeholder="Est. Cost" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
                      <div className="col-span-1 flex justify-center">{formItems.length > 1 && <button onClick={() => removeItem(i)} className="text-red-400 hover:text-red-600 text-lg">×</button>}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setActiveTab('list')} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
                <button onClick={submitCreate} disabled={loading} className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-60">
                  {loading ? 'Saving...' : 'Save as Draft'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ===== DETAIL TAB ===== */}
        {activeTab === 'detail' && selectedPr && (
          <div className="space-y-5">
            {/* PR Header Card */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Purchase Requisition</p>
                  <h2 className="text-2xl font-bold text-indigo-700 font-mono">{selectedPr.prNumber}</h2>
                  <div className="flex flex-wrap gap-3 mt-2 text-sm text-gray-500">
                    <span>By: <strong className="text-gray-800">{selectedPr.requestedBy}</strong></span>
                    {selectedPr.department && <span>· {selectedPr.department}</span>}
                    {selectedPr.neededBy && <span>· Needed by: <strong>{new Date(selectedPr.neededBy).toLocaleDateString()}</strong></span>}
                    <span>· <span className={`font-semibold ${PRIORITY_COLORS[selectedPr.priority]}`}>{selectedPr.priority}</span> priority</span>
                  </div>
                  {selectedPr.purpose && <p className="text-sm text-gray-600 mt-1">{selectedPr.purpose}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-3 py-1 rounded-full text-sm font-semibold ${STATUS_COLORS[selectedPr.status] ?? 'bg-gray-100 text-gray-700'}`}>{selectedPr.status}</span>
                  {selectedPr.status === 'Draft' && <button onClick={() => doAction(selectedPr.id, 'submit')} className="px-4 py-2 bg-amber-600 text-white text-sm rounded-lg hover:bg-amber-700">Submit for Approval</button>}
                  {selectedPr.status === 'Pending Approval' && (
                    <>
                      <button onClick={() => doAction(selectedPr.id, 'approve')} className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700">Approve</button>
                      <button onClick={() => doAction(selectedPr.id, 'reject')} className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700">Reject</button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Items */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100"><h3 className="font-semibold text-gray-800">Requested Items</h3></div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50"><tr>{['Product / Description','Qty','Unit','Est. Cost'].map(h => <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {selectedPr.items.map((item, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-800">{item.productName}{item.sku && <span className="text-gray-400 text-xs ml-2">({item.sku})</span>}</td>
                      <td className="px-4 py-3">{item.requestedQty}</td>
                      <td className="px-4 py-3 text-gray-500">{item.unit}</td>
                      <td className="px-4 py-3">{item.estimatedCost != null ? `₱${item.estimatedCost.toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Quotation Comparison */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-semibold text-gray-800">Supplier Quotations — Side-by-Side Comparison</h3>
                {['Approved', 'Pending Approval'].includes(selectedPr.status) && (
                  <button onClick={openSQModal} className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700">+ Add Quotation</button>
                )}
              </div>
              {selectedPr.quotations.length === 0 ? (
                <div className="text-center py-10 text-gray-400 text-sm">No quotations yet. Add one from an approved supplier.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Supplier</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Currency</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">FX Rate</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Lead Days</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Total (PHP)</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                        <th className="px-4 py-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {selectedPr.quotations.map(sq => {
                        const totalPhp = sq.items.reduce((s, i) => s + i.lineTotal, 0);
                        return (
                          <tr key={sq.id} className={`hover:bg-gray-50 ${sq.status === 'Approved' ? 'bg-green-50' : ''}`}>
                            <td className="px-4 py-3 font-medium text-gray-800">{sq.supplierName}<div className="text-xs text-gray-400">{sq.sqNumber}</div></td>
                            <td className="px-4 py-3">{sq.currency}</td>
                            <td className="px-4 py-3">{sq.exchangeRate}</td>
                            <td className="px-4 py-3">{sq.leadTimeDays ?? '—'}</td>
                            <td className="px-4 py-3 font-semibold">₱{totalPhp.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                            <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-semibold ${STATUS_COLORS[sq.status] ?? 'bg-gray-100 text-gray-700'}`}>{sq.status}</span></td>
                            <td className="px-4 py-3">
                              {sq.status === 'Pending' && <button onClick={() => approveSQ(sq.id)} className="px-3 py-1 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700">Select Winner</button>}
                              {sq.status === 'Approved' && selectedPr.status !== 'PO Issued' && (
                                <button onClick={() => generatePO(sq.id)} className="px-3 py-1 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 shadow-sm">
                                  Generate PO
                                </button>
                              )}
                              {selectedPr.status === 'PO Issued' && sq.status === 'Approved' && (
                                <span className="text-xs text-indigo-600 font-semibold">✓ PO Issued</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ADD QUOTATION MODAL */}
      {showSQModal && selectedPr && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-gray-900">Add Supplier Quotation</h3>
              <button onClick={() => setShowSQModal(false)} className="text-gray-400 hover:text-gray-700 text-2xl">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2"><label className="block text-xs font-semibold text-gray-600 mb-1">Supplier Name *</label><input value={sqForm.supplierName} onChange={e => setSqForm(p => ({...p, supplierName: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs font-semibold text-gray-600 mb-1">Currency</label>
                  <select value={sqForm.currency} onChange={e => setSqForm(p => ({...p, currency: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                    {['PHP','USD','EUR','CNY','JPY','KRW','SGD','GBP'].map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div><label className="block text-xs font-semibold text-gray-600 mb-1">Exchange Rate to PHP</label><input type="number" value={sqForm.exchangeRate} min={0} step={0.01} onChange={e => setSqForm(p => ({...p, exchangeRate: Number(e.target.value)}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs font-semibold text-gray-600 mb-1">Payment Terms</label><input value={sqForm.paymentTerms} onChange={e => setSqForm(p => ({...p, paymentTerms: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="e.g. Net 30, 50% DP" /></div>
                <div><label className="block text-xs font-semibold text-gray-600 mb-1">Lead Time (Days)</label><input type="number" value={sqForm.leadTimeDays} onChange={e => setSqForm(p => ({...p, leadTimeDays: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs font-semibold text-gray-600 mb-1">Valid Until</label><input type="date" value={sqForm.validUntil} onChange={e => setSqForm(p => ({...p, validUntil: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
              </div>

              <div className="mt-4">
                <h4 className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">Quoted Prices ({sqForm.currency})</h4>
                <div className="space-y-2">
                  {sqItems.map((item, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-center bg-gray-50 rounded-lg px-3 py-2">
                      <div className="col-span-4 text-sm font-medium text-gray-700 truncate">{item.productName}</div>
                      <div className="col-span-2"><label className="text-xs text-gray-400">MOQ</label><input type="number" value={item.moq} min={1} onChange={e => setSqItems(prev => prev.map((s,j) => j===i ? {...s, moq: Number(e.target.value)} : s))} className="w-full border border-gray-200 rounded px-2 py-1 text-xs" /></div>
                      <div className="col-span-3"><label className="text-xs text-gray-400">Qty</label><input type="number" value={item.quotedQty} min={0} onChange={e => setSqItems(prev => prev.map((s,j) => j===i ? {...s, quotedQty: Number(e.target.value)} : s))} className="w-full border border-gray-200 rounded px-2 py-1 text-xs" /></div>
                      <div className="col-span-3"><label className="text-xs text-gray-400">Unit Price ({sqForm.currency})</label><input type="number" value={item.unitPriceForeign} min={0} step={0.01} onChange={e => setSqItems(prev => prev.map((s,j) => j===i ? {...s, unitPriceForeign: Number(e.target.value)} : s))} className="w-full border border-gray-200 rounded px-2 py-1 text-xs" /></div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-right text-sm font-semibold text-gray-700">
                  Total (PHP): ₱{sqItems.reduce((s, i) => s + i.quotedQty * i.unitPriceForeign * sqForm.exchangeRate, 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={() => setShowSQModal(false)} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={submitSQ} disabled={loading} className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-60">{loading ? 'Saving...' : 'Add Quotation'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
