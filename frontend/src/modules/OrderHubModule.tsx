import React, { useState, useEffect } from 'react';

// --- INTERFACES ---
interface Customer { id: string; name: string; contact: string; phone: string; email: string; address: string; customerCode?: string; }
interface Product { id: number; name: string; sku: string; purchasePrice: number; sellingPrice: number; currentStock: number; [key: string]: any; }
interface OSItem { productId: number; sku: string; productName: string; requestedQty: number | ''; unitPrice: number; total: number; isCancelled?: boolean; cancelReason?: string; }
interface OrderSlip { id: string; osNumber: string; customerId: string; customer?: Customer; date: string; status: string; subtotal: number; vatAmount: number; isVatApplied: boolean; grandTotal: number; items: OSItem[]; user: string; }
interface Shortage { id: string; orderRef: string; customerName: string; productId: number; sku: string; productName: string; requestedQty: number; physicalQty: number; shortageQty: number; status: string; orderDate: string; cancelReason?: string; mode?: string; }
interface FinalOrder { id: string; foNumber: string; osId: string; osNumber: string; customerId: string; customer?: Customer; date: string; status: string; items: { productId: number; productName: string; sku: string; fulfilledQty: number; }[]; }
interface PurchaseOrder { id: string; poNumber: string; supplier: string; date: string; status: string; items: any[]; totalAmount: number; }
interface PackingList { id: string; plNumber: string; foId: string; foNumber: string; customerName: string; date: string; status: string; items: any[]; }
interface Warehouse { id: string; name: string; address: string; status: string; }
interface WarehouseStock { id: string; warehouseId: string; productId: number; sku: string; quantity: number; }

