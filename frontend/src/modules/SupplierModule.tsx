import React, { useState, useEffect } from 'react';

interface Supplier { id: string; name: string; contact: string; phone: string; email: string; balance: number; }
interface POItem { id?: string; productId: number; sku: string; productName: string; quantity: number; unitPrice: number; total: number; }
interface PurchaseOrder { id: string; poNumber: string; supplierId: string; supplier: Supplier; date: string; status: string; totalAmount: number; items: POItem[]; user: string; }

export default function SupplierModule({ selectedCompany, API_BASE_URL, onBack }: any) {
  const [activeTab, setActiveTab] = useState<'directory' | 'add'>('directory');
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [supForm, setSupForm] = useState({ name: '', contact: '', phone: '', email: '' });
  const [editSupplierModal, setEditSupplierModal] = useState<{ isOpen: boolean, supplier: Supplier | null }>({ isOpen: false, supplier: null });
  const [historyModal, setHistoryModal] = useState<{ isOpen: boolean, supplierId: string | null }>({ isOpen: false, supplierId: null });

  const showToast = (msg: string, type: 'success' | 'error') => { setToast({ message: msg, type }); setTimeout(() => setToast(null), 3500); };

  const fetchData = async () => {
    try {
      const [supRes, poRes] = await Promise.all([
        fetch(`${API_BASE_URL}/purchasing/suppliers?company=${selectedCompany}`),
        fetch(`${API_BASE_URL}/purchasing/pos?company=${selectedCompany}`)
      ]);
      if (supRes.ok) setSuppliers(await supRes.json());
      if (poRes.ok) setPos(await poRes.json());
    } catch (e) { console.warn("Backend not ready."); }
  };

  useEffect(() => { fetchData(); }, [selectedCompany]);

  const filteredSuppliers = suppliers.filter(s => s.name.toLowerCase().includes(supplierSearch.toLowerCase()));

  const handleCreateSupplier = async (e: React.FormEvent) => {
    e.preventDefault(); setIsProcessing(true);
    try {
      const res = await fetch(`${API_BASE_URL}/purchasing/suppliers`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ ...supForm, company: selectedCompany }) });
      if(!res.ok) throw new Error();
      fetchData(); showToast("Supplier registered.", "success");
      setSupForm({ name: '', contact: '', phone: '', email: '' });
      setActiveTab('directory');
    } catch (e) { showToast("Failed to add supplier.", "error"); } finally { setIsProcessing(false); }
  };

  const handleUpdateSupplier = async (e: React.FormEvent) => {
    e.preventDefault(); if (!editSupplierModal.supplier) return; setIsProcessing(true);
    try {
      const res = await fetch(`${API_BASE_URL}/purchasing/suppliers/${editSupplierModal.supplier.id}`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(editSupplierModal.supplier) });
      if(!res.ok) throw new Error();
      fetchData(); showToast("Supplier updated.", "success");
      setEditSupplierModal({ isOpen: false, supplier: null });
    } catch (e) { showToast("Update failed.", "error"); } finally { setIsProcessing(false); }
  };

  const getSupplierPriceHistory = (supId: string) => {
    const history: any[] = [];
    pos.filter(p => p.supplierId === supId).forEach(p => { p.items.forEach(item => history.push({ date: p.date, po: p.poNumber, product: item.productName, price: item.unitPrice, qty: item.quantity })); });
    return history.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  };

  return (
    <div className="flex h-screen w-full bg-[#F8FAFC] font-sans text-slate-900 overflow-hidden">
      {toast && <div className={`fixed bottom-6 right-6 z-[100] px-5 py-3.5 rounded-xl shadow-xl font-bold text-sm ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'}`}>{toast.message}</div>}

      <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col border-r border-slate-800 shrink-0 hidden md:flex">
        <div className="h-20 flex items-center px-6 border-b border-slate-800 bg-slate-950"><h1 className="text-xl font-black text-white uppercase tracking-wider">Vendor Data</h1></div>
        <div className="flex-1 py-6 px-3 space-y-1">
          <button onClick={() => setActiveTab('directory')} className={`w-full text-left px-4 py-3 rounded-lg font-bold text-sm transition-all ${activeTab === 'directory' ? 'bg-amber-600 text-white shadow-md' : 'hover:bg-slate-800'}`}>Supplier Directory</button>
          <button onClick={() => setActiveTab('add')} className={`w-full text-left px-4 py-3 rounded-lg font-bold text-sm transition-all ${activeTab === 'add' ? 'bg-amber-600 text-white shadow-md' : 'hover:bg-slate-800'}`}>Register New Vendor</button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 h-screen">
        <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0 shadow-sm z-10">
          <div><h2 className="text-2xl font-black text-amber-950 tracking-tight">Supplier Database</h2></div>
          <button onClick={onBack} className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors">Gateway</button>
        </header>

        <main className="flex-1 overflow-y-auto p-8 relative">
          <div className="max-w-7xl mx-auto">
            {activeTab === 'directory' && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-5 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                  <h3 className="font-bold text-slate-800 text-lg">Active Vendor Roster</h3>
                  <input type="text" placeholder="Search suppliers..." value={supplierSearch} onChange={e => setSupplierSearch(e.target.value)} className="px-4 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-amber-500 shadow-sm w-72" />
                </div>
                <div className="overflow-x-auto w-full">
                  <table className="w-full text-left min-w-[800px]">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest">Supplier Details</th>
                        <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">Payable Balance</th>
                        <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredSuppliers.map(s => (
                        <tr key={s.id} className="hover:bg-slate-50 group">
                          <td className="py-4 px-6">
                            <div className="font-black text-slate-900 uppercase text-sm">{s.name}</div>
                            <div className="text-xs text-slate-500 font-medium mt-1">{s.contact || 'No Contact'} • {s.phone}</div>
                          </td>
                          <td className="py-4 px-6 text-right">
                            <div className="font-black text-rose-600 text-sm">₱{s.balance.toLocaleString('en-PH')} <span className="text-[10px] text-slate-400 font-bold uppercase">Owed</span></div>
                          </td>
                          <td className="py-4 px-6 text-right">
                            <button onClick={() => setHistoryModal({ isOpen: true, supplierId: s.id })} className="text-sky-600 hover:text-sky-800 text-xs font-bold uppercase mr-4">PO Ledger</button>
                            <button onClick={() => setEditSupplierModal({ isOpen: true, supplier: s })} className="text-amber-600 hover:text-amber-800 text-xs font-bold uppercase">Edit</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'add' && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 max-w-2xl mx-auto">
                <h3 className="font-black text-xl text-slate-900 mb-6">Register New Vendor</h3>
                <form onSubmit={handleCreateSupplier} className="flex flex-col gap-5">
                  <input type="text" required value={supForm.name} onChange={e => setSupForm({...supForm, name: e.target.value})} className="px-4 py-3 border border-slate-300 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-amber-600 shadow-sm" placeholder="Company / Supplier Name *" />
                  <input type="text" value={supForm.contact} onChange={e => setSupForm({...supForm, contact: e.target.value})} className="px-4 py-3 border border-slate-300 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-amber-600 shadow-sm" placeholder="Primary Contact Person" />
                  <div className="grid grid-cols-2 gap-5">
                    <input type="text" value={supForm.phone} onChange={e => setSupForm({...supForm, phone: e.target.value})} className="px-4 py-3 border border-slate-300 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-amber-600 shadow-sm" placeholder="Phone Number" />
                    <input type="email" value={supForm.email} onChange={e => setSupForm({...supForm, email: e.target.value})} className="px-4 py-3 border border-slate-300 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-amber-600 shadow-sm" placeholder="Email Address" />
                  </div>
                  <button type="submit" disabled={isProcessing} className="mt-4 py-4 bg-amber-600 text-white font-black uppercase tracking-wider rounded-xl hover:bg-amber-700 transition-colors shadow-md disabled:opacity-50">Create Vendor Profile</button>
                </form>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* EDIT MODAL */}
      {editSupplierModal.isOpen && editSupplierModal.supplier && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-5 border-b bg-amber-600 text-white"><h3 className="font-bold text-lg">Edit Vendor Profile</h3></div>
            <form onSubmit={handleUpdateSupplier} className="p-6 flex flex-col gap-4 bg-slate-50">
              <input type="text" required value={editSupplierModal.supplier.name} onChange={e => setEditSupplierModal({ ...editSupplierModal, supplier: { ...editSupplierModal.supplier!, name: e.target.value }})} className="px-4 py-3 border rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-amber-600" />
              <input type="text" value={editSupplierModal.supplier.contact || ''} onChange={e => setEditSupplierModal({ ...editSupplierModal, supplier: { ...editSupplierModal.supplier!, contact: e.target.value }})} className="px-4 py-3 border rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-amber-600" />
              <input type="text" value={editSupplierModal.supplier.phone || ''} onChange={e => setEditSupplierModal({ ...editSupplierModal, supplier: { ...editSupplierModal.supplier!, phone: e.target.value }})} className="px-4 py-3 border rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-amber-600" />
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setEditSupplierModal({ isOpen: false, supplier: null })} className="flex-1 px-4 py-3 bg-white border border-slate-300 font-bold rounded-xl text-slate-700">Cancel</button>
                <button type="submit" disabled={isProcessing} className="flex-1 px-4 py-3 bg-amber-600 hover:bg-amber-700 text-white font-black rounded-xl transition-colors shadow-sm">Save Update</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* HISTORY MODAL */}
      {historyModal.isOpen && historyModal.supplierId && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-5 border-b bg-slate-900 text-white flex justify-between items-center">
              <h3 className="font-bold text-lg tracking-wide">Vendor PO Ledger</h3>
              <button onClick={() => setHistoryModal({ isOpen: false, supplierId: null })} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <div className="p-0 max-h-[60vh] overflow-y-auto bg-slate-50">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-100 border-b border-slate-200 sticky top-0">
                  <tr><th className="py-3 px-4 font-bold text-slate-500 uppercase text-xs">Date / PO</th><th className="py-3 px-4 font-bold text-slate-500 uppercase text-xs">Product Details</th><th className="py-3 px-4 font-bold text-slate-500 uppercase text-xs text-right">Unit Price</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {getSupplierPriceHistory(historyModal.supplierId).length === 0 ? (
                    <tr><td colSpan={3} className="py-8 text-center text-slate-400 font-medium">No purchase history found.</td></tr>
                  ) : getSupplierPriceHistory(historyModal.supplierId).map((h, i) => (
                    <tr key={i} className="bg-white">
                      <td className="py-3 px-4 font-mono text-xs text-slate-600">{new Date(h.date).toLocaleDateString()}<br/><span className="text-[10px] text-slate-400">{h.po}</span></td>
                      <td className="py-3 px-4 font-bold text-slate-900 text-sm">{h.product} <span className="text-[10px] text-slate-400 block font-bold uppercase mt-0.5">Qty: {h.qty}</span></td>
                      <td className="py-3 px-4 text-right font-black text-amber-700">₱{h.price.toLocaleString('en-PH')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}