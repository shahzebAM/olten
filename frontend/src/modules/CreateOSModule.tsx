import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';

// --- INTERFACES ---
interface Customer { id: string; company: string; name: string; contact: string | null; phone: string | null; email: string | null; address: string | null; }
interface WarehouseBreakdown { name: string; quantity: number; }
interface SearchedProduct { id: number; name: string; sku: string; category: string; sellingPrice: number; officeStock: number; warehouseQty: number; warehouseBreakdown: WarehouseBreakdown[]; }
interface DraftItem { id?: string; productId: number; sku: string; productName: string; requestedQty: number | ''; unitPrice: number | string; lineTotal: number; officeStock: number; warehouseQty: number; warehouseBreakdown: WarehouseBreakdown[]; selectedWarehouseName: string | null; }

interface CreateOSModuleProps {
  selectedCompany: string;
  loginUsername: string;
  API_BASE_URL: string;
  onBack: () => void;
  onViewLedger?: () => void;
  setActiveTab?: (tab: string) => void;
  initialCustomerId?: string | null;
}

export default function CreateOSModule({ selectedCompany, loginUsername, API_BASE_URL, onBack, onViewLedger, initialCustomerId, setActiveTab }: CreateOSModuleProps) {
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRefreshingStock, setIsRefreshingStock] = useState(false);

  // --- FINAL ORDER GENERATION STATES ---
  const [isGeneratingFinalOrder, setIsGeneratingFinalOrder] = useState(false);
  const [finalOrderGenerated, setFinalOrderGenerated] = useState(false);
  const [finalOrderNumber, setFinalOrderNumber] = useState(''); 

  // --- DATA STATES ---
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [allSlips, setAllSlips] = useState<any[]>([]);
  const [productSearchResults, setProductSearchResults] = useState<SearchedProduct[]>([]);
  
  // Editable OS Number & Reference & Update Tracker
  const [osNumber, setOsNumber] = useState<string>('');
  const [referenceOs, setReferenceOs] = useState<string | null>(null);
  const [loadedOsId, setLoadedOsId] = useState<string | null>(null);
  const [loadedOsStatus, setLoadedOsStatus] = useState<string>('Generated');
  const [finalizedOs, setFinalizedOs] = useState<any | null>(null);

  // --- WORKFLOW STATES ---
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [customerHighlightedIndex, setCustomerHighlightedIndex] = useState(-1);
  const customerDropdownRef = useRef<HTMLDivElement>(null);

  const [loadSlipSearch, setLoadSlipSearch] = useState('');
  const [showLoadSlipDropdown, setShowLoadSlipDropdown] = useState(false);

  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const [isSearchingProducts, setIsSearchingProducts] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const searchDropdownRef = useRef<HTMLDivElement>(null);

  const [isVatApplied, setIsVatApplied] = useState(false);
  const vatRate = 0.12;

  const showToast = (msg: string, type: 'success' | 'error') => { setToast({ message: msg, type }); setTimeout(() => setToast(null), 3500); };

  const fetchNextOsNumber = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/sales/order-slips?company=${encodeURIComponent(selectedCompany)}&limit=500`);
      const data = await res.json();
      const slips = data.data || [];
      
      setAllSlips(slips);

      const osSlips = slips.filter((s: any) => s.osNumber && s.osNumber.startsWith('OS'));
      osSlips.sort((a: any, b: any) => parseInt(b.osNumber.replace(/\D/g, '') || '0', 10) - parseInt(a.osNumber.replace(/\D/g, '') || '0', 10));

      const lastOs = osSlips.length > 0 ? osSlips[0] : null;
      if (lastOs) {
        const match = lastOs.osNumber.match(/(\d+)$/); 
        if (match) {
          const nextNum = parseInt(match[0], 10) + 1;
          const prefix = lastOs.osNumber.substring(0, match.index);
          const padding = match[0].length;
          setOsNumber(`${prefix}${String(nextNum).padStart(padding, '0')}`);
        } else setOsNumber('OS-000001');
      } else setOsNumber('OS-000001');
    } catch (e) { setOsNumber('OS-000001'); }
  }, [selectedCompany, API_BASE_URL]);

  const fetchNextFoNumber = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/sales/order-slips?company=${encodeURIComponent(selectedCompany)}&limit=500`);
      const data = await res.json();
      const slips = data.data || [];
      
      const foSlips = slips.filter((s: any) => s.osNumber && s.osNumber.startsWith('FO'));
      foSlips.sort((a: any, b: any) => parseInt(b.osNumber.replace(/\D/g, '') || '0', 10) - parseInt(a.osNumber.replace(/\D/g, '') || '0', 10));

      const lastFo = foSlips.length > 0 ? foSlips[0] : null;
      if (lastFo) {
        const match = lastFo.osNumber.match(/(\d+)$/); 
        if (match) {
          const nextNum = parseInt(match[0], 10) + 1;
          const prefix = lastFo.osNumber.substring(0, match.index);
          const padding = match[0].length;
          setFinalOrderNumber(`${prefix}${String(nextNum).padStart(padding, '0')}`);
        } else setFinalOrderNumber('FO-000001');
      } else setFinalOrderNumber('FO-000001');
    } catch (e) { setFinalOrderNumber('FO-000001'); }
  }, [selectedCompany, API_BASE_URL]);

  useEffect(() => { fetchNextOsNumber(); fetchNextFoNumber(); }, [fetchNextOsNumber, fetchNextFoNumber]);

  useEffect(() => {
    fetch(`${API_BASE_URL}/sales/customers?company=${selectedCompany}&limit=100`)
      .then(res => res.json())
      .then(data => {
        const list = Array.isArray(data) ? data : (data.data || []);
        setCustomers(list);
        if (initialCustomerId && list.length > 0) {
          const target = list.find((c: Customer) => c.id === initialCustomerId);
          if (target) { setSelectedCustomer(target); setCustomerSearch(target.name); }
        }
      }).catch(() => {});
  }, [selectedCompany, API_BASE_URL, initialCustomerId]);

  useEffect(() => {
    if (productSearch.trim().length < 2) { setProductSearchResults([]); setHighlightedIndex(-1); return; }
    const handler = setTimeout(async () => {
      setIsSearchingProducts(true);
      try {
        const res = await fetch(`${API_BASE_URL}/sales/order-slips/search-products?company=${selectedCompany}&q=${encodeURIComponent(productSearch)}`);
        if (res.ok) { setProductSearchResults(await res.json()); setHighlightedIndex(-1); }
      } catch (e) {} finally { setIsSearchingProducts(false); }
    }, 50);
    return () => clearTimeout(handler);
  }, [productSearch, selectedCompany, API_BASE_URL]);

  const filteredCustomers = useMemo(() => {
    const query = customerSearch.toLowerCase();
    return customers.filter(c => c.name.toLowerCase().includes(query) || c.company.toLowerCase().includes(query) || c.id.toLowerCase().includes(query));
  }, [customers, customerSearch]);

  const filteredSlips = useMemo(() => {
    const query = loadSlipSearch.toLowerCase();
    return allSlips.filter(s => s.osNumber.toLowerCase().includes(query) || s.customer?.name.toLowerCase().includes(query));
  }, [allSlips, loadSlipSearch]);

  const filteredOsSlips = useMemo(() => filteredSlips.filter(s => s.osNumber.startsWith('OS')), [filteredSlips]);
  const filteredFoSlips = useMemo(() => filteredSlips.filter(s => s.osNumber.startsWith('FO')), [filteredSlips]);

  const handleSelectCustomer = (c: Customer) => { setSelectedCustomer(c); setCustomerSearch(c.name); setShowCustomerDropdown(false); };

  const handleLoadSlip = async (slip: any) => {
    setLoadedOsId(slip.id); setOsNumber(slip.osNumber); setReferenceOs(slip.referenceOs || null); setIsVatApplied(slip.vatApplied || false); setLoadedOsStatus(slip.status || 'Generated');
    if (slip.customer) { setSelectedCustomer(slip.customer); setCustomerSearch(slip.customer.name); }
    
    const mappedItems: DraftItem[] = slip.items.map((i: any) => ({
      id: i.id, 
      productId: i.productId, sku: i.sku, productName: i.productName, requestedQty: Number(i.requestedQty), unitPrice: Number(i.unitPrice), lineTotal: Number(i.lineTotal),
      officeStock: 0, warehouseQty: 0, warehouseBreakdown: [], selectedWarehouseName: null
    }));
    
    setDraftItems(mappedItems);
    setShowLoadSlipDropdown(false); setLoadSlipSearch('');
    
    if (mappedItems.length > 0) {
      const productIds = mappedItems.map(i => i.productId);
      fetch(`${API_BASE_URL}/sales/order-slips/refresh-stock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company: selectedCompany, productIds }) })
        .then(res => res.json()).then(stockMap => {
          setDraftItems(prev => prev.map(item => ({ ...item, officeStock: stockMap[item.productId]?.officeStock ?? 0, warehouseQty: stockMap[item.productId]?.warehouseQty ?? 0, warehouseBreakdown: stockMap[item.productId]?.warehouseBreakdown ?? [] })));
        }).catch(() => {});
    }
    showToast(`Loaded ${slip.osNumber} successfully. Ready to edit.`, "success");
  };

  const handleCustomerKeyDown = (e: React.KeyboardEvent) => {
    if (!showCustomerDropdown || filteredCustomers.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setCustomerHighlightedIndex(prev => (prev < filteredCustomers.length - 1 ? prev + 1 : prev)); } 
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCustomerHighlightedIndex(prev => (prev > 0 ? prev - 1 : 0)); } 
    else if (e.key === 'Enter') { e.preventDefault(); if (customerHighlightedIndex >= 0 && customerHighlightedIndex < filteredCustomers.length) handleSelectCustomer(filteredCustomers[customerHighlightedIndex]); } 
    else if (e.key === 'Escape') { setShowCustomerDropdown(false); setCustomerHighlightedIndex(-1); }
  };

  const handleAddProduct = (p: SearchedProduct) => {
    if (draftItems.some(i => i.productId === p.id)) return showToast("Product already exists in the order.", "error");
    setDraftItems([...draftItems, { productId: p.id, sku: p.sku, productName: p.name, officeStock: p.officeStock, warehouseQty: p.warehouseQty, warehouseBreakdown: p.warehouseBreakdown || [], selectedWarehouseName: null, requestedQty: 1, unitPrice: p.sellingPrice || 0, lineTotal: p.sellingPrice || 0 }]);
    setProductSearch(''); setShowProductDropdown(false); setProductSearchResults([]); setHighlightedIndex(-1);
    setTimeout(() => { const input = document.getElementById(`qty-input-${p.id}`) as HTMLInputElement; if (input) { input.focus(); input.select(); } }, 50);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (!showProductDropdown || productSearchResults.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightedIndex(prev => (prev < productSearchResults.length - 1 ? prev + 1 : prev)); } 
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlightedIndex(prev => (prev > 0 ? prev - 1 : 0)); } 
    else if (e.key === 'Enter') { e.preventDefault(); if (highlightedIndex >= 0 && highlightedIndex < productSearchResults.length) handleAddProduct(productSearchResults[highlightedIndex]); } 
    else if (e.key === 'Escape') { setShowProductDropdown(false); setHighlightedIndex(-1); }
  };

  // --- CRITICAL FIX: Safe Quantity Handler ---
  const handleUpdateQty = (index: number, val: string) => {
    // Clean input to only allow digits (no letters or decimals)
    const cleanVal = val.replace(/\D/g, '');

    setDraftItems(prev => prev.map((item, i) => {
      if (i !== index) return item;
      if (cleanVal === '') return { ...item, requestedQty: '', lineTotal: 0 };
      
      const qty = parseInt(cleanVal, 10);
      const price = Number(item.unitPrice) || 0;
      return { ...item, requestedQty: qty, lineTotal: qty * price };
    }));
  };

  // --- CRITICAL FIX: Safe Unit Price Handler ---
  const handleUpdateUnitPrice = (index: number, val: string) => {
    // Clean input to allow only numbers and a single decimal point
    const cleanVal = val.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');

    setDraftItems(prev => prev.map((item, i) => {
      if (i !== index) return item;
      if (cleanVal === '') return { ...item, unitPrice: '', lineTotal: 0 };
      
      const priceFloat = parseFloat(cleanVal);
      const safePrice = isNaN(priceFloat) ? 0 : priceFloat;
      const qty = Number(item.requestedQty) || 0;
      
      return { ...item, unitPrice: cleanVal, lineTotal: qty * safePrice };
    }));
  };

  const handleSelectWarehouse = (index: number, warehouseName: string | null) => {
    setDraftItems(prev => prev.map((item, i) => {
      if (i !== index) return item;
      return { ...item, selectedWarehouseName: warehouseName };
    }));
  };

  const handleRemoveItem = (index: number) => {
    setDraftItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleRefreshStock = async () => {
    if (draftItems.length === 0) return;
    setIsRefreshingStock(true);
    try {
      const productIds = draftItems.map(i => i.productId);
      const res = await fetch(`${API_BASE_URL}/sales/order-slips/refresh-stock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company: selectedCompany, productIds }) });
      if (!res.ok) throw new Error();
      const stockMap = await res.json();
      setDraftItems(prev => prev.map(item => ({ ...item, officeStock: stockMap[item.productId]?.officeStock ?? item.officeStock, warehouseQty: stockMap[item.productId]?.warehouseQty ?? item.warehouseQty, warehouseBreakdown: stockMap[item.productId]?.warehouseBreakdown ?? item.warehouseBreakdown })));
    } catch (e) { console.warn("Failed to refresh stock.", e); } finally { setIsRefreshingStock(false); }
  };

  const subtotal = Math.round(draftItems.reduce((acc, item) => acc + (item.lineTotal || 0), 0) * 100) / 100;
  const vatAmount = isVatApplied ? Math.round((subtotal * vatRate) * 100) / 100 : 0;
  const grandTotal = Math.round((subtotal + vatAmount) * 100) / 100;
  
  const isFormValid = selectedCustomer && osNumber.trim() !== '' && draftItems.length > 0 && draftItems.every(i => {
    const q = Number(i.requestedQty);
    const p = Number(i.unitPrice);
    return !isNaN(q) && q > 0 && !isNaN(p) && i.unitPrice !== '';
  });

  const handleStatusChangeWithStockRestore = async (newStatus: 'Cancelled' | 'Returned') => {
    if (!loadedOsId) return;
    
    const isFO = osNumber.startsWith('FO');
    let confirmMsg = `Are you sure you want to mark this document as ${newStatus}?`;

    if (!isFO) {
      confirmMsg = `Notice: Marking an OS as ${newStatus} is safe. However, if a Final Order was generated from this OS, the backend will strictly block this action until the Final Order is cancelled first. Proceed?`;
    } else {
      confirmMsg = `Marking this Final Order as ${newStatus} will safely restore deducted stock to the Office. Proceed?`;
    }

    if (!window.confirm(confirmMsg)) return;

    setIsProcessing(true);
    try {
      const res = await fetch(`${API_BASE_URL}/sales/order-slips/${loadedOsId}`, { 
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: newStatus, user: loginUsername }) 
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || `Failed to mark as ${newStatus}.`);
      }

      await handleRefreshStock(); 
      showToast(`Order marked as ${newStatus}!`, "success");
      handleClosePrintModal(); 
    } catch (e: any) { showToast(e.message || "Failed to process cancellation.", "error"); } finally { setIsProcessing(false); }
  };

  const handleSubmit = async () => {
    if (!isFormValid) return showToast("Complete all required fields and item quantities.", "error");
    setIsProcessing(true);
    try {
      const payload = {
        osNumber: osNumber.trim(), company: selectedCompany, customerId: selectedCustomer.id, isVatApplied, vatRate, 
        subtotal, vatAmount, grandTotal, user: loginUsername, referenceOs: referenceOs || null,
        items: draftItems.map(i => ({ productId: i.productId, sku: i.sku, productName: i.productName, requestedQty: Number(i.requestedQty), unitPrice: Number(i.unitPrice), lineTotal: Number(i.lineTotal) }))
      };
      
      const res = await fetch(`${API_BASE_URL}/sales/order-slips`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error("Failed to create Order Slip.");
      
      const newlyCreatedOs = await res.json();
      showToast("Order Slip generated successfully.", "success");
      setFinalizedOs(newlyCreatedOs); setFinalOrderGenerated(false); setLoadedOsId(null); setLoadedOsStatus('Generated');
      fetchNextOsNumber(); fetchNextFoNumber();
    } catch (e: any) { showToast(e.message || "Network error. Please try again.", "error"); } finally { setIsProcessing(false); }
  };

  const handleUpdateOrder = async () => {
    if (!isFormValid || !loadedOsId) return showToast("Complete all required fields and item quantities.", "error");
    setIsProcessing(true);
    try {
      const payload = {
        user: loginUsername, status: loadedOsStatus, isVatApplied, vatRate, subtotal, vatAmount, grandTotal,
        items: draftItems.map(i => ({ 
          id: i.id, 
          productId: i.productId, sku: i.sku, productName: i.productName, requestedQty: Number(i.requestedQty), unitPrice: Number(i.unitPrice), lineTotal: Number(i.lineTotal) 
        }))
      };
      
      const res = await fetch(`${API_BASE_URL}/sales/order-slips/${loadedOsId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error("Failed to update Order Slip.");
      
      const updatedOs = await res.json();
      await handleRefreshStock(); 
      showToast("Order updated successfully.", "success");
      setFinalizedOs(updatedOs); setFinalOrderGenerated(updatedOs.osNumber.startsWith('FO'));
      fetchNextOsNumber(); fetchNextFoNumber();
    } catch (e: any) { showToast(e.message || "Network error. Please try again.", "error"); } finally { setIsProcessing(false); }
  };

  const handleGenerateFinalOrder = async () => {
    if (!finalizedOs) return;
    if (!finalOrderNumber.trim()) return showToast("Please enter a valid Final Order Number", "error");

    setIsGeneratingFinalOrder(true);
    try {
      const payload = {
        osNumber: finalOrderNumber.trim(), 
        referenceOs: finalizedOs.osNumber, 
        company: selectedCompany, 
        customerId: selectedCustomer?.id || finalizedOs.customerId,
        isVatApplied: finalizedOs.isVatApplied ?? finalizedOs.vatApplied ?? isVatApplied, 
        vatRate: finalizedOs.vatRate || vatRate, 
        subtotal: finalizedOs.subtotal || subtotal, 
        vatAmount: finalizedOs.vatAmount || vatAmount, 
        grandTotal: finalizedOs.grandTotal || grandTotal, 
        user: loginUsername,
        items: finalizedOs.items.map((i: any) => ({ 
            productId: i.productId, 
            sku: i.sku, 
            productName: i.productName, 
            requestedQty: Number(i.requestedQty), 
            unitPrice: Number(i.unitPrice), 
            lineTotal: Number(i.lineTotal) 
        }))
      };

      const res = await fetch(`${API_BASE_URL}/sales/order-slips`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      
      if (!res.ok) {
        let errDesc = "Failed to create Final Order in Database.";
        try { const d = await res.json(); if (d.message) errDesc = d.message; } catch(e){}
        throw new Error(errDesc);
      }
      
      const newFo = await res.json();

      try {
        await fetch(`${API_BASE_URL}/sales/order-slips/${finalizedOs.id}`, { 
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'Finalized Order', user: loginUsername }) 
        });
      } catch (patchErr) {
        console.warn("Could not patch original OS status, but FO was generated.");
      }

      await handleRefreshStock(); 
      showToast("Final Order logged & Stock Deducted instantly!", "success");
      
      const completeFo = { ...newFo, customer: selectedCustomer || finalizedOs.customer };
      
      setFinalizedOs(completeFo); 
      setFinalOrderGenerated(true); 
      setOsNumber(completeFo.osNumber); 
      setLoadedOsId(completeFo.id);
      fetchNextFoNumber();
    } catch (e: any) { 
      showToast(e.message || "Failed to generate Final Order.", "error"); 
    } finally { 
      setIsGeneratingFinalOrder(false); 
    }
  };

  const handleClosePrintModal = () => {
    setFinalizedOs(null); setFinalOrderGenerated(false); setDraftItems([]); setSelectedCustomer(null); setCustomerSearch(''); setIsVatApplied(false); setReferenceOs(null); setLoadedOsId(null); setLoadedOsStatus('Generated');
    fetchNextOsNumber();
  };

  const handlePrint = () => window.print();

  return (
    <div className="flex flex-col h-screen w-full bg-[#F8FAFC] font-sans text-slate-900 overflow-hidden print:h-auto print:overflow-visible">
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[100] px-5 py-3.5 rounded-xl shadow-xl font-bold text-sm ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'} print:hidden`}>
          {toast.message}
        </div>
      )}

      <header className="h-16 sm:h-20 bg-white border-b border-slate-200 flex items-center justify-between px-6 sm:px-8 shrink-0 shadow-sm z-20 print:hidden">
        <div><h2 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight">Enterprise ERP <span className="text-slate-400 font-medium">| Create Order Slip</span></h2></div>
        <div className="flex gap-3">
          <button onClick={() => { if (onViewLedger) onViewLedger(); else if (setActiveTab) setActiveTab('os-ledger'); }} className="px-4 sm:px-5 py-2 sm:py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl text-[10px] sm:text-xs font-bold uppercase tracking-wider transition-colors shadow-sm cursor-pointer z-50 relative">
            Records Ledger
          </button>
          <button onClick={onBack} className="px-4 sm:px-5 py-2 sm:py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-[10px] sm:text-xs font-bold uppercase tracking-wider transition-colors shadow-sm border border-slate-200">
            Back to Gateway
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col p-4 sm:p-6 lg:p-8 overflow-hidden print:hidden">
        <div className="flex-1 flex flex-col w-full mx-auto bg-white border border-slate-300 rounded-xl shadow-lg overflow-hidden">
          
          <div className="border-b border-slate-300 bg-white relative shrink-0 z-30 flex items-stretch min-h-[56px]">
            <div className="w-48 sm:w-64 border-r border-slate-300 relative flex flex-col justify-center px-4 sm:px-6 bg-slate-50">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Load Template</span>
              <input 
                type="text" placeholder="Search OS/FO..." value={loadSlipSearch}
                onChange={e => { setLoadSlipSearch(e.target.value); setShowLoadSlipDropdown(true); }}
                onFocus={() => setShowLoadSlipDropdown(true)}
                onBlur={() => setTimeout(() => setShowLoadSlipDropdown(false), 200)}
                className="w-full bg-transparent font-mono font-bold text-slate-700 text-xs outline-none placeholder:text-slate-300 focus:text-indigo-600 transition-colors uppercase"
              />
              {showLoadSlipDropdown && filteredSlips.length > 0 && (
                <div className="absolute top-full left-0 mt-1 w-[350px] bg-white border border-slate-200 rounded-xl shadow-2xl max-h-64 overflow-y-auto z-50">
                  {filteredOsSlips.length > 0 && <div className="px-4 py-2 bg-slate-100 text-[10px] font-black text-slate-500 uppercase tracking-widest sticky top-0 border-b border-slate-200">Order Slips</div>}
                  {filteredOsSlips.map((slip) => (
                    <div key={slip.id} onMouseDown={(e) => { e.preventDefault(); handleLoadSlip(slip); }} className="px-5 py-3 hover:bg-indigo-50 border-b border-slate-50 cursor-pointer flex justify-between items-center transition-colors">
                      <div><span className="font-bold text-slate-900 block font-mono">{slip.osNumber}</span><span className="text-[10px] text-slate-500 uppercase font-bold">{slip.customer?.name}</span></div>
                      <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${slip.status === 'Finalized Order' ? 'bg-teal-100 text-teal-800' : 'bg-indigo-100 text-indigo-700'}`}>{slip.status}</span>
                    </div>
                  ))}
                  {filteredFoSlips.length > 0 && <div className="px-4 py-2 bg-teal-50 text-[10px] font-black text-teal-700 uppercase tracking-widest sticky top-0 border-b border-teal-100">Final Orders</div>}
                  {filteredFoSlips.map((slip) => (
                    <div key={slip.id} onMouseDown={(e) => { e.preventDefault(); handleLoadSlip(slip); }} className="px-5 py-3 hover:bg-teal-50/50 border-b border-slate-50 cursor-pointer flex justify-between items-center transition-colors">
                      <div><span className="font-bold text-slate-900 block font-mono">{slip.osNumber}</span><span className="text-[10px] text-slate-500 uppercase font-bold">Ref: {slip.referenceOs}</span></div>
                      <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded bg-teal-100 text-teal-800">{slip.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex-1 relative flex items-center border-r border-slate-300">
              {!selectedCustomer ? (
                <div className="w-full relative">
                  <input 
                    type="text" placeholder="Search customer..." value={customerSearch}
                    onChange={e => { setCustomerSearch(e.target.value); setShowCustomerDropdown(true); setCustomerHighlightedIndex(-1); }}
                    onFocus={() => setShowCustomerDropdown(true)}
                    onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 200)}
                    onKeyDown={handleCustomerKeyDown}
                    className="w-full text-center py-4 bg-transparent text-sm font-medium outline-none placeholder:text-slate-400 placeholder:uppercase placeholder:tracking-widest focus:bg-indigo-50/30 transition-colors uppercase"
                  />
                  {showCustomerDropdown && (
                    <div ref={customerDropdownRef} className="absolute top-full left-1/2 -translate-x-1/2 mt-1 w-[90%] max-w-lg bg-white border border-slate-200 rounded-xl shadow-2xl max-h-64 overflow-y-auto z-40">
                      {filteredCustomers.length === 0 ? <div className="p-4 text-slate-500 text-sm font-medium text-center">No matching customers found.</div> : filteredCustomers.map((c, i) => (
                        <div key={c.id} onMouseDown={(e) => { e.preventDefault(); handleSelectCustomer(c); }} onMouseEnter={() => setCustomerHighlightedIndex(i)} className={`px-5 py-3 border-b border-slate-50 cursor-pointer flex justify-between items-center transition-colors ${customerHighlightedIndex === i ? 'bg-indigo-50' : 'hover:bg-indigo-50 bg-white'}`}>
                          <div><span className="font-bold text-slate-900 block uppercase">{c.name}</span></div>
                          <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">{c.company}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="w-full flex items-center justify-center py-4 relative group cursor-pointer" onClick={() => { setSelectedCustomer(null); setCustomerSearch(''); setReferenceOs(null); setLoadedOsId(null); setLoadedOsStatus('Generated'); fetchNextOsNumber(); }}>
                  <div className="flex flex-col items-center">
                    <span className="text-lg font-black text-indigo-900 tracking-tight uppercase">{selectedCustomer.name}</span>
                    {referenceOs && <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Ref: {referenceOs}</span>}
                  </div>
                  <span className="absolute right-6 text-xs font-bold text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity">✕ Remove</span>
                </div>
              )}
            </div>

            <div className="w-48 sm:w-64 bg-slate-50 flex flex-col justify-center px-4 sm:px-6 shrink-0 shadow-inner">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">{osNumber.startsWith('FO') ? 'F.O. Number' : 'O.S. Number'}</span>
              <input 
                type="text" value={osNumber} readOnly={loadedOsId !== null} 
                onChange={e => setOsNumber(e.target.value.toUpperCase())}
                className={`w-full bg-transparent font-mono font-black text-sm sm:text-base outline-none transition-colors uppercase ${osNumber.startsWith('FO') ? 'text-teal-600 focus:text-teal-500' : 'text-indigo-700 focus:text-indigo-500'} ${loadedOsId !== null ? 'opacity-70 cursor-not-allowed' : ''}`}
                placeholder="OS-000000"
              />
            </div>
          </div>

          <div className="flex-1 overflow-auto bg-slate-50/30 relative flex flex-col">
            <table className="w-full text-left border-collapse whitespace-nowrap text-sm min-w-[900px] flex-1">
              <thead className="sticky top-0 bg-slate-50 shadow-sm z-20">
                <tr>
                  <th className="border border-slate-300 py-3 px-4 font-black text-slate-500 uppercase tracking-widest text-[10px] w-40">SKU</th>
                  <th className="border border-slate-300 py-3 px-4 font-black text-slate-500 uppercase tracking-widest text-[10px] w-full">PRODUCT DESCRIPTION<button onClick={handleRefreshStock} disabled={isRefreshingStock || draftItems.length === 0} className="ml-3 text-indigo-500 hover:text-indigo-700 disabled:opacity-30">{isRefreshingStock ? '↻...' : '↻ SYNC'}</button></th>
                  <th className="border border-slate-300 py-3 px-4 font-black text-slate-500 uppercase tracking-widest text-[10px] text-center w-24">OFF QTY</th>
                  <th className="border border-slate-300 py-3 px-4 font-black text-indigo-600 uppercase tracking-widest text-[10px] text-center w-32 bg-indigo-50/50">REQUESTED</th>
                  <th className="border border-slate-300 py-3 px-4 font-black text-slate-500 uppercase tracking-widest text-[10px] text-right w-36">UNIT PRICE</th>
                  <th className="border border-slate-300 py-3 px-4 font-black text-slate-500 uppercase tracking-widest text-[10px] text-right w-36">LINE TOTAL</th>
                  <th className="border border-slate-300 py-3 px-4 font-black text-slate-500 uppercase tracking-widest text-[10px] text-center w-32">WHSE QTY</th>
                  <th className="border border-slate-300 py-3 px-3 w-10 text-center"></th>
                </tr>
              </thead>
              <tbody className="bg-white">
                {draftItems.map((item, idx) => {
                  const reqQty = Number(item.requestedQty) || 0;
                  const effectiveWhseQty = item.selectedWarehouseName ? (item.warehouseBreakdown.find(wb => wb.name === item.selectedWarehouseName)?.quantity || 0) : item.warehouseQty;

                  return (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="border border-slate-300 py-2.5 px-4 font-mono text-sm font-bold text-slate-900 uppercase">{item.sku}</td>
                      <td className="border border-slate-300 py-2.5 px-4 truncate max-w-0 w-full font-bold text-slate-900 uppercase">{item.productName}</td>
                      <td className={`border border-slate-300 py-2.5 px-4 text-center font-black ${item.officeStock > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{item.officeStock}</td>
                      
                      <td className="border border-slate-300 p-0 bg-indigo-50/20 relative">
                        {/* TYPE="TEXT" FOR QTY FIX */}
                        <input id={`qty-input-${item.productId}`} type="text" inputMode="numeric" placeholder="0" value={item.requestedQty} onChange={e => handleUpdateQty(idx, e.target.value)} className="w-full h-full px-2 py-3 text-center font-black text-indigo-700 bg-transparent outline-none focus:bg-indigo-50 focus:ring-2 focus:ring-indigo-500 transition-all" />
                        {item.officeStock !== undefined && reqQty > item.officeStock && <span className="absolute bottom-0 left-0 right-0 text-center text-rose-600 font-bold text-[8px] uppercase tracking-widest bg-rose-50">Short {reqQty - item.officeStock}</span>}
                      </td>

                      <td className="border border-slate-300 p-0 relative bg-white">
                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-medium">₱</div>
                        {/* TYPE="TEXT" FOR DECIMAL PRICE FIX */}
                        <input type="text" inputMode="decimal" value={item.unitPrice} onChange={e => handleUpdateUnitPrice(idx, e.target.value)} className="w-full h-[48px] pl-6 pr-4 py-3 text-right font-medium text-slate-700 font-mono bg-transparent outline-none focus:bg-indigo-50 focus:ring-2 focus:ring-indigo-500 transition-all" />
                      </td>

                      <td className="border border-slate-300 py-2.5 px-4 text-right font-black text-slate-900 font-mono">₱{(item.lineTotal || 0).toLocaleString('en-PH', {minimumFractionDigits: 2})}</td>

                      <td className={`border border-slate-300 py-1.5 px-2 text-center relative group`}>
                        <div className="inline-flex flex-col items-center justify-center cursor-pointer hover:bg-slate-100 p-1 rounded transition-colors w-full">
                          <span className={`font-black text-sm leading-none ${effectiveWhseQty > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{effectiveWhseQty}</span>
                          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1 truncate max-w-full">{item.selectedWarehouseName || 'All Whse'}</span>
                        </div>
                        {item.warehouseBreakdown && item.warehouseBreakdown.length > 0 && (
                          <div className="absolute top-full right-0 mt-0.5 w-48 bg-slate-900 text-white rounded-lg shadow-xl p-2 z-30 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
                            <div className="space-y-0.5 max-h-40 overflow-y-auto">
                              <button onClick={() => handleSelectWarehouse(idx, null)} className={`w-full flex justify-between items-center text-xs px-2 py-1.5 rounded hover:bg-slate-800 transition-colors ${!item.selectedWarehouseName ? 'bg-slate-800 text-emerald-400' : 'text-slate-300'}`}><span className="truncate pr-2 font-medium">All Whse</span><span className="font-black shrink-0">{item.warehouseQty}</span></button>
                              {item.warehouseBreakdown.map((wb, i) => (
                                <button key={i} onClick={() => handleSelectWarehouse(idx, wb.name)} className={`w-full flex justify-between items-center text-xs px-2 py-1.5 rounded hover:bg-slate-800 transition-colors ${item.selectedWarehouseName === wb.name ? 'bg-slate-800 text-emerald-400' : 'text-slate-300'}`}><span className="truncate pr-2 font-medium">{wb.name}</span><span className="font-black shrink-0">{wb.quantity}</span></button>
                              ))}
                            </div>
                          </div>
                        )}
                      </td>

                      <td className="border border-slate-300 py-2.5 px-3 text-center">
                        <button type="button" onClick={() => handleRemoveItem(idx)} className="text-slate-300 hover:text-rose-500 font-black transition-colors bg-slate-50 hover:bg-rose-50 p-1.5 rounded-md">✕</button>
                      </td>
                    </tr>
                  );
                })}

                <tr className="bg-white group">
                  <td className="border border-slate-300 bg-slate-50/50 h-[48px]"></td>
                  <td className="border border-slate-300 relative p-0 h-[48px] w-full">
                    <div className="absolute inset-0 flex items-center">
                      <input 
                        type="text" placeholder={draftItems.length === 0 ? "Search to add first product..." : "Add another product..."} value={productSearch}
                        onChange={e => { setProductSearch(e.target.value); setShowProductDropdown(true); }}
                        onFocus={() => setShowProductDropdown(true)}
                        onBlur={() => setTimeout(() => setShowProductDropdown(false), 200)}
                        onKeyDown={handleSearchKeyDown}
                        disabled={!selectedCustomer}
                        className="w-full h-full px-4 bg-transparent text-sm font-medium outline-none placeholder:text-slate-400 placeholder:italic disabled:opacity-30 focus:bg-indigo-50/30 transition-colors uppercase"
                      />
                    </div>
                    {showProductDropdown && productSearch.trim().length >= 2 && !isSearchingProducts && (
                      <div ref={searchDropdownRef} className="absolute top-full left-0 mt-1 w-[400px] bg-white border border-slate-300 rounded-lg shadow-2xl max-h-72 overflow-y-auto z-40">
                        {productSearchResults.map((p, i) => (
                          <div key={p.id} onMouseDown={(e) => { e.preventDefault(); handleAddProduct(p); }} onMouseEnter={() => setHighlightedIndex(i)} className={`px-4 py-3 border-b border-slate-100 cursor-pointer flex justify-between items-center transition-colors ${highlightedIndex === i ? 'bg-indigo-50' : 'hover:bg-indigo-50 bg-white'}`}>
                            <div><span className="font-bold text-slate-900 uppercase block">{p.name}</span><span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">{p.sku}</span></div>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="border border-slate-300 bg-slate-50/50"></td><td className="border border-slate-300 bg-slate-50/50"></td><td className="border border-slate-300 bg-slate-50/50"></td><td className="border border-slate-300 bg-slate-50/50"></td><td className="border border-slate-300 bg-slate-50/50"></td><td className="border border-slate-300 bg-slate-50/50"></td>
                </tr>
                <tr className="bg-slate-50/10 h-full">
                  <td className="border border-slate-300 h-full"></td><td className="border border-slate-300"></td><td className="border border-slate-300"></td><td className="border border-slate-300"></td><td className="border border-slate-300"></td><td className="border border-slate-300"></td><td className="border border-slate-300"></td><td className="border border-slate-300"></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="bg-[#E2E8F0] border-t border-slate-300 p-4 sm:p-5 flex flex-col sm:flex-row justify-between items-center shrink-0 z-30">
            <div className="flex items-center gap-6 w-full sm:w-auto">
              <label className="flex items-center gap-2 cursor-pointer group">
                <input type="checkbox" checked={isVatApplied} onChange={e => setIsVatApplied(e.target.checked)} className="w-4 h-4 rounded text-indigo-600 border-slate-400 focus:ring-indigo-500 cursor-pointer" />
                <span className="font-bold text-slate-700 group-hover:text-slate-900 transition-colors text-xs tracking-widest uppercase">Apply VAT</span>
              </label>
              <div className="text-xs font-bold text-slate-600 uppercase tracking-widest border-l border-slate-400 pl-6">
                VAT: <span className="font-mono ml-1">₱{vatAmount.toLocaleString('en-PH', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
              </div>
            </div>

            <div className="flex items-center gap-3 mt-4 sm:mt-0 w-full sm:w-auto justify-between sm:justify-end">
              <div className="text-sm font-black text-slate-800 uppercase tracking-widest mr-4">
                Total: <span className="font-mono text-xl ml-2">₱{grandTotal.toLocaleString('en-PH', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
              </div>
              
              {loadedOsId && loadedOsStatus !== 'Cancelled' && loadedOsStatus !== 'Returned' && (
                <>
                  <button onClick={() => handleStatusChangeWithStockRestore('Returned')} disabled={isProcessing} className="px-5 py-3 bg-amber-100 hover:bg-amber-200 disabled:opacity-50 text-amber-800 font-black text-xs uppercase tracking-widest rounded-lg transition-colors shadow-sm">Return</button>
                  <button onClick={() => handleStatusChangeWithStockRestore('Cancelled')} disabled={isProcessing} className="px-5 py-3 bg-rose-100 hover:bg-rose-200 disabled:opacity-50 text-rose-800 font-black text-xs uppercase tracking-widest rounded-lg transition-colors shadow-sm">Cancel</button>
                </>
              )}

              {loadedOsId ? (
                <button onClick={handleUpdateOrder} disabled={!isFormValid || isProcessing || loadedOsStatus === 'Cancelled' || loadedOsStatus === 'Returned'} className="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400 text-white font-black text-xs uppercase tracking-widest rounded-lg transition-colors shadow-sm">
                  {isProcessing ? 'Updating...' : (osNumber.startsWith('FO') ? 'Update F.O.' : 'Update O.S.')}
                </button>
              ) : (
                <button onClick={handleSubmit} disabled={!isFormValid || isProcessing} className="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400 text-white font-black text-xs uppercase tracking-widest rounded-lg transition-colors shadow-sm">
                  {isProcessing ? 'Saving...' : 'Finalize O.S.'}
                </button>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* FINALIZED PRINT MODAL */}
      {finalizedOs && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[250] flex justify-center p-4 sm:p-8 overflow-hidden print:static print:inset-auto print:p-0 print:bg-white print:block print:overflow-visible print:h-auto">
          <style type="text/css" media="print">{`@page { size: auto; margin: 0; }`}</style>
          
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl my-auto print:shadow-none print:m-0 print:rounded-none flex flex-col max-h-full print:max-h-none print:block print:h-auto print:overflow-visible">
            
            <div className="p-6 border-b border-emerald-100 flex justify-between items-center bg-emerald-50 shrink-0 print:hidden rounded-t-2xl">
              <div>
                <h3 className="text-xl font-black text-emerald-900 tracking-tight">
                  {loadedOsId ? (finalizedOs.osNumber.startsWith('FO') ? 'F.O. Updated Successfully!' : 'O.S. Updated Successfully!') : 'O.S. Generated Successfully!'}
                </h3>
                <p className="text-xs font-mono uppercase text-emerald-600 tracking-widest mt-1">Ready for immediate printing.</p>
              </div>
              <div className="flex gap-3">
                {!finalOrderGenerated && finalizedOs.osNumber.startsWith('OS') ? (
                  <div className="flex items-center gap-2 bg-teal-50 p-2 rounded-xl border-2 border-teal-200 shadow-sm mr-2">
                    <input type="text" value={finalOrderNumber} onChange={(e) => setFinalOrderNumber(e.target.value.toUpperCase())} className="w-36 px-3 py-2 text-sm font-mono font-black text-slate-900 bg-white border-2 border-teal-400 rounded-lg outline-none focus:border-teal-600 uppercase placeholder:text-slate-400 placeholder:font-medium" placeholder="FO-000000" />
                    <button onClick={handleGenerateFinalOrder} disabled={isGeneratingFinalOrder || !finalOrderNumber} className="px-5 py-2.5 bg-teal-600 text-white text-[11px] font-black uppercase tracking-widest rounded-lg hover:bg-teal-700 disabled:bg-slate-400 shadow-sm transition-colors">
                      {isGeneratingFinalOrder ? 'Gen...' : 'Gen Final Order'}
                    </button>
                  </div>
                ) : finalOrderGenerated ? (
                  <span className="px-5 py-2.5 bg-teal-200 text-teal-800 text-[10px] font-black uppercase tracking-widest rounded-xl shadow-sm border border-teal-300 flex items-center">✓ FINAL ORDER LOGGED</span>
                ) : null}
                <button onClick={handlePrint} className="px-5 py-2.5 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-indigo-700 shadow-sm transition-colors">Print {finalizedOs.osNumber.startsWith('FO') ? 'F.O.' : 'O.S.'}</button>
                <button onClick={handleClosePrintModal} className="px-4 py-2.5 bg-white border border-slate-300 text-slate-700 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-slate-50 shadow-sm transition-colors">Close & Start New</button>
              </div>
            </div>

            {/* PRINT CONTAINER */}
            <div className="p-8 print:pt-4 print:px-8 print:pb-4 bg-white flex-1 overflow-y-auto print:overflow-visible print:block relative">
              
              {(finalizedOs.status === 'Cancelled' || finalizedOs.status === 'Returned') && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-50 opacity-25 mix-blend-multiply">
                  <div className="text-[120px] font-black text-rose-600 uppercase tracking-tighter rotate-[-30deg] border-8 border-rose-600 px-12 py-4 rounded-3xl">{finalizedOs.status}</div>
                </div>
              )}

              <div className="relative z-10">
                {/* Top Header - Company & Title */}
                <div className="flex justify-between items-end border-b-2 border-slate-900 pb-3 mb-6">
                  <h1 className="text-3xl print:text-2xl font-black text-slate-900 uppercase tracking-widest leading-none">
                    {selectedCompany}
                  </h1>
                  <h2 className="text-lg font-black text-slate-900 uppercase tracking-widest leading-none">
                    {finalizedOs.osNumber.startsWith('FO') ? 'Final Order' : 'Order Slip'}
                  </h2>
                </div>
                
                {/* Billed To (Left) & OS Number (Right) */}
                <div className="flex justify-between items-start mb-6">
                  
                  <div className="text-left flex flex-col items-start">
                    <h4 className="text-[11px] font-black text-slate-800 uppercase tracking-widest mb-0.5">Billed To</h4>
                    <div className="font-black text-base text-black uppercase leading-tight">{finalizedOs.customer?.name || 'Unknown Customer'}</div>
                  </div>

                  <div className="text-right flex flex-col items-end">
                    <h2 className={`text-2xl font-mono font-black leading-none ${finalizedOs.osNumber.startsWith('FO') ? 'text-teal-700' : 'text-indigo-700'}`}>{finalizedOs.osNumber}</h2>
                    {finalizedOs.osNumber.startsWith('FO') && finalizedOs.referenceOs && (
                      <div className="mt-1 inline-block bg-slate-100 border border-slate-300 px-2 py-0.5 rounded-md text-[10px] font-black text-slate-600 tracking-widest uppercase">REF: {finalizedOs.referenceOs}</div>
                    )}
                    <p className="text-xs font-bold text-slate-500 mt-2 uppercase tracking-widest">
                      Date: {new Date(finalizedOs.createdAt).toLocaleDateString()} &nbsp; Time: {new Date(finalizedOs.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>

                </div>

                {/* Highly Legible & Compacted Table */}
                <table className="w-full text-left mb-6 border-collapse bg-white">
                  <thead className="border-y-2 border-black bg-slate-50/50 print:bg-transparent">
                    <tr>
                      <th className="py-2 px-2 font-black text-black uppercase text-[11px] tracking-wider w-32">SKU</th>
                      <th className="py-2 px-2 font-black text-black uppercase text-[11px] tracking-wider">Description</th>
                      <th className="py-2 px-2 font-black text-black uppercase text-[11px] tracking-wider text-center w-16">Qty</th>
                      <th className="py-2 px-2 font-black text-black uppercase text-[11px] tracking-wider text-right w-28">Unit Price</th>
                      <th className="py-2 px-2 font-black text-black uppercase text-[11px] tracking-wider text-right w-32">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-300 print:divide-slate-400">
                    {finalizedOs.items.map((item: any, idx: number) => (
                      <tr key={idx}>
                        <td className="py-2 px-2 font-mono text-[13px] font-black text-black uppercase">{item.sku}</td>
                        <td className="py-2 px-2 font-bold text-[13px] text-black uppercase leading-tight">{item.productName}</td>
                        <td className="py-2 px-2 text-center font-black text-[13px] text-black">{item.requestedQty}</td>
                        <td className="py-2 px-2 text-right font-mono text-[13px] font-bold text-black">₱{Number(item.unitPrice).toLocaleString('en-PH', {minimumFractionDigits:2})}</td>
                        <td className="py-2 px-2 text-right font-black font-mono text-[13px] text-black">₱{Number(item.lineTotal).toLocaleString('en-PH', {minimumFractionDigits:2})}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="flex justify-end border-t-2 border-slate-900 pt-4">
                  <div className="w-64 space-y-2">
                    <div className="flex justify-between text-xs font-bold text-slate-900"><span>Subtotal:</span><span className="font-mono text-sm">₱{Number(finalizedOs.subtotal).toLocaleString('en-PH', {minimumFractionDigits:2})}</span></div>
                    <div className="flex justify-between text-xs font-bold text-slate-900 border-b border-slate-300 pb-2"><span>VAT (12%):</span><span className="font-mono text-sm">₱{Number(finalizedOs.vatAmount).toLocaleString('en-PH', {minimumFractionDigits:2})}</span></div>
                    <div className="flex justify-between text-base font-black text-black pt-1"><span>Total:</span><span className={`font-mono text-xl ${finalizedOs.osNumber.startsWith('FO') ? 'text-teal-800' : 'text-indigo-800'}`}>₱{Number(finalizedOs.grandTotal).toLocaleString('en-PH', {minimumFractionDigits:2})}</span></div>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-200 bg-slate-50 print:hidden flex justify-between items-center rounded-b-2xl shrink-0">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Prepared by: {finalizedOs.createdBy}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}