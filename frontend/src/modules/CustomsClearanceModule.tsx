import { useState, useEffect, useCallback } from 'react';
import { getApiAuthHeaders } from '../lib/apiSession';

// ---- INTERFACES ----
interface CustomsEntry { id: string; ceNumber: string; shipmentId: string; company: string; brokerName?: string; declarationRef?: string; clearanceDate?: string; status: string; notes?: string; createdBy: string; createdAt: string; expenses: ImportExpense[]; }
interface ImportExpense { id: string; customsEntryId: string; expenseType: string; description?: string; currency: string; exchangeRate: number; amountForeign: number; amountPhp: number; paymentStatus: string; invoiceRef?: string; paidAt?: string; createdBy: string; createdAt: string; }
interface Shipment { id: string; shpNumber: string; importFileId: string; status: string; }
interface Props { selectedCompany: string; loginUsername: string; API_BASE_URL: string; onBack: () => void; initialShipment?: Shipment | null; }

const CE_STATUS: Record<string, string> = { Pending: 'bg-gray-100 text-gray-600', Filed: 'bg-blue-100 text-blue-700', 'Under Examination': 'bg-amber-100 text-amber-800', Released: 'bg-teal-100 text-teal-700', Cleared: 'bg-green-100 text-green-700' };
const PAY_STATUS: Record<string, string> = { Estimated: 'bg-gray-100 text-gray-500', Accrued: 'bg-amber-100 text-amber-700', Invoiced: 'bg-blue-100 text-blue-700', Paid: 'bg-green-100 text-green-700' };
const EXPENSE_TYPES = ['Duties', 'Taxes', 'Brokerage', 'Port Handling', 'Storage', 'Demurrage', 'Insurance', 'Other'];

