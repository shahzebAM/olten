import React, { useState, useEffect } from 'react';

interface Customer { id: string; name: string; contact: string; phone: string; email: string; address: string; creditLimit: number; balance: number; }
interface SOItem { id?: string; productId: number; sku: string; productName: string; quantity: number; unitPrice: number; total: number; }
interface SalesOrder { id: string; soNumber: string; customerId: string; customer: Customer; date: string; status: 'PENDING' | 'APPROVED' | 'FULFILLED' | 'RETURNED' | 'CANCELLED'; totalAmount: number; items: SOItem[]; user: string; }
interface Product { id: number; name: string; sku: string; purchasePrice: number; currentStock: number; reorderLevel: number; }
interface Warehouse { id: string; name: string; }

export default function SalesModule({ selectedCompany, loginUsername, API_BASE_URL, onLogout, onBack }: any) {
  
  const [activeTab, setActiveTab] = useState<'dashboard' | 'customers' | 'sales' | 'fulfill'>('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sos, setSos] = useState<SalesOrder[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  const [customerSearch, setCustomerSearch] = useState('');
  const [soSearch, setSoSearch] = useState('');

  const [custForm, setCustForm] = useState({ name: '', contact: '', phone: '', email: '', address: '', creditLimit: 0 });
  const [editCustomerModal, setEditCustomerModal] = useState<{ isOpen: boolean, customer: Customer | null }>({ isOpen: false, customer: null });
  const [historyModal, setHistoryModal] = useState<{ isOpen: boolean, customerId: string | null }>({ isOpen: false, customerId: null });
  
  const [soForm, setSoForm] = useState({ customerId: '', soNumber: `SO-${Date.now().toString().slice(-6)}` });
  const [soItems, setSoItems] = useState<SOItem[]>([]);
  
  const [showItemModal, setShowItemModal] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [tempSelectedItems, setTempSelectedItems] = useState<Record<number, { checked: boolean, qty: number, price: number }>>({});

  const [fulfillModal, setFulfillModal] = useState<{ isOpen: boolean, so: SalesOrder | null }>({ isOpen: false, so: null });
  const [fulfillWarehouseId, setFulfillWarehouseId] = useState('');

  const [returnModal, setReturnModal] = useState<{ isOpen: boolean, so: SalesOrder | null }>({ isOpen: false, so: null });
  const [returnWarehouseId, setReturnWarehouseId] = useState('');

  const [printSO, setPrintSO] = useState<SalesOrder | null>(null);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchData = async () => {
    try {
      const [custRes, soRes, prodRes, whRes] = await Promise.all([
        fetch(`${API_BASE_URL}/sales/customers?company=${selectedCompany}`),
        fetch(`${API_BASE_URL}/sales/orders?company=${selectedCompany}`),
        fetch(`${API_BASE_URL}/products?company=${selectedCompany}`),
        fetch(`${API_BASE_URL}/warehouses?company=${selectedCompany}`)
      ]);
      if (custRes.ok) setCustomers(await custRes.json());
      if (soRes.ok) setSos(await soRes.json());
      if (prodRes.ok) setProducts(await prodRes.json());
      if (whRes.ok) setWarehouses(await whRes.json());
    } catch (e) { console.warn("Backend not ready."); }
  };

  useEffect(() => { fetchData(); }, [selectedCompany]);

  const filteredCustomers = customers.filter(c => c.name.toLowerCase().includes(customerSearch.toLowerCase()));
  const filteredSOs = sos.filter(s => s.soNumber.toLowerCase().includes(soSearch.toLowerCase()) || s.customer?.name.toLowerCase().includes(soSearch.toLowerCase()));
  const filteredProducts = products.filter(p => p.name.toLowerCase().includes(productSearch.toLowerCase()) || p.sku.toLowerCase().includes(productSearch.toLowerCase()));
  const totalTempChecked = Object.values(tempSelectedItems).filter(item => item.checked).length;
  const creditAlerts = customers.filter(c => c.creditLimit > 0 && c.balance >= (c.creditLimit * 0.9));

  // --- CUSTOMER ACTIONS ---
  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    try {
      const payload = { ...custForm, creditLimit: Number(custForm.creditLimit), company: selectedCompany };
      const res = await fetch(`${API_BASE_URL}/sales/customers`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) });
      if(!res.ok) throw new Error();
      fetchData();
      showToast("Customer registered.", "success");
      setCustForm({ name: '', contact: '', phone: '', email: '', address: '', creditLimit: 0 });
    } catch (e) { showToast("Failed to add customer.", "error"); }
    finally { setIsProcessing(false); }
  };

  const handleUpdateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editCustomerModal.customer) return;
    setIsProcessing(true);
    try {
      const res = await fetch(`${API_BASE_URL}/sales/customers/${editCustomerModal.customer.id}`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({...editCustomerModal.customer, creditLimit: Number(editCustomerModal.customer.creditLimit)}) });
      if(!res.ok) throw new Error();
      fetchData();
      showToast("Customer updated.", "success");
      setEditCustomerModal({ isOpen: false, customer: null });
    } catch (e) { showToast("Update failed.", "error"); }
    finally { setIsProcessing(false); }
  };

  // --- BULK SO ITEM ACTIONS ---
  const handleToggleProduct = (p: Product) => {
    setTempSelectedItems(prev => {
      const exists = prev[p.id];
      if (exists?.checked) return { ...prev, [p.id]: { ...exists, checked: false } };
      return { ...prev, [p.id]: { checked: true, qty: 1, price: p.purchasePrice ? p.purchasePrice * 1.3 : 0 } }; // Defaults to 30% markup for sales
    });
  };

  const handleUpdateTempItem = (id: number, field: 'qty' | 'price', value: number) => {
    setTempSelectedItems(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };

  const handleConfirmAddItems = () => {
    const newItems = Object.entries(tempSelectedItems)
      .filter(([_, data]) => data.checked)
      .map(([id, data]) => {
        const p = products.find(prod => prod.id === Number(id))!;
        return { productId: p.id, sku: p.sku, productName: p.name, quantity: data.qty, unitPrice: data.price, total: data.qty * data.price };
      });
    if (newItems.length === 0) return showToast("No items selected.", "error");
    setSoItems([...soItems, ...newItems]);
    setShowItemModal(false);
    setTempSelectedItems({});
    setProductSearch('');
    showToast(`Added ${newItems.length} items to order.`, "success");
  };

  const handleRemoveSOItem = (index: number) => {
    setSoItems(soItems.filter((_, i) => i !== index));
  };

  const handleCreateSO = async (e: React.FormEvent) => {
    e.preventDefault();
    if (soItems.length === 0) return showToast("Add at least one item.", "error");
    
    // Check pending credit limit before creating draft
    const cust = customers.find(c => c.id === soForm.customerId);
    const totalAmount = soItems.reduce((acc, item) => acc + item.total, 0);
    
    if (cust && cust.creditLimit > 0) {
      const availableCredit = cust.creditLimit - cust.balance;
      if (totalAmount > availableCredit) {
        showToast(`Draft Alert: Order exceeds available credit limit (₱${availableCredit.toLocaleString('en-PH')}).`, "error");
      }
    }

    setIsProcessing(true);
    try {
      const payload = { company: selectedCompany, ...soForm, totalAmount, items: soItems, user: loginUsername, status: 'PENDING' };
      const res = await fetch(`${API_BASE_URL}/sales/orders`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) });
      if(!res.ok) throw new Error();
      fetchData();
      showToast("Sales Order draft generated.", "success");
      setSoItems([]);
      setSoForm({ customerId: '', soNumber: `SO-${Date.now().toString().slice(-6)}` });
    } catch (e) { showToast("Failed to create SO.", "error"); }
    finally { setIsProcessing(false); }
  };

  const handleUpdateSOStatus = async (so: SalesOrder, status: string) => {
    // CREDIT LIMIT STRICT ENFORCEMENT
    if (status === 'APPROVED') {
      const cust = customers.find(c => c.id === so.customerId);
      if (cust && cust.creditLimit > 0) {
        const availableCredit = cust.creditLimit - cust.balance;
        if (so.totalAmount > availableCredit) {
          showToast(`Action Denied: Order exceeds available credit (₱${availableCredit.toLocaleString('en-PH')}).`, "error");
          return;
        }
      }
    }

    setIsProcessing(true);
    try {
      const res = await fetch(`${API_BASE_URL}/sales/orders/${so.id}/status`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ status }) });
      if(!res.ok) throw new Error();
      fetchData();
      showToast(`Sales Order marked as ${status}.`, "success");
    } catch (e) { showToast("Failed to update status.", "error"); }
    finally { setIsProcessing(false); }
  };

  // --- FULFILL & RETURN ---
  const handleFulfillSO = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fulfillModal.so || !fulfillWarehouseId) return showToast("Select a dispatch warehouse.", "error");
    setIsProcessing(true);
    try {
      const so = fulfillModal.so;
      await fetch(`${API_BASE_URL}/sales/orders/${so.id}/status`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ status: 'FULFILLED' }) });
      await fetch(`${API_BASE_URL}/sales/customers/${so.customerId}/balance`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ amount: so.totalAmount }) }); // Increases receivable balance
      for (const item of so.items) {
        await fetch(`${API_BASE_URL}/warehouse-stock`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ company: selectedCompany, warehouseId: fulfillWarehouseId, productId: item.productId, sku: item.sku, quantity: -item.quantity }) });
        const prod = products.find(p => p.id === item.productId);
        if (prod) await fetch(`${API_BASE_URL}/products/${item.productId}`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ currentStock: Math.max(0, (prod.currentStock || 0) - item.quantity) }) });
      }
      fetchData();
      showToast("Order Fulfilled! Stock deducted and receivables updated.", "success");
      setFulfillModal({ isOpen: false, so: null });
      setFulfillWarehouseId('');
    } catch (e) { showToast("Error processing fulfillment.", "error"); }
    finally { setIsProcessing(false); }
  };

  const handleReturnSO = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returnModal.so || !returnWarehouseId) return showToast("Select warehouse to restore stock.", "error");
    setIsProcessing(true);
    try {
      const so = returnModal.so;
      await fetch(`${API_BASE_URL}/sales/orders/${so.id}/status`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ status: 'RETURNED' }) });
      
      // Decrease receivable balance
      await fetch(`${API_BASE_URL}/sales/customers/${so.customerId}/balance`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ amount: -so.totalAmount }) });
      
      for (const item of so.items) {
        await fetch(`${API_BASE_URL}/warehouse-stock`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ company: selectedCompany, warehouseId: returnWarehouseId, productId: item.productId, sku: item.sku, quantity: item.quantity }) });
        const prod = products.find(p => p.id === item.productId);
        if (prod) await fetch(`${API_BASE_URL}/products/${item.productId}`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ currentStock: (prod.currentStock || 0) + item.quantity }) });
      }
      fetchData();
      showToast("Order Returned! Stock restored and receivables reduced.", "success");
      setReturnModal({ isOpen: false, so: null });
      setReturnWarehouseId('');
    } catch (e) { showToast("Error processing return.", "error"); }
    finally { setIsProcessing(false); }
  };

  const getCustomerSalesHistory = (custId: string) => {
    const history: any[] = [];
    sos.filter(s => s.customerId === custId).forEach(s => {
      s.items.forEach(item => history.push({ date: s.date, so: s.soNumber, product: item.productName, price: item.unitPrice, qty: item.quantity }));
    });
    return history.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  };

  const handlePrintSO = (so: SalesOrder) => {
    setPrintSO(so);
    setTimeout(() => { window.print(); }, 300); 
  };

  const getCompanyDetails = () => {
    if (selectedCompany.toLowerCase().includes('wilcare')) {
      return {
        name: 'Wilcare Trading Corp.', address: '1457-A Rizal Ave. Sta. Cruz Manila',
        tel: '(02)87330879, 87333950, 87350918', mob: '09157739968, 09164394073',
        email: 'wilcaremanila@gmail.com', web: 'www.wilcare.com.ph'
      };
    }
    return {
      name: `${selectedCompany} Corporation`, address: 'Main Corporate Headquarters',
      tel: 'Contact System Admin', mob: 'N/A',
      email: `sales@${selectedCompany.toLowerCase().replace(/\s/g, '')}.com`, web: `www.${selectedCompany.toLowerCase().replace(/\s/g, '')}.com`
    };
  };

  const companyMeta = getCompanyDetails();

  return (
    <>
      <style>{`
        @media print {
          @page { size: auto; margin: 15mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: white; }
        }
      `}</style>

      {/* --- HIDDEN PRINT LAYER --- */}
      {printSO && (
        <div className="hidden print:block fixed inset-0 w-full h-full bg-white z-[99999] text-black font-sans p-4">
          <div className="flex justify-between items-start border-b-2 border-slate-800 pb-6 mb-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-slate-900 text-white rounded-lg flex items-center justify-center text-3xl font-serif font-bold italic border-2 border-slate-900">
                {companyMeta.name.charAt(0)}
              </div>
              <div>
                <h1 className="text-2xl font-black tracking-tight text-slate-900 uppercase">{companyMeta.name}</h1>
                <p className="text-sm font-medium text-slate-600 mt-1">{companyMeta.address}</p>
              </div>
            </div>
            <div className="text-right text-xs text-slate-600 space-y-0.5 mt-1">
              <p><span className="font-bold text-slate-800">Tel:</span> {companyMeta.tel}</p>
              <p><span className="font-bold text-slate-800">Mob:</span> {companyMeta.mob}</p>
              <p><span className="font-bold text-slate-800">Email:</span> {companyMeta.email}</p>
              <p><span className="font-bold text-slate-800">Web:</span> {companyMeta.web}</p>
            </div>
          </div>

          <div className="text-center mb-8">
            <h2 className="text-3xl font-black tracking-widest text-slate-900 uppercase">
              {printSO.status === 'FULFILLED' ? 'Delivery Receipt / Sales Invoice' : printSO.status === 'RETURNED' ? 'Credit Note / Return Receipt' : 'Sales Order'}
            </h2>
            <div className="inline-block mt-2 px-3 py-1 border border-slate-300 rounded font-bold text-xs uppercase tracking-widest bg-slate-50">
              {printSO.status}
            </div>
          </div>

          <div className="flex justify-between mb-8 text-sm">
            <div className="w-1/2 pr-4">
              <h3 className="font-bold text-slate-500 uppercase tracking-widest text-[10px] mb-2 border-b border-slate-200 pb-1">Bill To / Ship To</h3>
              <p className="font-black text-lg text-slate-800 uppercase">{printSO.customer?.name}</p>
              <p className="text-slate-600 mt-1 font-medium">{printSO.customer?.address || 'No Address Specified'}</p>
              <p className="text-slate-600 font-medium">{printSO.customer?.phone || 'N/A'} • {printSO.customer?.email || 'N/A'}</p>
            </div>
            <div className="w-1/2 pl-4 text-right">
              <h3 className="font-bold text-slate-500 uppercase tracking-widest text-[10px] mb-2 border-b border-slate-200 pb-1">Order Details</h3>
              <p className="font-medium text-slate-600 mt-1">Order Reference: <span className="font-bold text-slate-900">{printSO.soNumber}</span></p>
              <p className="font-medium text-slate-600">Date Logged: <span className="font-bold text-slate-900">{new Date(printSO.date).toLocaleString()}</span></p>
              <p className="font-medium text-slate-600">Processed By: <span className="font-bold text-slate-900 uppercase">{printSO.user}</span></p>
            </div>
          </div>

          <table className="w-full text-left border-collapse mb-8 text-sm">
            <thead className="bg-slate-100 border-y-2 border-slate-800">
              <tr>
                <th className="py-3 px-4 font-bold uppercase tracking-wider text-xs">Item Description</th>
                <th className="py-3 px-4 font-bold uppercase tracking-wider text-xs text-center">SKU</th>
                <th className="py-3 px-4 font-bold uppercase tracking-wider text-xs text-center">Qty</th>
                <th className="py-3 px-4 font-bold uppercase tracking-wider text-xs text-right">Unit Price</th>
                <th className="py-3 px-4 font-bold uppercase tracking-wider text-xs text-right">Total Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {printSO.items.map((item, i) => (
                <tr key={i} className="break-inside-avoid">
                  <td className="py-3 px-4 font-bold text-slate-800">{item.productName}</td>
                  <td className="py-3 px-4 text-center font-mono text-xs text-slate-500">{item.sku}</td>
                  <td className="py-3 px-4 text-center font-bold">{item.quantity}</td>
                  <td className="py-3 px-4 text-right font-medium text-slate-600">₱{item.unitPrice.toLocaleString('en-PH', {minimumFractionDigits: 2})}</td>
                  <td className="py-3 px-4 text-right font-black text-slate-900">₱{item.total.toLocaleString('en-PH', {minimumFractionDigits: 2})}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex justify-end mb-16">
            <div className="w-1/3 bg-slate-50 p-4 border-2 border-slate-800 rounded-lg">
              <div className="flex justify-between items-center">
                <span className="font-bold text-slate-600 uppercase tracking-widest text-xs">Total Units</span>
                <span className="font-black text-slate-900">{printSO.items.reduce((acc, curr) => acc + curr.quantity, 0)}</span>
              </div>
              <div className="border-t border-slate-300 my-2"></div>
              <div className="flex justify-between items-center">
                <span className="font-bold text-slate-900 uppercase tracking-widest text-sm">Grand Total</span>
                <span className="font-black text-2xl text-slate-900">₱{printSO.totalAmount.toLocaleString('en-PH', {minimumFractionDigits: 2})}</span>
              </div>
            </div>
          </div>

          <div className="flex justify-between items-end pt-12 mt-12 break-inside-avoid">
            <div className="w-1/3 text-center">
              <div className="border-t-2 border-slate-400 pt-2 font-bold text-slate-800 uppercase text-xs tracking-widest">Prepared By</div>
              <div className="text-slate-500 text-[10px] mt-1 uppercase">{printSO.user}</div>
            </div>
            <div className="w-1/3 text-center">
              <div className="border-t-2 border-slate-400 pt-2 font-bold text-slate-800 uppercase text-xs tracking-widest">Authorized By</div>
              <div className="text-slate-500 text-[10px] mt-1">Management Signature</div>
            </div>
            <div className="w-1/3 text-center">
              <div className="border-t-2 border-slate-400 pt-2 font-bold text-slate-800 uppercase text-xs tracking-widest">Customer Acceptance</div>
              <div className="text-slate-500 text-[10px] mt-1">Date & Signature</div>
            </div>
          </div>

          <div className="fixed bottom-4 left-0 w-full text-center text-[9px] text-slate-400 font-mono tracking-widest uppercase">
            Document auto-generated by the Sales Engine • Ref: {printSO.id}
          </div>
        </div>
      )}

      {/* --- MAIN APP LAYER --- */}
      <div className="flex h-screen w-full bg-slate-50 font-sans text-slate-900 overflow-hidden selection:bg-emerald-100 print:hidden">
        
        {toast && (
          <div className={`fixed bottom-6 right-6 z-[100] px-5 py-3.5 rounded-xl shadow-xl font-semibold flex items-center gap-3 animate-in slide-in-from-right-8 fade-in border ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>
            {toast.message}
          </div>
        )}

        {isMobileMenuOpen && <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 md:hidden" onClick={() => setIsMobileMenuOpen(false)}></div>}

        {/* BULK ADD ITEMS MODAL */}
        {showItemModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
              <div className="p-5 border-b border-slate-200 bg-slate-50 flex justify-between items-center shrink-0">
                <div>
                  <h3 className="font-bold text-lg text-slate-900 tracking-tight">Select Products for Sale</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Check items and define their quantities and selling prices.</p>
                </div>
                <button onClick={() => setShowItemModal(false)} className="text-slate-400 hover:text-slate-700 transition-colors">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              
              <div className="p-4 border-b border-slate-200 bg-white shrink-0">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                  </div>
                  <input type="text" placeholder="Search by SKU or Product Name..." value={productSearch} onChange={e => setProductSearch(e.target.value)} className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500 shadow-sm" />
                </div>
              </div>

              <div className="overflow-y-auto p-2 bg-slate-50 flex-1">
                {filteredProducts.length === 0 ? (
                  <div className="text-center py-12 text-slate-500 text-sm font-medium">No products match your search.</div>
                ) : (
                  <div className="space-y-2">
                    {filteredProducts.map(p => {
                      const isChecked = tempSelectedItems[p.id]?.checked || false;
                      return (
                        <div key={p.id} className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border transition-colors ${isChecked ? 'bg-emerald-50/50 border-emerald-300 shadow-sm' : 'bg-white border-slate-200 hover:border-slate-300'}`}>
                          <label className="flex items-start sm:items-center gap-3 cursor-pointer w-full sm:w-1/2">
                            <input type="checkbox" checked={isChecked} onChange={() => handleToggleProduct(p)} className="w-5 h-5 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 mt-0.5 sm:mt-0 cursor-pointer shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-sm text-slate-900 truncate">{p.name}</p>
                              <div className="flex gap-2 text-[11px] text-slate-500 font-mono tracking-wider mt-0.5">
                                <span>{p.sku}</span>
                                <span className="font-bold text-emerald-600 border-l pl-2 border-slate-300">Stock: {p.currentStock || 0}</span>
                              </div>
                            </div>
                          </label>

                          {isChecked && (
                            <div className="flex items-center gap-3 w-full sm:w-1/2 ml-8 sm:ml-0 animate-in fade-in slide-in-from-top-1">
                              <div className="w-1/3">
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Qty</label>
                                <input type="number" min="1" value={tempSelectedItems[p.id]?.qty || 1} onChange={e => handleUpdateTempItem(p.id, 'qty', Number(e.target.value))} className="w-full px-3 py-2 text-sm font-black border border-emerald-200 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 shadow-sm bg-white" />
                              </div>
                              <div className="w-2/3 relative">
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Selling Price</label>
                                <div className="relative">
                                  <span className="absolute left-3 top-2 text-slate-400 text-sm font-bold">₱</span>
                                  <input type="number" min="0" value={tempSelectedItems[p.id]?.price} onChange={e => handleUpdateTempItem(p.id, 'price', Number(e.target.value))} className="w-full pl-7 pr-3 py-2 text-sm font-black border border-emerald-200 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 shadow-sm bg-white" />
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="p-5 border-t border-slate-200 bg-white shrink-0 flex gap-3">
                <button onClick={() => setShowItemModal(false)} className="flex-1 px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors text-sm">Cancel</button>
                <button onClick={handleConfirmAddItems} className="flex-1 px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition-colors text-sm shadow-sm flex items-center justify-center gap-2">
                  Add {totalTempChecked > 0 ? `${totalTempChecked} Items` : 'Items'} to Order
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* EDIT CUSTOMER MODAL */}
        {editCustomerModal.isOpen && editCustomerModal.customer && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
              <div className="p-5 border-b bg-emerald-600 text-white"><h3 className="font-bold text-lg">Edit Customer</h3></div>
              <form onSubmit={handleUpdateCustomer} className="p-6 flex flex-col gap-4">
                <input type="text" required value={editCustomerModal.customer.name} onChange={e => setEditCustomerModal({ ...editCustomerModal, customer: { ...editCustomerModal.customer!, name: e.target.value }})} className="px-4 py-2 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-600" placeholder="Customer Name" />
                <input type="text" value={editCustomerModal.customer.contact || ''} onChange={e => setEditCustomerModal({ ...editCustomerModal, customer: { ...editCustomerModal.customer!, contact: e.target.value }})} className="px-4 py-2 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-600" placeholder="Contact Person" />
                <input type="text" value={editCustomerModal.customer.phone || ''} onChange={e => setEditCustomerModal({ ...editCustomerModal, customer: { ...editCustomerModal.customer!, phone: e.target.value }})} className="px-4 py-2 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-600" placeholder="Phone Number" />
                <input type="email" value={editCustomerModal.customer.email || ''} onChange={e => setEditCustomerModal({ ...editCustomerModal, customer: { ...editCustomerModal.customer!, email: e.target.value }})} className="px-4 py-2 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-600" placeholder="Email Address" />
                <input type="text" value={editCustomerModal.customer.address || ''} onChange={e => setEditCustomerModal({ ...editCustomerModal, customer: { ...editCustomerModal.customer!, address: e.target.value }})} className="px-4 py-2 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-600" placeholder="Complete Address" />
                <div className="flex flex-col gap-1.5 mt-2">
                  <label className="text-xs font-bold text-slate-600 uppercase tracking-wide">Credit Limit (₱)</label>
                  <input type="number" min="0" value={editCustomerModal.customer.creditLimit} onChange={e => setEditCustomerModal({ ...editCustomerModal, customer: { ...editCustomerModal.customer!, creditLimit: Number(e.target.value) }})} className="px-4 py-2 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-600 bg-emerald-50" />
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setEditCustomerModal({ isOpen: false, customer: null })} className="flex-1 px-4 py-2 bg-slate-100 font-bold rounded-xl text-slate-700">Cancel</button>
                  <button type="submit" disabled={isProcessing} className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition-colors">Save</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* CUSTOMER SALES HISTORY MODAL */}
        {historyModal.isOpen && historyModal.customerId && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
              <div className="p-5 border-b bg-slate-900 text-white flex justify-between items-center">
                <h3 className="font-bold text-lg">Customer Sales History</h3>
                <button onClick={() => setHistoryModal({ isOpen: false, customerId: null })} className="text-slate-400 hover:text-white">✕</button>
              </div>
              <div className="p-0 max-h-[60vh] overflow-y-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                    <tr>
                      <th className="py-3 px-4 font-semibold text-slate-600">Date / SO</th>
                      <th className="py-3 px-4 font-semibold text-slate-600">Product</th>
                      <th className="py-3 px-4 font-semibold text-slate-600 text-right">Sold Price</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {getCustomerSalesHistory(historyModal.customerId).length === 0 ? (
                      <tr><td colSpan={3} className="py-6 text-center text-slate-400">No sales history found.</td></tr>
                    ) : getCustomerSalesHistory(historyModal.customerId).map((h, i) => (
                      <tr key={i} className="hover:bg-emerald-50">
                        <td className="py-2 px-4 font-mono text-xs">{new Date(h.date).toLocaleDateString()}<br/><span className="text-[10px] text-slate-400">{h.so}</span></td>
                        <td className="py-2 px-4 font-bold text-slate-800">{h.product} <span className="text-[10px] text-slate-400 block font-normal">Qty: {h.qty}</span></td>
                        <td className="py-2 px-4 text-right font-black text-emerald-600">₱{h.price.toLocaleString('en-PH')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* FULFILL SO MODAL */}
        {fulfillModal.isOpen && fulfillModal.so && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
              <div className="p-5 border-b bg-emerald-600 text-white">
                <h3 className="font-bold text-lg leading-tight tracking-wide">Fulfill Sales Order</h3>
                <p className="text-[10px] opacity-80 uppercase tracking-widest">{fulfillModal.so.soNumber} • {fulfillModal.so.customer.name}</p>
              </div>
              <form onSubmit={handleFulfillSO} className="p-6 flex flex-col gap-5">
                <div className="bg-emerald-50 text-emerald-800 p-3 rounded-xl border border-emerald-200 text-xs font-medium">
                  This will dispatch <strong>{fulfillModal.so.items.reduce((a,b)=>a+b.quantity,0)} units</strong> OUT of the selected warehouse, and INCREASE the customer's balance by <strong>₱{fulfillModal.so.totalAmount.toLocaleString('en-PH')}</strong>.
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-600 uppercase tracking-wide">Pull Stock From <span className="text-rose-500">*</span></label>
                  <select required value={fulfillWarehouseId} onChange={e => setFulfillWarehouseId(e.target.value)} className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500 shadow-sm bg-white">
                    <option value="">Select Warehouse...</option>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setFulfillModal({ isOpen: false, so: null })} className="flex-1 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors">Cancel</button>
                  <button type="submit" disabled={isProcessing} className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition-colors disabled:opacity-50">
                    {isProcessing ? 'Processing...' : 'Confirm Fulfillment'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* RETURN SO MODAL */}
        {returnModal.isOpen && returnModal.so && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
              <div className="p-5 border-b bg-rose-600 text-white">
                <h3 className="font-bold text-lg leading-tight tracking-wide">Sales Return Entry</h3>
                <p className="text-[10px] opacity-80 uppercase tracking-widest">{returnModal.so.soNumber} • {returnModal.so.customer.name}</p>
              </div>
              <form onSubmit={handleReturnSO} className="p-6 flex flex-col gap-5">
                <div className="bg-rose-50 text-rose-800 p-3 rounded-xl border border-rose-200 text-xs font-medium">
                  WARNING: This reverses the fulfillment. It will inject <strong>{returnModal.so.items.reduce((a,b)=>a+b.quantity,0)} units</strong> BACK into the selected warehouse, and DECREASE the customer's balance by <strong>₱{returnModal.so.totalAmount.toLocaleString('en-PH')}</strong>.
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-600 uppercase tracking-wide">Restore Stock To <span className="text-rose-500">*</span></label>
                  <select required value={returnWarehouseId} onChange={e => setReturnWarehouseId(e.target.value)} className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-rose-500 shadow-sm bg-white">
                    <option value="">Select Warehouse...</option>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setReturnModal({ isOpen: false, so: null })} className="flex-1 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors">Cancel</button>
                  <button type="submit" disabled={isProcessing} className="flex-1 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl transition-colors disabled:opacity-50">
                    {isProcessing ? 'Processing...' : 'Confirm Return'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <aside className={`fixed inset-y-0 left-0 z-50 transform bg-slate-900 text-slate-300 flex flex-col w-64 transition-transform duration-300 md:relative md:translate-x-0 border-r border-slate-800 shadow-2xl shrink-0 ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="h-20 flex items-center justify-between px-6 border-b border-slate-800 bg-slate-950 shrink-0">
            <h1 className="text-xl font-black text-white tracking-wider uppercase">Sales</h1>
            <button onClick={() => setIsMobileMenuOpen(false)} className="md:hidden text-slate-400 hover:text-white"><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
          </div>
          <div className="flex-1 overflow-y-auto py-6 px-3 space-y-1">
            <button onClick={() => { setActiveTab('dashboard'); setIsMobileMenuOpen(false); }} className={`w-full flex text-left gap-3 px-3 py-2.5 rounded-lg font-semibold text-sm transition-all ${activeTab === 'dashboard' ? 'bg-emerald-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}>Metrics</button>
            <div className="px-3 pt-6 pb-2 text-xs font-bold text-slate-500 uppercase tracking-widest">Master Data</div>
            <button onClick={() => { setActiveTab('customers'); setIsMobileMenuOpen(false); }} className={`w-full flex text-left gap-3 px-3 py-2.5 rounded-lg font-semibold text-sm transition-all ${activeTab === 'customers' ? 'bg-emerald-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}>Customer Directory</button>
            <div className="px-3 pt-6 pb-2 text-xs font-bold text-slate-500 uppercase tracking-widest">Operations</div>
            <button onClick={() => { setActiveTab('sales'); setIsMobileMenuOpen(false); }} className={`w-full flex text-left gap-3 px-3 py-2.5 rounded-lg font-semibold text-sm transition-all ${activeTab === 'sales' ? 'bg-emerald-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}>Sales Orders</button>
            <button onClick={() => { setActiveTab('fulfill'); setIsMobileMenuOpen(false); }} className={`w-full flex text-left gap-3 px-3 py-2.5 rounded-lg font-semibold text-sm transition-all ${activeTab === 'fulfill' ? 'bg-emerald-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}>Fulfill / Return</button>
          </div>
        </aside>

        <div className="flex-1 flex flex-col min-w-0 h-screen">
          <header className="h-auto sm:h-20 bg-white border-b border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between px-4 sm:px-8 py-3 sm:py-0 shadow-sm relative z-10 shrink-0 gap-3">
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <button onClick={() => setIsMobileMenuOpen(true)} className="md:hidden p-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 border border-slate-200 shrink-0">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
              </button>
              <div>
                <h2 className="text-lg sm:text-2xl font-extrabold text-emerald-950 tracking-tight">Sales & CRM Engine</h2>
                <div className="text-[10px] sm:text-xs font-semibold text-slate-400 mt-0.5">{selectedCompany} / Sales</div>
              </div>
            </div>
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <button onClick={() => { showToast("Syncing with database...", "success"); fetchData(); }} className="w-full sm:w-auto px-4 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-sm font-bold transition-colors border border-emerald-200 flex justify-center items-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg> Sync
              </button>
              <button onClick={onBack} className="w-full sm:w-auto px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-bold transition-colors border border-slate-200 text-center">Gateway</button>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto p-4 sm:p-8 relative z-0">
            <div className="max-w-7xl mx-auto space-y-6 pb-12">

              {activeTab === 'dashboard' && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
                   <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col justify-center">
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Active Customers</p>
                      <h3 className="text-4xl font-black text-emerald-900 mt-1">{customers.length}</h3>
                    </div>
                   <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col justify-center">
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Pending Sales</p>
                      <h3 className="text-4xl font-black text-slate-900 mt-1">{sos.filter(p=>p.status==='PENDING').length}</h3>
                    </div>
                   <div className="bg-rose-50 rounded-2xl p-6 border border-rose-100 shadow-sm flex flex-col justify-center">
                      <p className="text-xs font-bold text-rose-500 uppercase tracking-wider">Credit Limit Alerts</p>
                      <h3 className="text-4xl font-black text-rose-700 mt-1">{creditAlerts.length}</h3>
                    </div>
                </div>
              )}

              {activeTab === 'customers' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-1 bg-white rounded-2xl shadow-sm border border-slate-200 p-6 h-fit">
                    <h3 className="font-bold text-lg text-slate-900 mb-4">Register Customer</h3>
                    <form onSubmit={handleCreateCustomer} className="flex flex-col gap-4">
                      <input type="text" required value={custForm.name} onChange={e => setCustForm({...custForm, name: e.target.value})} className="px-4 py-2 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-600" placeholder="Customer / Company Name" />
                      <input type="text" value={custForm.contact} onChange={e => setCustForm({...custForm, contact: e.target.value})} className="px-4 py-2 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-600" placeholder="Contact Person" />
                      <input type="text" value={custForm.phone} onChange={e => setCustForm({...custForm, phone: e.target.value})} className="px-4 py-2 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-600" placeholder="Phone Number" />
                      <input type="email" value={custForm.email} onChange={e => setCustForm({...custForm, email: e.target.value})} className="px-4 py-2 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-600" placeholder="Email Address" />
                      <input type="text" value={custForm.address} onChange={e => setCustForm({...custForm, address: e.target.value})} className="px-4 py-2 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-600" placeholder="Complete Address" />
                      
                      <div className="flex flex-col gap-1.5 mt-2">
                        <label className="text-xs font-bold text-slate-600 uppercase tracking-wide">Authorized Credit Limit (₱)</label>
                        <input type="number" min="0" value={custForm.creditLimit} onChange={e => setCustForm({...custForm, creditLimit: Number(e.target.value)})} className="px-4 py-2 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-600 bg-emerald-50" />
                      </div>

                      <button type="submit" disabled={isProcessing} className="mt-2 py-2.5 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800 transition-colors">Add Customer</button>
                    </form>
                  </div>
                  <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                      <h3 className="font-bold text-slate-800">Directory</h3>
                      <input type="text" placeholder="Search customers..." value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs outline-none focus:ring-2 focus:ring-emerald-500 shadow-sm" />
                    </div>
                    <div className="overflow-x-auto w-full">
                      <table className="w-full text-left min-w-[800px]">
                        <thead className="bg-slate-50 border-b border-slate-200">
                          <tr>
                            <th className="py-3 px-6 text-xs font-semibold text-slate-600 uppercase">Customer</th>
                            <th className="py-3 px-6 text-xs font-semibold text-slate-600 uppercase">Contact</th>
                            <th className="py-3 px-6 text-xs font-semibold text-slate-600 uppercase text-right">Balance / Limit</th>
                            <th className="py-3 px-6 text-xs font-semibold text-slate-600 uppercase text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredCustomers.map(c => (
                            <tr key={c.id} className="hover:bg-slate-50 group">
                              <td className="py-3 px-6 font-bold text-slate-800">{c.name}</td>
                              <td className="py-3 px-6 text-sm text-slate-600">
                                <div>{c.contact || 'N/A'}</div>
                                <div className="text-xs text-slate-400">{c.phone}</div>
                              </td>
                              <td className="py-3 px-6 text-right">
                                <div className="font-black text-rose-600">₱{c.balance.toLocaleString('en-PH')} <span className="text-[10px] text-slate-400 font-normal uppercase">Owed</span></div>
                                <div className="text-[11px] font-bold text-emerald-600 mt-0.5">₱{Math.max(0, c.creditLimit - c.balance).toLocaleString('en-PH')} <span className="text-slate-400 font-normal">Avail / ₱{c.creditLimit.toLocaleString('en-PH')} Limit</span></div>
                              </td>
                              <td className="py-3 px-6 text-right opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => setHistoryModal({ isOpen: true, customerId: c.id })} className="text-sky-600 hover:text-sky-800 text-[11px] font-bold uppercase tracking-wider mr-3">History</button>
                                <button onClick={() => setEditCustomerModal({ isOpen: true, customer: c })} className="text-amber-600 hover:text-amber-800 text-[11px] font-bold uppercase tracking-wider">Edit</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'sales' && (
                <div className="space-y-6">
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                    <h3 className="font-bold text-lg text-slate-900 mb-4">Draft Sales Order</h3>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      <div className="lg:col-span-1 border-r border-slate-100 pr-0 lg:pr-6 space-y-4">
                        <select required value={soForm.customerId} onChange={e => setSoForm({...soForm, customerId: e.target.value})} className="w-full px-4 py-2 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-600 bg-white">
                          <option value="">Select Customer...</option>
                          {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        <input type="text" required value={soForm.soNumber} onChange={e => setSoForm({...soForm, soNumber: e.target.value})} className="w-full px-4 py-2 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-600" placeholder="SO Number" />
                        
                        <button 
                          type="button" 
                          onClick={() => setShowItemModal(true)} 
                          className="w-full py-3 bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold rounded-xl hover:bg-emerald-100 hover:border-emerald-300 text-sm flex flex-col items-center justify-center gap-1 transition-colors shadow-sm"
                        >
                          <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                          Browse & Add Items
                        </button>
                      </div>
                      
                      <div className="lg:col-span-2 flex flex-col">
                        <div className="flex-1 border border-slate-200 rounded-xl overflow-x-auto mb-4 min-h-[200px]">
                          <table className="w-full text-left text-sm min-w-[500px]">
                            <thead className="bg-slate-50 border-b border-slate-200">
                              <tr>
                                <th className="py-3 px-4 text-xs font-semibold text-slate-600 uppercase">Item</th>
                                <th className="py-3 px-4 text-xs font-semibold text-slate-600 uppercase text-right">Qty</th>
                                <th className="py-3 px-4 text-xs font-semibold text-slate-600 uppercase text-right">Price</th>
                                <th className="py-3 px-4 text-xs font-semibold text-slate-600 uppercase text-right">Total</th>
                                <th className="py-3 px-4 text-xs font-semibold text-slate-600 uppercase text-center w-10"></th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {soItems.length === 0 ? <tr><td colSpan={5} className="py-12 text-center text-slate-400 font-medium">Click "Browse & Add Items" to build your draft.</td></tr> :
                                soItems.map((item, i) => (
                                  <tr key={i} className="hover:bg-slate-50 group">
                                    <td className="py-2.5 px-4 font-bold text-slate-900">{item.productName} <span className="text-[10px] font-normal text-slate-400 block tracking-wider">{item.sku}</span></td>
                                    <td className="py-2.5 px-4 text-right font-bold text-slate-700">{item.quantity}</td>
                                    <td className="py-2.5 px-4 text-right font-medium text-slate-600">₱{item.unitPrice.toLocaleString('en-PH')}</td>
                                    <td className="py-2.5 px-4 text-right font-black text-emerald-700">₱{item.total.toLocaleString('en-PH')}</td>
                                    <td className="py-2.5 px-4 text-center">
                                      <button onClick={() => handleRemoveSOItem(i)} className="text-slate-300 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100" title="Remove Item">
                                        <svg className="w-4 h-4 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                      </button>
                                    </td>
                                  </tr>
                                ))
                              }
                            </tbody>
                          </table>
                        </div>
                        <div className="flex flex-col sm:flex-row justify-between items-center bg-slate-900 text-white p-4 rounded-xl gap-4 shrink-0">
                          <div className="w-full sm:w-auto text-center sm:text-left">
                            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Total Amount</p>
                            <p className="text-2xl font-black">₱{soItems.reduce((a,b)=>a+b.total,0).toLocaleString('en-PH')}</p>
                          </div>
                          <button onClick={handleCreateSO} disabled={isProcessing || soItems.length === 0 || !soForm.customerId} className="w-full sm:w-auto px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-slate-900 font-black rounded-lg transition-colors disabled:opacity-50">Generate Order</button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                      <h3 className="font-bold text-slate-800">SO History & Approvals</h3>
                      <input type="text" placeholder="Search orders..." value={soSearch} onChange={e => setSoSearch(e.target.value)} className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs outline-none focus:ring-2 focus:ring-emerald-500 shadow-sm" />
                    </div>
                    <div className="overflow-x-auto w-full">
                      <table className="w-full text-left min-w-[800px]">
                        <thead className="bg-white border-b border-slate-200">
                          <tr>
                            <th className="py-3 px-6 text-xs font-semibold text-slate-600 uppercase">SO Number</th>
                            <th className="py-3 px-6 text-xs font-semibold text-slate-600 uppercase">Customer</th>
                            <th className="py-3 px-6 text-xs font-semibold text-slate-600 uppercase text-right">Total</th>
                            <th className="py-3 px-6 text-xs font-semibold text-slate-600 uppercase">Status</th>
                            <th className="py-3 px-6 text-xs font-semibold text-slate-600 uppercase text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredSOs.map(so => (
                            <tr key={so.id} className="hover:bg-slate-50 group">
                              <td className="py-3 px-6 font-bold text-slate-800">{so.soNumber} <div className="text-[10px] text-slate-400 font-normal">{new Date(so.date).toLocaleDateString()}</div></td>
                              <td className="py-3 px-6 text-sm font-bold text-slate-700">{so.customer?.name}</td>
                              <td className="py-3 px-6 text-right font-black text-slate-800">₱{so.totalAmount.toLocaleString('en-PH')}</td>
                              <td className="py-3 px-6">
                                <span className={`px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest ${so.status === 'PENDING' ? 'bg-amber-100 text-amber-800' : so.status === 'APPROVED' ? 'bg-sky-100 text-sky-800' : so.status === 'FULFILLED' ? 'bg-emerald-100 text-emerald-800' : so.status === 'RETURNED' ? 'bg-rose-100 text-rose-800' : 'bg-slate-200 text-slate-800'}`}>{so.status}</span>
                              </td>
                              <td className="py-3 px-6 text-right">
                                <button onClick={() => handlePrintSO(so)} className="text-slate-400 hover:text-slate-800 transition-colors mr-4 opacity-0 group-hover:opacity-100" title="Print Invoice">
                                  <svg className="w-5 h-5 inline-block" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                                </button>
                                
                                {so.status === 'PENDING' && <button onClick={() => handleUpdateSOStatus(so, 'APPROVED')} className="text-sky-600 hover:text-sky-800 text-[11px] font-bold uppercase tracking-wider">Approve</button>}
                                {so.status === 'FULFILLED' && <button onClick={() => setReturnModal({ isOpen: true, so })} className="text-rose-600 hover:text-rose-800 text-[11px] font-bold uppercase tracking-wider">Return / Revert</button>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'fulfill' && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="p-4 sm:p-6 border-b border-slate-200 bg-emerald-50/30">
                    <h3 className="font-bold text-lg text-slate-900">Approved Orders Awaiting Fulfillment</h3>
                    <p className="text-xs text-slate-500 mt-1">Select an approved order to dispatch physical stock and bill the customer.</p>
                  </div>
                  <div className="overflow-x-auto w-full pb-4">
                    <table className="w-full text-left min-w-[800px] border-collapse">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">SO Details</th>
                          <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Customer</th>
                          <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Total Items</th>
                          <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {sos.filter(s => s.status === 'APPROVED').length === 0 ? (
                          <tr><td colSpan={4} className="py-8 text-center text-sm font-medium text-slate-500">No approved SOs pending fulfillment.</td></tr>
                        ) : sos.filter(s => s.status === 'APPROVED').map(so => (
                          <tr key={so.id} className="hover:bg-emerald-50/30 transition-colors">
                            <td className="py-4 px-6">
                              <div className="font-bold text-slate-900">{so.soNumber}</div>
                              <div className="text-[10px] text-slate-400 font-mono mt-0.5 tracking-wider">{new Date(so.date).toLocaleString()}</div>
                            </td>
                            <td className="py-4 px-6 font-bold text-slate-700 text-sm">{so.customer.name}</td>
                            <td className="py-4 px-6 text-sm text-slate-600 font-bold">{so.items.reduce((a,b)=>a+b.quantity,0)} Units</td>
                            <td className="py-4 px-6 text-right">
                              <button onClick={() => setFulfillModal({ isOpen: true, so })} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold uppercase tracking-wider rounded-lg transition-colors shadow-sm">Dispatch & Fulfill</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </>
  );
}