export default function OrderHubModule({ selectedCompany, loginUsername, API_BASE_URL, onBack, initialMode = 'sales' }: any) {
  const [activeTab, setActiveTab] = useState<'CREATE_OS' | 'OS_LIST' | 'SHORTAGES' | 'FINAL_ORDERS' | 'PO_LIST' | 'PL_LIST'>('CREATE_OS');
  const [mode, setMode] = useState<'sales' | 'purchasing'>(initialMode);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // --- DATA STATES ---
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orderSlips, setOrderSlips] = useState<OrderSlip[]>([]);
  const [shortages, setShortages] = useState<Shortage[]>([]);
  const [finalOrders, setFinalOrders] = useState<FinalOrder[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [packingLists, setPackingLists] = useState<PackingList[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [hubStock, setHubStock] = useState<WarehouseStock[]>([]);

  // --- FILTERS ---
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // --- CREATION FORM STATES ---
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);

  const [draftItems, setDraftItems] = useState<OSItem[]>([]);
  const [isVatApplied, setIsVatApplied] = useState(false);
  
  const [inlineProductSearch, setInlineProductSearch] = useState('');
  const [showInlineDropdown, setShowInlineDropdown] = useState(false);

  // --- PROCESSING MODALS ---
  const [verifyModal, setVerifyModal] = useState<{ isOpen: boolean, os: OrderSlip | null, physicalCounts: Record<number, number> }>({ isOpen: false, os: null, physicalCounts: {} });
  const [editModal, setEditModal] = useState<{ isOpen: boolean, order: OrderSlip | null, items: OSItem[] }>({ isOpen: false, order: null, items: [] });
  const [returnModal, setReturnModal] = useState<{ isOpen: boolean, order: OrderSlip | null }>({ isOpen: false, order: null });
  const [viewModal, setViewModal] = useState<OrderSlip | null>(null);
  const [printDoc, setPrintDoc] = useState<{ type: 'OS' | 'PO' | 'PL', data: any } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error') => { setToast({ message: msg, type }); setTimeout(() => setToast(null), 3500); };

  // --- MASTER INVENTORY EXACT FETCH DATA LOGIC ---
  const fetchAllData = async () => {
    try {
      const [custRes, prodRes, osRes, shortRes, foRes, poRes, plRes, whRes, stkRes] = await Promise.all([
        fetch(`${API_BASE_URL}/sales/customers?company=${selectedCompany}`),
        fetch(`${API_BASE_URL}/products?company=${selectedCompany}`),
        fetch(`${API_BASE_URL}/erp/order-slips?company=${selectedCompany}`),
        fetch(`${API_BASE_URL}/erp/shortages?company=${selectedCompany}`),
        fetch(`${API_BASE_URL}/erp/final-orders?company=${selectedCompany}`),
        fetch(`${API_BASE_URL}/erp/purchase-orders?company=${selectedCompany}`),
        fetch(`${API_BASE_URL}/erp/packing-lists?company=${selectedCompany}`),
        fetch(`${API_BASE_URL}/warehouses?company=${selectedCompany}`),
        fetch(`${API_BASE_URL}/warehouse-stock?company=${selectedCompany}`)
      ]);

      if (custRes.ok) setCustomers(await custRes.json());
      if (prodRes.ok) setProducts(await prodRes.json());
      if (osRes.ok) setOrderSlips(await osRes.json());
      if (shortRes.ok) setShortages(await shortRes.json());
      if (foRes.ok) setFinalOrders(await foRes.json());
      if (poRes.ok) setPurchaseOrders(await poRes.json());
      if (plRes.ok) setPackingLists(await plRes.json());
      if (whRes.ok) setWarehouses(await whRes.json());
      if (stkRes.ok) setHubStock(await stkRes.json());
    } catch (e) { 
      console.error("API Error", e); 
    }
  };

  useEffect(() => { fetchAllData(); }, [selectedCompany]);

  useEffect(() => {
    const handleAfterPrint = () => setPrintDoc(null);
    window.addEventListener('afterprint', handleAfterPrint);
    return () => window.removeEventListener('afterprint', handleAfterPrint);
  }, []);

  // --- EXACT MASTER INVENTORY STOCK CALCULATOR ---
  const getLiveWarehouseStock = (productId: number | string, sku: string): number => {
    const filteredHubList = hubStock.filter(h => {
      const isMatch = (String(h.productId) === String(productId) || String(h.sku) === String(sku));
      if (!isMatch) return false;
      // Validates against existing warehouses just like Master Inventory
      return warehouses.some(w => String(w.id) === String(h.warehouseId));
    });
    return filteredHubList.reduce((acc, val) => acc + (Number(val.quantity) || 0), 0);
  };

  const getLiveOfficeStock = (productId: number | string): number => {
    const prod = products.find(p => String(p.id) === String(productId));
    return prod ? (Number(prod.currentStock) || 0) : 0;
  };

  // --- DRAFT MATH ---
  const draftSubtotal = draftItems.reduce((acc, item) => acc + (item.total || 0), 0);
  const draftVat = isVatApplied ? draftSubtotal * 0.12 : 0;
  const draftGrandTotal = draftSubtotal + draftVat;

  const filteredProducts = products.filter(p => 
    (p.name || '').toLowerCase().includes(inlineProductSearch.toLowerCase()) || 
    (p.sku || '').toLowerCase().includes(inlineProductSearch.toLowerCase())
  );

  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(customerSearchTerm.toLowerCase()) || 
    (c.customerCode || '').toLowerCase().includes(customerSearchTerm.toLowerCase())
  );

  const isDraftValid = selectedCustomerId && draftItems.length > 0 && !draftItems.some(i => i.requestedQty === '' || Number(i.requestedQty) <= 0);

  // --- ACTIONS ---
  const handleAddProduct = (p: Product) => {
    if (draftItems.find(i => String(i.productId) === String(p.id))) {
      showToast("Item already added.", "error");
    } else {
      const price = p.sellingPrice || (p.purchasePrice ? p.purchasePrice * 1.3 : 0);
      setDraftItems([...draftItems, { 
        productId: p.id, 
        sku: p.sku || 'N/A', 
        productName: p.name, 
        requestedQty: '', 
        unitPrice: price, 
        total: 0
      }]);
    }
    setInlineProductSearch('');
    setShowInlineDropdown(false);
  };

  const handleUpdateDraftQty = (idx: number, val: string) => {
    const next = [...draftItems];
    if (val === '') {
      next[idx].requestedQty = '';
      next[idx].total = 0;
    } else {
      const qty = Number(val);
      next[idx].requestedQty = qty;
      next[idx].total = qty * next[idx].unitPrice;
    }
    setDraftItems(next);
  };

  const handleGenerateOS = async () => {
    if (!isDraftValid) return showToast("Please complete the form properly.", "error");
    
    setIsProcessing(true);
    try {
      const cleanItems = draftItems.map(i => ({ 
        productId: i.productId,
        sku: i.sku,
        productName: i.productName,
        requestedQty: Number(i.requestedQty),
        unitPrice: i.unitPrice,
        total: i.total
      }));

      const payload = {
        company: selectedCompany,
        customerId: selectedCustomerId,
        subtotal: draftSubtotal,
        vatAmount: draftVat,
        isVatApplied,
        grandTotal: draftGrandTotal,
        user: loginUsername,
        items: cleanItems
      };
      
      const res = await fetch(`${API_BASE_URL}/erp/order-slips`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error();
      
      showToast("Order Slip OS Generated successfully.", "success");
      setDraftItems([]); setSelectedCustomerId(''); setCustomerSearchTerm(''); setIsVatApplied(false);
      fetchAllData(); setActiveTab('OS_LIST');
    } catch (e) { showToast("Failed to generate O.S.", "error"); } finally { setIsProcessing(false); }
  };

  const openVerification = (os: OrderSlip) => {
    const defaultCounts: Record<number, number> = {};
    os.items.forEach(i => { defaultCounts[i.productId] = Number(i.requestedQty); });
    setVerifyModal({ isOpen: true, os, physicalCounts: defaultCounts });
  };

  const submitVerification = async () => {
    if (!verifyModal.os) return;
    setIsProcessing(true);
    try {
      const payload = {
        osId: verifyModal.os.id,
        physicalCounts: verifyModal.physicalCounts,
        user: loginUsername
      };
      const res = await fetch(`${API_BASE_URL}/erp/order-slips/process`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error();
      
      showToast("O.S. Processed! Shortages and Final Orders generated.", "success");
      setVerifyModal({ isOpen: false, os: null, physicalCounts: {} });
      fetchAllData(); setActiveTab('FINAL_ORDERS');
    } catch (e) { showToast("Error processing verification.", "error"); } finally { setIsProcessing(false); }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!editModal.order) return;
    setIsProcessing(true);
    try {
      const finalTotal = editModal.items.reduce((acc, item) => acc + (item.total || 0), 0);
      await fetch(`${API_BASE_URL}/erp/order-slips/${editModal.order.id}`, { 
        method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ grandTotal: finalTotal, items: editModal.items }) 
      }).catch(()=>{});
      
      fetchAllData(); showToast("Order modifications saved.", "success");
      setEditModal({ isOpen: false, order: null, items: [] });
    } catch(e) { showToast("Failed to update order.", "error"); } finally { setIsProcessing(false); }
  };

  const handleConfirmReturn = async (e: React.FormEvent) => {
    e.preventDefault(); if (!returnModal.order) return;
    setIsProcessing(true);
    try {
      await fetch(`${API_BASE_URL}/erp/order-slips/${returnModal.order.id}`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ status: 'RETURNED' }) }).catch(()=>{});
      fetchAllData(); showToast(`Transaction Reversed!`, "success");
      setReturnModal({ isOpen: false, order: null });
    } catch (e) { showToast("Error processing return.", "error"); } finally { setIsProcessing(false); }
  };

  const handleDeleteTransaction = async (order: OrderSlip) => {
    const confirmDelete = window.prompt(`CRITICAL: Deleting this record removes it permanently.\n\nType "DELETE" to confirm removal of ${order.osNumber}:`);
    if (confirmDelete !== "DELETE") return showToast("Deletion cancelled.", "error");
    setIsProcessing(true);
    try {
      await fetch(`${API_BASE_URL}/erp/order-slips/${order.id}`, { method: 'DELETE' }).catch(()=>{});
      fetchAllData(); showToast(`Transaction ${order.osNumber} permanently deleted.`, "success");
    } catch (e) { showToast("Failed to delete transaction.", "error"); } finally { setIsProcessing(false); }
  };

  const handleRemoveShortage = async (shortageId: string) => {
    if(!window.confirm("Remove this shortage from the database?")) return;
    try {
      await fetch(`${API_BASE_URL}/shortages/${shortageId}`, { method: 'DELETE' }).catch(()=>{});
      fetchAllData(); showToast("Shortage record cleared.", "success");
    } catch (e) { showToast("Failed to delete shortage.", "error"); }
  };

  // --- RENDER HELPERS ---
  const handlePrint = (type: 'OS' | 'PO' | 'PL', data: any) => { setPrintDoc({ type, data }); setTimeout(() => window.print(), 500); };

  const checkDateFilter = (dateStr: string) => {
    if (!fromDate && !toDate) return true;
    const d = new Date(dateStr); d.setHours(0,0,0,0);
    if (fromDate && d < new Date(fromDate)) return false;
    if (toDate && d > new Date(new Date(toDate).setHours(23,59,59,999))) return false;
    return true;
  };

  const getCompanyDetails = () => {
    if (selectedCompany?.toLowerCase().includes('wilcare')) {
      return { name: 'Wilcare Trading Corp.', address: '1457-A Rizal Ave. Sta. Cruz Manila', tel: '(02)87330879, 87333950', email: 'wilcaremanila@gmail.com' };
    }
    return { name: `${selectedCompany || 'Unknown'} Corporation`, address: 'Main Corporate Headquarters', tel: 'Contact System Admin', email: `info@${(selectedCompany || 'company').toLowerCase().replace(/\s/g, '')}.com` };
  };
  const companyMeta = getCompanyDetails();

  return (
    <>
      <div className={`flex flex-col md:flex-row h-screen w-full bg-[#F8FAFC] font-sans text-slate-900 overflow-hidden ${printDoc ? 'hidden' : 'print:hidden'}`}>
        {toast && <div className={`fixed bottom-6 right-6 z-[100] px-5 py-3.5 rounded-xl shadow-xl font-bold text-sm ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>{toast.message}</div>}

        <aside className="w-64 bg-slate-900 text-slate-300 flex-col shrink-0 hidden md:flex z-20">
          <div className="h-20 flex items-center px-6 border-b border-slate-800 bg-slate-950"><h1 className="text-lg font-black text-white uppercase tracking-wider leading-tight">Order & Fulfillment</h1></div>
          <div className="flex-1 py-6 px-3 space-y-1 overflow-y-auto">
            <p className="px-3 pb-2 text-[10px] font-black uppercase tracking-widest text-slate-500">Sales Workflow</p>
            <button type="button" onClick={() => setActiveTab('CREATE_OS')} className={`w-full text-left px-4 py-3 rounded-lg font-bold text-sm transition-all ${activeTab === 'CREATE_OS' ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800'}`}>1. Create O.S.</button>
            <button type="button" onClick={() => setActiveTab('OS_LIST')} className={`w-full text-left px-4 py-3 rounded-lg font-bold text-sm transition-all ${activeTab === 'OS_LIST' ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800'}`}>2. Order Slips (Verify)</button>
            <p className="px-3 pb-2 pt-6 text-[10px] font-black uppercase tracking-widest text-slate-500">Fulfillment Engine</p>
            <button type="button" onClick={() => setActiveTab('SHORTAGES')} className={`w-full text-left px-4 py-3 rounded-lg font-bold text-sm transition-all ${activeTab === 'SHORTAGES' ? 'bg-rose-600 text-white' : 'hover:bg-slate-800'}`}>3. Shortages Log</button>
            <button type="button" onClick={() => setActiveTab('FINAL_ORDERS')} className={`w-full text-left px-4 py-3 rounded-lg font-bold text-sm transition-all ${activeTab === 'FINAL_ORDERS' ? 'bg-emerald-600 text-white' : 'hover:bg-slate-800'}`}>4. Final Orders</button>
            <p className="px-3 pb-2 pt-6 text-[10px] font-black uppercase tracking-widest text-slate-500">Logistics Documents</p>
            <button type="button" onClick={() => setActiveTab('PO_LIST')} className={`w-full text-left px-4 py-3 rounded-lg font-bold text-sm transition-all ${activeTab === 'PO_LIST' ? 'bg-slate-700 text-white' : 'hover:bg-slate-800'}`}>Purchase Orders</button>
            <button type="button" onClick={() => setActiveTab('PL_LIST')} className={`w-full text-left px-4 py-3 rounded-lg font-bold text-sm transition-all ${activeTab === 'PL_LIST' ? 'bg-slate-700 text-white' : 'hover:bg-slate-800'}`}>Packing Lists</button>
          </div>
        </aside>

        <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden bg-slate-50">
          <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0 shadow-sm z-10">
            <div><h2 className="text-2xl font-black text-slate-800 tracking-tight">Enterprise ERP <span className="text-slate-400 font-medium">| Distribution</span></h2></div>
            <button type="button" onClick={onBack} className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors">Exit Gateway</button>
          </header>

          <main className={`flex-1 relative ${activeTab === 'CREATE_OS' ? 'overflow-hidden flex flex-col p-4 sm:p-6' : 'overflow-y-auto p-4 sm:p-8'}`}>
            <div className={`max-w-[1400px] mx-auto w-full ${activeTab === 'CREATE_OS' ? 'h-full flex flex-col min-h-0' : ''}`}>
              
              {/* TAB 1: CREATE O.S. (FULL SCREEN & HORIZONTAL LAYOUT) */}
              {activeTab === 'CREATE_OS' && (
                <div className="flex flex-col h-full gap-4 min-h-0">
                  <div className="relative z-30 shrink-0">
                    <input 
                      type="text" 
                      placeholder="Search and select customer to begin..." 
                      value={customerSearchTerm}
                      onChange={(e) => {
                        setCustomerSearchTerm(e.target.value);
                        setShowCustomerDropdown(true);
                        setSelectedCustomerId(''); 
                      }}
                      onFocus={() => setShowCustomerDropdown(true)}
                      onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 200)}
                      className={`w-full px-6 py-4 border-2 rounded-2xl text-lg font-black outline-none shadow-sm transition-colors ${selectedCustomerId ? 'border-indigo-500 text-indigo-900 bg-indigo-50/50' : 'border-slate-300 focus:border-indigo-500 bg-white'}`}
                    />
                    {showCustomerDropdown && (
                      <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-2xl max-h-64 overflow-y-auto">
                        {filteredCustomers.length === 0 ? <div className="p-4 text-slate-500 font-medium">No customers found.</div> : 
                          filteredCustomers.map(c => (
                            <div 
                              key={c.id} 
                              onMouseDown={(e) => {
                                e.preventDefault();
                                setSelectedCustomerId(c.id);
                                setCustomerSearchTerm(c.name);
                                setShowCustomerDropdown(false);
                              }}
                              className="px-6 py-4 hover:bg-indigo-50 border-b border-slate-100 cursor-pointer flex justify-between items-center group"
                            >
                              <span className="font-bold text-slate-900 group-hover:text-indigo-700">{c.name}</span>
                              <span className="text-xs font-mono text-slate-400 bg-slate-100 px-2 py-1 rounded">{c.customerCode || c.id.slice(0,8)}</span>
                            </div>
                          ))
                        }
                      </div>
                    )}
                  </div>

                  <div className="bg-white border border-slate-200 rounded-2xl shadow-sm flex-1 flex flex-col min-h-0 relative z-20">
                    <div className="flex-1 overflow-y-auto">
                      <table className="w-full text-left text-sm whitespace-nowrap">
                        <thead className="bg-slate-100/95 backdrop-blur-sm border-b border-slate-200 sticky top-0 z-10 shadow-sm">
                          <tr>
                            <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] w-40">SKU</th>
                            <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px]">Item Name</th>
                            <th className="py-4 px-6 font-black text-indigo-600 uppercase tracking-widest text-[10px] text-center w-32 bg-indigo-50">Quantity</th>
                            <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] text-right w-32">Unit Price</th>
                            <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] text-right w-32">Office Stock</th>
                            <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] text-right w-32">Warehouse Qty</th>
                            <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] text-right w-40">Total Amount</th>
                            <th className="w-16"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {draftItems.map((item, i) => {
                            const liveWhseStock = getLiveWarehouseStock(item.productId, item.sku);
                            const liveOfficeStock = getLiveOfficeStock(item.productId);

                            return (
                              <tr key={i} className="hover:bg-slate-50 group transition-colors">
                                <td className="py-3 px-6 font-mono text-xs font-bold text-slate-600">{item.sku}</td>
                                <td className="py-3 px-6 font-bold text-slate-900">{item.productName}</td>
                                <td className="py-2 px-4 bg-indigo-50/30">
                                  <input 
                                    type="number" 
                                    min="1" 
                                    placeholder="0"
                                    value={item.requestedQty} 
                                    onChange={e => handleUpdateDraftQty(i, e.target.value)} 
                                    className="w-full px-2 py-1.5 text-center font-black text-lg text-indigo-700 bg-white border-2 border-indigo-200 rounded outline-none focus:border-indigo-500 shadow-sm" 
                                  />
                                </td>
                                <td className="py-3 px-6 text-right font-bold text-slate-700">₱{item.unitPrice.toLocaleString('en-PH', {minimumFractionDigits: 2})}</td>
                                <td className={`py-3 px-6 text-right font-black ${liveOfficeStock > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{liveOfficeStock}</td>
                                <td className={`py-3 px-6 text-right font-black ${liveWhseStock > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{liveWhseStock}</td>
                                <td className="py-3 px-6 text-right font-black text-slate-900">₱{(item.total || 0).toLocaleString('en-PH', {minimumFractionDigits: 2})}</td>
                                <td className="py-3 px-6 text-center"><button onClick={() => setDraftItems(draftItems.filter((_, idx) => idx !== i))} className="text-slate-300 hover:text-rose-500 font-black text-lg transition-colors">✕</button></td>
                              </tr>
                            );
                          })}
                          
                          <tr>
                            <td colSpan={2} className="py-3 px-6 relative">
                              <div className="relative">
                                <input 
                                  type="text" 
                                  placeholder="Click here to search SKU or Product Name..." 
                                  value={inlineProductSearch}
                                  onChange={e => {
                                    setInlineProductSearch(e.target.value);
                                    setShowInlineDropdown(true);
                                  }}
                                  onFocus={() => setShowInlineDropdown(true)}
                                  onBlur={() => setTimeout(() => setShowInlineDropdown(false), 200)}
                                  className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 focus:border-indigo-500 focus:bg-white rounded-lg px-4 py-2.5 text-sm font-bold outline-none transition-colors"
                                />
                                {showInlineDropdown && inlineProductSearch && (
                                  <div className="absolute top-full left-0 mt-1 w-[600px] bg-white border border-slate-200 rounded-xl shadow-2xl max-h-64 overflow-y-auto z-50">
                                    {filteredProducts.length === 0 ? <div className="p-4 text-slate-500 text-sm font-medium">No products match your search.</div> : 
                                      filteredProducts.map(p => {
                                        const liveWhseStock = getLiveWarehouseStock(p.id, p.sku);
                                        const liveOfficeStock = getLiveOfficeStock(p.id);
                                        return (
                                          <div 
                                            key={p.id} 
                                            onMouseDown={(e) => {
                                              e.preventDefault();
                                              handleAddProduct(p);
                                            }}
                                            className="px-4 py-3 hover:bg-indigo-50 border-b border-slate-50 cursor-pointer flex justify-between items-center group"
                                          >
                                            <div className="flex flex-col">
                                              <span className="font-bold text-slate-900 group-hover:text-indigo-700">{p.name}</span>
                                              <span className="text-xs font-mono text-slate-400">{p.sku}</span>
                                            </div>
                                            <div className="text-right">
                                              <div className="font-bold text-slate-700">₱{(p.sellingPrice || p.purchasePrice || 0).toLocaleString('en-PH')}</div>
                                              <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mt-1">
                                                Off: <span className={liveOfficeStock > 0 ? 'text-emerald-600' : 'text-rose-600'}>{liveOfficeStock}</span> | 
                                                Whse: <span className={liveWhseStock > 0 ? 'text-emerald-600' : 'text-rose-600'}>{liveWhseStock}</span>
                                              </div>
                                            </div>
                                          </div>
                                        );
                                      })
                                    }
                                  </div>
                                )}
                              </div>
                            </td>
                            <td colSpan={6} className="py-3 px-6 bg-slate-50/50"></td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="shrink-0 bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:px-6 flex flex-col lg:flex-row items-center justify-between gap-4 z-10">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={isVatApplied} onChange={e => setIsVatApplied(e.target.checked)} className="w-5 h-5 rounded text-indigo-500 focus:ring-indigo-500 border-slate-300" />
                      <span className="font-bold text-slate-700 text-sm tracking-wide">Apply 12% VAT to Document</span>
                    </label>
                    
                    <div className="flex items-center gap-6 w-full lg:w-auto justify-end">
                      <div className="text-right hidden sm:block">
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Subtotal</div>
                        <div className="font-bold text-slate-700">₱{draftSubtotal.toLocaleString('en-PH', {minimumFractionDigits: 2})}</div>
                      </div>
                      <div className="text-right hidden sm:block">
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">VAT (12%)</div>
                        <div className="font-bold text-slate-700">₱{draftVat.toLocaleString('en-PH', {minimumFractionDigits: 2})}</div>
                      </div>
                      <div className="text-right pl-6 border-l border-slate-200">
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Grand Total</div>
                        <div className="text-2xl font-black text-indigo-950">₱{draftGrandTotal.toLocaleString('en-PH', {minimumFractionDigits: 2})}</div>
                      </div>
                      
                      <button 
                        onClick={handleGenerateOS} 
                        disabled={!isDraftValid || isProcessing} 
                        className="ml-4 px-8 py-3.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-black uppercase tracking-wider rounded-xl transition-colors shadow-sm whitespace-nowrap"
                      >
                        {isProcessing ? 'Generating...' : 'Generate Order Slip'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: ORDER SLIPS (VERIFY) */}
              {activeTab === 'OS_LIST' && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="p-5 border-b border-slate-200 bg-slate-50 flex flex-wrap gap-4 items-center justify-between">
                    <div>
                      <h3 className="font-bold text-slate-900 text-lg">Order Slips Repository</h3>
                      <p className="text-xs text-slate-500">Validate physical stock and process into Final Orders.</p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-xs" />
                      <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-xs" />
                      <input type="text" placeholder="Search OS or Customer..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-xs min-w-[200px]" />
                    </div>
                  </div>
                  <div className="overflow-x-auto w-full">
                    <table className="w-full text-left text-sm min-w-[900px]">
                      <thead className="bg-white border-b border-slate-200">
                        <tr>
                          <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest">O.S. Number</th>
                          <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest">Customer</th>
                          <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">Grand Total</th>
                          <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest text-center">Status</th>
                          <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {orderSlips.filter(os => checkDateFilter(os.date) && ((os.osNumber || '').includes(searchQuery) || (os.customer?.name || '').toLowerCase().includes(searchQuery.toLowerCase()))).length === 0 ? <tr><td colSpan={5} className="py-16 text-center text-slate-400 font-medium">No Order Slips found.</td></tr> :
                          orderSlips.filter(os => checkDateFilter(os.date) && ((os.osNumber || '').includes(searchQuery) || (os.customer?.name || '').toLowerCase().includes(searchQuery.toLowerCase()))).map(os => {
                            const hasShortages = shortages.some(s => s.orderRef === os.osNumber);

                            return (
                              <tr key={os.id} className="hover:bg-slate-50 group">
                                <td className="py-4 px-6 font-black text-slate-900">{os.osNumber} <div className="text-[10px] text-slate-400 font-mono font-medium">{new Date(os.date).toLocaleDateString()}</div></td>
                                <td className="py-4 px-6 font-bold text-slate-700">{os.customer?.name || 'Unknown'}</td>
                                <td className="py-4 px-6 text-right font-black text-slate-800">
                                  ₱{(os.grandTotal || 0).toLocaleString('en-PH')}
                                  {os.isVatApplied && <span className="block text-[9px] text-slate-400 font-bold uppercase mt-0.5">INC VAT</span>}
                                </td>
                                <td className="py-4 px-6 text-center">
                                  <span className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-widest border ${os.status === 'PENDING' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-indigo-200 bg-indigo-50 text-indigo-700'}`}>
                                    {os.status}
                                  </span>
                                </td>
                                <td className="py-4 px-6 text-right space-x-3 whitespace-nowrap">
                                  <button type="button" onClick={() => setViewModal(os)} className="text-sky-600 hover:text-sky-900 font-bold text-[11px] uppercase tracking-wider underline">View</button>
                                  <button type="button" onClick={() => handlePrint('OS', os)} className="text-slate-500 hover:text-slate-900 text-[11px] font-bold uppercase tracking-wider underline">Print</button>
                                  
                                  {os.status === 'PENDING' ? (
                                    <>
                                      <button type="button" onClick={() => setEditModal({isOpen: true, order: os, items: [...os.items]})} className="text-amber-600 hover:text-amber-900 font-bold text-[11px] uppercase tracking-wider underline ml-3">Edit</button>
                                      <button type="button" onClick={() => openVerification(os)} className={`px-4 py-2 text-white text-[10px] font-black uppercase tracking-widest rounded-lg transition-colors shadow-sm ml-3 bg-indigo-600 hover:bg-indigo-700`}>Verify Stock</button>
                                    </>
                                  ) : (
                                    <>
                                      {os.status !== 'CANCELLED' && os.status !== 'RETURNED' && (
                                        <button type="button" onClick={() => setReturnModal({ isOpen: true, order: os })} className="text-amber-600 hover:text-amber-800 font-black text-[11px] uppercase tracking-wider ml-3">Return</button>
                                      )}
                                      <span className={`inline-block px-3 py-1.5 ml-3 text-[10px] font-black uppercase tracking-widest rounded-lg border ${os.status === 'CANCELLED' ? 'border-rose-200 bg-rose-100 text-rose-800' : 'border-emerald-200 bg-emerald-100 text-emerald-800'}`}>
                                        {os.status === 'CANCELLED' ? 'Cancelled' : (hasShortages ? 'Verified (Short)' : 'Verified')}
                                      </span>
                                    </>
                                  )}
                                  <button type="button" onClick={() => handleDeleteTransaction(os)} className="text-rose-600 hover:text-rose-900 font-black text-[11px] uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity ml-3">Delete</button>
                                </td>
                              </tr>
                            );
                          })
                        }
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 3: SHORTAGES */}
              {activeTab === 'SHORTAGES' && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="p-5 border-b border-slate-200 bg-rose-50 flex justify-between items-center">
                    <div>
                      <h3 className="font-bold text-slate-900 text-lg">Shortages Log</h3>
                      <p className="text-xs text-slate-600 mt-0.5">Items removed during verification due to low physical stock.</p>
                    </div>
                  </div>
                  <div className="overflow-x-auto w-full">
                    <table className="w-full text-left text-sm min-w-[900px]">
                      <thead className="bg-white border-b border-slate-200">
                        <tr>
                          <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest">O.S. Reference</th>
                          <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest">Customer</th>
                          <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest">SKU & Product</th>
                          <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest text-center">Deficit</th>
                          <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {shortages.filter(s => s.status === 'OPEN').length === 0 ? <tr><td colSpan={5} className="py-16 text-center text-slate-400 font-medium">No unresolved shortages.</td></tr> :
                          shortages.filter(s => s.status === 'OPEN').map(short => (
                            <tr key={short.id} className="hover:bg-rose-50/30">
                              <td className="py-4 px-6 font-black text-slate-900">{short.orderRef} <div className="text-[10px] text-slate-400 font-mono font-medium">{new Date(short.orderDate).toLocaleDateString()}</div></td>
                              <td className="py-4 px-6 font-bold text-slate-700">{short.customerName}</td>
                              <td className="py-4 px-6">
                                <div className="font-bold text-slate-900">{short.productName}</div>
                                <div className="text-[10px] font-mono text-slate-500">{short.sku}</div>
                              </td>
                              <td className="py-4 px-6 text-center">
                                <div className="font-black text-rose-600 text-lg">{short.shortageQty}</div>
                                <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Missing</div>
                              </td>
                              <td className="py-4 px-6 text-right">
                                <button type="button" onClick={() => handleRemoveShortage(short.id)} className="px-4 py-2 bg-slate-100 hover:bg-rose-100 text-slate-500 hover:text-rose-600 text-[10px] font-black uppercase tracking-widest rounded-lg transition-colors mr-2">Clear</button>
                                <button type="button" className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-[10px] font-black uppercase tracking-widest rounded-lg transition-colors shadow-sm">Generate P.O.</button>
                              </td>
                            </tr>
                          ))
                        }
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 4: FINAL ORDERS */}
              {activeTab === 'FINAL_ORDERS' && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="p-5 border-b border-slate-200 bg-emerald-50 flex justify-between items-center">
                    <div>
                      <h3 className="font-bold text-slate-900 text-lg">Final Orders (Ready to Ship)</h3>
                      <p className="text-xs text-slate-600 mt-0.5">Physically verified orders ready for Packing List generation.</p>
                    </div>
                  </div>
                  <div className="overflow-x-auto w-full">
                    <table className="w-full text-left text-sm min-w-[900px]">
                      <thead className="bg-white border-b border-slate-200">
                        <tr>
                          <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest">Final Order Ref</th>
                          <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest">O.S. Reference</th>
                          <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest">Customer</th>
                          <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest text-center">Verified Units</th>
                          <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {finalOrders.filter(fo => fo.status === 'PENDING').length === 0 ? <tr><td colSpan={5} className="py-16 text-center text-slate-400 font-medium">No pending Final Orders. Verify an OS first.</td></tr> :
                          finalOrders.filter(fo => fo.status === 'PENDING').map(fo => (
                            <tr key={fo.id} className="hover:bg-emerald-50/30">
                              <td className="py-4 px-6 font-black text-slate-900">{fo.foNumber} <div className="text-[10px] text-slate-400 font-mono font-medium">{new Date(fo.date).toLocaleDateString()}</div></td>
                              <td className="py-4 px-6 font-bold text-slate-500 underline decoration-slate-300">{fo.osNumber}</td>
                              <td className="py-4 px-6 font-bold text-slate-700">{fo.customer?.name}</td>
                              <td className="py-4 px-6 text-center font-black text-emerald-700 text-lg">{fo.items.reduce((a,b)=>a+b.fulfilledQty, 0)}</td>
                              <td className="py-4 px-6 text-right">
                                <button type="button" className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black uppercase tracking-widest rounded-lg transition-colors shadow-sm">Generate P.L.</button>
                              </td>
                            </tr>
                          ))
                        }
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </main>
        </div>

        {/* --- MODALS --- */}

        {/* VIEW DETAILS MODAL */}
        {viewModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
              <div className="p-4 sm:p-6 border-b border-slate-200 bg-slate-50 flex justify-between items-center shrink-0">
                <div>
                  <h3 className="font-bold text-lg text-slate-900 tracking-tight">Order Details Record</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-xs uppercase text-slate-500 font-bold tracking-widest">Ref: {viewModal.osNumber}</p>
                    <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest ${viewModal.status === 'CANCELLED' ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'}`}>{viewModal.status}</span>
                  </div>
                </div>
                <button type="button" onClick={() => setViewModal(null)} className="text-slate-400 hover:text-slate-700 font-black text-xl">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto bg-slate-100 p-4 sm:p-6 space-y-3">
                {(viewModal.items || []).map((item, i) => (
                  <div key={i} className={`p-4 rounded-xl flex flex-col sm:flex-row justify-between sm:items-center gap-4 border ${item.isCancelled ? 'bg-white border-rose-300 opacity-70' : 'bg-white border-slate-200 shadow-sm'}`}>
                    <div className="flex-1">
                      <h4 className={`font-black text-lg ${item.isCancelled ? 'line-through text-slate-400' : 'text-slate-900'}`}>{item.productName}</h4>
                      <div className="flex flex-wrap items-center gap-3 mt-1.5">
                        <span className="px-2 py-0.5 bg-slate-100 border border-slate-200 text-slate-500 font-mono text-[10px] rounded uppercase leading-none">{item.sku}</span>
                        <span className="px-2 py-0.5 bg-indigo-50 border border-indigo-100 text-indigo-700 font-bold text-xs rounded leading-none tracking-widest">QTY: <span className="text-sm">{item.requestedQty}</span></span>
                        <span className="text-xs font-semibold text-slate-500 leading-none">Unit Price: ₱{(item.unitPrice || 0).toLocaleString('en-PH')}</span>
                      </div>
                    </div>
                    <div className={`font-black text-xl text-right shrink-0 ${item.isCancelled ? 'text-rose-400 line-through' : 'text-slate-900'}`}>
                      ₱{(item.total || 0).toLocaleString('en-PH')}
                    </div>
                  </div>
                ))}
              </div>
              <div className="p-4 sm:p-6 border-t border-slate-200 bg-white shrink-0 flex justify-between items-center">
                <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Final Billed Total</span>
                <span className="text-3xl font-black text-slate-900">₱{(viewModal.grandTotal || 0).toLocaleString('en-PH')}</span>
              </div>
            </div>
          </div>
        )}

        {/* EDIT PENDING ORDER MODAL */}
        {editModal.isOpen && editModal.order && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[95vh] animate-in zoom-in-95 duration-200">
              <div className="p-4 sm:p-6 border-b text-slate-900 bg-white flex justify-between items-center">
                <div>
                  <h3 className="font-black text-xl tracking-wide">Edit Pending Order</h3>
                  <p className="text-xs uppercase text-slate-500 tracking-widest mt-1">Ref: {editModal.order.osNumber} • {editModal.order.customer?.name || 'Unknown'}</p>
                </div>
                <button type="button" onClick={() => setEditModal({ isOpen: false, order: null, items: [] })} className="text-slate-400 hover:text-slate-700 font-black text-xl">✕</button>
              </div>
              
              <div className="flex-1 overflow-y-auto bg-slate-100 p-4 sm:p-6 space-y-4">
                {editModal.items.length === 0 ? <div className="text-center py-8 text-slate-400 font-medium">All items removed.</div> : 
                  editModal.items.map((item, index) => (
                    <div key={index} className="p-4 rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                      <div className="flex-1">
                        <h4 className="font-black text-lg text-slate-900">{item.productName}</h4>
                        <div className="flex flex-wrap items-center gap-3 mt-1.5">
                          <span className="px-2 py-0.5 bg-slate-100 border border-slate-200 text-slate-500 font-mono text-[10px] rounded uppercase leading-none">{item.sku}</span>
                          <span className="text-xs font-semibold text-slate-500 leading-none">Unit Price: ₱{(item.unitPrice || 0).toLocaleString('en-PH')}</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between sm:justify-end w-full sm:w-auto gap-4 shrink-0 mt-3 sm:mt-0 pt-3 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                        <div className="flex flex-col">
                          <label className="text-[10px] font-bold text-slate-500 uppercase mb-1">Qty</label>
                          <input type="number" min="1" value={item.requestedQty === '' ? 0 : item.requestedQty} onChange={(e) => {
                            const newQty = Number(e.target.value) || 0;
                            const updated = [...editModal.items];
                            updated[index].requestedQty = newQty;
                            updated[index].total = newQty * (updated[index].unitPrice || 0);
                            setEditModal({...editModal, items: updated});
                          }} className="w-20 px-3 py-2 text-sm font-black border border-slate-300 rounded-lg outline-none focus:border-slate-500 text-center" />
                        </div>
                        <div className="text-right flex-1 sm:flex-none">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5 w-full sm:w-24">Total</p>
                          <span className={`font-black text-xl ${mode === 'sales' ? 'text-emerald-700' : 'text-amber-700'}`}>₱{(item.total || 0).toLocaleString('en-PH')}</span>
                        </div>
                        <button type="button" onClick={() => setEditModal({...editModal, items: editModal.items.filter((_, i) => i !== index)})} className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors bg-slate-50 sm:bg-transparent">✕</button>
                      </div>
                    </div>
                  ))
                }
              </div>

              <div className="p-4 sm:p-6 border-t border-slate-200 bg-white shrink-0 flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="text-center sm:text-left">
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400">New Adjusted Total</p>
                  <p className="text-2xl font-black text-slate-900">₱{(editModal.items.reduce((acc, item) => acc + (item.total || 0), 0) || 0).toLocaleString('en-PH')}</p>
                </div>
                <button type="button" onClick={handleSaveEdit} disabled={isProcessing} className="w-full sm:w-auto px-8 py-3.5 bg-slate-900 hover:bg-slate-800 text-white font-black uppercase tracking-wider rounded-xl transition-colors shadow-md disabled:opacity-50">Save Changes</button>
              </div>
            </div>
          </div>
        )}

        {/* PHYSICAL VERIFICATION MODAL */}
        {verifyModal.isOpen && verifyModal.os && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[95vh] animate-in zoom-in-95 duration-200">
              <div className="p-6 border-b text-white bg-indigo-600 flex justify-between items-center shrink-0">
                <div>
                  <h3 className="font-black text-xl tracking-wide">Physical Stock Verification</h3>
                  <p className="text-xs uppercase opacity-80 tracking-widest mt-1">Ref: {verifyModal.os.osNumber} • {verifyModal.os.customer?.name}</p>
                </div>
                <button type="button" onClick={() => setVerifyModal({ isOpen: false, os: null, physicalCounts: {} })} className="text-indigo-200 hover:text-white font-black text-2xl">✕</button>
              </div>
              
              <div className="flex-1 overflow-y-auto bg-slate-50 p-6 space-y-4">
                <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl text-amber-800 text-sm font-bold shadow-sm flex items-start gap-4 mb-6">
                  <svg className="w-6 h-6 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                  <div>Ensure accuracy. Entering a Physical Confirmed quantity lower than the Requested Quantity will automatically strip the deficit from the Final Order and route it to the Shortages Log.</div>
                </div>

                <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-100 border-b border-slate-200">
                      <tr>
                        <th className="py-4 px-5 text-xs font-bold text-slate-500 uppercase tracking-widest">SKU / Product</th>
                        <th className="py-4 px-5 text-xs font-bold text-slate-500 uppercase tracking-widest text-center">Req Qty</th>
                        <th className="py-4 px-5 text-xs font-bold text-indigo-700 uppercase tracking-widest text-center bg-indigo-50 border-x border-indigo-100">Physical Confirmed</th>
                        <th className="py-4 px-5 text-xs font-bold text-slate-500 uppercase tracking-widest text-center">Shortage Auto-Calc</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {verifyModal.os.items.map((item, idx) => {
                        const req = Number(item.requestedQty) || 0;
                        const conf = verifyModal.physicalCounts[item.productId] ?? req;
                        const short = Math.max(0, req - conf);

                        return (
                          <tr key={idx} className={short > 0 ? 'bg-rose-50/30' : 'hover:bg-slate-50'}>
                            <td className="py-4 px-5">
                              <div className="font-bold text-slate-900">{item.productName}</div>
                              <div className="text-[10px] font-mono text-slate-500 mt-0.5">{item.sku}</div>
                            </td>
                            <td className="py-4 px-5 text-center font-black text-slate-700 text-lg">{req}</td>
                            <td className="py-4 px-5 text-center bg-indigo-50/30 border-x border-indigo-50">
                              <input 
                                type="number" 
                                min="0" 
                                max={req}
                                value={conf}
                                onChange={e => {
                                  let val = Number(e.target.value);
                                  if (val < 0) val = 0;
                                  if (val > req) val = req; // Prevent over-fulfilling
                                  setVerifyModal({
                                    ...verifyModal,
                                    physicalCounts: { ...verifyModal.physicalCounts, [item.productId]: val }
                                  });
                                }}
                                className={`w-24 px-3 py-2 text-center font-black text-lg border-2 rounded-lg outline-none transition-colors ${short > 0 ? 'border-rose-300 text-rose-700 focus:border-rose-500 bg-white' : 'border-indigo-200 text-indigo-700 focus:border-indigo-500 bg-white'}`}
                              />
                            </td>
                            <td className="py-4 px-5 text-center">
                              {short > 0 ? (
                                <span className="inline-block px-3 py-1 font-black text-rose-700 bg-rose-100 border border-rose-200 rounded-md text-sm">{short} Deficit</span>
                              ) : (
                                <span className="text-emerald-500 font-black">✓ Complete</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="p-6 border-t border-slate-200 bg-white shrink-0 flex justify-between items-center">
                <button type="button" onClick={() => setVerifyModal({ isOpen: false, os: null, physicalCounts: {} })} className="px-6 py-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors">Cancel</button>
                <button type="button" onClick={submitVerification} disabled={isProcessing} className="px-10 py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase tracking-wider rounded-xl transition-colors shadow-md disabled:opacity-50">
                  {isProcessing ? 'Processing Transactions...' : 'Confirm Verification & Split Order'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* RETURN & REVERSE MODAL */}
        {returnModal.isOpen && returnModal.order && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
              <div className="p-5 border-b bg-rose-600 text-white">
                <h3 className="font-bold text-lg tracking-wide">Reverse & Return Transaction</h3>
                <p className="text-[10px] uppercase opacity-80 tracking-widest">{returnModal.order.osNumber}</p>
              </div>
              <form onSubmit={handleConfirmReturn} className="p-6 flex flex-col gap-5 bg-slate-50">
                <div className="bg-white border border-slate-200 p-4 rounded-xl text-xs font-bold text-rose-700 shadow-sm leading-relaxed">
                  WARNING: This fully reverses the transaction. It will <strong className="uppercase">{mode === 'sales' ? 'restore valid items back to' : 'deduct valid items from'} Master Stock</strong> and reverse the balance log by <strong>₱{(returnModal.order.items.reduce((acc, item) => acc + (item.total || 0), 0) || 0).toLocaleString('en-PH')}</strong>.
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setReturnModal({ isOpen: false, order: null })} className="flex-1 px-4 py-3 bg-white border border-slate-300 text-slate-700 font-bold rounded-xl transition-colors">Cancel</button>
                  <button type="submit" disabled={isProcessing} className="flex-1 px-4 py-3 bg-rose-600 hover:bg-rose-700 text-white font-black uppercase tracking-wider rounded-xl transition-colors shadow-sm disabled:opacity-50">Confirm Return</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>

      {/* --- PRINT TEMPLATES WITH STRICT TYPE SAFETY --- */}
      {printDoc && (
        <div className="hidden print:block absolute inset-0 w-full bg-white z-[99999] text-black font-sans p-8 min-h-screen">
          <div className="flex justify-between items-start border-b-2 border-black pb-6 mb-6">
            <div>
              <h1 className="text-4xl font-black tracking-tight uppercase">{companyMeta.name}</h1>
              <p className="text-sm font-bold mt-1">Official Document Center</p>
              <p className="text-xs mt-1 max-w-sm">{companyMeta.address} • {companyMeta.email}</p>
            </div>
            <div className="text-right text-xs space-y-0.5 mt-1 font-mono">
              <p>Generated: {new Date().toLocaleString()}</p>
              <p className="font-bold">System Ref: {String(printDoc.data?.id || 'N/A').slice(-8).toUpperCase()}</p>
            </div>
          </div>

          <div className="text-center mb-10">
            <h2 className="text-4xl font-black tracking-widest uppercase">
              {printDoc.type === 'OS' ? 'ORDER SLIP' : printDoc.type === 'PO' ? 'PURCHASE ORDER' : 'PACKING LIST'}
            </h2>
            <div className="inline-block mt-3 px-6 py-1.5 border-2 border-black font-black text-sm uppercase tracking-widest">
              DOC NO: {printDoc.type === 'OS' ? (printDoc.data?.osNumber || 'N/A') : printDoc.type === 'PO' ? (printDoc.data?.poNumber || 'N/A') : (printDoc.data?.plNumber || 'N/A')}
            </div>
          </div>

          <div className="flex justify-between mb-8 border-2 border-black p-5 bg-gray-50">
            <div className="w-1/2 pr-5 border-r-2 border-black">
              <h3 className="font-bold uppercase tracking-widest text-[10px] mb-2 border-b border-black pb-1">Billed / Shipped To</h3>
              <p className="font-black text-xl uppercase mt-2">{printDoc.data?.customer?.name || printDoc.data?.customerName || 'Unknown Entity'}</p>
              <p className="mt-1 font-medium">{printDoc.data?.customer?.address || 'Address not on file'}</p>
              <p className="font-medium mt-1">{printDoc.data?.customer?.contact || ''} {printDoc.data?.customer?.phone ? `• ${printDoc.data.customer.phone}` : ''}</p>
            </div>
            <div className="w-1/2 pl-5 text-right">
              <h3 className="font-bold uppercase tracking-widest text-[10px] mb-2 border-b border-black pb-1">Document Details</h3>
              <table className="w-full text-sm font-medium mt-2">
                <tbody>
                  <tr><td className="text-left pb-1">Document Date:</td><td className="font-bold text-black">{new Date(printDoc.data?.date || Date.now()).toLocaleDateString()}</td></tr>
                  <tr><td className="text-left pb-1">Status:</td><td className="font-bold text-black uppercase">{printDoc.data?.status || 'N/A'}</td></tr>
                  <tr><td className="text-left">Processed By:</td><td className="font-bold text-black uppercase">{printDoc.data?.user || 'SYSTEM'}</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <table className="w-full text-left border-collapse mb-8 border-2 border-black">
            <thead className="border-b-2 border-black bg-gray-100">
              <tr>
                <th className="py-3 px-4 font-black uppercase tracking-wider text-xs border-r border-black w-[15%]">SKU</th>
                <th className="py-3 px-4 font-black uppercase tracking-wider text-xs border-r border-black">Description</th>
                <th className="py-3 px-4 font-black uppercase tracking-wider text-xs text-center border-r border-black w-[10%]">Qty</th>
                <th className="py-3 px-4 font-black uppercase tracking-wider text-xs text-right border-r border-black w-[15%]">Unit Price</th>
                <th className="py-3 px-4 font-black uppercase tracking-wider text-xs text-right w-[15%]">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black">
              {(printDoc.data?.items || []).filter((item: any) => !item.isCancelled).map((item: any, i: number) => (
                <tr key={i} className="break-inside-avoid">
                  <td className="py-3 px-4 border-r border-black font-mono text-xs">{item.sku || 'N/A'}</td>
                  <td className="py-3 px-4 border-r border-black font-bold text-black">{item.productName || 'Unknown'}</td>
                  <td className="py-3 px-4 text-center font-bold border-r border-black text-black">{item.requestedQty || item.fulfilledQty || item.quantity || 0}</td>
                  <td className="py-3 px-4 text-right font-medium border-r border-black text-black">{item.unitPrice !== undefined ? `₱${Number(item.unitPrice).toLocaleString('en-PH', {minimumFractionDigits: 2})}` : '-'}</td>
                  <td className="py-3 px-4 text-right font-black text-black">{item.total !== undefined ? `₱${Number(item.total).toLocaleString('en-PH', {minimumFractionDigits: 2})}` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {printDoc.type === 'OS' && (
            <div className="flex justify-end mb-16 break-inside-avoid">
              <div className="w-2/5 p-5 border-2 border-black bg-gray-50">
                <div className="flex justify-between items-center mb-2"><span className="font-bold uppercase tracking-widest text-xs">Subtotal</span><span className="font-black">₱{Number(printDoc.data?.subtotal || 0).toLocaleString('en-PH', {minimumFractionDigits: 2})}</span></div>
                <div className="flex justify-between items-center mb-3"><span className="font-bold uppercase tracking-widest text-xs">VAT (12%)</span><span className="font-black">₱{Number(printDoc.data?.vatAmount || 0).toLocaleString('en-PH', {minimumFractionDigits: 2})}</span></div>
                <div className="border-t-2 border-black my-3"></div>
                <div className="flex justify-between items-center"><span className="font-black uppercase tracking-widest text-sm">Grand Total</span><span className="font-black text-2xl">₱{Number(printDoc.data?.grandTotal || 0).toLocaleString('en-PH', {minimumFractionDigits: 2})}</span></div>
              </div>
            </div>
          )}

          <div className="flex justify-between items-end pt-12 mt-12 break-inside-avoid">
            <div className="w-1/3 text-center"><div className="border-t-2 border-black pt-2 font-bold uppercase text-xs tracking-widest">Prepared By</div><div className="text-[10px] mt-1 uppercase">{printDoc.data?.user || 'SYSTEM'}</div></div>
            <div className="w-1/3 text-center"><div className="border-t-2 border-black pt-2 font-bold uppercase text-xs tracking-widest">Verified By</div><div className="text-[10px] mt-1">Signature / Date</div></div>
            <div className="w-1/3 text-center"><div className="border-t-2 border-black pt-2 font-bold uppercase text-xs tracking-widest">Client Acceptance</div><div className="text-[10px] mt-1">Signature / Date</div></div>
          </div>
        </div>
      )}
    </>
  );
}