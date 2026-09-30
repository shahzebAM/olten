import React, { useState, useEffect, useCallback } from 'react';

interface Supplier {
  id: string;
  legalName: string;
  tradeName: string;
  tin: string;
  address: string;
  contactPerson: string;
  phone: string;
  email: string;
  paymentTerms: string;
  apBalance: number;
}

interface SupplierModuleProps {
  selectedCompany: string;
  loginUsername: string;
  API_BASE_URL: string;
  onBack: () => void;
}

export default function SupplierModule({ selectedCompany, loginUsername, API_BASE_URL, onBack }: SupplierModuleProps) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  const [isSupplierModalOpen, setIsSupplierModalOpen] = useState(false);
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);
  const [supplierForm, setSupplierForm] = useState({
    legalName: '', tradeName: '', tin: '', address: '', contactPerson: '', phone: '', email: '', paymentTerms: 'Cash on Delivery'
  });

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ message: msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchSuppliers = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/procurement/suppliers?company=${encodeURIComponent(selectedCompany)}`);
      if (res.ok) {
        const data = await res.json();
        setSuppliers(data || []);
      }
    } catch (e) {
      showToast("Error loading suppliers.", "error");
    } finally {
      setIsLoading(false);
    }
  }, [selectedCompany, API_BASE_URL]);

  useEffect(() => { 
    fetchSuppliers(); 
  }, [fetchSuppliers]);

  const openAddSupplier = () => {
    setSupplierForm({ legalName: '', tradeName: '', tin: '', address: '', contactPerson: '', phone: '', email: '', paymentTerms: 'Cash on Delivery' });
    setEditingSupplierId(null);
    setIsSupplierModalOpen(true);
  };

  const openEditSupplier = (sup: Supplier) => {
    setSupplierForm({ ...sup });
    setEditingSupplierId(sup.id);
    setIsSupplierModalOpen(true);
  };

  const handleSaveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    const method = editingSupplierId ? 'PATCH' : 'POST';
    const url = editingSupplierId 
      ? `${API_BASE_URL}/procurement/suppliers/${editingSupplierId}`
      : `${API_BASE_URL}/procurement/suppliers`;

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...supplierForm, company: selectedCompany, user: loginUsername })
      });
      if (!res.ok) throw new Error();
      showToast(editingSupplierId ? "Supplier updated." : "Supplier registered.", "success");
      setIsSupplierModalOpen(false);
      fetchSuppliers();
    } catch (err) {
      showToast("Failed to save supplier.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteSupplier = async (id: string) => {
    if (!window.confirm("Delete this supplier? All associated PO references may be affected.")) return;
    try {
      const res = await fetch(`${API_BASE_URL}/procurement/suppliers/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      showToast("Supplier deleted.", "success");
      fetchSuppliers();
    } catch (err) {
      showToast("Failed to delete supplier. They may have active POs.", "error");
    }
  };

  return (
    <div className="flex flex-col h-screen w-full bg-[#F8FAFC] font-sans text-slate-900 overflow-hidden">
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[200] px-5 py-3.5 rounded-xl shadow-xl font-bold text-sm ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>
          {toast.message}
        </div>
      )}

      <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0 shadow-sm z-10 print:hidden">
        <div>
          <h2 className="text-2xl font-black text-slate-800 tracking-tight">Supplier Directory</h2>
          <div className="text-xs font-semibold text-slate-400 mt-0.5 flex items-center gap-2">
            <span>Procurement</span> <span>/</span> <span className="text-sky-600">{selectedCompany}</span>
          </div>
        </div>
        <button onClick={onBack} className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors shadow-sm border border-slate-200">
          Back to Gateway
        </button>
      </header>

      <main className="flex-1 overflow-y-auto p-8 print:hidden flex flex-col">
        <div className="w-full max-w-7xl mx-auto flex-1 flex flex-col relative">
          
          <div className="bg-white border border-slate-300 rounded-2xl shadow-sm flex flex-col flex-1 overflow-hidden relative">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center shrink-0">
              <h3 className="font-bold text-slate-800 uppercase tracking-widest text-sm">Approved Vendors</h3>
              <button onClick={openAddSupplier} className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-black uppercase tracking-widest rounded-lg shadow-sm transition-colors">
                + Register Supplier
              </button>
            </div>
            <div className="flex-1 overflow-auto w-full">
              <table className="w-full text-left text-sm whitespace-nowrap min-w-[1000px] border-collapse">
                <thead className="bg-slate-50 shadow-sm sticky top-0 z-20">
                  <tr>
                    <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] border-b border-slate-200">Legal Name / Brand</th>
                    <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] border-b border-slate-200">Contact Person</th>
                    <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] border-b border-slate-200">TIN</th>
                    <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] border-b border-slate-200 text-center">Terms</th>
                    <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] border-b border-slate-200 text-right">A/P Balance</th>
                    <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] border-b border-slate-200 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {suppliers.length === 0 ? (
                    <tr><td colSpan={6} className="py-20 text-center text-slate-400 font-medium">No suppliers registered in this workspace.</td></tr>
                  ) : (
                    suppliers.map(sup => (
                      <tr key={sup.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-3 px-6">
                          <div className="font-bold text-slate-900">{sup.legalName}</div>
                          <div className="text-xs font-semibold text-slate-400">DBA: {sup.tradeName || 'N/A'}</div>
                        </td>
                        <td className="py-3 px-6">
                          <div className="font-bold text-slate-700">{sup.contactPerson || 'N/A'}</div>
                          <div className="text-xs font-mono text-slate-400">{sup.phone || 'N/A'}</div>
                        </td>
                        <td className="py-3 px-6 font-mono text-xs font-bold text-slate-500">{sup.tin}</td>
                        <td className="py-3 px-6 text-center">
                          <span className="px-2.5 py-1 text-[9px] font-black uppercase tracking-wider rounded-md bg-slate-100 text-slate-600 border border-slate-200">
                            {sup.paymentTerms}
                          </span>
                        </td>
                        <td className="py-3 px-6 text-right font-black text-slate-900 font-mono">
                          ₱{Number(sup.apBalance || 0).toLocaleString('en-PH', {minimumFractionDigits: 2})}
                        </td>
                        <td className="py-3 px-6 text-right space-x-3">
                          <button onClick={() => openEditSupplier(sup)} className="text-sky-600 hover:text-sky-800 text-xs font-black uppercase tracking-wider">Edit</button>
                          <button onClick={() => handleDeleteSupplier(sup.id)} className="text-rose-600 hover:text-rose-800 text-xs font-black uppercase tracking-wider">Del</button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>

      {/* ADD/EDIT SUPPLIER MODAL */}
      {isSupplierModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex justify-center p-8 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-auto flex flex-col overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
              <h3 className="text-xl font-black text-slate-900 tracking-tight">{editingSupplierId ? 'Edit Supplier Profile' : 'Register New Supplier'}</h3>
              <button onClick={() => setIsSupplierModalOpen(false)} className="text-slate-400 hover:text-slate-700 font-black text-xl">✕</button>
            </div>
            <form onSubmit={handleSaveSupplier} className="flex flex-col flex-1">
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 block">Legal Name *</label>
                    <input required type="text" value={supplierForm.legalName} onChange={e => setSupplierForm({...supplierForm, legalName: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-slate-800 outline-none" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 block">Brand / Trade Name</label>
                    <input type="text" value={supplierForm.tradeName} onChange={e => setSupplierForm({...supplierForm, tradeName: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-slate-800 outline-none" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 block">TIN / Tax ID *</label>
                  <input required type="text" placeholder="000-000-000-000" value={supplierForm.tin} onChange={e => setSupplierForm({...supplierForm, tin: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-slate-800 outline-none" />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 block">Complete Address *</label>
                  <input required type="text" value={supplierForm.address} onChange={e => setSupplierForm({...supplierForm, address: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-slate-800 outline-none" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 block">Contact Person</label>
                    <input type="text" value={supplierForm.contactPerson} onChange={e => setSupplierForm({...supplierForm, contactPerson: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-slate-800 outline-none" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 block">Phone Number</label>
                    <input type="text" value={supplierForm.phone} onChange={e => setSupplierForm({...supplierForm, phone: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-slate-800 outline-none" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 block">Email</label>
                    <input type="email" value={supplierForm.email} onChange={e => setSupplierForm({...supplierForm, email: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-slate-800 outline-none" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 block">Payment Terms</label>
                    <select value={supplierForm.paymentTerms} onChange={e => setSupplierForm({...supplierForm, paymentTerms: e.target.value})} className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm font-bold text-slate-700 outline-none bg-white">
                      <option value="Cash on Delivery">Cash on Delivery (COD)</option>
                      <option value="Net 15">Net 15 Days</option>
                      <option value="Net 30">Net 30 Days</option>
                      <option value="Net 60">Net 60 Days</option>
                    </select>
                  </div>
                </div>
              </div>
              <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-3 shrink-0">
                <button type="button" onClick={() => setIsSupplierModalOpen(false)} className="px-5 py-2.5 bg-white border border-slate-300 text-slate-700 text-xs font-black uppercase tracking-widest rounded-lg hover:bg-slate-100 transition-colors">Cancel</button>
                <button type="submit" disabled={isLoading} className="px-6 py-2.5 bg-slate-900 text-white text-xs font-black uppercase tracking-widest rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-50">
                  {isLoading ? 'Saving...' : 'Save Profile'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}