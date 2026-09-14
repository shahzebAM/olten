import React, { useState, useEffect, useMemo } from 'react';

// --- INTERFACES ---
interface Customer { id: string; company: string; name: string; contact: string | null; phone: string | null; email: string | null; address: string | null; }
interface SearchedProduct { id: number; name: string; sku: string; category: string; sellingPrice: number; officeStock: number; warehouseQty: number; }
interface DraftItem { productId: number; sku: string; productName: string; requestedQty: number | ''; unitPrice: number; lineTotal: number; officeStock: number; warehouseQty: number; }

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

  // --- FETCH INITIAL CUSTOMERS ---
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

  // --- DEBOUNCED SERVER-SIDE PRODUCT SEARCH ---
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

  // --- ACTIONS ---
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
        warehouseQty: stockMap[item.productId]?.warehouseQty ?? item.warehouseQty
      })));
      
      showToast("Live stock validated with backend.", "success");
    } catch (e) {
      showToast("Failed to refresh stock.", "error");
    } finally {
      setIsRefreshingStock(false);
    }
  };

  const subtotal = draftItems.reduce((acc, item) => acc + (item.lineTotal || 0), 0);
  const vatAmount = isVatApplied ? subtotal * vatRate : 0;
  const grandTotal = subtotal + vatAmount;

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
    <div className="flex flex-col h-screen w-full bg-[#F8FAFC] font-sans text-slate-900 overflow-hidden">
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[100] px-5 py-3.5 rounded-xl shadow-xl font-bold text-sm ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'}`}>
          {toast.message}
        </div>
      )}

      <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0 shadow-sm z-10">
        <div><h2 className="text-2xl font-black text-slate-800 tracking-tight">Enterprise ERP <span className="text-slate-400 font-medium">| Create Order Slip</span></h2></div>
        <button onClick={onBack} className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors">Back to Gateway</button>
      </header>

      <main className="flex-1 overflow-y-auto p-4 sm:p-8">
        <div className="max-w-7xl mx-auto space-y-6">

          {/* STEP 1: CUSTOMER SELECTION */}
          <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-4">Step 1: Select Customer</h3>
            
            {!selectedCustomer ? (
              <div className="relative">
                <input 
                  type="text" 
                  placeholder="Search by Customer Name, Company, or Code..." 
                  value={customerSearch}
                  onChange={e => { setCustomerSearch(e.target.value); setShowCustomerDropdown(true); }}
                  onFocus={() => setShowCustomerDropdown(true)}
                  onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 200)}
                  className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-100 transition-all"
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
              <div className="flex items-center justify-between bg-indigo-50 border border-indigo-100 p-5 rounded-xl">
                <div>
                  <h4 className="text-lg font-black text-indigo-900">{selectedCustomer.name}</h4>
                  <div className="text-xs font-medium text-indigo-700 mt-1">{selectedCustomer.company} • {selectedCustomer.contact || 'No Direct Contact'} • {selectedCustomer.phone || 'No Phone'}</div>
                  <div className="text-xs text-indigo-500 mt-1 max-w-md truncate">{selectedCustomer.address || 'No Address Provided'}</div>
                </div>
                <button onClick={() => { setSelectedCustomer(null); setCustomerSearch(''); }} className="px-4 py-2 bg-white text-indigo-600 border border-indigo-200 hover:bg-indigo-100 font-bold text-[10px] uppercase tracking-widest rounded-lg transition-colors">Change Customer</button>
              </div>
            )}
          </section>

          {/* STEP 2: ORDER ITEMS */}
          <section className="bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden">
            <div className="p-6 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="flex items-center gap-4">
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-500">Step 2: Add Products</h3>
                <button onClick={handleRefreshStock} disabled={isRefreshingStock || draftItems.length === 0} className="px-3 py-1.5 bg-slate-200 text-slate-600 hover:bg-slate-300 disabled:opacity-50 text-[10px] font-black uppercase tracking-widest rounded-md transition-colors">
                  {isRefreshingStock ? 'Refreshing...' : 'Refresh Stock'}
                </button>
              </div>
              
              <div className="relative w-full sm:w-96">
                <input 
                  type="text" 
                  placeholder="Search SKU, Product Name, Category..." 
                  value={productSearch}
                  onChange={e => { setProductSearch(e.target.value); setShowProductDropdown(true); }}
                  onFocus={() => setShowProductDropdown(true)}
                  onBlur={() => setTimeout(() => setShowProductDropdown(false), 200)}
                  disabled={!selectedCustomer}
                  className="w-full px-4 py-2.5 bg-white border border-slate-300 hover:border-indigo-400 rounded-xl text-sm font-bold outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:opacity-50 disabled:bg-slate-100 transition-all"
                />
                
                {isSearchingProducts && (
                  <div className="absolute right-4 top-3"><div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div></div>
                )}

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

            <div className="overflow-x-auto w-full">
              <table className="w-full text-left text-sm whitespace-nowrap min-w-[900px]">
                <thead className="bg-white border-b border-slate-200">
                  <tr>
                    <th className="py-4 px-5 font-black text-slate-500 uppercase tracking-widest text-[10px] w-32">SKU</th>
                    <th className="py-4 px-5 font-black text-slate-500 uppercase tracking-widest text-[10px]">Product Description</th>
                    <th className="py-4 px-3 font-black text-slate-500 uppercase tracking-widest text-[10px] text-center w-20">Off Qty</th>
                    <th className="py-4 px-3 font-black text-slate-500 uppercase tracking-widest text-[10px] text-center w-20 border-r border-slate-200">Whse Qty</th>
                    <th className="py-4 px-5 font-black text-indigo-600 uppercase tracking-widest text-[10px] text-center w-36 bg-indigo-50/50">Requested</th>
                    <th className="py-4 px-5 font-black text-slate-500 uppercase tracking-widest text-[10px] text-right w-28">Unit Price</th>
                    <th className="py-4 px-5 font-black text-slate-500 uppercase tracking-widest text-[10px] text-right w-32">Line Total</th>
                    <th className="w-12 text-center"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {draftItems.length === 0 ? (
                    <tr><td colSpan={8} className="py-12 text-center text-slate-400 font-medium">Search and select a product to begin building the order.</td></tr>
                  ) : (
                    draftItems.map((item, idx) => {
                      const reqQty = Number(item.requestedQty) || 0;
                      const totalAvailable = item.officeStock + item.warehouseQty;

                      return (
                        <tr key={idx} className="hover:bg-slate-50 transition-colors">
                          <td className="py-3 px-5 font-mono text-xs font-bold text-slate-500">{item.sku}</td>
                          <td className="py-3 px-5 font-bold text-slate-900">{item.productName}</td>
                          <td className={`py-3 px-3 text-center font-black ${item.officeStock > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{item.officeStock}</td>
                          <td className={`py-3 px-3 text-center font-black border-r border-slate-200 ${item.warehouseQty > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{item.warehouseQty}</td>
                          <td className="py-2 px-4 bg-indigo-50/30">
                            <input 
                              type="number" min="1" placeholder="0" value={item.requestedQty} onChange={e => handleUpdateQty(idx, e.target.value)} 
                              className="w-full px-2 py-1.5 text-center font-black text-lg text-indigo-700 bg-white border-2 border-indigo-200 rounded outline-none focus:border-indigo-500 shadow-sm" 
                            />
                            <div className="mt-1 text-center">
                              {totalAvailable === 0 && <span className="text-rose-600 font-bold text-[9px] uppercase tracking-widest">Out of Stock</span>}
                              {totalAvailable > 0 && reqQty <= totalAvailable && <span className="text-emerald-600 font-bold text-[9px] uppercase tracking-widest">Stock Sufficient</span>}
                              {totalAvailable > 0 && reqQty > totalAvailable && <span className="text-amber-600 font-bold text-[9px] uppercase tracking-widest">Short by {reqQty - totalAvailable}</span>}
                            </div>
                          </td>
                          <td className="py-3 px-5 text-right font-bold text-slate-700">₱{item.unitPrice.toLocaleString('en-PH', {minimumFractionDigits: 2})}</td>
                          <td className="py-3 px-5 text-right font-black text-slate-900">₱{(item.lineTotal || 0).toLocaleString('en-PH', {minimumFractionDigits: 2})}</td>
                          <td className="py-3 px-5 text-center"><button onClick={() => handleRemoveItem(idx)} className="text-slate-300 hover:text-rose-500 font-black transition-colors">✕</button></td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* STEP 3: REVIEW & SUBMIT */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl flex flex-col md:flex-row items-center justify-between p-6 gap-6">
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={isVatApplied} onChange={e => setIsVatApplied(e.target.checked)} className="w-5 h-5 rounded text-indigo-500 bg-slate-800 border-slate-700 focus:ring-indigo-500" />
              <span className="font-bold text-slate-300 text-sm tracking-wide uppercase">Apply 12% VAT</span>
            </label>

            <div className="flex flex-wrap items-center gap-8 md:gap-12 w-full md:w-auto justify-end">
              <div className="text-right">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Subtotal</div>
                <div className="font-bold text-slate-300">₱{subtotal.toLocaleString('en-PH', {minimumFractionDigits: 2})}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">VAT (12%)</div>
                <div className="font-bold text-slate-300">₱{vatAmount.toLocaleString('en-PH', {minimumFractionDigits: 2})}</div>
              </div>
              <div className="text-right pl-6 border-l border-slate-700">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Grand Total</div>
                <div className="text-3xl font-black text-white">₱{grandTotal.toLocaleString('en-PH', {minimumFractionDigits: 2})}</div>
              </div>

              <button onClick={handleSubmit} disabled={!isFormValid || isProcessing} className="w-full md:w-auto px-10 py-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 text-white font-black uppercase tracking-wider rounded-xl transition-colors shadow-lg">
                {isProcessing ? 'Processing...' : 'Finalize & Generate O.S.'}
              </button>
            </div>
          </section>

        </div>
      </main>
    </div>
  );
}