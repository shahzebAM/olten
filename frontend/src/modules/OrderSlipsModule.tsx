import React, { useState, useEffect, useCallback, useRef } from 'react';

// --- INTERFACES ---
interface OrderSlipItem { 
  id: string; 
  productId: number; 
  sku: string; 
  productName: string; 
  requestedQty: number | ''; 
  unitPrice: number; 
  lineTotal: number; 
  physicalQty?: number; 
  shortageQty?: number; 
  warehouseQty?: number; 
  officeStock?: number; 
}
interface Customer { id: string; name: string; }
interface OrderSlip {
  id: string;
  osNumber: string;
  company: string;
  customerId: string;
  customer: Customer;
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

interface ShortageRecord {
  id: string;
  orderSlipId: string;
  sku: string;
  productName: string;
  requestedQty: number;
  confirmedQty: number;
  shortageQty: number;
  status: string;
  createdAt: string;
  orderSlip: { osNumber: string; customer: Customer; };
}

interface OrderSlipsModuleProps {
  selectedCompany: string;
  loginUsername: string;
  API_BASE_URL: string;
  onBack: () => void;
  onCreateNew?: () => void; 
}

export default function OrderSlipsModule({ selectedCompany, loginUsername, API_BASE_URL, onBack, onCreateNew }: OrderSlipsModuleProps) {
  const isAuthorizedAdmin = ['admin', 'ali', 'super admin'].includes(loginUsername?.toLowerCase() || '');

  const [activeMainTab, setActiveMainTab] = useState<'ledger' | 'shortages'>('ledger');

  const [orderSlips, setOrderSlips] = useState<OrderSlip[]>([]);
  const [shortages, setShortages] = useState<ShortageRecord[]>([]);
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

  // --- PROCESSING STATES (PHASE 7) ---
  const [processOs, setProcessOs] = useState<OrderSlip | null>(null);
  const [processItems, setProcessItems] = useState<any[]>([]);

  // --- ADVANCED EDIT STATES ---
  const [editOs, setEditOs] = useState<OrderSlip | null>(null);
  const [editStatus, setEditStatus] = useState('');
  const [editItems, setEditItems] = useState<OrderSlipItem[]>([]);
  const [editVatApplied, setEditVatApplied] = useState(false);
  
  const [editProductSearch, setEditProductSearch] = useState('');
  const [editSearchResults, setEditSearchResults] = useState<any[]>([]);
  const [showEditSearch, setShowEditSearch] = useState(false);
  const [editSelectedIndex, setEditSelectedIndex] = useState(-1);
  const searchDropdownRef = useRef<HTMLDivElement>(null);

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

  // --- FETCH SHORTAGES ---
  const fetchShortages = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/sales/order-slips/shortages/all?company=${encodeURIComponent(selectedCompany)}`);
      if (res.ok) {
        const data = await res.json();
        setShortages(data);
      }
    } catch (e) {
      console.warn("Failed to fetch shortages");
    }
  }, [selectedCompany, API_BASE_URL]);

  useEffect(() => { 
    if (activeMainTab === 'ledger') fetchOrderSlips(); 
    if (activeMainTab === 'shortages') fetchShortages();
  }, [fetchOrderSlips, fetchShortages, activeMainTab]);

  useEffect(() => {
    if (editProductSearch.trim().length < 2) {
      setEditSearchResults([]);
      setEditSelectedIndex(-1);
      return;
    }
    const handler = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/sales/order-slips/search-products?company=${encodeURIComponent(selectedCompany)}&q=${encodeURIComponent(editProductSearch)}`);
        if (res.ok) {
          setEditSearchResults(await res.json());
          setEditSelectedIndex(-1);
        }
      } catch (e) { console.warn(e); }
    }, 400);
    return () => clearTimeout(handler);
  }, [editProductSearch, selectedCompany, API_BASE_URL]);

  // Handle auto-scroll for keyboard navigation in edit modal
  useEffect(() => {
    if (editSelectedIndex >= 0 && searchDropdownRef.current) {
      const activeElement = searchDropdownRef.current.children[editSelectedIndex] as HTMLElement;
      if (activeElement) {
        activeElement.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [editSelectedIndex]);

  // --- EDIT PRODUCT SEARCH KEYBOARD NAVIGATION ---
  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showEditSearch || editSearchResults.length === 0) return;
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setEditSelectedIndex(prev => (prev < editSearchResults.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setEditSelectedIndex(prev => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (editSelectedIndex >= 0 && editSelectedIndex < editSearchResults.length) {
        handleAddEditProduct(editSearchResults[editSelectedIndex]);
      }
    } else if (e.key === 'Escape') {
      setShowEditSearch(false);
    }
  };

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

  // --- PROCESSING WORKFLOW (PHASE 7) ---
  const openProcessModal = async (os: OrderSlip) => {
    setProcessOs(os);
    
    // Step 1: Open modal instantly with undefined warehouseQty (to show fetching state)
    setProcessItems(os.items.map(i => ({
      ...i,
      physicalQty: i.physicalQty !== undefined && i.physicalQty !== null ? i.physicalQty : i.requestedQty,
      shortageQty: i.shortageQty || 0,
      warehouseQty: undefined 
    })));

    // Step 2: Dynamically fetch live stock from warehouse in background
    try {
      const productIds = os.items.map(i => i.productId);
      const res = await fetch(`${API_BASE_URL}/sales/order-slips/refresh-stock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: selectedCompany, productIds })
      });
      if (res.ok) {
        const stockMap = await res.json();
        setProcessItems(prev => prev.map(item => ({
          ...item,
          // Inject live warehouse stock so staff can make accurate decisions
          warehouseQty: stockMap[item.productId]?.warehouseQty ?? 0
        })));
      }
    } catch (e) {
      console.warn("Failed to fetch live warehouse stock for processing screen.", e);
    }
  };

  const handleProcessUpdateQty = (index: number, val: string) => {
    const updated = [...processItems];
    if (val === '') {
      updated[index].physicalQty = '';
      updated[index].shortageQty = updated[index].requestedQty; // If empty, assume full shortage
    } else {
      const phys = parseInt(val, 10);
      const requested = updated[index].requestedQty;
      updated[index].physicalQty = isNaN(phys) ? '' : phys;
      updated[index].shortageQty = isNaN(phys) ? requested : Math.max(0, requested - phys);
    }
    setProcessItems(updated);
  };

  const handleProcessSubmit = async () => {
    if (!processOs) return;
    
    // Prevent submission if fields are blank/NaN
    const isValid = processItems.every(i => typeof i.physicalQty === 'number' && !isNaN(i.physicalQty) && i.physicalQty >= 0);
    if (!isValid) return showToast("Enter a valid physical quantity for all items.", "error");

    setIsLoading(true);
    try {
      const payload = {
        user: loginUsername,
        items: processItems.map(i => ({
          id: i.id,
          physicalQty: Number(i.physicalQty)
        }))
      };

      const res = await fetch(`${API_BASE_URL}/sales/order-slips/${processOs.id}/process`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error();
      
      showToast("Order Slip processed successfully.", "success");
      setProcessOs(null);
      fetchOrderSlips();
      fetchShortages();
    } catch (e) {
      showToast("Failed to process Order Slip.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleShortageStatusChange = async (shortageId: string, newStatus: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/sales/order-slips/shortages/${shortageId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) {
        showToast("Shortage status updated.", "success");
        fetchShortages();
      }
    } catch (e) {
      showToast("Failed to update shortage status.", "error");
    }
  };

  // --- EDIT WORKFLOW ACTIONS ---
  const openEditModal = (os: OrderSlip) => {
    setEditOs(os);
    setEditStatus(os.status);
    setEditVatApplied(os.vatApplied);
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
      lineTotal: p.sellingPrice || 0,
      officeStock: p.officeStock || 0
    }]);
    setEditProductSearch('');
    setShowEditSearch(false);
    setEditSelectedIndex(-1);

    // Auto-focus the quantity input for seamless typing
    setTimeout(() => {
      const input = document.getElementById(`edit-qty-${p.id}`) as HTMLInputElement;
      if (input) {
        input.focus();
        input.select();
      }
    }, 50);
  };

  const handleEditUpdateQty = (index: number, val: string) => {
    const updated = [...editItems];
    if (val === '') {
      updated[index].requestedQty = '';
      updated[index].lineTotal = 0;
    } else {
      const qty = parseInt(val, 10);
      updated[index].requestedQty = isNaN(qty) ? '' : qty;
      updated[index].lineTotal = isNaN(qty) ? 0 : Math.round((qty * updated[index].unitPrice) * 100) / 100;
    }
    setEditItems(updated);
  };

  const handleEditRemoveItem = (index: number) => {
    setEditItems(editItems.filter((_, i) => i !== index));
  };

  const editSubtotal = Math.round(editItems.reduce((acc, item) => acc + (item.lineTotal || 0), 0) * 100) / 100;
  const editVatTotal = editVatApplied ? Math.round((editSubtotal * 0.12) * 100) / 100 : 0;
  const editGrandTotal = Math.round((editSubtotal + editVatTotal) * 100) / 100;

  const isEditFormValid = editOs && editItems.length > 0 && editItems.every(i => typeof i.requestedQty === 'number' && !isNaN(i.requestedQty) && i.requestedQty > 0);

  const handleEditSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editOs) return;
    if (!isEditFormValid) return showToast("Please ensure all items have a valid quantity.", "error");
    
    try {
      const payload = {
        status: editStatus,
        user: loginUsername,
        isVatApplied: editVatApplied,
        subtotal: Number(editSubtotal) || 0,
        vatAmount: Number(editVatTotal) || 0,
        grandTotal: Number(editGrandTotal) || 0,
        items: editItems.map(i => ({
          productId: i.productId,
          sku: i.sku,
          productName: i.productName,
          requestedQty: Number(i.requestedQty) || 0,
          unitPrice: Number(i.unitPrice) || 0,
          lineTotal: Number(i.lineTotal) || 0
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

  return (
    <div className="flex flex-col h-screen w-full bg-[#F8FAFC] font-sans text-slate-900 overflow-hidden">
      
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[100] px-5 py-3.5 rounded-xl shadow-xl font-bold text-sm ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>
          {toast.message}
        </div>
      )}

     {/* GLOBAL HEADER */}
      <header className="h-16 sm:h-20 bg-white border-b border-slate-200 flex items-center justify-between px-6 sm:px-8 shrink-0 shadow-sm z-10 print:hidden">
        <div><h2 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight">Enterprise ERP <span className="text-slate-400 font-medium">| O.S. Management</span></h2></div>
        <div className="flex gap-3">
          {onCreateNew && (
            <button onClick={onCreateNew} className="px-4 py-2 sm:py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[10px] sm:text-xs font-bold uppercase tracking-wider transition-colors shadow-sm">
              Back to OS Gen
            </button>
          )}
          <button onClick={onBack} className="px-4 py-2 sm:py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-[10px] sm:text-xs font-bold uppercase tracking-wider transition-colors shadow-sm border border-slate-200">
            Back to Gateway
          </button>
        </div>
      </header>

      {/* TOP TAB NAVIGATOR */}
      <div className="bg-white border-b border-slate-200 px-6 sm:px-8 shrink-0 print:hidden">
        <div className="flex gap-6 max-w-7xl mx-auto">
          <button 
            onClick={() => setActiveMainTab('ledger')} 
            className={`py-4 font-bold text-sm uppercase tracking-widest border-b-2 transition-colors ${activeMainTab === 'ledger' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
          >
            O.S. Ledger
          </button>
          <button 
            onClick={() => setActiveMainTab('shortages')} 
            className={`py-4 font-bold text-sm uppercase tracking-widest border-b-2 transition-colors ${activeMainTab === 'shortages' ? 'border-rose-600 text-rose-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
          >
            Pending Shortages
          </button>
        </div>
      </div>

      <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 print:hidden flex flex-col">
        <div className="w-full max-w-7xl mx-auto space-y-4 sm:space-y-6 flex-1 flex flex-col">

          {/* ===================== LEDGER TAB ===================== */}
          {activeMainTab === 'ledger' && (
            <>
              {/* FILTERS SECTION */}
              <div className="bg-white border border-slate-300 rounded-2xl p-5 shadow-sm flex flex-col lg:flex-row gap-4 items-end shrink-0">
                <div className="w-full lg:w-72">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Global Search</label>
                  <input type="text" placeholder="O.S. Number, Customer..." value={search} onChange={e => setSearch(e.target.value)} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:bg-white focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50 transition-all" />
                </div>
                <div className="w-full lg:w-48">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Status Filter</label>
                  <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:bg-white focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50 transition-all cursor-pointer">
                    <option value="All">All Statuses</option>
                    <option value="Generated">Generated</option>
                    <option value="Partially Verified">Partially Verified</option>
                    <option value="Verified">Verified</option>
                    <option value="Shipped">Shipped</option>
                    <option value="Completed">Completed</option>
                    <option value="Cancelled">Cancelled</option>
                  </select>
                </div>
                <div className="w-full lg:w-auto flex flex-col sm:flex-row gap-3 items-end">
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">From Date</label>
                    <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:bg-white focus:border-indigo-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">To Date</label>
                    <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:bg-white focus:border-indigo-400" />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 lg:ml-auto">
                  <button onClick={() => applyQuickDate('today')} className="px-3 py-2 bg-slate-100 text-slate-600 text-[10px] uppercase tracking-widest font-bold rounded-lg hover:bg-slate-200 transition-colors">Today</button>
                  <button onClick={() => applyQuickDate('week')} className="px-3 py-2 bg-slate-100 text-slate-600 text-[10px] uppercase tracking-widest font-bold rounded-lg hover:bg-slate-200 transition-colors">This Week</button>
                  <button onClick={() => applyQuickDate('month')} className="px-3 py-2 bg-slate-100 text-slate-600 text-[10px] uppercase tracking-widest font-bold rounded-lg hover:bg-slate-200 transition-colors">This Month</button>
                  <button onClick={() => applyQuickDate('clear')} className="px-3 py-2 bg-rose-50 text-rose-600 text-[10px] uppercase tracking-widest font-bold rounded-lg hover:bg-rose-100 transition-colors">Clear</button>
                </div>
              </div>

              {/* LEDGER TABLE */}
              <div className="bg-white border border-slate-300 rounded-2xl shadow-sm flex flex-col flex-1 overflow-hidden relative">
                {isLoading && (
                  <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] z-10 flex items-center justify-center">
                    <div className="font-bold text-indigo-600 animate-pulse uppercase tracking-widest text-sm bg-white px-6 py-3 rounded-full shadow-lg border border-indigo-100">Syncing Ledger...</div>
                  </div>
                )}
                <div className="flex-1 overflow-auto w-full">
                  <table className="w-full text-left text-sm whitespace-nowrap min-w-[1100px] border-collapse">
                    <thead className="bg-slate-50 shadow-sm sticky top-0 z-20">
                      <tr>
                        <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] border-b border-slate-200">O.S. Number</th>
                        <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] border-b border-slate-200">Date</th>
                        <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] border-b border-slate-200">Customer</th>
                        <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] text-center border-b border-slate-200">Items</th>
                        <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] text-right border-b border-slate-200">Grand Total</th>
                        <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] text-center border-b border-slate-200">Status</th>
                        <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] border-b border-slate-200">Created By</th>
                        <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] text-right border-b border-slate-200">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {orderSlips.length === 0 && !isLoading ? (
                        <tr><td colSpan={8} className="py-20 text-center text-slate-400 font-medium">No Order Slips match your filters.</td></tr>
                      ) : (
                        orderSlips.map(os => (
                          <tr key={os.id} className="hover:bg-slate-50 transition-colors">
                            <td className="py-3.5 px-6 font-mono text-sm font-black text-indigo-700">{os.osNumber}</td>
                            <td className="py-3.5 px-6 font-medium text-slate-600">{new Date(os.createdAt).toLocaleDateString()}</td>
                            <td className="py-3.5 px-6">
                              <div className="font-bold text-slate-900 truncate max-w-[250px]">{os.customer?.name || 'Unknown'}</div>
                              <div className="text-[10px] font-mono text-slate-400 uppercase mt-0.5">{os.customerId.slice(0, 8)}</div>
                            </td>
                            <td className="py-3.5 px-6 text-center font-black text-slate-700">{os.items?.length || 0}</td>
                            <td className="py-3.5 px-6 text-right font-black text-slate-900 font-mono">₱{Number(os.grandTotal).toLocaleString('en-PH', {minimumFractionDigits: 2, maximumFractionDigits:2})}</td>
                            <td className="py-3.5 px-6 text-center">
                              <span className={`px-3 py-1.5 text-[9px] font-black uppercase tracking-wider rounded-md 
                                ${os.status === 'Cancelled' ? 'bg-rose-100 text-rose-700' : 
                                  os.status === 'Generated' ? 'bg-indigo-100 text-indigo-700' : 
                                  os.status === 'Partially Verified' ? 'bg-amber-100 text-amber-700' : 
                                  os.status === 'Verified' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700'}`}>
                                {os.status}
                              </span>
                            </td>
                            <td className="py-3.5 px-6 text-xs font-bold text-slate-500 uppercase">{os.createdBy}</td>
                            <td className="py-3.5 px-6 text-right space-x-2">
                              {os.status !== 'Cancelled' && (
                                <button onClick={() => openProcessModal(os)} className="px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md text-[9px] font-black uppercase hover:bg-emerald-100 transition-colors shadow-sm">Process</button>
                              )}
                              <button onClick={() => setViewOs(os)} className="px-3 py-1.5 bg-white text-slate-700 border border-slate-300 rounded-md text-[9px] font-black uppercase hover:bg-slate-50 transition-colors shadow-sm">View</button>
                              <button onClick={() => openEditModal(os)} className="px-3 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-md text-[9px] font-black uppercase hover:bg-indigo-100 transition-colors shadow-sm">Edit</button>
                              {isAuthorizedAdmin && (
                                <button onClick={() => handleHardDeleteOs(os.id)} className="px-3 py-1.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-md text-[9px] font-black uppercase hover:bg-rose-100 transition-colors shadow-sm">Del</button>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                
                {/* PAGINATION */}
                <div className="p-4 border-t border-slate-300 bg-slate-100 flex flex-col sm:flex-row items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-widest shrink-0">
                  <div className="mb-3 sm:mb-0">Showing {orderSlips.length} of {totalRecords} records</div>
                  <div className="flex gap-2">
                    <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-4 py-2 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors shadow-sm text-slate-700">Prev</button>
                    <div className="px-4 py-2 bg-white border border-slate-200 rounded-lg shadow-sm text-indigo-600">Pg {page} / {totalPages}</div>
                    <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-4 py-2 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors shadow-sm text-slate-700">Next</button>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ===================== SHORTAGES TAB ===================== */}
          {activeMainTab === 'shortages' && (
            <div className="bg-white border border-slate-300 rounded-2xl shadow-sm flex flex-col flex-1 overflow-hidden relative">
              <div className="flex-1 overflow-auto w-full">
                <table className="w-full text-left text-sm whitespace-nowrap min-w-[1100px] border-collapse">
                  <thead className="bg-slate-50 shadow-sm sticky top-0 z-20">
                    <tr>
                      <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] border-b border-slate-200">O.S. Ref</th>
                      <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] border-b border-slate-200">Date Logged</th>
                      <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] border-b border-slate-200">Customer</th>
                      <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] border-b border-slate-200">SKU / Product</th>
                      <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] text-center border-b border-slate-200">Req Qty</th>
                      <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] text-center border-b border-slate-200">Conf Qty</th>
                      <th className="py-4 px-6 font-black text-rose-600 uppercase tracking-widest text-[10px] text-center border-b border-slate-200 bg-rose-50/50">Shortage</th>
                      <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] border-b border-slate-200">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {shortages.length === 0 ? (
                      <tr><td colSpan={8} className="py-20 text-center text-slate-400 font-medium">No pending shortages found.</td></tr>
                    ) : (
                      shortages.map(shortage => (
                        <tr key={shortage.id} className="hover:bg-slate-50 transition-colors">
                          <td className="py-3 px-6 font-mono text-sm font-black text-indigo-700">{shortage.orderSlip?.osNumber || 'Unknown'}</td>
                          <td className="py-3 px-6 font-medium text-slate-600">{new Date(shortage.createdAt).toLocaleDateString()}</td>
                          <td className="py-3 px-6 font-bold text-slate-900 truncate max-w-[200px]">{shortage.orderSlip?.customer?.name || 'Unknown'}</td>
                          <td className="py-3 px-6">
                            <div className="font-bold text-slate-900 truncate max-w-[200px]">{shortage.productName}</div>
                            <div className="text-[10px] font-mono text-slate-400 uppercase mt-0.5">{shortage.sku}</div>
                          </td>
                          <td className="py-3 px-6 text-center font-bold text-slate-700">{shortage.requestedQty}</td>
                          <td className="py-3 px-6 text-center font-bold text-emerald-600">{shortage.confirmedQty}</td>
                          <td className="py-3 px-6 text-center font-black text-rose-600 bg-rose-50/30 text-lg">{shortage.shortageQty}</td>
                          <td className="py-3 px-6">
                            <select 
                              value={shortage.status} 
                              onChange={(e) => handleShortageStatusChange(shortage.id, e.target.value)}
                              className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                            >
                              <option value="Open">Open</option>
                              <option value="Pending Purchase">Pending Purchase</option>
                              <option value="Ordered">Ordered</option>
                              <option value="Partially Fulfilled">Partially Fulfilled</option>
                              <option value="Fulfilled">Fulfilled</option>
                              <option value="Cancelled">Cancelled</option>
                            </select>
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

      {/* ===================== PHASE 7: PROCESSING MODAL ===================== */}
      {processOs && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[200] flex justify-center items-center p-4 sm:p-8">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 max-h-full">
            
            <div className="p-6 border-b border-slate-200 flex justify-between items-center bg-slate-50 shrink-0">
              <div>
                <h3 className="text-xl font-black text-slate-900 tracking-tight uppercase">Physical Verification: {processOs.osNumber}</h3>
                <p className="text-xs font-bold text-slate-500 tracking-widest mt-1 uppercase">Verify Actual Stock vs Requested Qty</p>
              </div>
              <button type="button" onClick={() => setProcessOs(null)} className="text-slate-400 hover:text-slate-700 font-black text-xl">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 bg-white relative">
              <table className="w-full text-left text-sm whitespace-nowrap border-collapse">
                <thead className="bg-slate-50 border-y border-slate-200">
                  <tr>
                    <th className="py-3 px-4 font-black text-slate-500 uppercase tracking-widest text-[10px]">SKU / Product</th>
                    <th className="py-3 px-4 font-black text-slate-500 uppercase tracking-widest text-[10px] text-center w-28">Whse Qty</th>
                    <th className="py-3 px-4 font-black text-indigo-600 uppercase tracking-widest text-[10px] text-center w-28 bg-indigo-50/50">Requested</th>
                    <th className="py-3 px-4 font-black text-emerald-600 uppercase tracking-widest text-[10px] text-center w-36 bg-emerald-50/50">Physical Confirmed</th>
                    <th className="py-3 px-4 font-black text-rose-600 uppercase tracking-widest text-[10px] text-center w-28 bg-rose-50/50">Shortage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {processItems.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="py-4 px-4 border border-slate-100">
                        <div className="font-bold text-slate-900 truncate max-w-[300px]">{item.productName}</div>
                        <div className="text-[10px] font-mono text-slate-500">{item.sku}</div>
                      </td>
                      <td className="py-4 px-4 border border-slate-100 text-center font-bold text-slate-500">
                        {/* Show fetching animation until warehouseQty is loaded */}
                        {item.warehouseQty !== undefined ? item.warehouseQty : <span className="text-slate-300 animate-pulse text-[10px] uppercase">Fetching...</span>}
                      </td>
                      <td className="py-4 px-4 border border-slate-100 text-center font-black text-indigo-700 bg-indigo-50/20">
                        {item.requestedQty}
                      </td>
                      <td className="py-2 px-4 border border-slate-100 bg-emerald-50/20 relative">
                        <input 
                          type="number" min="0" value={item.physicalQty} 
                          onChange={e => handleProcessUpdateQty(idx, e.target.value)} 
                          className={`w-full px-2 py-2.5 text-center font-black text-lg bg-white border-2 rounded outline-none shadow-sm transition-all
                            ${item.shortageQty > 0 ? 'border-rose-400 text-rose-700 focus:border-rose-600' : 'border-emerald-300 text-emerald-700 focus:border-emerald-600'}
                          `} 
                        />
                      </td>
                      <td className={`py-4 px-4 text-center border border-slate-100 font-black text-lg ${item.shortageQty > 0 ? 'text-rose-600 bg-rose-50/40' : 'text-slate-300'}`}>
                        {item.shortageQty}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-6 border-t border-slate-200 bg-slate-50 shrink-0 flex justify-between items-center">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                Shortages will be automatically logged to the pending board.
              </p>
              <button 
                onClick={handleProcessSubmit} 
                disabled={isLoading} 
                className="px-8 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 text-white font-black uppercase tracking-wider rounded-xl transition-colors shadow-lg"
              >
                {isLoading ? "Saving..." : "Confirm Physical Stock"}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* FULL ADVANCED EDIT MODAL */}
      {editOs && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[200] flex justify-center p-4 sm:p-8 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl my-auto flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            
            <div className="p-6 border-b border-slate-200 flex justify-between items-center bg-slate-50">
              <div>
                <h3 className="text-xl font-black text-slate-900 tracking-tight uppercase">Edit Order Slip: {editOs.osNumber}</h3>
                <p className="text-xs font-bold text-slate-500 tracking-widest mt-1 uppercase">Customer: {editOs.customer?.name}</p>
              </div>
              <button type="button" onClick={() => setEditOs(null)} className="text-slate-400 hover:text-slate-700 font-black text-xl">✕</button>
            </div>

            <div className="flex flex-col lg:flex-row h-[600px] max-h-[70vh]">
              
              {/* Product Edit Table */}
              <div className="flex-1 overflow-y-auto p-6 bg-white border-r border-slate-200 relative">
                <div className="mb-4 relative">
                  <input 
                    type="text" 
                    placeholder="Search SKU or Product Name to add..." 
                    value={editProductSearch}
                    onChange={e => { setEditProductSearch(e.target.value); setShowEditSearch(true); }}
                    onFocus={() => setShowEditSearch(true)}
                    onKeyDown={handleEditKeyDown}
                    onBlur={() => setTimeout(() => setShowEditSearch(false), 200)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-300 rounded-xl text-sm font-bold outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50 transition-all"
                  />
                  {showEditSearch && editProductSearch.trim().length >= 2 && (
                    <div ref={searchDropdownRef} className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-2xl max-h-64 overflow-y-auto z-50">
                      {editSearchResults.length === 0 ? (
                        <div className="p-4 text-slate-500 text-sm font-medium text-center">No matching products found.</div>
                      ) : (
                        editSearchResults.map((p, idx) => (
                          <div 
                            key={p.id} 
                            onMouseDown={(e) => { e.preventDefault(); handleAddEditProduct(p); }} 
                            onMouseEnter={() => setEditSelectedIndex(idx)}
                            className={`px-5 py-3 border-b border-slate-50 cursor-pointer flex justify-between items-center transition-colors ${editSelectedIndex === idx ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
                          >
                            <div>
                              <span className="font-bold text-slate-900">{p.name}</span>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[10px] font-mono text-slate-400">{p.sku}</span>
                                <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">Stock: {p.officeStock || 0}</span>
                              </div>
                            </div>
                            <span className="font-black text-indigo-700">₱{(p.sellingPrice || 0).toLocaleString()}</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>

                <table className="w-full text-left text-sm whitespace-nowrap border-collapse">
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
                        <td className="py-3 px-4 border border-slate-100">
                          <div className="font-bold text-slate-900 truncate max-w-[200px]">{item.productName}</div>
                          <div className="text-[10px] font-mono text-slate-500">{item.sku}</div>
                        </td>
                        <td className="py-2 px-4 border border-slate-100 relative">
                          <input 
                            id={`edit-qty-${item.productId}`}
                            type="number" min="1" value={item.requestedQty} 
                            onChange={e => handleEditUpdateQty(idx, e.target.value)} 
                            className="w-full px-2 py-1.5 text-center font-black text-indigo-700 bg-white border-2 border-indigo-200 rounded outline-none focus:border-indigo-500 shadow-sm" 
                          />
                          {item.officeStock !== undefined && Number(item.requestedQty) > item.officeStock && (
                            <div className="absolute top-full mt-1 left-0 right-0 text-[9px] font-black text-rose-600 bg-rose-100 px-1.5 py-0.5 rounded text-center uppercase tracking-widest">
                              Short {Number(item.requestedQty) - item.officeStock}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-slate-700 border border-slate-100 font-mono">₱{Number(item.unitPrice).toLocaleString('en-PH', {minimumFractionDigits: 2})}</td>
                        <td className="py-3 px-4 text-right font-black text-slate-900 border border-slate-100 font-mono">₱{(item.lineTotal || 0).toLocaleString('en-PH', {minimumFractionDigits: 2})}</td>
                        <td className="py-3 px-4 text-center border border-slate-100">
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
                      className="w-full px-4 py-3 bg-white border border-slate-300 rounded-xl font-bold outline-none focus:ring-4 focus:ring-indigo-50 transition-all cursor-pointer"
                    >
                      <option value="Generated">Generated</option>
                      <option value="Partially Verified">Partially Verified</option>
                      <option value="Verified">Verified</option>
                      <option value="Shipped">Shipped</option>
                      <option value="Completed">Completed</option>
                      <option value="Cancelled">Cancelled</option>
                    </select>
                  </div>
                  
                  <label className="flex items-center gap-3 cursor-pointer bg-white border border-slate-200 p-4 rounded-xl shadow-sm">
                    <input type="checkbox" checked={editVatApplied} onChange={e => setEditVatApplied(e.target.checked)} className="w-5 h-5 rounded text-indigo-500 border-slate-300 focus:ring-indigo-500" />
                    <span className="font-bold text-slate-700 text-xs tracking-wide uppercase">Apply 12% VAT</span>
                  </label>
                </div>

                <div className="mt-8 space-y-4">
                  <div className="flex justify-between text-xs font-bold text-slate-500 uppercase tracking-widest">
                    <span>Subtotal</span>
                    <span className="text-slate-900 font-mono">₱{editSubtotal.toLocaleString('en-PH', {minimumFractionDigits: 2})}</span>
                  </div>
                  <div className="flex justify-between text-xs font-bold text-slate-500 uppercase tracking-widest border-b border-slate-200 pb-4">
                    <span>VAT</span>
                    <span className="text-slate-900 font-mono">₱{editVatTotal.toLocaleString('en-PH', {minimumFractionDigits: 2})}</span>
                  </div>
                  <div className="flex justify-between items-end">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Grand Total</span>
                    <span className="text-2xl font-black text-indigo-700 font-mono">₱{editGrandTotal.toLocaleString('en-PH', {minimumFractionDigits: 2})}</span>
                  </div>

                  <button onClick={handleEditSave} disabled={!isEditFormValid} className="w-full py-4 mt-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-300 text-white font-black uppercase tracking-wider rounded-xl transition-colors shadow-lg">
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
          
          {/* MAGIC PRINT STYLE - FORCES BROWSER TO HIDE URLS/HEADERS */}
          <style type="text/css" media="print">
            {`@page { size: auto; margin: 0; }`}
          </style>

          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl my-auto print:shadow-none print:m-0 print:rounded-none flex flex-col">
            
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0 print:hidden rounded-t-2xl">
              <div>
                <h3 className="text-xl font-black text-slate-900 tracking-tight">O.S. Detail View</h3>
                <p className="text-xs font-mono uppercase text-slate-500 tracking-widest mt-1">ID: {viewOs.id}</p>
              </div>
              <div className="flex gap-3">
                <button onClick={handlePrint} className="px-5 py-2.5 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-indigo-700 shadow-sm transition-colors">Print O.S.</button>
                <button onClick={() => setViewOs(null)} className="px-4 py-2.5 bg-white border border-slate-300 text-slate-700 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-slate-50 shadow-sm transition-colors">Close</button>
              </div>
            </div>

            {/* PRINT CONTAINER (Adds margins back inside the document to compensate for @page margin: 0) */}
            <div className="p-8 print:pt-12 print:px-8 print:pb-8 bg-white flex-1">
              
              {/* PRINT ONLY HEADER */}
              <h2 className="hidden print:block text-center text-xl font-black uppercase mb-8 tracking-widest text-slate-900">
                {selectedCompany}
              </h2>

              <div className="flex justify-between items-start mb-10 border-b-2 border-slate-900 pb-6">
                <div>
                  <h1 className="text-3xl font-black text-slate-900 uppercase tracking-tighter print:hidden">{selectedCompany}</h1>
                  <p className="text-sm font-bold text-slate-500 mt-1 uppercase tracking-widest">Order Slip</p>
                </div>
                <div className="text-right">
                  <h2 className="text-2xl font-mono font-black text-indigo-700">{viewOs.osNumber}</h2>
                  <p className="text-sm font-bold text-slate-500 mt-1 uppercase tracking-widest">Date: {new Date(viewOs.createdAt).toLocaleDateString()}</p>
                  {viewOs.status === 'Cancelled' && <p className="text-lg font-black text-rose-600 uppercase mt-2 border-2 border-rose-600 inline-block px-3 py-1">VOID / CANCELLED</p>}
                </div>
              </div>

              <div className="mb-8">
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 border-b border-slate-100 pb-1">Billed To</h4>
                <div className="font-black text-lg text-slate-900">{viewOs.customer?.name || 'Unknown Customer'}</div>
                <div className="text-xs font-mono text-slate-500 uppercase mt-1">Code: {viewOs.customerId.slice(0,8)}</div>
              </div>

              <table className="w-full text-left text-sm mb-12 border-collapse">
                <thead className="border-y-2 border-slate-900 bg-slate-50/50">
                  <tr>
                    <th className="py-3 px-3 font-black text-slate-900 uppercase text-xs w-32 border-r border-slate-200">SKU</th>
                    <th className="py-3 px-3 font-black text-slate-900 uppercase text-xs border-r border-slate-200">Description</th>
                    <th className="py-3 px-3 font-black text-slate-900 uppercase text-xs text-center w-24 border-r border-slate-200">Req Qty</th>
                    <th className="py-3 px-3 font-black text-slate-900 uppercase text-xs text-center w-24 border-r border-slate-200">Conf Qty</th>
                    <th className="py-3 px-3 font-black text-slate-900 uppercase text-xs text-right w-32 border-r border-slate-200">Unit Price</th>
                    <th className="py-3 px-3 font-black text-slate-900 uppercase text-xs text-right w-32">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {viewOs.items.map((item, idx) => (
                    <tr key={idx}>
                      <td className="py-3 px-3 font-mono text-xs border-r border-slate-200 font-bold text-slate-700">{item.sku}</td>
                      <td className="py-3 px-3 font-bold text-slate-900 border-r border-slate-200">
                        {item.productName}
                        {item.shortageQty && item.shortageQty > 0 ? (
                          <span className="ml-2 px-1.5 py-0.5 bg-rose-100 text-rose-700 text-[9px] font-black uppercase rounded">Short {item.shortageQty}</span>
                        ) : null}
                      </td>
                      <td className="py-3 px-3 text-center font-bold border-r border-slate-200 text-slate-500">{item.requestedQty}</td>
                      <td className="py-3 px-3 text-center font-black border-r border-slate-200 text-indigo-700">{item.physicalQty !== undefined && item.physicalQty !== null ? item.physicalQty : '-'}</td>
                      <td className="py-3 px-3 text-right border-r border-slate-200 font-mono text-slate-700">₱{Number(item.unitPrice).toLocaleString('en-PH', {minimumFractionDigits:2})}</td>
                      <td className="py-3 px-3 text-right font-black font-mono text-slate-900">₱{Number(item.lineTotal).toLocaleString('en-PH', {minimumFractionDigits:2})}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="flex justify-end border-t-2 border-slate-900 pt-6">
                <div className="w-72 space-y-3">
                  <div className="flex justify-between text-sm font-bold text-slate-600">
                    <span>Subtotal:</span>
                    <span className="font-mono">₱{Number(viewOs.subtotal).toLocaleString('en-PH', {minimumFractionDigits:2})}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-slate-600 border-b border-slate-200 pb-3">
                    <span>VAT (12%):</span>
                    <span className="font-mono">₱{Number(viewOs.vatAmount).toLocaleString('en-PH', {minimumFractionDigits:2})}</span>
                  </div>
                  <div className="flex justify-between text-xl font-black text-slate-900 pt-1">
                    <span>Total:</span>
                    <span className="font-mono text-indigo-700">₱{Number(viewOs.grandTotal).toLocaleString('en-PH', {minimumFractionDigits:2})}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-slate-200 bg-slate-50 print:hidden flex justify-between items-center rounded-b-2xl">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Prepared by: {viewOs.createdBy}</span>
              {viewOs.status !== 'Cancelled' && (
                <button onClick={() => handleCancelOs(viewOs.id)} className="px-5 py-2.5 bg-white border border-rose-200 text-rose-600 font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-rose-50 shadow-sm transition-colors">Void / Cancel O.S.</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}