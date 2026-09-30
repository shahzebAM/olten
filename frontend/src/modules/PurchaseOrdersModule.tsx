import React, { useState, useEffect, useCallback } from 'react';

// --- INTERFACES ---
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

interface POItem { 
  id: string; 
  productId: number; 
  sku: string; 
  productName: string; 
  requestedQty: number; 
  confirmedQty?: number;
  shortageQty?: number;
  unitCost: number; 
  lineTotal: number; 
}

interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierId?: string;
  supplierName?: string;
  company: string;
  osReference: string | null;
  status: string;
  subtotal: number;
  vatApplied: boolean;
  vatAmount: number;
  grandTotal: number;
  createdBy: string;
  createdAt: string;
  items: POItem[];
}

interface SupplierModuleProps {
  selectedCompany: string;
  loginUsername: string;
  API_BASE_URL: string;
  onBack: () => void;
}

export default function SupplierModule({ selectedCompany, loginUsername, API_BASE_URL, onBack }: SupplierModuleProps) {
  const isAuthorizedAdmin = ['admin', 'ali', 'super admin'].includes(loginUsername?.toLowerCase() || '');

  // Global States
  const [activeTab, setActiveTab] = useState<'directory' | 'pos'>('directory');
  const [isLoading, setIsLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  // Supplier States
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isSupplierModalOpen, setIsSupplierModalOpen] = useState(false);
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);
  const [supplierForm, setSupplierForm] = useState({
    legalName: '', tradeName: '', tin: '', address: '', contactPerson: '', phone: '', email: '', paymentTerms: 'Cash on Delivery'
  });

  // PO States
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [viewPo, setViewPo] = useState<PurchaseOrder | null>(null);
  const [receivePo, setReceivePo] = useState<PurchaseOrder | null>(null);
  const [receiveItems, setReceiveItems] = useState<any[]>([]);

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ message: msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // --- DATA FETCHING ---
  const fetchSuppliers = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/procurement/suppliers?company=${encodeURIComponent(selectedCompany)}`);
      if (res.ok) {
        const data = await res.json();
        setSuppliers(data || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  }, [selectedCompany, API_BASE_URL]);

  const fetchPurchaseOrders = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/procurement/purchase-orders?company=${encodeURIComponent(selectedCompany)}`);
      if (res.ok) {
        const data = await res.json();
        setPurchaseOrders(data || []);
      }
    } catch (e) {
      showToast("Error loading Purchase Orders.", "error");
    } finally {
      setIsLoading(false);
    }
  }, [selectedCompany, API_BASE_URL]);

  useEffect(() => { 
    if (activeTab === 'directory') fetchSuppliers();
    if (activeTab === 'pos') fetchPurchaseOrders(); 
  }, [activeTab, fetchSuppliers, fetchPurchaseOrders]);


  // --- SUPPLIER WORKFLOW ---
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
      showToast("Failed to delete supplier.", "error");
    }
  };


  // --- RECEIVE PO WORKFLOW (PHASE 8) ---
  const openReceiveModal = (po: PurchaseOrder) => {
    setReceivePo(po);
    setReceiveItems(po.items.map(i => ({
      ...i,
      confirmedQty: i.confirmedQty !== undefined && i.confirmedQty !== null ? i.confirmedQty : i.requestedQty,
      shortageQty: i.shortageQty || 0
    })));
  };

  const handleUpdateReceiveQty = (index: number, val: string) => {
    const updated = [...receiveItems];
    if (val === '') {
      updated[index].confirmedQty = '';
      updated[index].shortageQty = updated[index].requestedQty;
    } else {
      const confirmed = parseInt(val, 10);
      const requested = updated[index].requestedQty;
      updated[index].confirmedQty = isNaN(confirmed) ? '' : confirmed;
      updated[index].shortageQty = isNaN(confirmed) ? requested : Math.max(0, requested - confirmed);
    }
    setReceiveItems(updated);
  };

  const handleReceiveSubmit = async () => {
    if (!receivePo) return;
    const isValid = receiveItems.every(i => typeof i.confirmedQty === 'number' && !isNaN(i.confirmedQty) && i.confirmedQty >= 0);
    if (!isValid) return showToast("Enter a valid received quantity for all items.", "error");

    setIsLoading(true);
    try {
      const payload = {
        user: loginUsername,
        verifications: receiveItems.map(i => ({ itemId: i.id, confirmedQty: Number(i.confirmedQty) }))
      };

      const res = await fetch(`${API_BASE_URL}/procurement/purchase-orders/${receivePo.id}/receive`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error();
      showToast("Purchase Order received successfully. Shortages logged.", "success");
      setReceivePo(null);
      fetchPurchaseOrders();
    } catch (e) {
      showToast("Failed to receive Purchase Order.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelPo = async (id: string) => {
    if (!window.confirm("Void this Purchase Order? It will remain in history as Cancelled.")) return;
    try {
      const res = await fetch(`${API_BASE_URL}/procurement/purchase-orders/${id}/cancel`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: loginUsername })
      });
      if (!res.ok) throw new Error();
      showToast("Purchase Order cancelled.", "success");
      setViewPo(null);
      fetchPurchaseOrders();
    } catch (e) { showToast("Failed to cancel P.O.", "error"); }
  };

  const handleHardDeletePo = async (id: string) => {
    if (!isAuthorizedAdmin) return showToast("Unauthorized action.", "error");
    if (!window.confirm("CRITICAL WARNING: This will permanently wipe this P.O. Are you sure?")) return;
    try {
      const res = await fetch(`${API_BASE_URL}/procurement/purchase-orders/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      showToast("Purchase Order permanently deleted.", "success");
      fetchPurchaseOrders();
    } catch (e) { showToast("Failed to delete P.O.", "error"); }
  };

  return (
    <div className="flex flex-col h-screen w-full bg-[#F8FAFC] font-sans text-slate-900 overflow-hidden">
      
      {/* TOAST NOTIFICATION */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[200] px-5 py-3.5 rounded-xl shadow-xl font-bold text-sm ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>
          {toast.message}
        </div>
      )}

      {/* HEADER */}
      <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0 shadow-sm z-10 print:hidden">
        <div>
          <h2 className="text-2xl font-black text-slate-800 tracking-tight">Vendor Management</h2>
          <div className="text-xs font-semibold text-slate-400 mt-0.5 flex items-center gap-2">
            <span>Procurement</span> <span>/</span> <span className="text-sky-600">{selectedCompany}</span>
          </div>
        </div>
        <button onClick={onBack} className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors shadow-sm border border-slate-200">
          Back to Gateway
        </button>
      </header>

      {/* TAB NAVIGATION */}
      <div className="bg-white border-b border-slate-200 px-8 py-3 flex gap-4 shrink-0 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.02)] z-10">
        <button 
          onClick={() => setActiveTab('directory')} 
          className={`px-5 py-2 rounded-lg text-sm font-black uppercase tracking-wider transition-colors ${activeTab === 'directory' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'}`}
        >
          Supplier Directory
        </button>
        <button 
          onClick={() => setActiveTab('pos')} 
          className={`px-5 py-2 rounded-lg text-sm font-black uppercase tracking-wider transition-colors ${activeTab === 'pos' ? 'bg-sky-700 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'}`}
        >
          P.O. Ledger
        </button>
      </div>

      <main className="flex-1 overflow-y-auto p-8 print:hidden flex flex-col">
        <div className="w-full max-w-7xl mx-auto space-y-6 flex-1 flex flex-col">

          {/* =========================================
              TAB 1: SUPPLIER DIRECTORY
          ========================================= */}
          {activeTab === 'directory' && (
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
                            <div className="font-bold text-slate-700">{sup.contactPerson}</div>
                            <div className="text-xs font-mono text-slate-400">{sup.phone}</div>
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
          )}

          {/* =========================================
              TAB 2: P.O. LEDGER (Original Code)
          ========================================= */}
          {activeTab === 'pos' && (
            <div className="bg-white border border-slate-300 rounded-2xl shadow-sm flex flex-col flex-1 overflow-hidden relative">
              {isLoading && (
                <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] z-10 flex items-center justify-center">
                  <div className="font-bold text-sky-600 animate-pulse uppercase tracking-widest text-sm bg-white px-6 py-3 rounded-full shadow-lg border border-sky-100">Syncing P.O. Ledger...</div>
                </div>
              )}
              <div className="flex-1 overflow-auto w-full">
                <table className="w-full text-left text-sm whitespace-nowrap min-w-[1100px] border-collapse">
                  <thead className="bg-slate-50 shadow-sm sticky top-0 z-20">
                    <tr>
                      <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] border-b border-slate-200">P.O. Number</th>
                      <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] border-b border-slate-200">Supplier</th>
                      <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] text-center border-b border-slate-200">Items</th>
                      <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] text-right border-b border-slate-200">Total Value</th>
                      <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] text-center border-b border-slate-200">Status</th>
                      <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] border-b border-slate-200">Generated By</th>
                      <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] text-right border-b border-slate-200">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {purchaseOrders.length === 0 && !isLoading ? (
                      <tr><td colSpan={7} className="py-20 text-center text-slate-400 font-medium">No Purchase Orders generated yet.</td></tr>
                    ) : (
                      purchaseOrders.map(po => (
                        <tr key={po.id} className="hover:bg-slate-50 transition-colors">
                          <td className="py-3.5 px-6 font-mono text-sm font-black text-sky-700">{po.poNumber}</td>
                          <td className="py-3.5 px-6 font-bold text-slate-700">{po.supplierName || 'N/A'}</td>
                          <td className="py-3.5 px-6 text-center font-black text-slate-700">{po.items?.length || 0}</td>
                          <td className="py-3.5 px-6 text-right font-black text-slate-900 font-mono">₱{Number(po.grandTotal).toLocaleString('en-PH', {minimumFractionDigits: 2})}</td>
                          <td className="py-3.5 px-6 text-center">
                            <span className={`px-3 py-1.5 text-[9px] font-black uppercase tracking-wider rounded-md 
                              ${po.status === 'Cancelled' ? 'bg-rose-100 text-rose-700' : 
                                po.status === 'Generated' ? 'bg-sky-100 text-sky-700' : 
                                po.status === 'Partially Received' ? 'bg-amber-100 text-amber-700' : 
                                po.status === 'Received' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700'}`}>
                              {po.status}
                            </span>
                          </td>
                          <td className="py-3.5 px-6 text-xs font-bold text-slate-500 uppercase">{po.createdBy}</td>
                          <td className="py-3.5 px-6 text-right space-x-2">
                            {po.status !== 'Cancelled' && (
                              <button onClick={() => openReceiveModal(po)} className="px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md text-[9px] font-black uppercase hover:bg-emerald-100 transition-colors shadow-sm">Receive</button>
                            )}
                            <button onClick={() => setViewPo(po)} className="px-3 py-1.5 bg-white text-slate-700 border border-slate-300 rounded-md text-[9px] font-black uppercase hover:bg-slate-50 transition-colors shadow-sm">View</button>
                            {isAuthorizedAdmin && (
                              <button onClick={() => handleHardDeletePo(po.id)} className="px-3 py-1.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-md text-[9px] font-black uppercase hover:bg-rose-100 transition-colors shadow-sm">Del</button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      </main>

      {/* =========================================
          MODALS
      ========================================= */}

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

      {/* RECEIVE PO MODAL (Phase 8 preserved) */}
      {receivePo && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[200] flex justify-center items-center p-4 sm:p-8">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 max-h-full">
            <div className="p-6 border-b border-slate-200 flex justify-between items-center bg-slate-50 shrink-0">
              <div>
                <h3 className="text-xl font-black text-slate-900 tracking-tight uppercase">Receive Purchase Order: {receivePo.poNumber}</h3>
                <p className="text-xs font-bold text-slate-500 tracking-widest mt-1 uppercase">Verify Supplier Delivery vs Requested Qty</p>
              </div>
              <button type="button" onClick={() => setReceivePo(null)} className="text-slate-400 hover:text-slate-700 font-black text-xl">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 bg-white relative">
              <table className="w-full text-left text-sm whitespace-nowrap border-collapse">
                <thead className="bg-slate-50 border-y border-slate-200">
                  <tr>
                    <th className="py-3 px-4 font-black text-slate-500 uppercase tracking-widest text-[10px]">SKU / Product</th>
                    <th className="py-3 px-4 font-black text-sky-600 uppercase tracking-widest text-[10px] text-center w-28 bg-sky-50/50">Ordered</th>
                    <th className="py-3 px-4 font-black text-emerald-600 uppercase tracking-widest text-[10px] text-center w-36 bg-emerald-50/50">Delivered</th>
                    <th className="py-3 px-4 font-black text-rose-600 uppercase tracking-widest text-[10px] text-center w-28 bg-rose-50/50">Shortage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {receiveItems.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="py-4 px-4 border border-slate-100">
                        <div className="font-bold text-slate-900 truncate max-w-[300px]">{item.productName}</div>
                        <div className="text-[10px] font-mono text-slate-500">{item.sku}</div>
                      </td>
                      <td className="py-4 px-4 border border-slate-100 text-center font-black text-sky-700 bg-sky-50/20">{item.requestedQty}</td>
                      <td className="py-2 px-4 border border-slate-100 bg-emerald-50/20 relative">
                        <input 
                          type="number" min="0" value={item.confirmedQty} 
                          onChange={e => handleUpdateReceiveQty(idx, e.target.value)} 
                          className={`w-full px-2 py-2.5 text-center font-black text-lg bg-white border-2 rounded outline-none shadow-sm transition-all ${item.shortageQty > 0 ? 'border-rose-400 text-rose-700 focus:border-rose-600' : 'border-emerald-300 text-emerald-700 focus:border-emerald-600'}`} 
                        />
                      </td>
                      <td className={`py-4 px-4 text-center border border-slate-100 font-black text-lg ${item.shortageQty > 0 ? 'text-rose-600 bg-rose-50/40' : 'text-slate-300'}`}>{item.shortageQty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-6 border-t border-slate-200 bg-slate-50 shrink-0 flex justify-between items-center">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Missing items automatically route to Shortages.</p>
              <button onClick={handleReceiveSubmit} disabled={isLoading} className="px-8 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 text-white font-black uppercase tracking-wider rounded-xl transition-colors shadow-lg">
                {isLoading ? "Processing..." : "Confirm Delivery"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW PO MODAL (Preserved from original) */}
      {viewPo && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex justify-center p-4 sm:p-8 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl my-auto flex flex-col">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0 rounded-t-2xl">
              <div>
                <h3 className="text-xl font-black text-slate-900 tracking-tight">P.O. Detail View</h3>
                <p className="text-xs font-mono uppercase text-slate-500 tracking-widest mt-1">Supplier: {viewPo.supplierName || 'Unknown'}</p>
              </div>
              <button onClick={() => setViewPo(null)} className="px-4 py-2.5 bg-white border border-slate-300 text-slate-700 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-slate-50 shadow-sm transition-colors">Close</button>
            </div>
            <div className="p-8 bg-white flex-1">
              <div className="flex justify-between items-start mb-10 border-b-2 border-slate-900 pb-6">
                <div>
                  <h1 className="text-3xl font-black text-slate-900 uppercase tracking-tighter">{selectedCompany}</h1>
                  <p className="text-sm font-bold text-slate-500 mt-1 uppercase tracking-widest">Purchase Order</p>
                </div>
                <div className="text-right">
                  <h2 className="text-2xl font-mono font-black text-sky-700">{viewPo.poNumber}</h2>
                  <p className="text-sm font-bold text-slate-500 mt-1 uppercase tracking-widest">Date: {new Date(viewPo.createdAt).toLocaleDateString()}</p>
                  {viewPo.status === 'Cancelled' && <p className="text-lg font-black text-rose-600 uppercase mt-2 border-2 border-rose-600 inline-block px-3 py-1">VOID / CANCELLED</p>}
                </div>
              </div>
              <table className="w-full text-left text-sm mb-12 border-collapse">
                <thead className="border-y-2 border-slate-900 bg-slate-50/50">
                  <tr>
                    <th className="py-3 px-3 font-black text-slate-900 uppercase text-xs w-32 border-r border-slate-200">SKU</th>
                    <th className="py-3 px-3 font-black text-slate-900 uppercase text-xs border-r border-slate-200">Description</th>
                    <th className="py-3 px-3 font-black text-slate-900 uppercase text-xs text-center w-24 border-r border-slate-200">Ordered</th>
                    <th className="py-3 px-3 font-black text-slate-900 uppercase text-xs text-center w-24 border-r border-slate-200">Received</th>
                    <th className="py-3 px-3 font-black text-slate-900 uppercase text-xs text-right w-32 border-r border-slate-200">Unit Cost</th>
                    <th className="py-3 px-3 font-black text-slate-900 uppercase text-xs text-right w-32">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {viewPo.items.map((item, idx) => (
                    <tr key={idx}>
                      <td className="py-3 px-3 font-mono text-xs border-r border-slate-200 font-bold text-slate-700">{item.sku}</td>
                      <td className="py-3 px-3 font-bold text-slate-900 border-r border-slate-200">
                        {item.productName}
                        {item.shortageQty && item.shortageQty > 0 ? <span className="ml-2 px-1.5 py-0.5 bg-rose-100 text-rose-700 text-[9px] font-black uppercase rounded">Short {item.shortageQty}</span> : null}
                      </td>
                      <td className="py-3 px-3 text-center font-bold border-r border-slate-200 text-slate-500">{item.requestedQty}</td>
                      <td className="py-3 px-3 text-center font-black border-r border-slate-200 text-emerald-700">{item.confirmedQty !== undefined && item.confirmedQty !== null ? item.confirmedQty : '-'}</td>
                      <td className="py-3 px-3 text-right border-r border-slate-200 font-mono text-slate-700">₱{Number(item.unitCost).toLocaleString('en-PH', {minimumFractionDigits:2})}</td>
                      <td className="py-3 px-3 text-right font-black font-mono text-slate-900">₱{Number(item.lineTotal).toLocaleString('en-PH', {minimumFractionDigits:2})}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex justify-end border-t-2 border-slate-900 pt-6">
                <div className="flex justify-between text-xl font-black text-slate-900 pt-1 w-72">
                  <span>Total Cost:</span>
                  <span className="font-mono text-sky-700">₱{Number(viewPo.grandTotal).toLocaleString('en-PH', {minimumFractionDigits:2})}</span>
                </div>
              </div>
            </div>
            <div className="p-6 border-t border-slate-200 bg-slate-50 flex justify-between items-center rounded-b-2xl">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Generated by: {viewPo.createdBy}</span>
              {viewPo.status !== 'Cancelled' && (
                <button onClick={() => handleCancelPo(viewPo.id)} className="px-5 py-2.5 bg-white border border-rose-200 text-rose-600 font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-rose-50 shadow-sm transition-colors">Cancel P.O.</button>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}