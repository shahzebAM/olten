import React, { useState, useEffect, useCallback } from 'react';

interface AssignedProduct { productId: number; sku: string; name: string; supplierCost: number; }
interface Supplier {
  id: string; legalName: string; tradeName: string; tin: string; address: string; 
  contactPerson: string; phone: string; email: string; paymentTerms: string; apBalance: number;
  catalog?: AssignedProduct[];
}
interface Product { id: number; name: string; sku: string; purchasePrice: number; }

interface SupplierModuleProps { selectedCompany: string; loginUsername: string; API_BASE_URL: string; onBack: () => void; }

export default function SupplierModule({ selectedCompany, loginUsername, API_BASE_URL, onBack }: SupplierModuleProps) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [catalogProducts, setCatalogProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  const [isSupplierModalOpen, setIsSupplierModalOpen] = useState(false);
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);
  const [supplierForm, setSupplierForm] = useState({
    legalName: '', tradeName: '', tin: '', address: '', contactPerson: '', phone: '', email: '', paymentTerms: 'Cash on Delivery'
  });

  // DB Synced Catalog States
  const [activeProductsModal, setActiveProductsModal] = useState<string | null>(null);
  const [activeCatalog, setActiveCatalog] = useState<AssignedProduct[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ message: msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchAllData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [supRes, prodRes] = await Promise.all([
        fetch(`${API_BASE_URL}/procurement/suppliers?company=${encodeURIComponent(selectedCompany)}`),
        fetch(`${API_BASE_URL}/products?company=${encodeURIComponent(selectedCompany)}`)
      ]);
      if (supRes.ok) setSuppliers(await supRes.json());
      if (prodRes.ok) setCatalogProducts(await prodRes.json());
    } catch (e) {
      showToast("Error loading data.", "error");
    } finally {
      setIsLoading(false);
    }
  }, [selectedCompany, API_BASE_URL]);

  useEffect(() => { fetchAllData(); }, [fetchAllData]);

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
    const url = editingSupplierId ? `${API_BASE_URL}/procurement/suppliers/${editingSupplierId}` : `${API_BASE_URL}/procurement/suppliers`;
    try {
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...supplierForm, company: selectedCompany, user: loginUsername })
      });
      if (!res.ok) throw new Error();
      showToast(editingSupplierId ? "Supplier updated." : "Supplier registered.", "success");
      setIsSupplierModalOpen(false);
      fetchAllData();
    } catch (err) { showToast("Failed to save supplier.", "error"); } finally { setIsLoading(false); }
  };

  const handleDeleteSupplier = async (id: string) => {
    if (!window.confirm("Delete this supplier? All associated PO references may be affected.")) return;
    try {
      const res = await fetch(`${API_BASE_URL}/procurement/suppliers/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      showToast("Supplier deleted.", "success");
      fetchAllData();
    } catch (err) { showToast("Failed to delete supplier.", "error"); }
  };

  // --- CATALOG SYNC METHODS ---
  const openCatalogModal = (supplier: Supplier) => {
    setActiveProductsModal(supplier.id);
    setActiveCatalog(supplier.catalog || []);
    setSearchTerm('');
  };

  const toggleProductAssignment = (product: Product) => {
    setActiveCatalog(prev => {
      const exists = prev.find(p => p.productId === product.id);
      if (exists) return prev.filter(p => p.productId !== product.id);
      return [...prev, { productId: product.id, sku: product.sku, name: product.name, supplierCost: product.purchasePrice }];
    });
  };

  const updateSupplierCost = (productId: number, newCost: string) => {
    setActiveCatalog(prev => prev.map(p => p.productId === productId ? { ...p, supplierCost: Number(newCost) } : p));
  };

  const handleSaveCatalogToDatabase = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/procurement/suppliers/${activeProductsModal}/catalog`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ catalog: activeCatalog })
      });
      if (!res.ok) throw new Error();
      showToast("Supplier catalog synced to database.", "success");
      setActiveProductsModal(null);
      fetchAllData();
    } catch (e) {
      showToast("Failed to sync catalog.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen w-full bg-[#F8FAFC] font-sans text-slate-900 overflow-hidden">
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[300] px-5 py-3.5 rounded-xl shadow-xl font-bold text-sm ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>
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
                    <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] border-b border-slate-200 text-center">Assigned Items</th>
                    <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] border-b border-slate-200 text-right">A/P Balance</th>
                    <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] border-b border-slate-200 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {suppliers.length === 0 ? (
                    <tr><td colSpan={7} className="py-20 text-center text-slate-400 font-medium">No suppliers registered in this workspace.</td></tr>
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
                        <td className="py-3 px-6 text-center">
                          <button onClick={() => openCatalogModal(sup)} className="px-3 py-1.5 bg-indigo-50 text-indigo-700 font-black text-[10px] uppercase rounded-lg border border-indigo-200 hover:bg-indigo-100 transition-colors shadow-sm">
                            {sup.catalog?.length || 0} Products
                          </button>
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

      {/* ASSIGN PRODUCTS TO SUPPLIER MODAL (LAYOUT FIXED & CONNECTED TO DB) */}
      {activeProductsModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex justify-center items-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl flex flex-col overflow-hidden max-h-[90vh] animate-in zoom-in-95 duration-200">
            
            <div className="p-6 border-b border-indigo-100 flex justify-between items-center bg-indigo-50 shrink-0">
              <div>
                <h3 className="text-xl font-black text-indigo-900 tracking-tight">Supplier Catalog Link</h3>
                <p className="text-xs font-bold text-indigo-500 uppercase tracking-widest mt-1">
                  Assign products and set vendor-specific cost pricing
                </p>
              </div>
              <button onClick={() => setActiveProductsModal(null)} className="p-2 text-indigo-400 hover:text-indigo-700 hover:bg-indigo-100 rounded-full transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            <div className="p-4 border-b border-slate-200 bg-white shrink-0">
              <input 
                type="text" 
                placeholder="Search Master Catalog by Name or SKU..." 
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full px-5 py-3 border border-slate-300 rounded-xl text-sm font-bold uppercase outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50"
              />
            </div>
            
            <div className="flex-1 overflow-y-auto p-0 bg-slate-50 relative">
              {/* TABLE FIXED APPLIED HERE TO PREVENT HORIZONTAL SCROLL OVERFLOW */}
              <table className="w-full text-left text-sm table-fixed border-collapse">
                <thead className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="py-3 px-4 w-14 text-center"></th>
                    <th className="py-3 px-4 font-black text-slate-500 uppercase tracking-widest text-[10px] w-auto">Product / SKU</th>
                    <th className="py-3 px-4 font-black text-slate-500 uppercase tracking-widest text-[10px] text-right w-24 sm:w-32 hidden sm:table-cell">Sys Cost</th>
                    <th className="py-3 px-4 font-black text-indigo-600 uppercase tracking-widest text-[10px] text-right bg-indigo-50 w-32 sm:w-40">Custom Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {catalogProducts.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.sku.toLowerCase().includes(searchTerm.toLowerCase())).map(p => {
                    const isLinked = activeCatalog.some(linked => linked.productId === p.id);
                    const linkedProduct = activeCatalog.find(linked => linked.productId === p.id);
                    
                    return (
                      <tr key={p.id} className={`hover:bg-slate-50 transition-colors ${isLinked ? 'bg-indigo-50/20' : ''}`}>
                        <td className="py-3 px-4 text-center">
                          <input 
                            type="checkbox" 
                            checked={isLinked} 
                            onChange={() => toggleProductAssignment(p)}
                            className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                          />
                        </td>
                        <td className="py-3 px-4 overflow-hidden">
                          <div className={`font-black text-sm uppercase truncate ${isLinked ? 'text-indigo-900' : 'text-slate-900'}`}>{p.name}</div>
                          <div className="text-[10px] font-mono font-bold text-slate-400 mt-0.5 truncate">{p.sku}</div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-slate-400 hidden sm:table-cell">
                          ₱{Number(p.purchasePrice).toLocaleString('en-PH', {minimumFractionDigits: 2})}
                        </td>
                        <td className="py-2 px-4 bg-indigo-50/30">
                          <input 
                            type="number" 
                            min="0" step="0.01"
                            disabled={!isLinked}
                            value={linkedProduct ? linkedProduct.supplierCost : ''}
                            onChange={e => updateSupplierCost(p.id, e.target.value)}
                            className="w-full px-2 sm:px-3 py-2 border border-slate-200 rounded-lg text-sm font-black font-mono text-right text-indigo-700 outline-none focus:border-indigo-500 disabled:opacity-30 disabled:bg-slate-100 shadow-inner"
                            placeholder="₱0.00"
                          />
                        </td>
                      </tr>
                    );
                  })}
                  {catalogProducts.length === 0 && (
                    <tr><td colSpan={4} className="py-12 text-center text-sm font-medium text-slate-400 uppercase">Master catalog is empty.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end shrink-0">
              <button onClick={handleSaveCatalogToDatabase} disabled={isLoading} className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-colors shadow-md">
                {isLoading ? 'Syncing...' : 'Save & Sync Catalog'}
              </button>
            </div>

          </div>
        </div>
      )}
      
      {/* ... [Rest of SupplierModule code remains identical for other modals] ... */}
      
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