import React, { useState, useEffect } from 'react';

interface Supplier { id: string; name: string; contact: string; phone: string; email: string; balance: number; }
interface POItem { id?: string; productId: number; sku: string; productName: string; quantity: number; unitPrice: number; total: number; }
interface PurchaseOrder { id: string; poNumber: string; supplierId: string; supplier: Supplier; date: string; status: 'PENDING' | 'APPROVED' | 'RECEIVED' | 'RETURNED' | 'CANCELLED'; totalAmount: number; items: POItem[]; user: string; }
interface Product { id: number; name: string; sku: string; purchasePrice: number; currentStock: number; reorderLevel: number; }
interface Warehouse { id: string; name: string; }

export default function PurchaseOrderModule({ selectedCompany, loginUsername, API_BASE_URL, onBack }: any) {
  const [activeTab, setActiveTab] = useState<'create' | 'history' | 'receive'>('create');
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  // Draft States
  const [poForm, setPoForm] = useState({ supplierId: '', poNumber: `PO-${Date.now().toString().slice(-6)}` });
  const [poItems, setPoItems] = useState<POItem[]>([]);
  const [showItemModal, setShowItemModal] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [tempSelectedItems, setTempSelectedItems] = useState<Record<number, { checked: boolean, qty: number, price: number }>>({});

  // Action Modals
  const [receiveModal, setReceiveModal] = useState<{ isOpen: boolean, po: PurchaseOrder | null }>({ isOpen: false, po: null });
  const [receiveWarehouseId, setReceiveWarehouseId] = useState('');
  const [returnModal, setReturnModal] = useState<{ isOpen: boolean, po: PurchaseOrder | null }>({ isOpen: false, po: null });
  const [returnWarehouseId, setReturnWarehouseId] = useState('');
  const [printPO, setPrintPO] = useState<PurchaseOrder | null>(null);

  const showToast = (msg: string, type: 'success' | 'error') => { setToast({ message: msg, type }); setTimeout(() => setToast(null), 3500); };

  const fetchData = async () => {
    try {
      const [supRes, poRes, prodRes, whRes] = await Promise.all([
        fetch(`${API_BASE_URL}/purchasing/suppliers?company=${selectedCompany}`),
        fetch(`${API_BASE_URL}/purchasing/pos?company=${selectedCompany}`),
        fetch(`${API_BASE_URL}/products?company=${selectedCompany}`),
        fetch(`${API_BASE_URL}/warehouses?company=${selectedCompany}`)
      ]);
      if (supRes.ok) setSuppliers(await supRes.json());
      if (poRes.ok) setPos(await poRes.json());
      if (prodRes.ok) setProducts(await prodRes.json());
      if (whRes.ok) setWarehouses(await whRes.json());
    } catch (e) { console.warn("Backend not ready."); }
  };

  useEffect(() => { fetchData(); }, [selectedCompany]);

  const filteredProducts = products.filter(p => p.name.toLowerCase().includes(productSearch.toLowerCase()) || p.sku.toLowerCase().includes(productSearch.toLowerCase()));
  
  const handleToggleProduct = (p: Product) => {
    setTempSelectedItems(prev => {
      const exists = prev[p.id];
      if (exists?.checked) return { ...prev, [p.id]: { ...exists, checked: false } };
      return { ...prev, [p.id]: { checked: true, qty: 1, price: p.purchasePrice || 0 } }; 
    });
  };

  const handleUpdateTempItem = (id: number, field: 'qty' | 'price', value: number) => { setTempSelectedItems(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } })); };

  const handleConfirmAddItems = () => {
    const newItems = Object.entries(tempSelectedItems).filter(([_, data]) => data.checked).map(([id, data]) => {
        const p = products.find(prod => prod.id === Number(id))!;
        return { productId: p.id, sku: p.sku, productName: p.name, quantity: data.qty, unitPrice: data.price, total: data.qty * data.price };
      });
    if (newItems.length === 0) return showToast("No items selected.", "error");
    setPoItems([...poItems, ...newItems]); setShowItemModal(false); setTempSelectedItems({}); setProductSearch('');
    showToast(`Added ${newItems.length} items to order.`, "success");
  };

  const handleCreatePO = async (e: React.FormEvent) => {
    e.preventDefault(); if (poItems.length === 0) return showToast("Add at least one item.", "error");
    
    setIsProcessing(true);
    try {
      const totalAmount = poItems.reduce((acc, item) => acc + item.total, 0);
      const res = await fetch(`${API_BASE_URL}/purchasing/pos`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ company: selectedCompany, ...poForm, totalAmount, items: poItems, user: loginUsername, status: 'PENDING' }) });
      if(!res.ok) throw new Error();
      fetchData(); showToast("Purchase Order draft generated.", "success");
      setPoItems([]); setPoForm({ supplierId: '', poNumber: `PO-${Date.now().toString().slice(-6)}` });
      setActiveTab('history');
    } catch (e) { showToast("Failed to create PO.", "error"); } finally { setIsProcessing(false); }
  };

  const handleUpdatePOStatus = async (id: string, status: string) => {
    setIsProcessing(true);
    try {
      const res = await fetch(`${API_BASE_URL}/purchasing/pos/${id}/status`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ status }) });
      if(!res.ok) throw new Error();
      fetchData(); showToast(`Order marked as ${status}.`, "success");
    } catch (e) { showToast("Failed to update status.", "error"); } finally { setIsProcessing(false); }
  };

  const handleReceivePO = async (e: React.FormEvent) => {
    e.preventDefault(); if (!receiveModal.po || !receiveWarehouseId) return showToast("Select a receiving warehouse.", "error");
    setIsProcessing(true);
    try {
      const po = receiveModal.po;
      await fetch(`${API_BASE_URL}/purchasing/pos/${po.id}/status`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ status: 'RECEIVED' }) });
      await fetch(`${API_BASE_URL}/purchasing/suppliers/${po.supplierId}/balance`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ amount: po.totalAmount }) }); 
      for (const item of po.items) {
        await fetch(`${API_BASE_URL}/warehouse-stock`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ company: selectedCompany, warehouseId: receiveWarehouseId, productId: item.productId, sku: item.sku, quantity: item.quantity }) });
        const prod = products.find(p => p.id === item.productId);
        if (prod) await fetch(`${API_BASE_URL}/products/${item.productId}`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ currentStock: (prod.currentStock || 0) + item.quantity }) });
      }
      fetchData(); showToast("PO Received! Stock and payables updated.", "success");
      setReceiveModal({ isOpen: false, po: null }); setReceiveWarehouseId('');
    } catch (e) { showToast("Error processing receipt.", "error"); } finally { setIsProcessing(false); }
  };

  const handleReturnPO = async (e: React.FormEvent) => {
    e.preventDefault(); if (!returnModal.po || !returnWarehouseId) return showToast("Select warehouse to pull stock from.", "error");
    setIsProcessing(true);
    try {
      const po = returnModal.po;
      await fetch(`${API_BASE_URL}/purchasing/pos/${po.id}/status`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ status: 'RETURNED' }) });
      await fetch(`${API_BASE_URL}/purchasing/suppliers/${po.supplierId}/balance`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ amount: -po.totalAmount }) });
      for (const item of po.items) {
        await fetch(`${API_BASE_URL}/warehouse-stock`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ company: selectedCompany, warehouseId: returnWarehouseId, productId: item.productId, sku: item.sku, quantity: -item.quantity }) });
        const prod = products.find(p => p.id === item.productId);
        if (prod) await fetch(`${API_BASE_URL}/products/${item.productId}`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ currentStock: Math.max(0, (prod.currentStock || 0) - item.quantity) }) });
      }
      fetchData(); showToast("PO Returned! Stock deducted and payables reduced.", "success");
      setReturnModal({ isOpen: false, po: null }); setReturnWarehouseId('');
    } catch (e) { showToast("Error processing return.", "error"); } finally { setIsProcessing(false); }
  };

  const getCompanyDetails = () => {
    if (selectedCompany.toLowerCase().includes('wilcare')) {
      return { name: 'Wilcare Trading Corp.', address: '1457-A Rizal Ave. Sta. Cruz Manila', tel: '(02)87330879, 87333950', mob: '09157739968, 09164394073', email: 'wilcaremanila@gmail.com', web: 'www.wilcare.com.ph' };
    }
    return { name: `${selectedCompany} Corporation`, address: 'Main Corporate Headquarters', tel: 'Contact System Admin', mob: 'N/A', email: `purchasing@${selectedCompany.toLowerCase().replace(/\s/g, '')}.com`, web: `www.${selectedCompany.toLowerCase().replace(/\s/g, '')}.com` };
  };
  const companyMeta = getCompanyDetails();

  return (
    <div className="flex h-screen w-full bg-[#F8FAFC] font-sans text-slate-900 overflow-hidden print:hidden">
      {toast && <div className={`fixed bottom-6 right-6 z-[100] px-5 py-3.5 rounded-xl shadow-xl font-bold text-sm ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>{toast.message}</div>}

      <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col border-r border-slate-800 shrink-0 hidden md:flex">
        <div className="h-20 flex items-center px-6 border-b border-slate-800 bg-slate-950"><h1 className="text-xl font-black text-white uppercase tracking-wider">Procurement</h1></div>
        <div className="flex-1 py-6 px-3 space-y-1">
          <button onClick={() => setActiveTab('create')} className={`w-full text-left px-4 py-3 rounded-lg font-bold text-sm transition-all ${activeTab === 'create' ? 'bg-amber-600 text-white shadow-md' : 'hover:bg-slate-800'}`}>Draft Purchase Order</button>
          <button onClick={() => setActiveTab('history')} className={`w-full text-left px-4 py-3 rounded-lg font-bold text-sm transition-all ${activeTab === 'history' ? 'bg-amber-600 text-white shadow-md' : 'hover:bg-slate-800'}`}>PO Approvals</button>
          <button onClick={() => setActiveTab('receive')} className={`w-full text-left px-4 py-3 rounded-lg font-bold text-sm transition-all ${activeTab === 'receive' ? 'bg-amber-600 text-white shadow-md' : 'hover:bg-slate-800'}`}>Receive & Stock</button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 h-screen">
        <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0 shadow-sm z-10">
          <div><h2 className="text-2xl font-black text-amber-950 tracking-tight">Purchase Order Engine</h2></div>
          <button onClick={onBack} className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors">Gateway</button>
        </header>

        <main className="flex-1 overflow-y-auto p-8 relative">
          <div className="max-w-7xl mx-auto">
            
            {activeTab === 'create' && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
                <h3 className="font-black text-xl text-slate-900 mb-6 tracking-tight">Generate Purchase Order</h3>
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                  <div className="lg:col-span-1 border-r border-slate-100 pr-0 lg:pr-8 space-y-5">
                    <select required value={poForm.supplierId} onChange={e => setPoForm({...poForm, supplierId: e.target.value})} className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-amber-600 bg-slate-50">
                      <option value="">Select Vendor...</option>
                      {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <input type="text" required value={poForm.poNumber} onChange={e => setPoForm({...poForm, poNumber: e.target.value})} className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-amber-600" />
                    <button type="button" onClick={() => setShowItemModal(true)} className="w-full py-4 bg-amber-50 border border-amber-200 text-amber-800 font-black tracking-wide uppercase rounded-xl hover:bg-amber-100 transition-colors shadow-sm text-xs">Browse & Add Items</button>
                  </div>
                  
                  <div className="lg:col-span-3 flex flex-col">
                    <div className="flex-1 border border-slate-200 rounded-xl overflow-hidden mb-6 min-h-[300px] bg-slate-50">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-100 border-b border-slate-200">
                          <tr><th className="py-4 px-5 text-xs font-bold text-slate-500 uppercase">Item</th><th className="py-4 px-5 text-xs font-bold text-slate-500 uppercase text-right">Qty</th><th className="py-4 px-5 text-xs font-bold text-slate-500 uppercase text-right">Cost</th><th className="py-4 px-5 text-xs font-bold text-slate-500 uppercase text-right">Total</th><th className="w-12"></th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 bg-white">
                          {poItems.length === 0 ? <tr><td colSpan={5} className="py-16 text-center text-slate-400 font-medium">Cart is empty.</td></tr> :
                            poItems.map((item, i) => (
                              <tr key={i} className="group">
                                <td className="py-3 px-5 font-bold text-slate-900">{item.productName} <span className="text-[10px] font-mono text-slate-400 block mt-0.5">{item.sku}</span></td>
                                <td className="py-3 px-5 text-right font-black text-slate-700">{item.quantity}</td>
                                <td className="py-3 px-5 text-right font-medium text-slate-600">₱{item.unitPrice.toLocaleString()}</td>
                                <td className="py-3 px-5 text-right font-black text-amber-700">₱{item.total.toLocaleString()}</td>
                                <td className="py-3 px-5 text-center"><button onClick={() => setPoItems(poItems.filter((_, idx) => idx !== i))} className="text-slate-300 hover:text-rose-500">✕</button></td>
                              </tr>
                            ))
                          }
                        </tbody>
                      </table>
                    </div>
                    <div className="flex justify-between items-center bg-slate-900 text-white p-5 rounded-xl">
                      <div><p className="text-xs font-bold uppercase tracking-widest text-slate-400">Total Draft Value</p><p className="text-3xl font-black">₱{poItems.reduce((a,b)=>a+b.total,0).toLocaleString('en-PH')}</p></div>
                      <button onClick={handleCreatePO} disabled={isProcessing || poItems.length === 0 || !poForm.supplierId} className="px-8 py-3.5 bg-amber-500 hover:bg-amber-600 text-slate-900 font-black uppercase tracking-wider rounded-xl transition-colors disabled:opacity-50">Generate PO</button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'history' && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-5 border-b border-slate-200 bg-slate-50"><h3 className="font-bold text-slate-800 text-lg">Purchase Order Ledger</h3></div>
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr><th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest">Order Ref</th><th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest">Vendor</th><th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">Value</th><th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest">Status</th><th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">Actions</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pos.map(po => (
                      <tr key={po.id} className="hover:bg-slate-50">
                        <td className="py-4 px-6 font-black text-slate-800">{po.poNumber} <div className="text-[10px] text-slate-400 font-mono font-medium">{new Date(po.date).toLocaleDateString()}</div></td>
                        <td className="py-4 px-6 font-bold text-slate-700">{po.supplier?.name}</td>
                        <td className="py-4 px-6 text-right font-black text-amber-700">₱{po.totalAmount.toLocaleString()}</td>
                        <td className="py-4 px-6"><span className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-widest border ${po.status === 'PENDING' ? 'border-amber-200 bg-amber-50 text-amber-700' : po.status === 'APPROVED' ? 'border-sky-200 bg-sky-50 text-sky-700' : po.status === 'RECEIVED' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-700'}`}>{po.status}</span></td>
                        <td className="py-4 px-6 text-right">
                          <button onClick={() => setPrintPO(po)} className="text-slate-400 hover:text-slate-900 mr-4 font-bold text-[11px] uppercase tracking-wider">Print</button>
                          {po.status === 'PENDING' && <button onClick={() => handleUpdatePOStatus(po.id, 'APPROVED')} className="text-sky-600 hover:text-sky-800 font-black text-[11px] uppercase tracking-wider">Approve</button>}
                          {po.status === 'RECEIVED' && <button onClick={() => setReturnModal({ isOpen: true, po })} className="text-rose-600 hover:text-rose-800 font-black text-[11px] uppercase tracking-wider">Return</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === 'receive' && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-6 border-b border-slate-200 bg-amber-50"><h3 className="font-bold text-slate-900 text-lg tracking-tight">Receiving & Stocking</h3><p className="text-xs text-slate-600 font-medium">Process approved orders to inject stock and update accounts payable.</p></div>
                <table className="w-full text-left text-sm">
                  <thead className="bg-white border-b border-slate-200">
                    <tr><th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest">Order Ref</th><th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest">Vendor</th><th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest">Units</th><th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">Process</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pos.filter(p => p.status === 'APPROVED').length === 0 ? <tr><td colSpan={4} className="py-12 text-center text-slate-400 font-medium">No approved POs pending receipt.</td></tr> :
                      pos.filter(p => p.status === 'APPROVED').map(po => (
                        <tr key={po.id} className="hover:bg-slate-50">
                          <td className="py-4 px-6 font-black text-slate-900">{po.poNumber}</td>
                          <td className="py-4 px-6 font-bold text-slate-700">{po.supplier.name}</td>
                          <td className="py-4 px-6 font-black text-slate-600">{po.items.reduce((a,b)=>a+b.quantity,0)} Items</td>
                          <td className="py-4 px-6 text-right"><button onClick={() => setReceiveModal({ isOpen: true, po })} className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-colors shadow-sm">Receive Order</button></td>
                        </tr>
                      ))
                    }
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* RECEIVE MODAL */}
      {receiveModal.isOpen && receiveModal.po && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-5 border-b bg-amber-600 text-white"><h3 className="font-bold text-lg tracking-wide">Receive Stock</h3><p className="text-[10px] uppercase opacity-80 tracking-widest">{receiveModal.po.poNumber}</p></div>
            <form onSubmit={handleReceivePO} className="p-6 flex flex-col gap-5 bg-slate-50">
              <div className="bg-white border border-slate-200 p-4 rounded-xl text-xs font-bold text-slate-700 shadow-sm">This action logs physical units and registers ₱{receiveModal.po.totalAmount.toLocaleString()} to Accounts Payable.</div>
              <select required value={receiveWarehouseId} onChange={e => setReceiveWarehouseId(e.target.value)} className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-amber-500 bg-white">
                <option value="">Select Destination Warehouse...</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setReceiveModal({ isOpen: false, po: null })} className="flex-1 px-4 py-3 bg-white border border-slate-300 text-slate-700 font-bold rounded-xl transition-colors">Cancel</button>
                <button type="submit" disabled={isProcessing} className="flex-1 px-4 py-3 bg-amber-600 hover:bg-amber-700 text-white font-black uppercase tracking-wider rounded-xl transition-colors shadow-sm disabled:opacity-50">Confirm Receipt</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RETURN MODAL */}
      {returnModal.isOpen && returnModal.po && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-5 border-b bg-rose-600 text-white"><h3 className="font-bold text-lg tracking-wide">Return Purchase Order</h3><p className="text-[10px] uppercase opacity-80 tracking-widest">{returnModal.po.poNumber}</p></div>
            <form onSubmit={handleReturnPO} className="p-6 flex flex-col gap-5 bg-slate-50">
              <div className="bg-white border border-slate-200 p-4 rounded-xl text-xs font-bold text-slate-700 shadow-sm">WARNING: This reverses the receipt, pulls units OUT of the warehouse, and reduces the payable by ₱{returnModal.po.totalAmount.toLocaleString()}.</div>
              <select required value={returnWarehouseId} onChange={e => setReturnWarehouseId(e.target.value)} className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-rose-500 bg-white">
                <option value="">Select Origin Warehouse...</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setReturnModal({ isOpen: false, po: null })} className="flex-1 px-4 py-3 bg-white border border-slate-300 text-slate-700 font-bold rounded-xl transition-colors">Cancel</button>
                <button type="submit" disabled={isProcessing} className="flex-1 px-4 py-3 bg-rose-600 hover:bg-rose-700 text-white font-black uppercase tracking-wider rounded-xl transition-colors shadow-sm disabled:opacity-50">Confirm Return</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ITEM BROWSER MODAL */}
      {showItemModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-slate-200 bg-slate-50 flex justify-between items-center shrink-0">
              <h3 className="font-bold text-lg text-slate-900 tracking-tight">Select Products</h3>
              <button onClick={() => setShowItemModal(false)} className="text-slate-400 hover:text-slate-700">✕</button>
            </div>
            <div className="p-4 border-b border-slate-200 bg-white shrink-0"><input type="text" placeholder="Search by SKU or Name..." value={productSearch} onChange={e => setProductSearch(e.target.value)} className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-amber-500" /></div>
            <div className="overflow-y-auto p-2 bg-slate-50 flex-1">
              {filteredProducts.map(p => {
                const isChecked = tempSelectedItems[p.id]?.checked || false;
                return (
                  <div key={p.id} className={`flex flex-col sm:flex-row justify-between gap-4 p-4 rounded-xl border transition-colors mb-2 ${isChecked ? 'bg-amber-50/50 border-amber-300' : 'bg-white border-slate-200'}`}>
                    <label className="flex items-center gap-3 cursor-pointer w-full sm:w-1/2">
                      <input type="checkbox" checked={isChecked} onChange={() => handleToggleProduct(p)} className="w-5 h-5 text-amber-600 rounded cursor-pointer" />
                      <div><p className="font-bold text-sm text-slate-900">{p.name}</p><p className="text-[10px] text-slate-500 font-mono tracking-wider">{p.sku}</p></div>
                    </label>
                    {isChecked && (
                      <div className="flex gap-3 w-full sm:w-1/2">
                        <div className="w-1/3"><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">Qty</label><input type="number" min="1" value={tempSelectedItems[p.id]?.qty || 1} onChange={e => handleUpdateTempItem(p.id, 'qty', Number(e.target.value))} className="w-full px-3 py-2 text-sm font-black border border-amber-200 rounded-lg outline-none" /></div>
                        <div className="w-2/3"><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">Unit Cost (₱)</label><input type="number" min="0" value={tempSelectedItems[p.id]?.price} onChange={e => handleUpdateTempItem(p.id, 'price', Number(e.target.value))} className="w-full px-3 py-2 text-sm font-black border border-amber-200 rounded-lg outline-none" /></div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="p-5 border-t border-slate-200 bg-white flex gap-3">
              <button onClick={() => setShowItemModal(false)} className="flex-1 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl">Cancel</button>
              <button onClick={handleConfirmAddItems} className="flex-1 py-3 bg-amber-600 text-white font-black uppercase tracking-wider rounded-xl shadow-sm">Add Items</button>
            </div>
          </div>
        </div>
      )}

      {/* PRINT LAYER */}
      {printPO && (
        <div className="hidden print:block fixed inset-0 w-full h-full bg-white z-[99999] text-black font-sans p-4">
          <div className="flex justify-between items-start border-b-2 border-slate-800 pb-6 mb-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-slate-900 text-white rounded-lg flex items-center justify-center text-3xl font-serif font-bold italic border-2 border-slate-900">{companyMeta.name.charAt(0)}</div>
              <div><h1 className="text-2xl font-black tracking-tight text-slate-900 uppercase">{companyMeta.name}</h1><p className="text-sm font-medium text-slate-600 mt-1">{companyMeta.address}</p></div>
            </div>
            <div className="text-right text-xs text-slate-600 space-y-0.5 mt-1">
              <p><span className="font-bold text-slate-800">Tel:</span> {companyMeta.tel}</p>
              <p><span className="font-bold text-slate-800">Mob:</span> {companyMeta.mob}</p>
              <p><span className="font-bold text-slate-800">Email:</span> {companyMeta.email}</p>
              <p><span className="font-bold text-slate-800">Web:</span> {companyMeta.web}</p>
            </div>
          </div>

          <div className="text-center mb-8">
            <h2 className="text-3xl font-black tracking-widest text-slate-900 uppercase">{printPO.status === 'RECEIVED' ? 'Receiving Report' : printPO.status === 'RETURNED' ? 'Return Receipt' : 'Purchase Order'}</h2>
            <div className="inline-block mt-2 px-3 py-1 border border-slate-300 rounded font-bold text-xs uppercase tracking-widest bg-slate-50">{printPO.status}</div>
          </div>

          <div className="flex justify-between mb-8 text-sm">
            <div className="w-1/2 pr-4">
              <h3 className="font-bold text-slate-500 uppercase tracking-widest text-[10px] mb-2 border-b border-slate-200 pb-1">Supplier Details</h3>
              <p className="font-black text-lg text-slate-800 uppercase">{printPO.supplier.name}</p>
              <p className="text-slate-600 mt-1 font-medium">{printPO.supplier.contact || 'No Contact Specified'}</p>
              <p className="text-slate-600 font-medium">{printPO.supplier.phone || 'N/A'} • {printPO.supplier.email || 'N/A'}</p>
            </div>
            <div className="w-1/2 pl-4 text-right">
              <h3 className="font-bold text-slate-500 uppercase tracking-widest text-[10px] mb-2 border-b border-slate-200 pb-1">Order Details</h3>
              <p className="font-medium text-slate-600 mt-1">Order Reference: <span className="font-bold text-slate-900">{printPO.poNumber}</span></p>
              <p className="font-medium text-slate-600">Date Logged: <span className="font-bold text-slate-900">{new Date(printPO.date).toLocaleString()}</span></p>
              <p className="font-medium text-slate-600">Processed By: <span className="font-bold text-slate-900 uppercase">{printPO.user}</span></p>
            </div>
          </div>

          <table className="w-full text-left border-collapse mb-8 text-sm">
            <thead className="bg-slate-100 border-y-2 border-slate-800">
              <tr><th className="py-3 px-4 font-bold uppercase tracking-wider text-xs">Item Description</th><th className="py-3 px-4 font-bold uppercase tracking-wider text-xs text-center">SKU</th><th className="py-3 px-4 font-bold uppercase tracking-wider text-xs text-center">Qty</th><th className="py-3 px-4 font-bold uppercase tracking-wider text-xs text-right">Unit Price</th><th className="py-3 px-4 font-bold uppercase tracking-wider text-xs text-right">Total Amount</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {printPO.items.map((item, i) => (
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
              <div className="flex justify-between items-center"><span className="font-bold text-slate-600 uppercase tracking-widest text-xs">Total Units</span><span className="font-black text-slate-900">{printPO.items.reduce((acc, curr) => acc + curr.quantity, 0)}</span></div>
              <div className="border-t border-slate-300 my-2"></div>
              <div className="flex justify-between items-center"><span className="font-bold text-slate-900 uppercase tracking-widest text-sm">Grand Total</span><span className="font-black text-2xl text-slate-900">₱{printPO.totalAmount.toLocaleString('en-PH', {minimumFractionDigits: 2})}</span></div>
            </div>
          </div>

          <div className="flex justify-between items-end pt-12 mt-12 break-inside-avoid">
            <div className="w-1/3 text-center"><div className="border-t-2 border-slate-400 pt-2 font-bold text-slate-800 uppercase text-xs tracking-widest">Prepared By</div><div className="text-slate-500 text-[10px] mt-1 uppercase">{printPO.user}</div></div>
            <div className="w-1/3 text-center"><div className="border-t-2 border-slate-400 pt-2 font-bold text-slate-800 uppercase text-xs tracking-widest">Authorized By</div><div className="text-slate-500 text-[10px] mt-1">Management Signature</div></div>
            <div className="w-1/3 text-center"><div className="border-t-2 border-slate-400 pt-2 font-bold text-slate-800 uppercase text-xs tracking-widest">Supplier Acceptance</div><div className="text-slate-500 text-[10px] mt-1">Date & Signature</div></div>
          </div>

          <div className="fixed bottom-4 left-0 w-full text-center text-[9px] text-slate-400 font-mono tracking-widest uppercase">Document auto-generated by the Procurement Engine • Ref: {printPO.id}</div>
        </div>
      )}
    </div>
  );
}