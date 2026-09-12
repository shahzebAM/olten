import React, { useState, useEffect } from 'react';

interface Customer { id: string; name: string; contact: string; phone: string; email: string; address: string; creditLimit: number; balance: number; }
interface SOItem { id?: string; productId: number; sku: string; productName: string; quantity: number; unitPrice: number; total: number; }
interface SalesOrder { id: string; soNumber: string; customerId: string; customer: Customer; date: string; status: string; totalAmount: number; items: SOItem[]; user: string; }

export default function CustomerModule({ selectedCompany, API_BASE_URL, onBack }: any) {
  const [activeTab, setActiveTab] = useState<'directory' | 'add'>('directory');
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sos, setSos] = useState<SalesOrder[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [custForm, setCustForm] = useState({ name: '', contact: '', phone: '', email: '', address: '', creditLimit: 0 });
  const [editCustomerModal, setEditCustomerModal] = useState<{ isOpen: boolean, customer: Customer | null }>({ isOpen: false, customer: null });
  const [historyModal, setHistoryModal] = useState<{ isOpen: boolean, customerId: string | null }>({ isOpen: false, customerId: null });

  const showToast = (msg: string, type: 'success' | 'error') => { setToast({ message: msg, type }); setTimeout(() => setToast(null), 3500); };

  const fetchData = async () => {
    try {
      const [custRes, soRes] = await Promise.all([
        fetch(`${API_BASE_URL}/sales/customers?company=${selectedCompany}`),
        fetch(`${API_BASE_URL}/sales/orders?company=${selectedCompany}`)
      ]);
      if (custRes.ok) setCustomers(await custRes.json());
      if (soRes.ok) setSos(await soRes.json());
    } catch (err: any) { 
      if (err.message?.includes('Failed to fetch')) {
        showToast("Network Error: Cannot load customer data.", "error");
      }
      console.warn("Backend not ready or unreachable."); 
    }
  };

  useEffect(() => { fetchData(); }, [selectedCompany]);

  const filteredCustomers = customers.filter(c => (c.name || '').toLowerCase().includes(customerSearch.toLowerCase()));

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault(); 
    setIsProcessing(true);
    try {
      const res = await fetch(`${API_BASE_URL}/sales/customers`, { 
        method: 'POST', 
        headers: {'Content-Type': 'application/json'}, 
        body: JSON.stringify({ ...custForm, creditLimit: Number(custForm.creditLimit), company: selectedCompany }) 
      });
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || "Failed to add customer.");
      }

      fetchData(); 
      showToast("Customer registered.", "success");
      setCustForm({ name: '', contact: '', phone: '', email: '', address: '', creditLimit: 0 });
      setActiveTab('directory');
    } catch (err: any) { 
      if (err.message?.includes('Failed to fetch')) {
        showToast("Network Error: Could not reach the backend server.", "error");
      } else {
        showToast(err.message || "Failed to add customer.", "error");
      }
    } finally { 
      setIsProcessing(false); 
    }
  };

  const handleUpdateCustomer = async (e: React.FormEvent) => {
    e.preventDefault(); 
    if (!editCustomerModal.customer) return; 
    setIsProcessing(true);
    try {
      const res = await fetch(`${API_BASE_URL}/sales/customers/${editCustomerModal.customer.id}`, { 
        method: 'PATCH', 
        headers: {'Content-Type': 'application/json'}, 
        body: JSON.stringify({...editCustomerModal.customer, creditLimit: Number(editCustomerModal.customer.creditLimit)}) 
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || "Update failed.");
      }

      fetchData(); 
      showToast("Customer updated.", "success");
      setEditCustomerModal({ isOpen: false, customer: null });
    } catch (err: any) { 
      if (err.message?.includes('Failed to fetch')) {
        showToast("Network Error: Could not reach the backend server.", "error");
      } else {
        showToast(err.message || "Update failed.", "error");
      }
    } finally { 
      setIsProcessing(false); 
    }
  };

  const getCustomerSalesHistory = (custId: string) => {
    const history: any[] = [];
    sos.filter(s => s.customerId === custId).forEach(s => { 
      // SAFE FALLBACK: Check if items exist before running forEach
      (s.items || []).forEach(item => { 
        history.push({ 
          date: s.date || new Date().toISOString(), 
          so: s.soNumber || 'N/A', 
          product: item.productName || 'Unknown Product', 
          price: item.unitPrice || 0, 
          qty: item.quantity || 0 
        }); 
      }); 
    });
    return history.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  };

  return (
    <div className="flex h-screen w-full bg-[#F8FAFC] font-sans text-slate-900 overflow-hidden">
      {toast && <div className={`fixed bottom-6 right-6 z-[100] px-5 py-3.5 rounded-xl shadow-xl font-bold text-sm ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'}`}>{toast.message}</div>}

      <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col border-r border-slate-800 shrink-0 hidden md:flex">
        <div className="h-20 flex items-center px-6 border-b border-slate-800 bg-slate-950"><h1 className="text-xl font-black text-white uppercase tracking-wider">CRM Center</h1></div>
        <div className="flex-1 py-6 px-3 space-y-1">
          <button onClick={() => setActiveTab('directory')} className={`w-full text-left px-4 py-3 rounded-lg font-bold text-sm transition-all ${activeTab === 'directory' ? 'bg-emerald-600 text-white shadow-md' : 'hover:bg-slate-800'}`}>Customer Directory</button>
          <button onClick={() => setActiveTab('add')} className={`w-full text-left px-4 py-3 rounded-lg font-bold text-sm transition-all ${activeTab === 'add' ? 'bg-emerald-600 text-white shadow-md' : 'hover:bg-slate-800'}`}>Register New Client</button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 h-screen">
        <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0 shadow-sm z-10">
          <div><h2 className="text-2xl font-black text-emerald-950 tracking-tight">Customer Database</h2></div>
          <button onClick={onBack} className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors">Gateway</button>
        </header>

        <main className="flex-1 overflow-y-auto p-8 relative">
          <div className="max-w-7xl mx-auto">
            {activeTab === 'directory' && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-5 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                  <h3 className="font-bold text-slate-800 text-lg">Active Roster</h3>
                  <input type="text" placeholder="Search customers..." value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} className="px-4 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500 shadow-sm w-72" />
                </div>
                <div className="overflow-x-auto w-full">
                  <table className="w-full text-left min-w-[800px]">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest">Customer Details</th>
                        <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">Account Balances</th>
                        <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredCustomers.map(c => (
                        <tr key={c.id} className="hover:bg-slate-50 group">
                          <td className="py-4 px-6">
                            <div className="font-black text-slate-900 uppercase text-sm">{c.name}</div>
                            <div className="text-xs text-slate-500 font-medium mt-1">{c.contact || 'No Contact'} • {c.phone}</div>
                          </td>
                          <td className="py-4 px-6 text-right">
                            <div className="font-black text-rose-600 text-sm">₱{(c.balance || 0).toLocaleString('en-PH')} <span className="text-[10px] text-slate-400 font-bold uppercase">Owed</span></div>
                            <div className="text-xs font-bold text-emerald-600 mt-1">Avail: ₱{Math.max(0, (c.creditLimit || 0) - (c.balance || 0)).toLocaleString('en-PH')}</div>
                          </td>
                          <td className="py-4 px-6 text-right">
                            <button onClick={() => setHistoryModal({ isOpen: true, customerId: c.id })} className="text-sky-600 hover:text-sky-800 text-xs font-bold uppercase mr-4">Ledger</button>
                            <button onClick={() => setEditCustomerModal({ isOpen: true, customer: c })} className="text-amber-600 hover:text-amber-800 text-xs font-bold uppercase">Edit</button>
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
                <h3 className="font-black text-xl text-slate-900 mb-6">Register New Client</h3>
                <form onSubmit={handleCreateCustomer} className="flex flex-col gap-5">
                  <input type="text" required value={custForm.name} onChange={e => setCustForm({...custForm, name: e.target.value})} className="px-4 py-3 border border-slate-300 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-600 shadow-sm" placeholder="Company / Customer Name *" />
                  <input type="text" value={custForm.contact} onChange={e => setCustForm({...custForm, contact: e.target.value})} className="px-4 py-3 border border-slate-300 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-600 shadow-sm" placeholder="Primary Contact Person" />
                  <div className="grid grid-cols-2 gap-5">
                    <input type="text" value={custForm.phone} onChange={e => setCustForm({...custForm, phone: e.target.value})} className="px-4 py-3 border border-slate-300 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-600 shadow-sm" placeholder="Phone Number" />
                    <input type="email" value={custForm.email} onChange={e => setCustForm({...custForm, email: e.target.value})} className="px-4 py-3 border border-slate-300 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-600 shadow-sm" placeholder="Email Address" />
                  </div>
                  <input type="text" value={custForm.address} onChange={e => setCustForm({...custForm, address: e.target.value})} className="px-4 py-3 border border-slate-300 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-600 shadow-sm" placeholder="Complete Address" />
                  <div className="flex flex-col gap-1.5 mt-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Authorized Credit Limit (₱)</label>
                    <input type="number" min="0" value={custForm.creditLimit} onChange={e => setCustForm({...custForm, creditLimit: Number(e.target.value)})} className="px-4 py-3 border border-emerald-200 rounded-xl text-sm font-black outline-none focus:ring-2 focus:ring-emerald-600 bg-emerald-50 text-emerald-900" />
                  </div>
                  <button type="submit" disabled={isProcessing} className="mt-4 py-4 bg-emerald-600 text-white font-black uppercase tracking-wider rounded-xl hover:bg-emerald-700 transition-colors shadow-md disabled:opacity-50">Create Account Profile</button>
                </form>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* EDIT MODAL */}
      {editCustomerModal.isOpen && editCustomerModal.customer && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-5 border-b bg-emerald-600 text-white"><h3 className="font-bold text-lg">Edit Customer Profile</h3></div>
            <form onSubmit={handleUpdateCustomer} className="p-6 flex flex-col gap-4 bg-slate-50">
              <input type="text" required value={editCustomerModal.customer.name} onChange={e => setEditCustomerModal({ ...editCustomerModal, customer: { ...editCustomerModal.customer!, name: e.target.value }})} className="px-4 py-3 border rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-600" />
              <input type="text" value={editCustomerModal.customer.contact || ''} onChange={e => setEditCustomerModal({ ...editCustomerModal, customer: { ...editCustomerModal.customer!, contact: e.target.value }})} className="px-4 py-3 border rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-600" />
              <div className="flex flex-col gap-1.5 mt-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Credit Limit (₱)</label>
                <input type="number" min="0" value={editCustomerModal.customer.creditLimit} onChange={e => setEditCustomerModal({ ...editCustomerModal, customer: { ...editCustomerModal.customer!, creditLimit: Number(e.target.value) }})} className="px-4 py-3 border border-emerald-200 rounded-xl text-sm font-black outline-none focus:ring-2 focus:ring-emerald-600 bg-emerald-100 text-emerald-900" />
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setEditCustomerModal({ isOpen: false, customer: null })} className="flex-1 px-4 py-3 bg-white border border-slate-300 font-bold rounded-xl text-slate-700">Cancel</button>
                <button type="submit" disabled={isProcessing} className="flex-1 px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-xl transition-colors shadow-sm">Save Update</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* HISTORY MODAL */}
      {historyModal.isOpen && historyModal.customerId && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-5 border-b bg-slate-900 text-white flex justify-between items-center">
              <h3 className="font-bold text-lg tracking-wide">Client Sales Ledger</h3>
              <button onClick={() => setHistoryModal({ isOpen: false, customerId: null })} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <div className="p-0 max-h-[60vh] overflow-y-auto bg-slate-50">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-100 border-b border-slate-200 sticky top-0">
                  <tr><th className="py-3 px-4 font-bold text-slate-500 uppercase text-xs">Date / SO</th><th className="py-3 px-4 font-bold text-slate-500 uppercase text-xs">Product Details</th><th className="py-3 px-4 font-bold text-slate-500 uppercase text-xs text-right">Unit Price</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {getCustomerSalesHistory(historyModal.customerId).length === 0 ? (
                    <tr><td colSpan={3} className="py-8 text-center text-slate-400 font-medium">No sales history found.</td></tr>
                  ) : getCustomerSalesHistory(historyModal.customerId).map((h, i) => (
                    <tr key={i} className="bg-white">
                      <td className="py-3 px-4 font-mono text-xs text-slate-600">{new Date(h.date).toLocaleDateString()}<br/><span className="text-[10px] text-slate-400">{h.so}</span></td>
                      <td className="py-3 px-4 font-bold text-slate-900 text-sm">{h.product} <span className="text-[10px] text-slate-400 block font-bold uppercase mt-0.5">Qty: {h.qty}</span></td>
                      <td className="py-3 px-4 text-right font-black text-emerald-700">₱{(h.price || 0).toLocaleString('en-PH')}</td>
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