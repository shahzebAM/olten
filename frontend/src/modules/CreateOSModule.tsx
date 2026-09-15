import React, { useState, useEffect, useMemo } from 'react';

// --- INTERFACES ---
interface Customer { id: string; company: string; name: string; contact: string | null; phone: string | null; email: string | null; address: string | null; }
interface WarehouseBreakdown { name: string; quantity: number; }
interface SearchedProduct { id: number; name: string; sku: string; category: string; sellingPrice: number; officeStock: number; warehouseQty: number; warehouseBreakdown: WarehouseBreakdown[]; }
interface DraftItem { productId: number; sku: string; productName: string; requestedQty: number | ''; unitPrice: number; lineTotal: number; officeStock: number; warehouseQty: number; warehouseBreakdown: WarehouseBreakdown[]; selectedWarehouseName: string | null; }

interface CreateOSModuleProps {
  selectedCompany: string;
  loginUsername: string;
  API_BASE_URL: string;
  onBack: () => void;
  initialCustomerId?: string | null;
}

export default function CreateOSModule({ selectedCompany, loginUsername, API_BASE_URL, onBack, initialCustomerId }: CreateOSModuleProps) {
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRefreshingStock, setIsRefreshingStock] = useState(false);

  // --- DATA STATES ---
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [productSearchResults, setProductSearchResults] = useState<SearchedProduct[]>([]);

  // --- WORKFLOW STATES ---
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);

  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const [isSearchingProducts, setIsSearchingProducts] = useState(false);

  const [isVatApplied, setIsVatApplied] = useState(false);
  const vatRate = 0.12;

  const showToast = (msg: string, type: 'success' | 'error') => { setToast({ message: msg, type }); setTimeout(() => setToast(null), 3500); };

  useEffect(() => {
    fetch(`${API_BASE_URL}/sales/customers?company=${selectedCompany}&limit=100`)
      .then(res => res.json())
      .then(data => {
        const list = Array.isArray(data) ? data : (data.data || []);
        setCustomers(list);
        if (initialCustomerId && list.length > 0) {
          const target = list.find((c: Customer) => c.id === initialCustomerId);
          if (target) {
            setSelectedCustomer(target);
            setCustomerSearch(target.name);
          }
        }
      })
      .catch(() => console.warn(`Silent skip: Failed to fetch customers`));
  }, [selectedCompany, API_BASE_URL, initialCustomerId]);

  useEffect(() => {
    if (productSearch.trim().length < 2) {
      setProductSearchResults([]);
      return;
    }

    const handler = setTimeout(async () => {
      setIsSearchingProducts(true);
      try {
        const res = await fetch(`${API_BASE_URL}/sales/order-slips/search-products?company=${selectedCompany}&q=${encodeURIComponent(productSearch)}`);
        if (res.ok) {
          const data = await res.json();
          setProductSearchResults(data);
        }
      } catch (e) {
        console.warn("Product search failed.");
      } finally {
        setIsSearchingProducts(false);
      }
    }, 400);

    return () => clearTimeout(handler);
  }, [productSearch, selectedCompany, API_BASE_URL]);

  const filteredCustomers = useMemo(() => {
    const query = customerSearch.toLowerCase();
    return customers.filter(c => 
      c.name.toLowerCase().includes(query) || 
      c.company.toLowerCase().includes(query) || 
      c.id.toLowerCase().includes(query) ||
      (c.phone && c.phone.toLowerCase().includes(query)) ||
      (c.email && c.email.toLowerCase().includes(query))
    );
  }, [customers, customerSearch]);

  const handleSelectCustomer = (c: Customer) => {
    setSelectedCustomer(c);
    setCustomerSearch(c.name);
    setShowCustomerDropdown(false);
  };

  const handleAddProduct = (p: SearchedProduct) => {
    if (draftItems.some(i => i.productId === p.id)) {
      return showToast("Product already exists in the order.", "error");
    }
    
    setDraftItems([...draftItems, { 
      productId: p.id, 
      sku: p.sku, 
      productName: p.name, 
      officeStock: p.officeStock,
      warehouseQty: p.warehouseQty,
      warehouseBreakdown: p.warehouseBreakdown || [],
      selectedWarehouseName: null, // Default to all warehouses
      requestedQty: 1, 
      unitPrice: p.sellingPrice || 0, 
      lineTotal: p.sellingPrice || 0 
    }]);
    
    setProductSearch('');
    setShowProductDropdown(false);
    setProductSearchResults([]);
  };

  const handleUpdateQty = (index: number, val: string) => {
    const updated = [...draftItems];
    if (val === '') {
      updated[index].requestedQty = '';
      updated[index].lineTotal = 0;
    } else {
      const qty = parseInt(val, 10);
      updated[index].requestedQty = qty;
      updated[index].lineTotal = qty * updated[index].unitPrice;
    }
    setDraftItems(updated);
  };

  const handleSelectWarehouse = (index: number, warehouseName: string | null) => {
    const updated = [...draftItems];
    updated[index].selectedWarehouseName = warehouseName;
    setDraftItems(updated);
  };

  const handleRemoveItem = (index: number) => {
    setDraftItems(draftItems.filter((_, i) => i !== index));
  };

  const handleRefreshStock = async () => {
    if (draftItems.length === 0) return;
    setIsRefreshingStock(true);
    
    try {
      const productIds = draftItems.map(i => i.productId);
      const res = await fetch(`${API_BASE_URL}/sales/order-slips/refresh-stock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: selectedCompany, productIds })
      });
      
      if (!res.ok) throw new Error();
      const stockMap = await res.json();
      
      setDraftItems(prev => prev.map(item => ({
        ...item,
        officeStock: stockMap[item.productId]?.officeStock ?? item.officeStock,
        warehouseQty: stockMap[item.productId]?.warehouseQty ?? item.warehouseQty,
        warehouseBreakdown: stockMap[item.productId]?.warehouseBreakdown ?? item.warehouseBreakdown
      })));
      
      showToast("Live stock validated with backend.", "success");
    } catch (e) {
      showToast("Failed to refresh stock.", "error");
    } finally {
      setIsRefreshingStock(false);
    }
  };

  const subtotal = Math.round(draftItems.reduce((acc, item) => acc + (item.lineTotal || 0), 0) * 100) / 100;
  const vatAmount = isVatApplied ? Math.round((subtotal * vatRate) * 100) / 100 : 0;
  const grandTotal = Math.round((subtotal + vatAmount) * 100) / 100;

  const isFormValid = selectedCustomer && draftItems.length > 0 && draftItems.every(i => typeof i.requestedQty === 'number' && i.requestedQty > 0);

  const handleSubmit = async () => {
    if (!isFormValid) return showToast("Complete customer selection and item quantities.", "error");
    
    setIsProcessing(true);
    try {
      const payload = {
        company: selectedCompany,
        customerId: selectedCustomer.id,
        isVatApplied,
        vatRate,
        user: loginUsername,
        items: draftItems.map(i => ({
          productId: i.productId,
          sku: i.sku,
          productName: i.productName,
          requestedQty: Number(i.requestedQty),
          unitPrice: i.unitPrice
        }))
      };

      const res = await fetch(`${API_BASE_URL}/sales/order-slips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error("Failed to create Order Slip.");

      showToast("Order Slip generated successfully.", "success");
      setDraftItems([]);
      setSelectedCustomer(null);
      setCustomerSearch('');
      setIsVatApplied(false);
    } catch (e: any) {
      showToast(e.message || "Network error. Please try again.", "error");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    // 1. Parent container is locked to screen height with hidden overflow
    <div className="flex flex-col h-screen w-full bg-[#F8FAFC] font-sans text-slate-900 overflow-hidden">
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[100] px-5 py-3.5 rounded-xl shadow-xl font-bold text-sm ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'}`}>
          {toast.message}
        </div>
      )}

      {/* Header takes natural height and never shrinks/grows */}
      <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0 shadow-sm z-20">
        <div><h2 className="text-2xl font-black text-slate-800 tracking-tight">Enterprise ERP <span className="text-slate-400 font-medium">| Create Order Slip</span></h2></div>
        <button onClick={onBack} className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors shadow-sm border border-slate-200">Back to Gateway</button>
      </header>

      {/* 2. Main content area becomes a flex container that fills the rest of the screen without scrolling the body */}
      <main className="flex-1 flex flex-col p-4 sm:p-6 overflow-hidden">
        <div className="max-w-[1400px] w-full mx-auto flex flex-col flex-1 overflow-hidden space-y-4">

          {/* STEP 1: CUSTOMER SELECTION (Fixed Height / Shrink-0) */}
          <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 shrink-0 z-10">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3 pl-1">Step 1: Select Customer</h3>
            
            {!selectedCustomer ? (
              <div className="relative">
                <input 
                  type="text" 
                  placeholder="Search by Customer Name, Company, or Code..." 
                  value={customerSearch}
                  onChange={e => { setCustomerSearch(e.target.value); setShowCustomerDropdown(true); }}
                  onFocus={() => setShowCustomerDropdown(true)}
                  onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 200)}
                  className="w-full px-5 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-50 transition-all placeholder:text-slate-400"
                />
                {showCustomerDropdown && (
                  <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-2xl max-h-64 overflow-y-auto z-30">
                    {filteredCustomers.length === 0 ? (
                      <div className="p-4 text-slate-500 text-sm font-medium text-center">No matching customers found.</div>
                    ) : (
                      filteredCustomers.map(c => (
                        <div key={c.id} onMouseDown={(e) => { e.preventDefault(); handleSelectCustomer(c); }} className="px-5 py-3 hover:bg-indigo-50 border-b border-slate-50 cursor-pointer flex justify-between items-center group">
                          <div>
                            <span className="font-bold text-slate-900 group-hover:text-indigo-700 block">{c.name}</span>
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mt-0.5">{c.company}</span>
                          </div>
                          <span className="text-xs font-mono text-slate-500 bg-slate-100 px-2 py-1 rounded">{c.id.slice(0, 8)}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-between bg-indigo-50/50 border border-indigo-100 px-5 py-4 rounded-xl">
                <h4 className="text-xl font-black text-indigo-900">{selectedCustomer.name}</h4>
                <button onClick={() => { setSelectedCustomer(null); setCustomerSearch(''); }} className="px-4 py-2 bg-white text-indigo-600 border border-indigo-200 hover:bg-indigo-100 font-bold text-[10px] uppercase tracking-widest rounded-lg transition-colors shadow-sm">Change Customer</button>
              </div>
            )}
          </section>

          {/* STEP 2: PRODUCTS TABLE (Flex-1 / Grows to fill space / Internal Scrolling) */}
          <section className="bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col flex-1 overflow-hidden">
            
            {/* Header + Minimal Search Bar */}
            <div className="p-4 border-b border-slate-200 bg-white flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0 z-10">
              <div className="flex items-center gap-4">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 pl-1">Step 2: Add Products</h3>
                <button onClick={handleRefreshStock} disabled={isRefreshingStock || draftItems.length === 0} className="px-3 py-1.5 bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200 disabled:opacity-50 text-[9px] font-black uppercase tracking-widest rounded-md transition-colors shadow-sm">
                  {isRefreshingStock ? 'Refreshing...' : 'Refresh Stock'}
                </button>
              </div>
              
              <div className="relative w-full sm:w-[400px]">
                <div className="relative flex items-center">
                  <svg className="absolute left-3 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                  <input 
                    type="text" 
                    placeholder="Search SKU, Product Name, Category..." 
                    value={productSearch}
                    onChange={e => { setProductSearch(e.target.value); setShowProductDropdown(true); }}
                    onFocus={() => setShowProductDropdown(true)}
                    onBlur={() => setTimeout(() => setShowProductDropdown(false), 200)}
                    disabled={!selectedCustomer}
                    className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium outline-none focus:bg-white focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50 disabled:opacity-50 disabled:bg-slate-100 transition-all placeholder:text-slate-400"
                  />
                  {isSearchingProducts && (
                    <div className="absolute right-3"><div className="w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div></div>
                  )}
                </div>

                {showProductDropdown && productSearch.trim().length >= 2 && !isSearchingProducts && (
                  <div className="absolute top-full right-0 mt-2 w-full sm:w-[500px] bg-white border border-slate-200 rounded-xl shadow-2xl max-h-72 overflow-y-auto z-40">
                    {productSearchResults.length === 0 ? (
                      <div className="p-4 text-slate-500 text-sm font-medium text-center">No products match your search.</div>
                    ) : (
                      productSearchResults.map(p => (
                        <div key={p.id} onMouseDown={(e) => { e.preventDefault(); handleAddProduct(p); }} className="px-5 py-3 hover:bg-indigo-50 border-b border-slate-100 cursor-pointer flex justify-between items-center group">
                          <div className="flex flex-col">
                            <span className="font-bold text-slate-900 group-hover:text-indigo-700">{p.name}</span>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[10px] font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">{p.sku}</span>
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{p.category}</span>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-black text-slate-700">₱{(p.sellingPrice || 0).toLocaleString()}</div>
                            <div className="text-[9px] font-black uppercase tracking-widest mt-1 flex gap-2 justify-end">
                              <span className={p.officeStock > 0 ? 'text-emerald-600' : 'text-rose-600'}>Off: {p.officeStock}</span>
                              <span className={p.warehouseQty > 0 ? 'text-emerald-600' : 'text-rose-600'}>Whse: {p.warehouseQty}</span>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 3. The Table Container handles the scrolling internally while headers stay sticky */}
            <div className="flex-1 overflow-auto w-full relative bg-slate-50/30">
              <table className="w-full text-left text-sm whitespace-nowrap min-w-[900px]">
                <thead className="bg-white sticky top-0 z-20 shadow-sm shadow-slate-200/50">
                  <tr>
                    <th className="py-3 px-5 font-black text-slate-500 uppercase tracking-widest text-[10px] w-32 border-b border-slate-200">SKU</th>
                    <th className="py-3 px-5 font-black text-slate-500 uppercase tracking-widest text-[10px] border-b border-slate-200">Product Description</th>
                    <th className="py-3 px-3 font-black text-slate-500 uppercase tracking-widest text-[10px] text-center w-20 border-b border-slate-200">Off Qty</th>
                    <th className="py-3 px-3 font-black text-indigo-600 uppercase tracking-widest text-[10px] text-center w-28 border-r border-b border-slate-200">Whse Qty</th>
                    <th className="py-3 px-5 font-black text-indigo-600 uppercase tracking-widest text-[10px] text-center w-36 bg-indigo-50/50 border-b border-indigo-100">Requested</th>
                    <th className="py-3 px-5 font-black text-slate-500 uppercase tracking-widest text-[10px] text-right w-28 border-b border-slate-200">Unit Price</th>
                    <th className="py-3 px-5 font-black text-slate-500 uppercase tracking-widest text-[10px] text-right w-32 border-b border-slate-200">Line Total</th>
                    <th className="w-12 text-center border-b border-slate-200"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {draftItems.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-24 text-center text-slate-400 font-medium">
                        Search and select a product to begin building the order.
                      </td>
                    </tr>
                  ) : (
                    draftItems.map((item, idx) => {
                      const reqQty = Number(item.requestedQty) || 0;
                      
                      // Calculate effective warehouse qty based on selection
                      const effectiveWhseQty = item.selectedWarehouseName 
                        ? (item.warehouseBreakdown.find(wb => wb.name === item.selectedWarehouseName)?.quantity || 0)
                        : item.warehouseQty;

                      const totalAvailable = item.officeStock + effectiveWhseQty;

                      return (
                        <tr key={idx} className="hover:bg-indigo-50/20 transition-colors bg-white">
                          <td className="py-3 px-5 font-mono text-xs font-bold text-slate-500">{item.sku}</td>
                          <td className="py-3 px-5 font-bold text-slate-900">{item.productName}</td>
                          <td className={`py-3 px-3 text-center font-black ${item.officeStock > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{item.officeStock}</td>
                          
                          {/* WAREHOUSE DROPDOWN SELECTOR */}
                          <td className={`py-3 px-3 text-center border-r border-slate-100 relative group`}>
                            <div className="inline-flex flex-col items-center justify-center cursor-pointer p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
                              <span className={`font-black text-sm leading-none ${effectiveWhseQty > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                {effectiveWhseQty}
                              </span>
                              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                                {item.selectedWarehouseName || 'All Whse'}
                              </span>
                            </div>
                            
                            {item.warehouseBreakdown && item.warehouseBreakdown.length > 0 && (
                              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 w-56 bg-slate-900 text-white rounded-xl shadow-2xl p-2 z-30 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
                                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 border-b border-slate-700 pb-1.5 px-2 text-left">Select Location</div>
                                <div className="space-y-1 max-h-40 overflow-y-auto">
                                  {/* Default 'All Warehouses' Option */}
                                  <button 
                                    type="button"
                                    onClick={() => handleSelectWarehouse(idx, null)}
                                    className={`w-full flex justify-between items-center text-xs px-2 py-1.5 rounded hover:bg-slate-800 transition-colors ${!item.selectedWarehouseName ? 'bg-slate-800 text-emerald-400' : 'text-slate-300'}`}
                                  >
                                    <span className="truncate pr-3 font-medium">All Warehouses</span>
                                    <span className="font-black shrink-0">{item.warehouseQty}</span>
                                  </button>
                                  
                                  {/* Specific Warehouse Options */}
                                  {item.warehouseBreakdown.map((wb, i) => (
                                    <button 
                                      type="button"
                                      key={i}
                                      onClick={() => handleSelectWarehouse(idx, wb.name)}
                                      className={`w-full flex justify-between items-center text-xs px-2 py-1.5 rounded hover:bg-slate-800 transition-colors ${item.selectedWarehouseName === wb.name ? 'bg-slate-800 text-emerald-400' : 'text-slate-300'}`}
                                    >
                                      <span className="truncate pr-3 font-medium">{wb.name}</span>
                                      <span className="font-black shrink-0">{wb.quantity}</span>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </td>

                          <td className="py-2 px-4 bg-indigo-50/30">
                            <input 
                              type="number" min="1" placeholder="0" value={item.requestedQty} onChange={e => handleUpdateQty(idx, e.target.value)} 
                              className="w-full px-2 py-1.5 text-center font-black text-lg text-indigo-700 bg-white border border-indigo-200 rounded-lg outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50 shadow-sm transition-all" 
                            />
                            <div className="mt-1 text-center">
                              {totalAvailable === 0 && <span className="text-rose-600 font-bold text-[9px] uppercase tracking-widest">Out of Stock</span>}
                              {totalAvailable > 0 && reqQty <= totalAvailable && <span className="text-emerald-600 font-bold text-[9px] uppercase tracking-widest">Stock Sufficient</span>}
                              {totalAvailable > 0 && reqQty > totalAvailable && <span className="text-amber-600 font-bold text-[9px] uppercase tracking-widest">Short by {reqQty - totalAvailable}</span>}
                            </div>
                          </td>
                          <td className="py-3 px-5 text-right font-bold text-slate-700">₱{item.unitPrice.toLocaleString('en-PH', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                          <td className="py-3 px-5 text-right font-black text-slate-900">₱{(item.lineTotal || 0).toLocaleString('en-PH', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                          <td className="py-3 px-5 text-center"><button type="button" onClick={() => handleRemoveItem(idx)} className="text-slate-300 hover:text-rose-500 font-black transition-colors bg-slate-50 hover:bg-rose-50 p-1.5 rounded-md">✕</button></td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* STEP 3: FOOTER CHECKOUT (Fixed Height / Shrink-0) */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl flex flex-col md:flex-row items-center justify-between p-6 gap-6 shrink-0 z-30">
            <label className="flex items-center gap-3 cursor-pointer group">
              <input type="checkbox" checked={isVatApplied} onChange={e => setIsVatApplied(e.target.checked)} className="w-5 h-5 rounded text-indigo-500 bg-slate-800 border-slate-700 focus:ring-indigo-500 cursor-pointer" />
              <span className="font-bold text-slate-300 group-hover:text-white transition-colors text-sm tracking-wide uppercase">Apply 12% VAT</span>
            </label>

            <div className="flex flex-wrap items-center gap-8 md:gap-12 w-full md:w-auto justify-end">
              <div className="text-right">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Subtotal</div>
                <div className="font-bold text-slate-300">₱{subtotal.toLocaleString('en-PH', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">VAT (12%)</div>
                <div className="font-bold text-slate-300">₱{vatAmount.toLocaleString('en-PH', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
              </div>
              <div className="text-right pl-6 border-l border-slate-700">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Grand Total</div>
                <div className="text-3xl font-black text-white">₱{grandTotal.toLocaleString('en-PH', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
              </div>

              <button type="button" onClick={handleSubmit} disabled={!isFormValid || isProcessing} className="w-full md:w-auto px-10 py-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 text-white font-black uppercase tracking-wider rounded-xl transition-colors shadow-lg">
                {isProcessing ? 'Processing...' : 'Finalize & Generate O.S.'}
              </button>
            </div>
          </section>

        </div>
      </main>
    </div>
  );
}