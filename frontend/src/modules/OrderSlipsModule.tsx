import React, { useState, useEffect, useCallback } from 'react';

// --- INTERFACES ---
interface OrderSlipItem { id: string; productId: number; sku: string; productName: string; requestedQty: number | ''; unitPrice: number; lineTotal: number; }
interface Customer { id: string; name: string; }
interface OrderSlip {
  id: string;
  osNumber: string;
  company: string;
  customerId: string;
  customer: Customer;
  date: string;
  status: string;
  subtotal: number;
  vatApplied: boolean;
  vatRate: number;
  vatAmount: number;
  grandTotal: number;
  createdBy: string;
  createdAt: string;
  items: OrderSlipItem[];
}

interface OrderSlipsModuleProps {
  selectedCompany: string;
  loginUsername: string;
  API_BASE_URL: string;
  onBack: () => void;
}

export default function OrderSlipsModule({ selectedCompany, loginUsername, API_BASE_URL, onBack }: OrderSlipsModuleProps) {
  const isAuthorizedAdmin = ['admin', 'ali', 'super admin'].includes(loginUsername?.toLowerCase());

  const [orderSlips, setOrderSlips] = useState<OrderSlip[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  // --- FILTERS & PAGINATION ---
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const limit = 15;

  const [viewOs, setViewOs] = useState<OrderSlip | null>(null);

  // --- ADVANCED EDIT STATES ---
  const [editOs, setEditOs] = useState<OrderSlip | null>(null);
  const [editStatus, setEditStatus] = useState('');
  const [editItems, setEditItems] = useState<OrderSlipItem[]>([]);
  const [editVatApplied, setEditVatApplied] = useState(false);
  
  const [editProductSearch, setEditProductSearch] = useState('');
  const [editSearchResults, setEditSearchResults] = useState<any[]>([]);
  const [showEditSearch, setShowEditSearch] = useState(false);

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ message: msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    const handler = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 400);
    return () => clearTimeout(handler);
  }, [search]);

  // --- FETCH LEDGER ---
  const fetchOrderSlips = useCallback(async () => {
    setIsLoading(true);
    try {
      let url = `${API_BASE_URL}/sales/order-slips?company=${encodeURIComponent(selectedCompany)}&page=${page}&limit=${limit}`;
      if (debouncedSearch) url += `&search=${encodeURIComponent(debouncedSearch)}`;
      if (statusFilter !== 'All') url += `&status=${encodeURIComponent(statusFilter)}`;
      if (startDate && endDate) {
        url += `&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
      }

      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      
      setOrderSlips(data.data || []);
      setTotalPages(data.totalPages || 1);
      setTotalRecords(data.total || 0);
    } catch (e) {
      showToast("Error loading Order Slips.", "error");
    } finally {
      setIsLoading(false);
    }
  }, [selectedCompany, page, limit, debouncedSearch, statusFilter, startDate, endDate, API_BASE_URL]);

  useEffect(() => { fetchOrderSlips(); }, [fetchOrderSlips]);

  // --- EDIT PRODUCT SEARCH DEBOUNCE ---
  useEffect(() => {
    if (editProductSearch.trim().length < 2) {
      setEditSearchResults([]);
      return;
    }
    const handler = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/sales/order-slips/search-products?company=${selectedCompany}&q=${encodeURIComponent(editProductSearch)}`);
        if (res.ok) setEditSearchResults(await res.json());
      } catch (e) { console.warn(e); }
    }, 400);
    return () => clearTimeout(handler);
  }, [editProductSearch, selectedCompany, API_BASE_URL]);

  const applyQuickDate = (type: 'today' | 'week' | 'month' | 'clear') => {
    const now = new Date();
    if (type === 'clear') { setStartDate(''); setEndDate(''); return; }
    
    if (type === 'today') {
      const today = now.toISOString().split('T')[0];
      setStartDate(today); setEndDate(today);
    } else if (type === 'week') {
      const first = now.getDate() - now.getDay() + 1;
      const last = first + 6;
      setStartDate(new Date(now.setDate(first)).toISOString().split('T')[0]);
      setEndDate(new Date(now.setDate(last)).toISOString().split('T')[0]);
    } else if (type === 'month') {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      setStartDate(first.toISOString().split('T')[0]);
      setEndDate(last.toISOString().split('T')[0]);
    }
    setPage(1);
  };

  // --- EDIT WORKFLOW ACTIONS ---
  const openEditModal = (os: OrderSlip) => {
    setEditOs(os);
    setEditStatus(os.status);
    setEditVatApplied(os.vatApplied);
    // Deep copy items so we don't mutate original state directly
    setEditItems(os.items.map(i => ({ ...i })));
  };

  const handleAddEditProduct = (p: any) => {
    if (editItems.some(i => i.productId === p.id)) {
      return showToast("Product already exists in the order.", "error");
    }
    setEditItems([...editItems, {
      id: `new-${p.id}`,
      productId: p.id,
      sku: p.sku,
      productName: p.name,
      requestedQty: 1,
      unitPrice: p.sellingPrice || 0,
      lineTotal: p.sellingPrice || 0
    }]);
    setEditProductSearch('');
    setShowEditSearch(false);
  };

  const handleEditUpdateQty = (index: number, val: string) => {
    const updated = [...editItems];
    if (val === '') {
      updated[index].requestedQty = '';
      updated[index].lineTotal = 0;
    } else {
      const qty = parseInt(val, 10);
      updated[index].requestedQty = qty;
      updated[index].lineTotal = Math.round((qty * updated[index].unitPrice) * 100) / 100;
    }
    setEditItems(updated);
  };

  const handleEditRemoveItem = (index: number) => {
    setEditItems(editItems.filter((_, i) => i !== index));
  };

  const handleEditSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editOs) return;
    
    try {
      const payload = {
        status: editStatus,
        user: loginUsername,
        isVatApplied: editVatApplied,
        items: editItems.map(i => ({
          productId: i.productId,
          sku: i.sku,
          productName: i.productName,
          requestedQty: Number(i.requestedQty) || 0,
          unitPrice: i.unitPrice
        }))
      };

      const res = await fetch(`${API_BASE_URL}/sales/order-slips/${editOs.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error();
      
      showToast("Order Slip updated successfully.", "success");
      setEditOs(null);
      fetchOrderSlips();
    } catch (e) {
      showToast("Failed to update Order Slip.", "error");
    }
  };

  const handleCancelOs = async (id: string) => {
    if (!isAuthorizedAdmin) return showToast("Unauthorized action.", "error");
    if (!window.confirm("Void this Order Slip? It will remain in history as Cancelled.")) return;

    try {
      const res = await fetch(`${API_BASE_URL}/sales/order-slips/${id}/cancel`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: loginUsername })
      });
      if (!res.ok) throw new Error();
      showToast("Order Slip cancelled.", "success");
      setViewOs(null);
      fetchOrderSlips();
    } catch (e) {
      showToast("Failed to cancel Order Slip.", "error");
    }
  };

  const handleHardDeleteOs = async (id: string) => {
    if (!isAuthorizedAdmin) return showToast("Unauthorized action.", "error");
    if (!window.confirm("CRITICAL WARNING: This will permanently wipe this Order Slip from the database. Are you sure?")) return;

    try {
      const res = await fetch(`${API_BASE_URL}/sales/order-slips/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      showToast("Order Slip permanently deleted.", "success");
      fetchOrderSlips();
    } catch (e) {
      showToast("Failed to delete Order Slip.", "error");
    }
  };

  const handlePrint = () => window.print();

  // Edit Calculations
  const editSubtotal = Math.round(editItems.reduce((acc, item) => acc + (item.lineTotal || 0), 0) * 100) / 100;
  const editVatTotal = editVatApplied ? Math.round((editSubtotal * 0.12) * 100) / 100 : 0;
  const editGrandTotal = Math.round((editSubtotal + editVatTotal) * 100) / 100;

  return (
    <div className="flex flex-col h-screen w-full bg-[#F8FAFC] font-sans text-slate-900 overflow-hidden">
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[100] px-5 py-3.5 rounded-xl shadow-xl font-bold text-sm ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>
          {toast.message}
        </div>
      )}

      <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0 shadow-sm z-10 print:hidden">
        <div><h2 className="text-2xl font-black text-slate-800 tracking-tight">Enterprise ERP <span className="text-slate-400 font-medium">| Order Slips</span></h2></div>
        <button onClick={onBack} className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors">Back to Gateway</button>
      </header>

      <main className="flex-1 overflow-y-auto p-4 sm:p-8 print:hidden">
        <div className="max-w-[1400px] mx-auto space-y-6">

          {/* FILTERS */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col lg:flex-row gap-4 items-end">
            <div className="w-full lg:w-72">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Global Search</label>
              <input type="text" placeholder="O.S. Number, Customer..." value={search} onChange={e => setSearch(e.target.value)} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div className="w-full lg:w-48">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Status</label>
              <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="All">All Statuses</option>
                <option value="Generated">Generated</option>
                <option value="Shipped">Shipped</option>
                <option value="Completed">Completed</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </div>
            <div className="w-full lg:w-auto flex flex-col sm:flex-row gap-3 items-end">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">From Date</label>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none" />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">To Date</label>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none" />
              </div>
            </div>
            <div className="flex flex-wrap gap-2 lg:ml-auto">
              <button onClick={() => applyQuickDate('today')} className="px-3 py-2 bg-slate-100 text-slate-600 text-xs font-bold rounded-lg hover:bg-slate-200">Today</button>
              <button onClick={() => applyQuickDate('week')} className="px-3 py-2 bg-slate-100 text-slate-600 text-xs font-bold rounded-lg hover:bg-slate-200">This Week</button>
              <button onClick={() => applyQuickDate('month')} className="px-3 py-2 bg-slate-100 text-slate-600 text-xs font-bold rounded-lg hover:bg-slate-200">This Month</button>
              <button onClick={() => applyQuickDate('clear')} className="px-3 py-2 bg-rose-50 text-rose-600 text-xs font-bold rounded-lg hover:bg-rose-100">Clear</button>
            </div>
          </div>

          {/* LEDGER TABLE */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden relative">
            {isLoading && (
              <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] z-10 flex items-center justify-center">
                <div className="font-bold text-indigo-600 animate-pulse uppercase tracking-widest text-sm">Syncing Ledger...</div>
              </div>
            )}
            <div className="overflow-x-auto w-full">
              <table className="w-full text-left text-sm whitespace-nowrap min-w-[1300px]">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px]">O.S. Number</th>
                    <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px]">Date</th>
                    <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px]">Customer</th>
                    <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] text-center">Items</th>
                    <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] text-right">Grand Total</th>
                    <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] text-center">Status</th>
                    <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px]">Created By</th>
                    <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {orderSlips.length === 0 && !isLoading ? (
                    <tr><td colSpan={8} className="py-16 text-center text-slate-400 font-medium">No Order Slips found.</td></tr>
                  ) : (
                    orderSlips.map(os => (
                      <tr key={os.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-4 px-6 font-mono text-sm font-black text-indigo-700">{os.osNumber}</td>
                        <td className="py-4 px-6 font-medium text-slate-600">{new Date(os.createdAt).toLocaleDateString()}</td>
                        <td className="py-4 px-6">
                          <div className="font-bold text-slate-900">{os.customer?.name || 'Unknown'}</div>
                          <div className="text-[10px] font-mono text-slate-400 uppercase mt-0.5">{os.customerId.slice(0, 8)}</div>
                        </td>
                        <td className="py-4 px-6 text-center font-black text-slate-700">{os.items?.length || 0}</td>
                        <td className="py-4 px-6 text-right font-black text-slate-900">₱{Number(os.grandTotal).toLocaleString('en-PH', {minimumFractionDigits: 2, maximumFractionDigits:2})}</td>
                        <td className="py-4 px-6 text-center">
                          <span className={`px-3 py-1 text-[10px] font-black uppercase tracking-wider rounded-md 
                            ${os.status === 'Cancelled' ? 'bg-rose-100 text-rose-700' : 
                              os.status === 'Generated' ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-700'}`}>
                            {os.status}
                          </span>
                        </td>
                        <td className="py-4 px-6 text-xs font-bold text-slate-500 uppercase">{os.createdBy}</td>
                        <td className="py-4 px-6 text-right space-x-2">
                          <button onClick={() => setViewOs(os)} className="px-3 py-1.5 bg-slate-100 text-slate-700 border border-slate-200 rounded-md text-[10px] font-bold uppercase hover:bg-slate-200 transition-colors">View</button>
                          <button onClick={() => openEditModal(os)} className="px-3 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-md text-[10px] font-bold uppercase hover:bg-indigo-100 transition-colors">Edit</button>
                          {isAuthorizedAdmin && (
                            <button onClick={() => handleHardDeleteOs(os.id)} className="px-3 py-1.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-md text-[10px] font-bold uppercase hover:bg-rose-100 transition-colors">Delete</button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-widest">
              <div>Showing {orderSlips.length} of {totalRecords} records</div>
              <div className="flex gap-2">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 bg-white border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-50">Prev</button>
                <span className="px-3 py-1.5 bg-white border border-slate-200 rounded">{page} / {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1.5 bg-white border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-50">Next</button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* FULL ADVANCED EDIT MODAL */}
      {editOs && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[200] flex justify-center p-4 sm:p-8 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl my-auto flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <div>
                <h3 className="text-xl font-black text-slate-900 tracking-tight uppercase">Edit Order Slip: {editOs.osNumber}</h3>
                <p className="text-xs font-bold text-slate-500 tracking-widest mt-1 uppercase">Customer: {editOs.customer?.name}</p>
              </div>
              <button type="button" onClick={() => setEditOs(null)} className="text-slate-400 hover:text-slate-700 font-black text-xl">✕</button>
            </div>

            <div className="flex flex-col lg:flex-row h-[600px] max-h-[70vh]">
              
              {/* Product Edit Table */}
              <div className="flex-1 overflow-y-auto p-6 bg-white border-r border-slate-100 relative">
                <div className="mb-4 relative">
                  <input 
                    type="text" 
                    placeholder="Search SKU or Product Name to add..." 
                    value={editProductSearch}
                    onChange={e => { setEditProductSearch(e.target.value); setShowEditSearch(true); }}
                    onFocus={() => setShowEditSearch(true)}
                    onBlur={() => setTimeout(() => setShowEditSearch(false), 200)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all"
                  />
                  {showEditSearch && editProductSearch.trim().length >= 2 && (
                    <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-2xl max-h-64 overflow-y-auto z-50">
                      {editSearchResults.length === 0 ? (
                        <div className="p-4 text-slate-500 text-sm font-medium text-center">No matching products found.</div>
                      ) : (
                        editSearchResults.map(p => (
                          <div key={p.id} onMouseDown={(e) => { e.preventDefault(); handleAddEditProduct(p); }} className="px-5 py-3 hover:bg-indigo-50 border-b border-slate-50 cursor-pointer flex justify-between items-center">
                            <div>
                              <span className="font-bold text-slate-900">{p.name}</span>
                              <span className="text-[10px] font-mono text-slate-400 block mt-0.5">{p.sku}</span>
                            </div>
                            <span className="font-black text-indigo-700">₱{(p.sellingPrice || 0).toLocaleString()}</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>

                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-slate-50 border-y border-slate-200">
                    <tr>
                      <th className="py-3 px-4 font-black text-slate-500 uppercase tracking-widest text-[10px]">SKU / Product</th>
                      <th className="py-3 px-4 font-black text-indigo-600 uppercase tracking-widest text-[10px] text-center w-28">Qty</th>
                      <th className="py-3 px-4 font-black text-slate-500 uppercase tracking-widest text-[10px] text-right">Price</th>
                      <th className="py-3 px-4 font-black text-slate-500 uppercase tracking-widest text-[10px] text-right">Total</th>
                      <th className="py-3 px-4 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {editItems.map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900 truncate max-w-[200px]">{item.productName}</div>
                          <div className="text-[10px] font-mono text-slate-500">{item.sku}</div>
                        </td>
                        <td className="py-2 px-4">
                          <input 
                            type="number" min="1" value={item.requestedQty} 
                            onChange={e => handleEditUpdateQty(idx, e.target.value)} 
                            className="w-full px-2 py-1.5 text-center font-black text-indigo-700 bg-white border-2 border-indigo-200 rounded outline-none focus:border-indigo-500 shadow-sm" 
                          />
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-slate-700">₱{item.unitPrice.toLocaleString('en-PH', {minimumFractionDigits: 2})}</td>
                        <td className="py-3 px-4 text-right font-black text-slate-900">₱{(item.lineTotal || 0).toLocaleString('en-PH', {minimumFractionDigits: 2})}</td>
                        <td className="py-3 px-4 text-center">
                          <button onClick={() => handleEditRemoveItem(idx)} className="text-slate-300 hover:text-rose-500 font-black">✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Edit Controls Sidebar */}
              <div className="w-full lg:w-80 bg-slate-50 p-6 flex flex-col justify-between">
                <div className="space-y-6">
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-500 tracking-wider mb-2 block">Document Status</label>
                    <select 
                      value={editStatus} 
                      onChange={e => setEditStatus(e.target.value)}
                      className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl font-bold outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="Generated">Generated</option>
                      <option value="Shipped">Shipped</option>
                      <option value="Completed">Completed</option>
                      <option value="Cancelled">Cancelled</option>
                    </select>
                  </div>
                  
                  <label className="flex items-center gap-3 cursor-pointer bg-white border border-slate-200 p-4 rounded-xl">
                    <input type="checkbox" checked={editVatApplied} onChange={e => setEditVatApplied(e.target.checked)} className="w-5 h-5 rounded text-indigo-500 border-slate-300 focus:ring-indigo-500" />
                    <span className="font-bold text-slate-700 text-xs tracking-wide uppercase">Apply 12% VAT</span>
                  </label>
                </div>

                <div className="mt-8 space-y-4">
                  <div className="flex justify-between text-xs font-bold text-slate-500 uppercase tracking-widest">
                    <span>Subtotal</span>
                    <span className="text-slate-900">₱{editSubtotal.toLocaleString('en-PH', {minimumFractionDigits: 2})}</span>
                  </div>
                  <div className="flex justify-between text-xs font-bold text-slate-500 uppercase tracking-widest border-b border-slate-200 pb-4">
                    <span>VAT</span>
                    <span className="text-slate-900">₱{editVatTotal.toLocaleString('en-PH', {minimumFractionDigits: 2})}</span>
                  </div>
                  <div className="flex justify-between items-end">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Grand Total</span>
                    <span className="text-2xl font-black text-indigo-700">₱{editGrandTotal.toLocaleString('en-PH', {minimumFractionDigits: 2})}</span>
                  </div>

                  <button onClick={handleEditSave} disabled={editItems.length === 0} className="w-full py-4 mt-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-300 text-white font-black uppercase tracking-wider rounded-xl transition-colors shadow-lg">
                    Save Changes
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW / PRINT MODAL */}
      {viewOs && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex justify-center p-4 sm:p-8 overflow-y-auto print:p-0 print:bg-white print:block">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl my-auto print:shadow-none print:m-0 print:rounded-none">
            
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0 print:hidden rounded-t-2xl">
              <div>
                <h3 className="text-xl font-black text-slate-900 tracking-tight">O.S. Detail View</h3>
                <p className="text-xs font-mono uppercase text-slate-500 tracking-widest mt-1">ID: {viewOs.id}</p>
              </div>
              <div className="flex gap-3">
                <button onClick={handlePrint} className="px-5 py-2.5 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-indigo-700">Print O.S.</button>
                <button onClick={() => setViewOs(null)} className="px-4 py-2.5 bg-slate-200 text-slate-700 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-slate-300">Close</button>
              </div>
            </div>

            <div className="p-8 print:p-0 bg-white">
              <div className="flex justify-between items-start mb-12 border-b-2 border-slate-900 pb-8">
                <div>
                  <h1 className="text-4xl font-black text-slate-900 uppercase tracking-tighter">{selectedCompany}</h1>
                  <p className="text-sm font-bold text-slate-500 mt-1 uppercase tracking-widest">Order Slip</p>
                </div>
                <div className="text-right">
                  <h2 className="text-2xl font-mono font-black text-indigo-700">{viewOs.osNumber}</h2>
                  <p className="text-sm font-bold text-slate-500 mt-1 uppercase tracking-widest">Date: {new Date(viewOs.createdAt).toLocaleDateString()}</p>
                  {viewOs.status === 'Cancelled' && <p className="text-lg font-black text-rose-600 uppercase mt-2 border-2 border-rose-600 inline-block px-3 py-1">VOID / CANCELLED</p>}
                </div>
              </div>

              <div className="mb-10">
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 border-b border-slate-100 pb-1">Billed To</h4>
                <div className="font-black text-lg text-slate-900">{viewOs.customer?.name || 'Unknown Customer'}</div>
                <div className="text-xs font-mono text-slate-500 uppercase mt-1">Code: {viewOs.customerId.slice(0,8)}</div>
              </div>

              <table className="w-full text-left text-sm mb-12">
                <thead className="border-b-2 border-slate-900">
                  <tr>
                    <th className="py-3 px-2 font-black text-slate-900 uppercase text-xs w-32">SKU</th>
                    <th className="py-3 px-2 font-black text-slate-900 uppercase text-xs">Description</th>
                    <th className="py-3 px-2 font-black text-slate-900 uppercase text-xs text-center w-24">Qty</th>
                    <th className="py-3 px-2 font-black text-slate-900 uppercase text-xs text-right w-32">Unit Price</th>
                    <th className="py-3 px-2 font-black text-slate-900 uppercase text-xs text-right w-32">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {viewOs.items.map((item, idx) => (
                    <tr key={idx}>
                      <td className="py-3 px-2 font-mono text-xs">{item.sku}</td>
                      <td className="py-3 px-2 font-bold">{item.productName}</td>
                      <td className="py-3 px-2 text-center font-black">{item.requestedQty}</td>
                      <td className="py-3 px-2 text-right">₱{Number(item.unitPrice).toLocaleString('en-PH', {minimumFractionDigits:2})}</td>
                      <td className="py-3 px-2 text-right font-black">₱{Number(item.lineTotal).toLocaleString('en-PH', {minimumFractionDigits:2})}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="flex justify-end border-t-2 border-slate-900 pt-6">
                <div className="w-64 space-y-3">
                  <div className="flex justify-between text-sm font-bold text-slate-600">
                    <span>Subtotal:</span>
                    <span>₱{Number(viewOs.subtotal).toLocaleString('en-PH', {minimumFractionDigits:2})}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-slate-600 border-b border-slate-200 pb-3">
                    <span>VAT (12%):</span>
                    <span>₱{Number(viewOs.vatAmount).toLocaleString('en-PH', {minimumFractionDigits:2})}</span>
                  </div>
                  <div className="flex justify-between text-xl font-black text-slate-900">
                    <span>Total:</span>
                    <span>₱{Number(viewOs.grandTotal).toLocaleString('en-PH', {minimumFractionDigits:2})}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-slate-100 bg-slate-50 print:hidden flex justify-between items-center rounded-b-2xl">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Prepared by: {viewOs.createdBy}</span>
              {viewOs.status !== 'Cancelled' && isAuthorizedAdmin && (
                <button onClick={() => handleCancelOs(viewOs.id)} className="px-5 py-2.5 bg-rose-50 text-rose-700 font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-rose-100">Void / Cancel O.S.</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}