export default function CustomsClearanceModule({ selectedCompany, loginUsername, API_BASE_URL, onBack, initialShipment }: Props) {
  const [entries, setEntries] = useState<CustomsEntry[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [filterShipment, setFilterShipment] = useState<string>(initialShipment?.id ?? '');
  const [selectedEntry, setSelectedEntry] = useState<CustomsEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // CE form
  const [showCEModal, setShowCEModal] = useState(false);
  const [ceForm, setCeForm] = useState({ shipmentId: initialShipment?.id ?? '', brokerName: '', declarationRef: '', clearanceDate: '', status: 'Pending', notes: '' });
  const [nextCeNumber, setNextCeNumber] = useState('CE-...');

  // Expense form
  const [showExpModal, setShowExpModal] = useState(false);
  const [expForm, setExpForm] = useState({ expenseType: 'Duties', description: '', currency: 'PHP', exchangeRate: 1, amountForeign: 0, paymentStatus: 'Estimated', invoiceRef: '' });

  // Edit expense
  const [editExp, setEditExp] = useState<ImportExpense | null>(null);
  const [editExpForm, setEditExpForm] = useState<Partial<ImportExpense>>({});

  const toast$ = (msg: string, type: 'success' | 'error' = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3500); };
  const h = () => ({ 'Content-Type': 'application/json', ...getApiAuthHeaders() });

  const fetchEntries = useCallback(async (shipmentId?: string) => {
    setLoading(true);
    try {
      const q = shipmentId ? `shipmentId=${shipmentId}` : `company=${encodeURIComponent(selectedCompany)}`;
      const res = await fetch(`${API_BASE_URL}/importation/customs?${q}`, { headers: getApiAuthHeaders() });
      if (res.ok) setEntries(await res.json());
    } catch { toast$('Failed to load customs entries', 'error'); }
    finally { setLoading(false); }
  }, [selectedCompany, API_BASE_URL]);

  const fetchShipments = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/importation/shipments?company=${encodeURIComponent(selectedCompany)}`, { headers: getApiAuthHeaders() });
      if (res.ok) setShipments(await res.json());
    } catch { /* silent */ }
  }, [selectedCompany, API_BASE_URL]);

  const fetchNextCe = useCallback(async () => {
    try { const r = await fetch(`${API_BASE_URL}/importation/customs/next-number?company=${encodeURIComponent(selectedCompany)}`, { headers: getApiAuthHeaders() }); if (r.ok) { const d = await r.json(); setNextCeNumber(d.ceNumber); } } catch { setNextCeNumber('CE-ERROR'); }
  }, [selectedCompany, API_BASE_URL]);

  useEffect(() => { fetchShipments(); fetchEntries(filterShipment || undefined); }, [fetchShipments, fetchEntries, filterShipment]);

  const createCE = async () => {
    if (!ceForm.shipmentId) { toast$('Select a shipment', 'error'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/importation/customs`, { method: 'POST', headers: h(), body: JSON.stringify({ company: selectedCompany, createdBy: loginUsername, ...ceForm, clearanceDate: ceForm.clearanceDate || null }) });
      if (!res.ok) throw new Error((await res.json()).message);
      toast$('Customs entry created!');
      setShowCEModal(false);
      fetchEntries(filterShipment || undefined);
    } catch (e: any) { toast$(e.message, 'error'); }
    finally { setLoading(false); }
  };

  const updateCEStatus = async (id: string, status: string) => {
    try {
      await fetch(`${API_BASE_URL}/importation/customs/${id}`, { method: 'PATCH', headers: h(), body: JSON.stringify({ status }) });
      fetchEntries(filterShipment || undefined);
      if (selectedEntry?.id === id) setSelectedEntry(prev => prev ? {...prev, status} : null);
    } catch { toast$('Failed to update status', 'error'); }
  };

  const addExpense = async () => {
    if (!selectedEntry) return;
    setLoading(true);
    try {
      const rate = Number(expForm.exchangeRate) || 1;
      const foreign = Number(expForm.amountForeign) || 0;
      const res = await fetch(`${API_BASE_URL}/importation/customs/${selectedEntry.id}/expenses`, {
        method: 'POST', headers: h(),
        body: JSON.stringify({ ...expForm, exchangeRate: rate, amountForeign: foreign, amountPhp: foreign * rate, createdBy: loginUsername }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      toast$('Expense added!');
      setShowExpModal(false);
      // Refresh the detail
      const r2 = await fetch(`${API_BASE_URL}/importation/customs/${selectedEntry.id}`, { headers: getApiAuthHeaders() });
      if (r2.ok) setSelectedEntry(await r2.json());
      fetchEntries(filterShipment || undefined);
    } catch (e: any) { toast$(e.message, 'error'); }
    finally { setLoading(false); }
  };

  const saveEditExp = async () => {
    if (!selectedEntry || !editExp) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/importation/customs/${selectedEntry.id}/expenses/${editExp.id}`, { method: 'PATCH', headers: h(), body: JSON.stringify(editExpForm) });
      if (!res.ok) throw new Error((await res.json()).message);
      toast$('Expense updated!');
      setEditExp(null);
      const r2 = await fetch(`${API_BASE_URL}/importation/customs/${selectedEntry.id}`, { headers: getApiAuthHeaders() });
      if (r2.ok) setSelectedEntry(await r2.json());
    } catch (e: any) { toast$(e.message, 'error'); }
    finally { setLoading(false); }
  };

  const deleteExp = async (expId: string) => {
    if (!selectedEntry || !window.confirm('Delete this expense?')) return;
    try {
      await fetch(`${API_BASE_URL}/importation/customs/${selectedEntry.id}/expenses/${expId}`, { method: 'DELETE', headers: getApiAuthHeaders() });
      const r2 = await fetch(`${API_BASE_URL}/importation/customs/${selectedEntry.id}`, { headers: getApiAuthHeaders() });
      if (r2.ok) setSelectedEntry(await r2.json());
      toast$('Expense deleted');
    } catch { toast$('Failed to delete expense', 'error'); }
  };

  const fmtDate = (d?: string) => d ? new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  const fmtPhp = (n: number) => n.toLocaleString('en-PH', { minimumFractionDigits: 2 });

  const totalByStatus = (exps: ImportExpense[], status: string) => exps.filter(e => e.paymentStatus === status).reduce((s, e) => s + e.amountPhp, 0);

  return (
    <div className="min-h-screen bg-gray-50">
      {toast && <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-medium ${toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>{toast.msg}</div>}

      {/* HEADER */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center gap-4">
          <button onClick={onBack} className="text-gray-400 hover:text-gray-900"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg></button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-gray-900">Customs & Clearance</h1>
            <p className="text-xs text-gray-500">{selectedCompany} · Declaration entries, duties, taxes, and brokerage expenses</p>
          </div>
          <select value={filterShipment} onChange={e => { setFilterShipment(e.target.value); fetchEntries(e.target.value || undefined); setSelectedEntry(null); }} className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white">
            <option value="">All Shipments</option>
            {shipments.map(s => <option key={s.id} value={s.id}>{s.shpNumber}</option>)}
          </select>
          <button onClick={() => { fetchNextCe(); setCeForm({ shipmentId: filterShipment || (shipments[0]?.id ?? ''), brokerName: '', declarationRef: '', clearanceDate: '', status: 'Pending', notes: '' }); setShowCEModal(true); }} className="px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700">+ New Entry</button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 flex gap-6">
        {/* ENTRY LIST */}
        <div className="w-72 shrink-0 space-y-3">
          {loading && <p className="text-center text-gray-400 text-sm py-8">Loading...</p>}
          {!loading && entries.length === 0 && <p className="text-center text-gray-400 text-sm py-8">No customs entries</p>}
          {entries.map(ce => (
            <button key={ce.id} onClick={() => setSelectedEntry(ce)} className={`w-full text-left rounded-xl border p-4 transition-all ${selectedEntry?.id === ce.id ? 'border-amber-500 bg-amber-50 shadow' : 'border-gray-200 bg-white hover:border-amber-200 hover:bg-amber-50/50'}`}>
              <p className="font-mono font-bold text-amber-700 text-sm">{ce.ceNumber}</p>
              {ce.brokerName && <p className="text-xs text-gray-600 mt-0.5">{ce.brokerName}</p>}
              {ce.declarationRef && <p className="text-xs text-gray-400">Decl: {ce.declarationRef}</p>}
              <div className="flex items-center justify-between mt-2">
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${CE_STATUS[ce.status] ?? 'bg-gray-100 text-gray-600'}`}>{ce.status}</span>
                <span className="text-xs text-gray-400">{ce.expenses.length} expenses</span>
              </div>
              <p className="text-xs text-amber-700 font-semibold mt-1">₱{fmtPhp(ce.expenses.reduce((s, e) => s + e.amountPhp, 0))}</p>
            </button>
          ))}
        </div>

        {/* DETAIL PANEL */}
        {selectedEntry ? (
          <div className="flex-1 space-y-4">
            {/* CE Header */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide">Customs Entry</p>
                  <h2 className="text-2xl font-bold text-amber-700 font-mono">{selectedEntry.ceNumber}</h2>
                  <div className="text-sm text-gray-500 space-y-0.5 mt-1">
                    {selectedEntry.brokerName && <p>Broker: <strong className="text-gray-800">{selectedEntry.brokerName}</strong></p>}
                    {selectedEntry.declarationRef && <p>Declaration Ref: <strong>{selectedEntry.declarationRef}</strong></p>}
                    {selectedEntry.clearanceDate && <p>Cleared: <strong>{fmtDate(selectedEntry.clearanceDate)}</strong></p>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <select value={selectedEntry.status} onChange={e => updateCEStatus(selectedEntry.id, e.target.value)} className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white">
                    {Object.keys(CE_STATUS).map(s => <option key={s}>{s}</option>)}
                  </select>
                  <button onClick={() => { setExpForm({ expenseType: 'Duties', description: '', currency: 'PHP', exchangeRate: 1, amountForeign: 0, paymentStatus: 'Estimated', invoiceRef: '' }); setShowExpModal(true); }} className="px-4 py-2 bg-amber-600 text-white text-sm rounded-lg hover:bg-amber-700">+ Add Expense</button>
                </div>
              </div>

              {/* Summary totals */}
              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                {(['Estimated', 'Accrued', 'Invoiced', 'Paid'] as const).map(status => (
                  <div key={status} className={`rounded-xl px-4 py-3 ${PAY_STATUS[status]}`}>
                    <p className="text-xs font-semibold uppercase tracking-wide opacity-70">{status}</p>
                    <p className="text-lg font-bold">₱{fmtPhp(totalByStatus(selectedEntry.expenses, status))}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Expenses Table */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-semibold text-gray-800">Itemized Import Expenses</h3>
                <p className="text-sm font-bold text-amber-700">Total: ₱{fmtPhp(selectedEntry.expenses.reduce((s, e) => s + e.amountPhp, 0))}</p>
              </div>
              {selectedEntry.expenses.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-10">No expenses yet</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50"><tr>{['Type','Description','Currency','Foreign Amt','PHP Amt','Payment Status','Invoice Ref',''].map(h => <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {selectedEntry.expenses.map(exp => (
                      <tr key={exp.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-semibold text-gray-700">{exp.expenseType}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{exp.description ?? '—'}</td>
                        <td className="px-4 py-3">{exp.currency}</td>
                        <td className="px-4 py-3">{exp.currency !== 'PHP' ? fmtPhp(exp.amountForeign) : '—'}</td>
                        <td className="px-4 py-3 font-semibold text-amber-700">₱{fmtPhp(exp.amountPhp)}</td>
                        <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${PAY_STATUS[exp.paymentStatus] ?? 'bg-gray-100 text-gray-500'}`}>{exp.paymentStatus}</span></td>
                        <td className="px-4 py-3 text-xs text-gray-400">{exp.invoiceRef ?? '—'}</td>
                        <td className="px-4 py-3 text-right flex items-center gap-2">
                          <button onClick={() => { setEditExp(exp); setEditExpForm({ expenseType: exp.expenseType, description: exp.description, currency: exp.currency, exchangeRate: exp.exchangeRate, amountForeign: exp.amountForeign, paymentStatus: exp.paymentStatus, invoiceRef: exp.invoiceRef }); }} className="text-xs text-blue-600 hover:underline">Edit</button>
                          <button onClick={() => deleteExp(exp.id)} className="text-xs text-red-500 hover:underline">Del</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center"><p className="text-lg">Select a customs entry to view details</p><p className="text-sm mt-1">Or create a new one with "+ New Entry"</p></div>
          </div>
        )}
      </div>

      {/* CREATE CE MODAL */}
      {showCEModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
              <div><h3 className="font-bold text-gray-900">New Customs Entry</h3><p className="text-xs text-gray-400 font-mono">{nextCeNumber}</p></div>
              <button onClick={() => setShowCEModal(false)} className="text-gray-400 text-2xl">×</button>
            </div>
            <div className="p-6 space-y-3">
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">Shipment *</label>
                <select value={ceForm.shipmentId} onChange={e => setCeForm(p => ({...p, shipmentId: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  <option value="">— Select —</option>
                  {shipments.map(s => <option key={s.id} value={s.id}>{s.shpNumber}</option>)}
                </select>
              </div>
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">Customs Broker</label><input value={ceForm.brokerName} onChange={e => setCeForm(p => ({...p, brokerName: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">Declaration / Entry Reference</label><input value={ceForm.declarationRef} onChange={e => setCeForm(p => ({...p, declarationRef: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="e.g. PIER-2026-001234" /></div>
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">Clearance Date</label><input type="date" value={ceForm.clearanceDate} onChange={e => setCeForm(p => ({...p, clearanceDate: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">Initial Status</label>
                <select value={ceForm.status} onChange={e => setCeForm(p => ({...p, status: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  {Object.keys(CE_STATUS).map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">Notes</label><textarea value={ceForm.notes} onChange={e => setCeForm(p => ({...p, notes: e.target.value}))} rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none" /></div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={() => setShowCEModal(false)} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg">Cancel</button>
              <button onClick={createCE} disabled={loading} className="px-5 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 disabled:opacity-60">{loading ? 'Saving...' : 'Create Entry'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ADD EXPENSE MODAL */}
      {showExpModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-gray-900">Add Import Expense</h3>
              <button onClick={() => setShowExpModal(false)} className="text-gray-400 text-2xl">×</button>
            </div>
            <div className="p-6 space-y-3">
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">Expense Type *</label>
                <select value={expForm.expenseType} onChange={e => setExpForm(p => ({...p, expenseType: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  {EXPENSE_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">Description</label><input value={expForm.description} onChange={e => setExpForm(p => ({...p, description: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-semibold text-gray-600 mb-1">Currency</label>
                  <select value={expForm.currency} onChange={e => setExpForm(p => ({...p, currency: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                    {['PHP','USD','EUR','CNY','JPY','SGD'].map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div><label className="block text-xs font-semibold text-gray-600 mb-1">Exchange Rate</label><input type="number" value={expForm.exchangeRate} step={0.01} onChange={e => setExpForm(p => ({...p, exchangeRate: Number(e.target.value)}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
              </div>
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">Amount ({expForm.currency})</label><input type="number" value={expForm.amountForeign} step={0.01} onChange={e => setExpForm(p => ({...p, amountForeign: Number(e.target.value)}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
              <div className="bg-amber-50 rounded-lg px-4 py-2 text-sm font-semibold text-amber-700">PHP Amount: ₱{(Number(expForm.amountForeign) * Number(expForm.exchangeRate)).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-semibold text-gray-600 mb-1">Payment Status</label>
                  <select value={expForm.paymentStatus} onChange={e => setExpForm(p => ({...p, paymentStatus: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                    {['Estimated','Accrued','Invoiced','Paid'].map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div><label className="block text-xs font-semibold text-gray-600 mb-1">Invoice Ref</label><input value={expForm.invoiceRef} onChange={e => setExpForm(p => ({...p, invoiceRef: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={() => setShowExpModal(false)} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg">Cancel</button>
              <button onClick={addExpense} disabled={loading} className="px-5 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 disabled:opacity-60">{loading ? 'Saving...' : 'Add Expense'}</button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT EXPENSE MODAL */}
      {editExp && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-gray-900">Edit Expense</h3>
              <button onClick={() => setEditExp(null)} className="text-gray-400 text-2xl">×</button>
            </div>
            <div className="p-6 space-y-3">
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">Expense Type</label>
                <select value={(editExpForm as any).expenseType ?? ''} onChange={e => setEditExpForm(p => ({...p, expenseType: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  {EXPENSE_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">Description</label><input value={(editExpForm as any).description ?? ''} onChange={e => setEditExpForm(p => ({...p, description: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-semibold text-gray-600 mb-1">Currency</label>
                  <select value={(editExpForm as any).currency ?? 'PHP'} onChange={e => setEditExpForm(p => ({...p, currency: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                    {['PHP','USD','EUR','CNY','JPY','SGD'].map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div><label className="block text-xs font-semibold text-gray-600 mb-1">Exchange Rate</label><input type="number" value={(editExpForm as any).exchangeRate ?? 1} step={0.01} onChange={e => setEditExpForm(p => ({...p, exchangeRate: Number(e.target.value)}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
              </div>
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">Amount (Foreign)</label><input type="number" value={(editExpForm as any).amountForeign ?? 0} step={0.01} onChange={e => setEditExpForm(p => ({...p, amountForeign: Number(e.target.value)}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">Payment Status</label>
                <select value={(editExpForm as any).paymentStatus ?? 'Estimated'} onChange={e => setEditExpForm(p => ({...p, paymentStatus: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  {['Estimated','Accrued','Invoiced','Paid'].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">Invoice Ref</label><input value={(editExpForm as any).invoiceRef ?? ''} onChange={e => setEditExpForm(p => ({...p, invoiceRef: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={() => setEditExp(null)} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg">Cancel</button>
              <button onClick={saveEditExp} disabled={loading} className="px-5 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 disabled:opacity-60">{loading ? 'Saving...' : 'Save Changes'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
