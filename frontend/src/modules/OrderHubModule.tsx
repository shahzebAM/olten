import React, { useState, useEffect } from 'react';

// --- INTERFACES ---
interface Partner { id: string; name: string; contact: string; phone: string; email: string; address?: string; creditLimit?: number; balance: number; }
interface OrderItem { id?: string; productId: number; sku: string; productName: string; quantity: number; unitPrice: number; total: number; isCancelled?: boolean; cancelReason?: string; }
interface Transaction { id: string; refNumber: string; partnerId: string; partner: Partner; date: string; status: string; totalAmount: number; items: OrderItem[]; user: string; }
interface Product { id: number; name: string; sku: string; purchasePrice: number; currentStock: number; reorderLevel: number; }

export default function OrderHubModule({ selectedCompany, loginUsername, API_BASE_URL, onBack, initialMode = 'sales' }: any) {
  
  const [mode, setMode] = useState<'sales' | 'purchasing'>(initialMode);
  const [activeTab, setActiveTab] = useState<'draft' | 'verify' | 'pending' | 'history'>('draft');
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Core Data
  const [customers, setCustomers] = useState<Partner[]>([]);
  const [suppliers, setSuppliers] = useState<Partner[]>([]);
  const [salesOrders, setSalesOrders] = useState<Transaction[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<Transaction[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  // Draft States
  const [draftForm, setDraftForm] = useState({ partnerId: '', refNumber: '' });
  const [draftItems, setDraftItems] = useState<OrderItem[]>([]);
  
  // Modals
  const [showItemModal, setShowItemModal] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [tempSelectedItems, setTempSelectedItems] = useState<Record<number, { checked: boolean, qty: number, price: number }>>({});
  
  // Action Modal States
  const [editModal, setEditModal] = useState<{ isOpen: boolean, order: Transaction | null, items: OrderItem[] }>({ isOpen: false, order: null, items: [] });
  const [verifyModal, setVerifyModal] = useState<{ isOpen: boolean, order: Transaction | null, items: OrderItem[] }>({ isOpen: false, order: null, items: [] });
  const [returnModal, setReturnModal] = useState<{ isOpen: boolean, order: Transaction | null }>({ isOpen: false, order: null });
  const [viewModal, setViewModal] = useState<Transaction | null>(null);

  // Print & Filter State
  const [printDoc, setPrintDoc] = useState<{ order: Transaction, type: 'OS' | 'PO' | 'INVOICE' | 'RECEIPT' } | null>(null);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const showToast = (msg: string, type: 'success' | 'error') => { setToast({ message: msg, type }); setTimeout(() => setToast(null), 3500); };

  const getCompanyDetails = () => {
    if (selectedCompany?.toLowerCase().includes('wilcare')) {
      return { name: 'Wilcare Trading Corp.', address: '1457-A Rizal Ave. Sta. Cruz Manila', tel: '(02)87330879, 87333950', mob: '09157739968, 09164394073', email: 'wilcaremanila@gmail.com', web: 'www.wilcare.com.ph' };
    }
    return { name: `${selectedCompany} Corporation`, address: 'Main Corporate Headquarters', tel: 'Contact System Admin', mob: 'N/A', email: `info@${(selectedCompany || 'company').toLowerCase().replace(/\s/g, '')}.com`, web: `www.${(selectedCompany || 'company').toLowerCase().replace(/\s/g, '')}.com` };
  };
  const companyMeta = getCompanyDetails();

  useEffect(() => {
    const handleAfterPrint = () => setPrintDoc(null);
    window.addEventListener('afterprint', handleAfterPrint);
    return () => window.removeEventListener('afterprint', handleAfterPrint);
  }, []);

  const fetchData = async () => {
    try {
      const [custRes, supRes, soRes, poRes, prodRes] = await Promise.all([
        fetch(`${API_BASE_URL}/sales/customers?company=${selectedCompany}`),
        fetch(`${API_BASE_URL}/purchasing/suppliers?company=${selectedCompany}`),
        fetch(`${API_BASE_URL}/sales/orders?company=${selectedCompany}`),
        fetch(`${API_BASE_URL}/purchasing/pos?company=${selectedCompany}`),
        fetch(`${API_BASE_URL}/products?company=${selectedCompany}`)
      ]);
      if (custRes.ok) setCustomers(await custRes.json());
      if (supRes.ok) setSuppliers(await supRes.json());
      if (soRes.ok) {
        const soData = await soRes.json();
        setSalesOrders(soData.map((s: any) => ({ ...s, refNumber: s.soNumber, partnerId: s.customerId, partner: s.customer })));
      }
      if (poRes.ok) {
        const poData = await poRes.json();
        setPurchaseOrders(poData.map((p: any) => ({ ...p, refNumber: p.poNumber, partnerId: p.supplierId, partner: p.supplier })));
      }
      if (prodRes.ok) setProducts(await prodRes.json());
    } catch (e) { console.warn("Backend not ready."); }
  };

  useEffect(() => { 
    fetchData(); 
    setDraftForm({ partnerId: '', refNumber: mode === 'sales' ? `OS-${Date.now().toString().slice(-6)}` : `PO-${Date.now().toString().slice(-6)}` });
    setDraftItems([]);
  }, [selectedCompany, mode]);

  const partners = mode === 'sales' ? customers : suppliers;
  const transactions = mode === 'sales' ? salesOrders : purchaseOrders;
  
  const filteredProducts = products.filter(p => 
    (p.name || '').toLowerCase().includes(productSearch.toLowerCase()) || 
    (p.sku || '').toLowerCase().includes(productSearch.toLowerCase())
  );

  // --- SHORTAGES / PENDING ITEMS FILTERING ---
  const pendingItemsList = transactions.flatMap(order => 
    order.items
      .filter(item => item.isCancelled)
      .map(item => ({
        ...item,
        orderDate: order.date,
        orderRef: order.refNumber,
        partnerName: order.partner?.name || 'Unknown'
      }))
  ).sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());

  const filteredPendingItems = pendingItemsList.filter(item => {
    const itemDate = new Date(item.orderDate);
    if (fromDate && itemDate < new Date(fromDate)) return false;
    if (toDate && itemDate > new Date(new Date(toDate).setHours(23,59,59,999))) return false;
    return true;
  });

  // --- ADD ITEMS LOGIC ---
  const handleToggleProduct = (p: Product) => {
    setTempSelectedItems(prev => {
      const exists = prev[p.id];
      if (exists?.checked) return { ...prev, [p.id]: { ...exists, checked: false } };
      const defaultPrice = mode === 'sales' ? (p.purchasePrice ? p.purchasePrice * 1.3 : 0) : (p.purchasePrice || 0);
      return { ...prev, [p.id]: { checked: true, qty: 1, price: defaultPrice } }; 
    });
  };

  const handleUpdateTempItem = (id: number, field: 'qty' | 'price', value: number) => {
    setTempSelectedItems(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };

  const handleConfirmAddItems = () => {
    const newItems = Object.entries(tempSelectedItems).filter(([_, data]) => data.checked).map(([id, data]) => {
        const p = products.find(prod => prod.id === Number(id))!;
        return { productId: p.id, sku: p.sku || 'N/A', productName: p.name || 'Unnamed Product', quantity: data.qty, unitPrice: data.price, total: data.qty * data.price, isCancelled: false, cancelReason: '' };
      });
    if (newItems.length === 0) return showToast("No items selected.", "error");
    
    if (editModal.isOpen) {
      setEditModal({ ...editModal, items: [...editModal.items, ...newItems] });
    } else {
      setDraftItems([...draftItems, ...newItems]); 
    }
    
    setShowItemModal(false); setTempSelectedItems({}); setProductSearch('');
    showToast(`Added ${newItems.length} items.`, "success");
  };

  // --- DRAFT CREATION ---
  const handleGenerateDraft = async (e: React.FormEvent) => {
    e.preventDefault(); if (draftItems.length === 0) return showToast("Add at least one item.", "error");
    setIsProcessing(true);
    try {
      const totalAmount = draftItems.reduce((acc, item) => acc + item.total, 0);
      const endpoint = mode === 'sales' ? '/sales/orders' : '/purchasing/pos';
      const payload = mode === 'sales' 
        ? { company: selectedCompany, customerId: draftForm.partnerId, soNumber: draftForm.refNumber, totalAmount, items: draftItems, user: loginUsername, status: 'PENDING' }
        : { company: selectedCompany, supplierId: draftForm.partnerId, poNumber: draftForm.refNumber, totalAmount, items: draftItems, user: loginUsername, status: 'PENDING' };

      const res = await fetch(`${API_BASE_URL}${endpoint}`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) });
      if(!res.ok) throw new Error();
      
      fetchData(); showToast(`${mode === 'sales' ? 'Order Slip (OS)' : 'Purchase Order (PO)'} Generated successfully.`, "success");
      setDraftItems([]); setDraftForm({ partnerId: '', refNumber: mode === 'sales' ? `OS-${Date.now().toString().slice(-6)}` : `PO-${Date.now().toString().slice(-6)}` });
      setActiveTab('verify');
    } catch (e) { showToast("Failed to create document.", "error"); } finally { setIsProcessing(false); }
  };

  // --- EDIT EXISTING PENDING DRAFT ---
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!editModal.order) return;
    setIsProcessing(true);
    try {
      const finalTotal = editModal.items.reduce((acc, item) => acc + item.total, 0);
      const endpoint = mode === 'sales' ? `/sales/orders/${editModal.order.id}` : `/purchasing/pos/${editModal.order.id}`;
      
      await fetch(`${API_BASE_URL}${endpoint}`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ totalAmount: finalTotal, items: editModal.items }) });
      
      fetchData(); showToast("Order modifications saved.", "success");
      setEditModal({ isOpen: false, order: null, items: [] });
    } catch(e) { showToast("Failed to update order.", "error"); } finally { setIsProcessing(false); }
  };

  // --- VERIFICATION & STOCK COUNTING LOGIC ---
  const openVerificationModal = (order: Transaction) => {
    const itemsClone = order.items.map(i => ({ ...i }));
    setVerifyModal({ isOpen: true, order, items: itemsClone });
  };

  const handleToggleCancelItem = (index: number) => {
    setVerifyModal(prev => {
      const updatedItems = [...prev.items];
      const isCurrentlyCancelled = updatedItems[index].isCancelled;
      updatedItems[index].isCancelled = !isCurrentlyCancelled;
      
      if (!isCurrentlyCancelled) {
        updatedItems[index].cancelReason = mode === 'sales' ? "Low Stock / Discrepancy" : "Not Delivered / Missing";
        updatedItems[index].total = 0; 
      } else {
        updatedItems[index].cancelReason = '';
        updatedItems[index].total = updatedItems[index].quantity * updatedItems[index].unitPrice; 
      }
      return { ...prev, items: updatedItems };
    });
  };

  const handleConfirmVerification = async (e: React.FormEvent) => {
    e.preventDefault(); if (!verifyModal.order) return;
    setIsProcessing(true);
    try {
      const order = verifyModal.order;
      const finalItems = verifyModal.items;
      const finalTotal = finalItems.reduce((acc, item) => acc + (item.isCancelled ? 0 : item.total), 0);
      
      const targetStatus = mode === 'sales' ? 'FULFILLED' : 'RECEIVED'; 
      const endpoint = mode === 'sales' ? `/sales/orders/${order.id}` : `/purchasing/pos/${order.id}`;
      
      await fetch(`${API_BASE_URL}${endpoint}`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ status: targetStatus, totalAmount: finalTotal, items: finalItems }) });
      await fetch(`${API_BASE_URL}${endpoint}/status`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ status: targetStatus, totalAmount: finalTotal }) }).catch(()=>{});

      if (mode === 'sales') {
        await fetch(`${API_BASE_URL}/sales/customers/${order.partnerId}/balance`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ amount: finalTotal }) }); 
      } else {
        await fetch(`${API_BASE_URL}/purchasing/suppliers/${order.partnerId}/balance`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ amount: finalTotal }) });
      }

      const validItems = finalItems.filter(i => !i.isCancelled);
      for (const item of validItems) {
        const prod = products.find(p => p.id === item.productId);
        if (prod) {
          const newStock = mode === 'sales' 
            ? Math.max(0, (prod.currentStock || 0) - item.quantity) 
            : (prod.currentStock || 0) + item.quantity;             
            
          await fetch(`${API_BASE_URL}/products/${item.productId}`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ currentStock: newStock }) });
        }
      }

      fetchData(); 
      showToast(`Verification Complete! Missing items moved to Pending.`, "success");
      setVerifyModal({ isOpen: false, order: null, items: [] }); 
      setActiveTab('history');
    } catch (e) { showToast("Error during verification process.", "error"); } finally { setIsProcessing(false); }
  };

  // --- RETURN LOGIC ---
  const handleConfirmReturn = async (e: React.FormEvent) => {
    e.preventDefault(); if (!returnModal.order) return;
    setIsProcessing(true);
    try {
      const order = returnModal.order;
      const targetStatus = 'RETURNED';
      const endpoint = mode === 'sales' ? `/sales/orders/${order.id}` : `/purchasing/pos/${order.id}`;

      await fetch(`${API_BASE_URL}${endpoint}/status`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ status: targetStatus }) });

      const validTotal = order.items.reduce((acc, item) => acc + (item.isCancelled ? 0 : item.total), 0);
      
      if (mode === 'sales') {
        await fetch(`${API_BASE_URL}/sales/customers/${order.partnerId}/balance`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ amount: -validTotal }) });
      } else {
        await fetch(`${API_BASE_URL}/purchasing/suppliers/${order.partnerId}/balance`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ amount: -validTotal }) });
      }

      const validItems = order.items.filter(i => !i.isCancelled);
      for (const item of validItems) {
        const prod = products.find(p => p.id === item.productId);
        if (prod) {
          const newStock = mode === 'sales'
            ? (prod.currentStock || 0) + item.quantity              
            : Math.max(0, (prod.currentStock || 0) - item.quantity); 

          await fetch(`${API_BASE_URL}/products/${item.productId}`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ currentStock: newStock }) });
        }
      }

      fetchData(); showToast(`Transaction Reversed! Stock restored.`, "success");
      setReturnModal({ isOpen: false, order: null });
    } catch (e) { showToast("Error processing return.", "error"); } finally { setIsProcessing(false); }
  };

  // --- DELETE HISTORY LOGIC ---
  const handleDeleteTransaction = async (order: Transaction) => {
    const confirmDelete = window.prompt(`CRITICAL: Deleting this record removes it permanently from the ledger. To reverse stock, use "Return" instead.\n\nType "DELETE" to confirm removal of ${order.refNumber}:`);
    if (confirmDelete !== "DELETE") {
      return showToast("Deletion cancelled. Order retained.", "error");
    }

    setIsProcessing(true);
    try {
      const endpoint = mode === 'sales' ? `/sales/orders/${order.id}` : `/purchasing/pos/${order.id}`;
      const res = await fetch(`${API_BASE_URL}${endpoint}`, { method: 'DELETE' });
      if(!res.ok) throw new Error();
      
      fetchData();
      showToast(`Transaction ${order.refNumber} permanently deleted.`, "success");
    } catch (e) { 
      showToast("Failed to delete transaction.", "error"); 
    } finally { 
      setIsProcessing(false); 
    }
  };

  const handlePrint = (order: Transaction, printType: 'OS' | 'PO' | 'INVOICE' | 'RECEIPT') => {
    setPrintDoc({ order, type: printType });
    setTimeout(() => { window.print(); }, 400); 
  };

  return (
    <>
      <div className={`flex h-screen w-full bg-[#F8FAFC] font-sans text-slate-900 overflow-hidden ${printDoc ? 'hidden' : 'print:hidden'}`}>
        
        {toast && <div className={`fixed bottom-6 right-6 z-[100] px-5 py-3.5 rounded-xl shadow-xl font-bold text-sm ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>{toast.message}</div>}

        <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col border-r border-slate-800 shrink-0 hidden md:flex">
          <div className="h-20 flex items-center px-6 border-b border-slate-800 bg-slate-950">
            <h1 className="text-xl font-black text-white uppercase tracking-wider">{mode === 'sales' ? 'Sales Desk' : 'Purchasing'}</h1>
          </div>
          <div className="flex-1 py-6 px-3 space-y-1">
            <p className="px-3 pb-2 text-[10px] font-black uppercase tracking-widest text-slate-500">Order Management</p>
            <button onClick={() => setActiveTab('draft')} className={`w-full text-left px-4 py-3 rounded-lg font-bold text-sm transition-all ${activeTab === 'draft' ? (mode === 'sales' ? 'bg-emerald-600 text-white' : 'bg-amber-600 text-white') : 'hover:bg-slate-800'}`}>
              1. Draft {mode === 'sales' ? 'Order Slip' : 'PO'}
            </button>
            <button onClick={() => setActiveTab('verify')} className={`w-full text-left px-4 py-3 rounded-lg font-bold text-sm transition-all ${activeTab === 'verify' ? (mode === 'sales' ? 'bg-emerald-600 text-white' : 'bg-amber-600 text-white') : 'hover:bg-slate-800'}`}>
              2. Verify & Process Stock
            </button>
            <button onClick={() => setActiveTab('pending')} className={`w-full text-left px-4 py-3 rounded-lg font-bold text-sm transition-all ${activeTab === 'pending' ? (mode === 'sales' ? 'bg-rose-600 text-white' : 'bg-amber-600 text-white') : 'hover:bg-slate-800'}`}>
              3. Pending Shortages
            </button>
            <button onClick={() => setActiveTab('history')} className={`w-full text-left px-4 py-3 rounded-lg font-bold text-sm transition-all ${activeTab === 'history' ? (mode === 'sales' ? 'bg-emerald-600 text-white' : 'bg-amber-600 text-white') : 'hover:bg-slate-800'}`}>
              4. Finalized Ledger
            </button>
          </div>
        </aside>

        <div className="flex-1 flex flex-col min-w-0 h-screen">
          <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0 shadow-sm z-10">
            <div>
              <h2 className={`text-2xl font-black tracking-tight ${mode === 'sales' ? 'text-emerald-950' : 'text-amber-950'}`}>Order Fulfillment Engine</h2>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-1">{mode === 'sales' ? 'Outbound Sales & OS Generation' : 'Inbound Purchasing & PO Logging'}</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setMode(mode === 'sales' ? 'purchasing' : 'sales'); setActiveTab('draft'); }} className="px-5 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-colors shadow-sm">
                Switch to {mode === 'sales' ? 'Purchasing' : 'Sales'}
              </button>
              <button onClick={onBack} className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors">Gateway</button>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto p-8 relative">
            <div className="max-w-7xl mx-auto">
              
              {activeTab === 'draft' && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
                  <h3 className="font-black text-xl text-slate-900 mb-6 tracking-tight">Draft New {mode === 'sales' ? 'Order Slip (OS)' : 'Purchase Order (PO)'}</h3>
                  <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                    <div className="lg:col-span-1 border-r border-slate-100 pr-0 lg:pr-8 space-y-5">
                      <select required value={draftForm.partnerId} onChange={e => setDraftForm({...draftForm, partnerId: e.target.value})} className={`w-full px-4 py-3 border border-slate-300 rounded-xl text-sm font-bold outline-none focus:ring-2 bg-slate-50 ${mode === 'sales' ? 'focus:ring-emerald-600' : 'focus:ring-amber-600'}`}>
                        <option value="">Select {mode === 'sales' ? 'Customer' : 'Supplier'}...</option>
                        {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      <input type="text" required value={draftForm.refNumber} onChange={e => setDraftForm({...draftForm, refNumber: e.target.value})} className={`w-full px-4 py-3 border border-slate-300 rounded-xl text-sm font-bold outline-none focus:ring-2 ${mode === 'sales' ? 'focus:ring-emerald-600' : 'focus:ring-amber-600'}`} />
                      <button type="button" onClick={() => setShowItemModal(true)} className={`w-full py-4 border font-black tracking-wide uppercase rounded-xl transition-colors shadow-sm text-xs flex flex-col items-center justify-center gap-1 ${mode === 'sales' ? 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100' : 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100'}`}>
                        <svg className="w-5 h-5 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                        Browse Master Catalog
                      </button>
                    </div>
                    
                    <div className="lg:col-span-3 flex flex-col">
                      <div className="flex-1 border border-slate-200 rounded-xl overflow-hidden mb-6 min-h-[300px] bg-slate-50">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-slate-100 border-b border-slate-200">
                            <tr><th className="py-4 px-5 text-xs font-bold text-slate-500 uppercase">Item Details</th><th className="py-4 px-5 text-xs font-bold text-slate-500 uppercase text-right">Qty</th><th className="py-4 px-5 text-xs font-bold text-slate-500 uppercase text-right">Price</th><th className="py-4 px-5 text-xs font-bold text-slate-500 uppercase text-right">Total</th><th className="w-12"></th></tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 bg-white">
                            {draftItems.length === 0 ? <tr><td colSpan={5} className="py-16 text-center text-slate-400 font-medium">Cart is empty. Click Browse Master Catalog to add items.</td></tr> :
                              draftItems.map((item, i) => (
                                <tr key={i} className="group">
                                  <td className="py-3 px-5 font-bold text-slate-900">{item.productName} <span className="text-[10px] font-mono text-slate-400 block mt-0.5">{item.sku}</span></td>
                                  <td className="py-3 px-5 text-right font-black text-slate-700">{item.quantity}</td>
                                  <td className="py-3 px-5 text-right font-medium text-slate-600">₱{item.unitPrice.toLocaleString()}</td>
                                  <td className={`py-3 px-5 text-right font-black ${mode === 'sales' ? 'text-emerald-700' : 'text-amber-700'}`}>₱{item.total.toLocaleString()}</td>
                                  <td className="py-3 px-5 text-center"><button onClick={() => setDraftItems(draftItems.filter((_, idx) => idx !== i))} className="text-slate-300 hover:text-rose-500">✕</button></td>
                                </tr>
                              ))
                            }
                          </tbody>
                        </table>
                      </div>
                      <div className="flex justify-between items-center bg-slate-900 text-white p-5 rounded-xl">
                        <div><p className="text-xs font-bold uppercase tracking-widest text-slate-400">Total Draft Value</p><p className="text-3xl font-black">₱{draftItems.reduce((a,b)=>a+b.total,0).toLocaleString('en-PH')}</p></div>
                        <button onClick={handleGenerateDraft} disabled={isProcessing || draftItems.length === 0 || !draftForm.partnerId} className={`px-8 py-3.5 font-black uppercase tracking-wider rounded-xl transition-colors disabled:opacity-50 text-slate-900 ${mode === 'sales' ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-amber-500 hover:bg-amber-600'}`}>
                          Generate {mode === 'sales' ? 'Order Slip' : 'Purchase Order'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'verify' && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className={`p-6 border-b border-slate-200 ${mode === 'sales' ? 'bg-emerald-50' : 'bg-amber-50'}`}>
                    <h3 className="font-bold text-slate-900 text-lg tracking-tight">Pending Physical Verification</h3>
                    <p className="text-xs text-slate-600 font-medium">Print documents, modify items if needed, and confirm stock processing.</p>
                  </div>
                  <table className="w-full text-left text-sm">
                    <thead className="bg-white border-b border-slate-200">
                      <tr><th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest">Document Ref</th><th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest">{mode === 'sales' ? 'Client' : 'Vendor'}</th><th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest">Expected Units</th><th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">Verification Action</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {transactions.filter(t => t.status === 'PENDING').length === 0 ? <tr><td colSpan={4} className="py-12 text-center text-slate-400 font-medium">No pending documents to verify.</td></tr> :
                        transactions.filter(t => t.status === 'PENDING').map(order => (
                          <tr key={order.id} className="hover:bg-slate-50">
                            <td className="py-4 px-6 font-black text-slate-900">{order.refNumber} <div className="text-[10px] text-slate-400 font-mono font-medium">{new Date(order.date).toLocaleDateString()}</div></td>
                            <td className="py-4 px-6 font-bold text-slate-700">{order.partner?.name}</td>
                            <td className="py-4 px-6 font-black text-slate-600">{order.items.reduce((a,b)=>a+b.quantity,0)} Items</td>
                            <td className="py-4 px-6 text-right space-x-3">
                              <button onClick={() => setEditModal({ isOpen: true, order, items: order.items.map(i => ({...i})) })} className="text-amber-600 hover:text-amber-800 text-[11px] font-bold uppercase tracking-wider mr-2 underline">Edit Order</button>
                              <button onClick={() => handlePrint(order, mode === 'sales' ? 'OS' : 'PO')} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-black uppercase tracking-widest rounded-lg transition-colors shadow-sm">Print {mode === 'sales' ? 'OS' : 'PO'}</button>
                              <button onClick={() => openVerificationModal(order)} className={`px-4 py-2 text-white text-[10px] font-black uppercase tracking-widest rounded-lg transition-colors shadow-sm ${mode === 'sales' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700'}`}>Verify Stock</button>
                            </td>
                          </tr>
                        ))
                      }
                    </tbody>
                  </table>
                </div>
              )}

              {/* NEW PENDING SHORTAGES TAB */}
              {activeTab === 'pending' && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className={`p-6 border-b border-slate-200 ${mode === 'sales' ? 'bg-rose-50' : 'bg-amber-50'}`}>
                    <h3 className="font-bold text-slate-900 text-lg tracking-tight">Pending Items / Shortages</h3>
                    <p className="text-xs text-slate-600 font-medium">Items that were cancelled during verification due to low stock or missing delivery.</p>
                  </div>
                  
                  <div className="p-4 border-b border-slate-200 bg-slate-50 flex gap-4 items-center">
                    <div className="flex flex-col">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">From Date</label>
                      <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-slate-500 bg-white" />
                    </div>
                    <div className="flex flex-col">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">To Date</label>
                      <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-slate-500 bg-white" />
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm min-w-[800px]">
                      <thead className="bg-white border-b border-slate-200">
                        <tr>
                          <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest">Date / Ref</th>
                          <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest">{mode === 'sales' ? 'Client' : 'Vendor'}</th>
                          <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest">Product Details</th>
                          <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest text-center">Qty Short</th>
                          <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest">Cancellation Reason</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredPendingItems.length === 0 ? (
                          <tr><td colSpan={5} className="py-12 text-center text-slate-400 font-medium">No cancelled items found for this period.</td></tr>
                        ) : filteredPendingItems.map((item, i) => (
                          <tr key={i} className="hover:bg-rose-50/30 transition-colors">
                            <td className="py-4 px-6 font-black text-slate-900">{item.orderRef} <div className="text-[10px] text-slate-400 font-mono font-medium">{new Date(item.orderDate).toLocaleDateString()}</div></td>
                            <td className="py-4 px-6 font-bold text-slate-700">{item.partnerName}</td>
                            <td className="py-4 px-6">
                              <div className="font-bold text-slate-900">{item.productName}</div>
                              <div className="text-[10px] font-mono text-slate-500">{item.sku}</div>
                            </td>
                            <td className="py-4 px-6 text-center font-black text-rose-600 text-lg">{item.quantity}</td>
                            <td className="py-4 px-6 font-bold text-rose-700 text-xs uppercase tracking-wide">{item.cancelReason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeTab === 'history' && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="p-5 border-b border-slate-200 bg-slate-50"><h3 className="font-bold text-slate-800 text-lg">Finalized Operations Ledger</h3></div>
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr><th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest">Reference</th><th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest">{mode === 'sales' ? 'Client' : 'Vendor'}</th><th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">Value</th><th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest">Status</th><th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">Actions</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {transactions.filter(t => t.status === 'FULFILLED' || t.status === 'RECEIVED' || t.status === 'RETURNED').map(order => (
                        <tr key={order.id} className="hover:bg-slate-50">
                          <td className="py-4 px-6 font-black text-slate-800">{order.refNumber} <div className="text-[10px] text-slate-400 font-mono font-medium">{new Date(order.date).toLocaleDateString()}</div></td>
                          <td className="py-4 px-6 font-bold text-slate-700">{order.partner?.name}</td>
                          <td className={`py-4 px-6 text-right font-black ${mode === 'sales' ? 'text-emerald-700' : 'text-amber-700'}`}>₱{order.totalAmount.toLocaleString()}</td>
                          <td className="py-4 px-6">
                            <span className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-widest border ${order.status === 'RETURNED' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{order.status}</span>
                          </td>
                          <td className="py-4 px-6 text-right space-x-3">
                            <button onClick={() => setViewModal(order)} className="text-sky-600 hover:text-sky-900 font-bold text-[11px] uppercase tracking-wider underline">View Details</button>
                            <button onClick={() => handlePrint(order, mode === 'sales' ? 'INVOICE' : 'RECEIPT')} className="text-slate-500 hover:text-slate-900 font-bold text-[11px] uppercase tracking-wider underline">Print Doc</button>
                            {(order.status === 'FULFILLED' || order.status === 'RECEIVED') && (
                              <button onClick={() => setReturnModal({ isOpen: true, order })} className="text-amber-600 hover:text-amber-800 font-black text-[11px] uppercase tracking-wider">Return</button>
                            )}
                            <button onClick={() => handleDeleteTransaction(order)} className="text-rose-600 hover:text-rose-900 font-black text-[11px] uppercase tracking-wider">Delete</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </main>
        </div>

        {/* VIEW DETAILS MODAL */}
        {viewModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
              <div className="p-6 border-b border-slate-200 bg-slate-50 flex justify-between items-center shrink-0">
                <div>
                  <h3 className="font-bold text-lg text-slate-900 tracking-tight">Order Details Record</h3>
                  <p className="text-xs uppercase text-slate-500 font-bold tracking-widest mt-1">Ref: {viewModal.refNumber} • Status: {viewModal.status}</p>
                </div>
                <button onClick={() => setViewModal(null)} className="text-slate-400 hover:text-slate-700 font-black text-xl">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto bg-white p-6 space-y-3">
                {viewModal.items.map((item, i) => (
                  <div key={i} className={`p-4 rounded-xl border flex justify-between items-center ${item.isCancelled ? 'bg-slate-50 border-rose-200 opacity-70' : 'border-slate-200'}`}>
                    <div>
                      <h4 className={`font-black text-sm ${item.isCancelled ? 'line-through text-slate-400' : 'text-slate-900'}`}>{item.productName}</h4>
                      <p className="text-[10px] font-mono text-slate-500 mt-1">{item.sku} • Qty: {item.quantity} • Unit Price: ₱{(item.unitPrice || 0).toLocaleString()}</p>
                      {item.isCancelled && <p className="text-xs font-bold text-rose-600 uppercase mt-2 tracking-wide">CANCELLED: {item.cancelReason}</p>}
                    </div>
                    <div className={`font-black text-lg ${item.isCancelled ? 'text-rose-400 line-through' : 'text-slate-900'}`}>
                      ₱{(item.total || 0).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
              <div className="p-6 border-t border-slate-200 bg-slate-50 shrink-0 text-right">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Final Billed Total</p>
                <p className="text-3xl font-black text-slate-900 mt-1">₱{viewModal.totalAmount.toLocaleString('en-PH')}</p>
              </div>
            </div>
          </div>
        )}

        {/* EDIT PENDING ORDER MODAL */}
        {editModal.isOpen && editModal.order && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[95vh] animate-in zoom-in-95 duration-200">
              <div className="p-6 border-b text-slate-900 bg-white flex justify-between items-center">
                <div>
                  <h3 className="font-black text-xl tracking-wide">Edit Pending Order</h3>
                  <p className="text-xs uppercase text-slate-500 tracking-widest mt-1">Ref: {editModal.order.refNumber} • {editModal.order.partner?.name}</p>
                </div>
                <button onClick={() => setEditModal({ isOpen: false, order: null, items: [] })} className="text-slate-400 hover:text-slate-700 font-black text-xl">✕</button>
              </div>
              
              <div className="flex-1 overflow-y-auto bg-slate-50 p-6 space-y-4">
                <button onClick={() => setShowItemModal(true)} className={`w-full py-4 border-2 border-dashed font-black uppercase tracking-widest rounded-xl transition-colors text-xs ${mode === 'sales' ? 'border-emerald-300 text-emerald-700 hover:bg-emerald-50' : 'border-amber-300 text-amber-700 hover:bg-amber-50'}`}>+ Add New Items</button>
                
                {editModal.items.length === 0 ? <div className="text-center py-8 text-slate-400 font-medium">All items removed.</div> : 
                  editModal.items.map((item, index) => (
                    <div key={index} className="p-4 rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                      <div className="flex-1">
                        <h4 className="font-black text-base text-slate-900">{item.productName}</h4>
                        <p className="text-[10px] font-mono text-slate-500 mt-1">{item.sku} • Unit Price: ₱{(item.unitPrice || 0).toLocaleString()}</p>
                      </div>
                      <div className="flex items-center gap-4 shrink-0">
                        <div className="flex flex-col">
                          <label className="text-[10px] font-bold text-slate-500 uppercase mb-1">Qty</label>
                          <input type="number" min="1" value={item.quantity} onChange={(e) => {
                            const newQty = Number(e.target.value);
                            const updated = [...editModal.items];
                            updated[index].quantity = newQty;
                            updated[index].total = newQty * updated[index].unitPrice;
                            setEditModal({...editModal, items: updated});
                          }} className="w-20 px-3 py-2 text-sm font-black border border-slate-300 rounded-lg outline-none focus:border-slate-500 text-center" />
                        </div>
                        <span className={`font-black text-lg w-24 text-right ${mode === 'sales' ? 'text-emerald-700' : 'text-amber-700'}`}>₱{(item.total || 0).toLocaleString()}</span>
                        <button onClick={() => setEditModal({...editModal, items: editModal.items.filter((_, i) => i !== index)})} className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors">✕</button>
                      </div>
                    </div>
                  ))
                }
              </div>

              <div className="p-6 border-t border-slate-200 bg-white shrink-0 flex justify-between items-center">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400">New Adjusted Total</p>
                  <p className="text-2xl font-black text-slate-900">₱{editModal.items.reduce((acc, item) => acc + item.total, 0).toLocaleString('en-PH')}</p>
                </div>
                <button onClick={handleSaveEdit} disabled={isProcessing} className="px-8 py-3.5 bg-slate-900 hover:bg-slate-800 text-white font-black uppercase tracking-wider rounded-xl transition-colors shadow-md disabled:opacity-50">Save Changes</button>
              </div>
            </div>
          </div>
        )}

        {/* ITEM BROWSER MODAL */}
        {showItemModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
              <div className="p-5 border-b border-slate-200 bg-slate-50 flex justify-between items-center shrink-0">
                <h3 className="font-bold text-lg text-slate-900 tracking-tight">Select Products from Master Catalog</h3>
                <button onClick={() => setShowItemModal(false)} className="text-slate-400 hover:text-slate-700">✕</button>
              </div>
              <div className="p-4 border-b border-slate-200 bg-white shrink-0"><input type="text" placeholder="Search by SKU or Name..." value={productSearch} onChange={e => setProductSearch(e.target.value)} className={`w-full px-4 py-3 border border-slate-300 rounded-xl text-sm font-medium outline-none focus:ring-2 ${mode === 'sales' ? 'focus:ring-emerald-500' : 'focus:ring-amber-500'}`} /></div>
              <div className="overflow-y-auto p-2 bg-slate-50 flex-1">
                {filteredProducts.map(p => {
                  const isChecked = tempSelectedItems[p.id]?.checked || false;
                  return (
                    <div key={p.id} className={`flex flex-col sm:flex-row justify-between gap-4 p-4 rounded-xl border transition-colors mb-2 ${isChecked ? (mode==='sales'?'bg-emerald-50/50 border-emerald-300':'bg-amber-50/50 border-amber-300') : 'bg-white border-slate-200'}`}>
                      <label className="flex items-center gap-3 cursor-pointer w-full sm:w-1/2">
                        <input type="checkbox" checked={isChecked} onChange={() => handleToggleProduct(p)} className={`w-5 h-5 rounded cursor-pointer ${mode==='sales'?'text-emerald-600 focus:ring-emerald-500':'text-amber-600 focus:ring-amber-500'}`} />
                        <div>
                          <p className="font-bold text-sm text-slate-900">{p.name}</p>
                          <p className="text-[10px] text-slate-500 font-mono tracking-wider flex items-center gap-2">
                            {p.sku || 'N/A'} | <span className={`font-bold ${p.currentStock > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>Stock: {p.currentStock || 0}</span>
                          </p>
                        </div>
                      </label>
                      {isChecked && (
                        <div className="flex gap-3 w-full sm:w-1/2">
                          <div className="w-1/3"><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">Qty</label><input type="number" min="1" value={tempSelectedItems[p.id]?.qty ?? 1} onChange={e => handleUpdateTempItem(p.id, 'qty', Number(e.target.value))} className={`w-full px-3 py-2 text-sm font-black border rounded-lg outline-none ${mode==='sales'?'border-emerald-200 focus:ring-emerald-500':'border-amber-200 focus:ring-amber-500'}`} /></div>
                          <div className="w-2/3"><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">{mode === 'sales' ? 'Selling Price (₱)' : 'Purchase Price (₱)'}</label><input type="number" min="0" value={tempSelectedItems[p.id]?.price ?? ''} onChange={e => handleUpdateTempItem(p.id, 'price', Number(e.target.value))} className={`w-full px-3 py-2 text-sm font-black border rounded-lg outline-none ${mode==='sales'?'border-emerald-200 focus:ring-emerald-500':'border-amber-200 focus:ring-amber-500'}`} /></div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="p-5 border-t border-slate-200 bg-white flex gap-3">
                <button onClick={() => setShowItemModal(false)} className="flex-1 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl">Cancel</button>
                <button onClick={handleConfirmAddItems} className={`flex-1 py-3 text-white font-black uppercase tracking-wider rounded-xl shadow-sm ${mode==='sales'?'bg-emerald-600 hover:bg-emerald-700':'bg-amber-600 hover:bg-amber-700'}`}>Add Selected Items</button>
              </div>
            </div>
          </div>
        )}

        {/* VERIFICATION MODAL */}
        {verifyModal.isOpen && verifyModal.order && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[95vh] animate-in zoom-in-95 duration-200">
              <div className={`p-6 border-b text-white ${mode === 'sales' ? 'bg-emerald-700' : 'bg-amber-700'}`}>
                <h3 className="font-black text-xl tracking-wide">{mode === 'sales' ? 'Stock Verification & Dispatch' : 'Physical Receipt & Stock Logging'}</h3>
                <p className="text-xs uppercase opacity-80 tracking-widest mt-1">Ref: {verifyModal.order.refNumber} • {verifyModal.order.partner?.name}</p>
              </div>
              
              <div className="flex-1 overflow-y-auto bg-slate-50 p-6">
                <div className="bg-rose-50 border border-rose-200 p-4 rounded-xl text-rose-800 text-sm font-bold mb-6">
                  Instructions: Compare the physical stock against this list. If an item is physically missing, click "Cancel Item (Low Stock)" to omit it from the transaction.
                </div>

                <div className="space-y-4">
                  {verifyModal.items.map((item, index) => (
                    <div key={index} className={`p-4 rounded-xl border-2 transition-all ${item.isCancelled ? 'bg-white border-rose-300 opacity-60' : 'bg-white border-slate-200 shadow-sm'}`}>
                      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                        <div className="flex-1">
                          <h4 className={`font-black text-base ${item.isCancelled ? 'line-through text-slate-400' : 'text-slate-900'}`}>{item.productName}</h4>
                          <p className="text-xs font-mono text-slate-500 mt-1">{item.sku} • Qty: {item.quantity} • Unit: ₱{(item.unitPrice || 0).toLocaleString()}</p>
                        </div>
                        
                        <div className="flex items-center gap-4 shrink-0">
                          <span className={`font-black text-lg ${item.isCancelled ? 'text-rose-400 line-through' : (mode === 'sales' ? 'text-emerald-700' : 'text-amber-700')}`}>
                            ₱{(item.total || 0).toLocaleString()}
                          </span>
                          
                          <button 
                            onClick={() => handleToggleCancelItem(index)}
                            className={`px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-widest transition-colors ${item.isCancelled ? 'bg-slate-200 text-slate-700 hover:bg-slate-300' : 'bg-rose-100 text-rose-700 hover:bg-rose-200'}`}
                          >
                            {item.isCancelled ? 'Restore Item' : 'Cancel Item (Low Stock)'}
                          </button>
                        </div>
                      </div>

                      {item.isCancelled && (
                        <div className="mt-4 pt-4 border-t border-slate-200 animate-in slide-in-from-top-2">
                          <label className="text-[10px] font-bold text-rose-600 uppercase tracking-widest mb-1.5 block">Cancellation Reason (Saved to Shortages)</label>
                          <input 
                            type="text" 
                            value={item.cancelReason} 
                            onChange={(e) => {
                              const newItems = [...verifyModal.items];
                              newItems[index].cancelReason = e.target.value;
                              setVerifyModal({...verifyModal, items: newItems});
                            }}
                            className="w-full px-3 py-2 text-sm border-2 border-rose-200 rounded-lg outline-none focus:border-rose-500 text-rose-900 font-medium" 
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-6 border-t border-slate-200 bg-white shrink-0">
                <div className="flex flex-col sm:flex-row justify-between items-center gap-6 mb-6">
                  <div className="w-full sm:w-1/2">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Stock Action</p>
                    <p className="text-sm font-black text-slate-800 mt-1">
                      {mode === 'sales' ? 'Deduct valid units directly from Master Stock.' : 'Add valid units directly to Master Stock.'}
                    </p>
                  </div>
                  
                  <div className="text-right">
                    <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Final Adjusted Total</p>
                    <p className="text-3xl font-black text-slate-900">
                      ₱{verifyModal.items.reduce((acc, item) => acc + (item.isCancelled ? 0 : item.total), 0).toLocaleString('en-PH')}
                    </p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <button onClick={() => setVerifyModal({ isOpen: false, order: null, items: [] })} className="px-6 py-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors">Cancel</button>
                  <button onClick={handleConfirmVerification} disabled={isProcessing} className={`flex-1 py-4 text-white font-black uppercase tracking-wider rounded-xl transition-colors shadow-md disabled:opacity-50 ${mode === 'sales' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700'}`}>
                    {isProcessing ? 'Processing Database...' : (mode === 'sales' ? 'Confirm Deductions & Dispatch' : 'Confirm Receipts & Stock')}
                  </button>
                </div>
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
                <p className="text-[10px] uppercase opacity-80 tracking-widest">{returnModal.order.refNumber}</p>
              </div>
              <form onSubmit={handleConfirmReturn} className="p-6 flex flex-col gap-5 bg-slate-50">
                <div className="bg-white border border-slate-200 p-4 rounded-xl text-xs font-bold text-rose-700 shadow-sm leading-relaxed">
                  WARNING: This fully reverses the transaction. It will <strong className="uppercase">{mode === 'sales' ? 'restore valid items back to' : 'deduct valid items from'} Master Stock</strong> and reverse the balance log by <strong>₱{returnModal.order.items.reduce((acc, item) => acc + (item.isCancelled ? 0 : item.total), 0).toLocaleString()}</strong>.
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

      {/* UNIVERSAL PRINT LAYER */}
      {printDoc && (
        <div className="hidden print:block absolute inset-0 w-full bg-white z-[99999] text-black font-sans p-8 min-h-screen">
          <div className="flex justify-between items-start border-b-2 border-black pb-6 mb-6">
            <div>
              <h1 className="text-4xl font-black tracking-tight uppercase">{companyMeta.name}</h1>
              <p className="text-sm font-medium mt-1">Order Processing Center</p>
            </div>
            <div className="text-right text-xs space-y-0.5 mt-1 font-mono">
              <p>Generated: {new Date().toLocaleString()}</p>
              <p>Doc Ref: {printDoc.order.id.slice(-8)}</p>
            </div>
          </div>

          <div className="text-center mb-8">
            <h2 className="text-4xl font-black tracking-widest uppercase">
              {printDoc.type === 'OS' ? 'ORDER SLIP (PICK LIST)' : 
               printDoc.type === 'PO' ? 'PURCHASE ORDER' : 
               printDoc.type === 'INVOICE' ? 'SALES INVOICE' : 'RECEIVING REPORT'}
            </h2>
            <div className="inline-block mt-2 px-4 py-1 border-2 border-black font-black text-sm uppercase tracking-widest">
              {printDoc.order.status}
            </div>
          </div>

          <div className="flex justify-between mb-8 border-2 border-black p-4">
            <div className="w-1/2 pr-4 border-r-2 border-black">
              <h3 className="font-bold uppercase tracking-widest text-[10px] mb-2 border-b border-black pb-1">{mode === 'sales' ? 'Billed To' : 'Vendor'}</h3>
              <p className="font-black text-xl uppercase">{printDoc.order.partner?.name}</p>
              <p className="mt-1 font-medium">{printDoc.order.partner?.contact || 'No Contact Specified'}</p>
              <p className="font-medium">{printDoc.order.partner?.phone || 'N/A'}</p>
            </div>
            <div className="w-1/2 pl-4 text-right">
              <h3 className="font-bold uppercase tracking-widest text-[10px] mb-2 border-b border-black pb-1">Transaction Details</h3>
              <p className="font-medium mt-1">Reference: <span className="font-bold text-lg">{printDoc.order.refNumber}</span></p>
              <p className="font-medium">Date: <span className="font-bold">{new Date(printDoc.order.date).toLocaleDateString()}</span></p>
              <p className="font-medium">Agent: <span className="font-bold uppercase">{printDoc.order.user}</span></p>
            </div>
          </div>

          <table className="w-full text-left border-collapse mb-8 border-2 border-black">
            <thead className="border-b-2 border-black bg-slate-100">
              <tr>
                <th className="py-3 px-4 font-black uppercase tracking-wider text-xs border-r border-black w-1/2">Item Description</th>
                <th className="py-3 px-4 font-black uppercase tracking-wider text-xs text-center border-r border-black">Qty</th>
                <th className="py-3 px-4 font-black uppercase tracking-wider text-xs text-right border-r border-black">Price</th>
                <th className="py-3 px-4 font-black uppercase tracking-wider text-xs text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black">
              {printDoc.order.items.map((item, i) => (
                <tr key={i} className="break-inside-avoid">
                  <td className="py-3 px-4 border-r border-black">
                    <div className={`font-bold ${item.isCancelled ? 'line-through text-slate-400' : ''}`}>{item.productName}</div>
                    <div className="text-[10px] font-mono">{item.sku}</div>
                    {item.isCancelled && <div className="text-xs font-bold text-black uppercase mt-1">*** CANCELLED: {item.cancelReason} ***</div>}
                  </td>
                  <td className={`py-3 px-4 text-center font-bold border-r border-black ${item.isCancelled ? 'line-through text-slate-400' : ''}`}>{item.quantity}</td>
                  <td className={`py-3 px-4 text-right font-medium border-r border-black ${item.isCancelled ? 'line-through text-slate-400' : ''}`}>₱{(item.unitPrice || 0).toLocaleString('en-PH')}</td>
                  <td className="py-3 px-4 text-right font-black">₱{(item.isCancelled ? 0 : (item.total || 0)).toLocaleString('en-PH')}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex justify-end mb-16 break-inside-avoid">
            <div className="w-1/3 p-4 border-2 border-black">
              <div className="flex justify-between items-center mb-2"><span className="font-bold uppercase tracking-widest text-xs">Valid Units</span><span className="font-black">{printDoc.order.items.reduce((acc, curr) => acc + (curr.isCancelled ? 0 : curr.quantity), 0)}</span></div>
              <div className="border-t-2 border-black my-2"></div>
              <div className="flex justify-between items-center"><span className="font-black uppercase tracking-widest text-sm">Grand Total</span><span className="font-black text-2xl">₱{printDoc.order.items.reduce((acc, item) => acc + (item.isCancelled ? 0 : item.total), 0).toLocaleString('en-PH')}</span></div>
            </div>
          </div>

          <div className="flex justify-between items-end pt-12 mt-12 break-inside-avoid">
            <div className="w-1/3 text-center"><div className="border-t-2 border-black pt-2 font-bold uppercase text-xs tracking-widest">Prepared By</div><div className="text-[10px] mt-1 uppercase">{printDoc.order.user}</div></div>
            <div className="w-1/3 text-center"><div className="border-t-2 border-black pt-2 font-bold uppercase text-xs tracking-widest">Warehouse Verification</div><div className="text-[10px] mt-1">Signature / Date</div></div>
            <div className="w-1/3 text-center"><div className="border-t-2 border-black pt-2 font-bold uppercase text-xs tracking-widest">{mode === 'sales' ? 'Client Acceptance' : 'Vendor Acceptance'}</div><div className="text-[10px] mt-1">Signature / Date</div></div>
          </div>
        </div>
      )}
    </>
  );
}