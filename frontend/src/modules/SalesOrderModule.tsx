import React, { useState, useEffect } from 'react';

interface Customer { id: string; name: string; contact: string; phone: string; email: string; address: string; creditLimit: number; balance: number; }
interface SOItem { id?: string; productId: number; sku: string; productName: string; quantity: number; unitPrice: number; total: number; }
interface SalesOrder { id: string; soNumber: string; customerId: string; customer: Customer; date: string; status: 'PENDING' | 'APPROVED' | 'FULFILLED' | 'RETURNED' | 'CANCELLED'; totalAmount: number; items: SOItem[]; user: string; }
interface Product { id: number; name: string; sku: string; purchasePrice: number; currentStock: number; reorderLevel: number; }
interface Warehouse { id: string; name: string; }

export default function SalesOrderModule({ selectedCompany, loginUsername, API_BASE_URL, onBack }: any) {
  const [activeTab, setActiveTab] = useState<'create' | 'history' | 'fulfill'>('create');
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sos, setSos] = useState<SalesOrder[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  // Draft States
  const [soForm, setSoForm] = useState({ customerId: '', soNumber: `SO-${Date.now().toString().slice(-6)}` });
  const [soItems, setSoItems] = useState<SOItem[]>([]);
  const [showItemModal, setShowItemModal] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [tempSelectedItems, setTempSelectedItems] = useState<Record<number, { checked: boolean, qty: number, price: number }>>({});

  // Action Modals
  const [fulfillModal, setFulfillModal] = useState<{ isOpen: boolean, so: SalesOrder | null }>({ isOpen: false, so: null });
  const [fulfillWarehouseId, setFulfillWarehouseId] = useState('');
  const [printSO, setPrintSO] = useState<SalesOrder | null>(null);

  const showToast = (msg: string, type: 'success' | 'error') => { setToast({ message: msg, type }); setTimeout(() => setToast(null), 3500); };

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

  const filteredProducts = products.filter(p => p.name.toLowerCase().includes(productSearch.toLowerCase()) || p.sku.toLowerCase().includes(productSearch.toLowerCase()));
  
  const handleToggleProduct = (p: Product) => {
    setTempSelectedItems(prev => {
      const exists = prev[p.id];
      if (exists?.checked) return { ...prev, [p.id]: { ...exists, checked: false } };
      return { ...prev, [p.id]: { checked: true, qty: 1, price: p.purchasePrice ? p.purchasePrice * 1.3 : 0 } }; 
    });
  };

  const handleUpdateTempItem = (id: number, field: 'qty' | 'price', value: number) => { setTempSelectedItems(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } })); };

  const handleConfirmAddItems = () => {
    const newItems = Object.entries(tempSelectedItems).filter(([_, data]) => data.checked).map(([id, data]) => {
        const p = products.find(prod => prod.id === Number(id))!;
        return { productId: p.id, sku: p.sku, productName: p.name, quantity: data.qty, unitPrice: data.price, total: data.qty * data.price };
      });
    if (newItems.length === 0) return showToast("No items selected.", "error");
    setSoItems([...soItems, ...newItems]); setShowItemModal(false); setTempSelectedItems({}); setProductSearch('');
    showToast(`Added ${newItems.length} items to order.`, "success");
  };

  const handleCreateSO = async (e: React.FormEvent) => {
    e.preventDefault(); if (soItems.length === 0) return showToast("Add at least one item.", "error");
    const cust = customers.find(c => c.id === soForm.customerId);
    const totalAmount = soItems.reduce((acc, item) => acc + item.total, 0);
    
    if (cust && cust.creditLimit > 0 && totalAmount > (cust.creditLimit - cust.balance)) {
      showToast(`Draft Alert: Order exceeds available credit limit.`, "error");
    }

    setIsProcessing(true);
    try {
      const res = await fetch(`${API_BASE_URL}/sales/orders`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ company: selectedCompany, ...soForm, totalAmount, items: soItems, user: loginUsername, status: 'PENDING' }) });
      if(!res.ok) throw new Error();
      fetchData(); showToast("Sales Order draft generated.", "success");
      setSoItems([]); setSoForm({ customerId: '', soNumber: `SO-${Date.now().toString().slice(-6)}` });
      setActiveTab('history');
    } catch (e) { showToast("Failed to create SO.", "error"); } finally { setIsProcessing(false); }
  };

  const handleUpdateSOStatus = async (so: SalesOrder, status: string) => {
    if (status === 'APPROVED') {
      const cust = customers.find(c => c.id === so.customerId);
      if (cust && cust.creditLimit > 0 && so.totalAmount > (cust.creditLimit - cust.balance)) { return showToast(`Denied: Order exceeds available credit.`, "error"); }
    }
    setIsProcessing(true);
    try {
      const res = await fetch(`${API_BASE_URL}/sales/orders/${so.id}/status`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ status }) });
      if(!res.ok) throw new Error();
      fetchData(); showToast(`Order marked as ${status}.`, "success");
    } catch (e) { showToast("Failed to update status.", "error"); } finally { setIsProcessing(false); }
  };

  const handleFulfillSO = async (e: React.FormEvent) => {
    e.preventDefault(); if (!fulfillModal.so || !fulfillWarehouseId) return showToast("Select a dispatch warehouse.", "error");
    setIsProcessing(true);
    try {
      const so = fulfillModal.so;
      await fetch(`${API_BASE_URL}/sales/orders/${so.id}/status`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ status: 'FULFILLED' }) });
      await fetch(`${API_BASE_URL}/sales/customers/${so.customerId}/balance`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ amount: so.totalAmount }) }); 
      for (const item of so.items) {
        await fetch(`${API_BASE_URL}/warehouse-stock`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ company: selectedCompany, warehouseId: fulfillWarehouseId, productId: item.productId, sku: item.sku, quantity: -item.quantity }) });
        const prod = products.find(p => p.id === item.productId);
        if (prod) await fetch(`${API_BASE_URL}/products/${item.productId}`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ currentStock: Math.max(0, (prod.currentStock || 0) - item.quantity) }) });
      }
      fetchData(); showToast("Order Fulfilled!", "success");
      setFulfillModal({ isOpen: false, so: null }); setFulfillWarehouseId('');
    } catch (e) { showToast("Error processing fulfillment.", "error"); } finally { setIsProcessing(false); }
  };

  return (
    <div className="flex h-screen w-full bg-[#F8FAFC] font-sans text-slate-900 overflow-hidden print:hidden">
      {toast && <div className={`fixed bottom-6 right-6 z-[100] px-5 py-3.5 rounded-xl shadow-xl font-bold text-sm ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>{toast.message}</div>}

      <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col border-r border-slate-800 shrink-0 hidden md:flex">
        <div className="h-20 flex items-center px-6 border-b border-slate-800 bg-slate-950"><h1 className="text-xl font-black text-white uppercase tracking-wider">Order Desk</h1></div>
        <div className="flex-1 py-6 px-3 space-y-1">
          <button onClick={() => setActiveTab('create')} className={`w-full text-left px-4 py-3 rounded-lg font-bold text-sm transition-all ${activeTab === 'create' ? 'bg-emerald-600 text-white shadow-md' : 'hover:bg-slate-800'}`}>Draft New Order</button>
          <button onClick={() => setActiveTab('history')} className={`w-full text-left px-4 py-3 rounded-lg font-bold text-sm transition-all ${activeTab === 'history' ? 'bg-emerald-600 text-white shadow-md' : 'hover:bg-slate-800'}`}>Sales Approvals</button>
          <button onClick={() => setActiveTab('fulfill')} className={`w-full text-left px-4 py-3 rounded-lg font-bold text-sm transition-all ${activeTab === 'fulfill' ? 'bg-emerald-600 text-white shadow-md' : 'hover:bg-slate-800'}`}>Fulfill & Dispatch</button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 h-screen">
        <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0 shadow-sm z-10">
          <div><h2 className="text-2xl font-black text-emerald-950 tracking-tight">Sales Engine</h2></div>
          <button onClick={onBack} className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors">Gateway</button>
        </header>

        <main className="flex-1 overflow-y-auto p-8 relative">
          <div className="max-w-7xl mx-auto">
            
            {activeTab === 'create' && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
                <h3 className="font-black text-xl text-slate-900 mb-6 tracking-tight">Generate Draft Sales Order</h3>
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                  <div className="lg:col-span-1 border-r border-slate-100 pr-0 lg:pr-8 space-y-5">
                    <select required value={soForm.customerId} onChange={e => setSoForm({...soForm, customerId: e.target.value})} className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-600 bg-slate-50">
                      <option value="">Select Billed Client...</option>
                      {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <input type="text" required value={soForm.soNumber} onChange={e => setSoForm({...soForm, soNumber: e.target.value})} className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-600" />
                    <button type="button" onClick={() => setShowItemModal(true)} className="w-full py-4 bg-emerald-50 border border-emerald-200 text-emerald-800 font-black tracking-wide uppercase rounded-xl hover:bg-emerald-100 transition-colors shadow-sm text-xs">Browse & Add Items</button>
                  </div>
                  
                  <div className="lg:col-span-3 flex flex-col">
                    <div className="flex-1 border border-slate-200 rounded-xl overflow-hidden mb-6 min-h-[300px] bg-slate-50">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-100 border-b border-slate-200">
                          <tr><th className="py-4 px-5 text-xs font-bold text-slate-500 uppercase">Item</th><th className="py-4 px-5 text-xs font-bold text-slate-500 uppercase text-right">Qty</th><th className="py-4 px-5 text-xs font-bold text-slate-500 uppercase text-right">Price</th><th className="py-4 px-5 text-xs font-bold text-slate-500 uppercase text-right">Total</th><th className="w-12"></th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 bg-white">
                          {soItems.length === 0 ? <tr><td colSpan={5} className="py-16 text-center text-slate-400 font-medium">Cart is empty.</td></tr> :
                            soItems.map((item, i) => (
                              <tr key={i} className="group">
                                <td className="py-3 px-5 font-bold text-slate-900">{item.productName} <span className="text-[10px] font-mono text-slate-400 block mt-0.5">{item.sku}</span></td>
                                <td className="py-3 px-5 text-right font-black text-slate-700">{item.quantity}</td>
                                <td className="py-3 px-5 text-right font-medium text-slate-600">₱{item.unitPrice.toLocaleString()}</td>
                                <td className="py-3 px-5 text-right font-black text-emerald-700">₱{item.total.toLocaleString()}</td>
                                <td className="py-3 px-5 text-center"><button onClick={() => setSoItems(soItems.filter((_, idx) => idx !== i))} className="text-slate-300 hover:text-rose-500">✕</button></td>
                              </tr>
                            ))
                          }
                        </tbody>
                      </table>
                    </div>
                    <div className="flex justify-between items-center bg-slate-900 text-white p-5 rounded-xl">
                      <div><p className="text-xs font-bold uppercase tracking-widest text-slate-400">Total Draft Value</p><p className="text-3xl font-black">₱{soItems.reduce((a,b)=>a+b.total,0).toLocaleString('en-PH')}</p></div>
                      <button onClick={handleCreateSO} disabled={isProcessing || soItems.length === 0 || !soForm.customerId} className="px-8 py-3.5 bg-emerald-500 hover:bg-emerald-600 text-slate-900 font-black uppercase tracking-wider rounded-xl transition-colors disabled:opacity-50">Generate Order</button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'history' && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-5 border-b border-slate-200 bg-slate-50"><h3 className="font-bold text-slate-800 text-lg">Sales Order Approvals</h3></div>
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr><th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest">Order Ref</th><th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest">Client</th><th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">Value</th><th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest">Status</th><th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">Actions</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sos.map(so => (
                      <tr key={so.id} className="hover:bg-slate-50">
                        <td className="py-4 px-6 font-black text-slate-800">{so.soNumber} <div className="text-[10px] text-slate-400 font-mono font-medium">{new Date(so.date).toLocaleDateString()}</div></td>
                        <td className="py-4 px-6 font-bold text-slate-700">{so.customer?.name}</td>
                        <td className="py-4 px-6 text-right font-black text-emerald-700">₱{so.totalAmount.toLocaleString()}</td>
                        <td className="py-4 px-6"><span className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-widest border ${so.status === 'PENDING' ? 'border-amber-200 bg-amber-50 text-amber-700' : so.status === 'APPROVED' ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-slate-200 bg-slate-100 text-slate-700'}`}>{so.status}</span></td>
                        <td className="py-4 px-6 text-right">
                          <button onClick={() => setPrintSO(so)} className="text-slate-400 hover:text-slate-900 mr-4 font-bold text-[11px] uppercase tracking-wider">Print</button>
                          {so.status === 'PENDING' && <button onClick={() => handleUpdateSOStatus(so, 'APPROVED')} className="text-sky-600 hover:text-sky-800 font-black text-[11px] uppercase tracking-wider">Approve</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === 'fulfill' && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-6 border-b border-slate-200 bg-emerald-50"><h3 className="font-bold text-slate-900 text-lg tracking-tight">Fulfillment & Dispatch</h3><p className="text-xs text-slate-600 font-medium">Process approved orders to deduct stock and update ledgers.</p></div>
                <table className="w-full text-left text-sm">
                  <thead className="bg-white border-b border-slate-200">
                    <tr><th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest">Order Ref</th><th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest">Client</th><th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest">Units</th><th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">Dispatch</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sos.filter(s => s.status === 'APPROVED').length === 0 ? <tr><td colSpan={4} className="py-12 text-center text-slate-400 font-medium">No approved orders pending dispatch.</td></tr> :
                      sos.filter(s => s.status === 'APPROVED').map(so => (
                        <tr key={so.id} className="hover:bg-slate-50">
                          <td className="py-4 px-6 font-black text-slate-900">{so.soNumber}</td>
                          <td className="py-4 px-6 font-bold text-slate-700">{so.customer.name}</td>
                          <td className="py-4 px-6 font-black text-slate-600">{so.items.reduce((a,b)=>a+b.quantity,0)} Items</td>
                          <td className="py-4 px-6 text-right"><button onClick={() => setFulfillModal({ isOpen: true, so })} className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-colors shadow-sm">Fulfill Order</button></td>
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

      {/* FULFILL MODAL */}
      {fulfillModal.isOpen && fulfillModal.so && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-5 border-b bg-emerald-600 text-white"><h3 className="font-bold text-lg tracking-wide">Dispatch Stock</h3><p className="text-[10px] uppercase opacity-80 tracking-widest">{fulfillModal.so.soNumber}</p></div>
            <form onSubmit={handleFulfillSO} className="p-6 flex flex-col gap-5 bg-slate-50">
              <div className="bg-white border border-slate-200 p-4 rounded-xl text-xs font-bold text-slate-700 shadow-sm">This action withdraws physical units and registers ₱{fulfillModal.so.totalAmount.toLocaleString()} to Accounts Receivable.</div>
              <select required value={fulfillWarehouseId} onChange={e => setFulfillWarehouseId(e.target.value)} className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500 bg-white">
                <option value="">Select Dispatch Warehouse...</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setFulfillModal({ isOpen: false, so: null })} className="flex-1 px-4 py-3 bg-white border border-slate-300 text-slate-700 font-bold rounded-xl transition-colors">Cancel</button>
                <button type="submit" disabled={isProcessing} className="flex-1 px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase tracking-wider rounded-xl transition-colors shadow-sm disabled:opacity-50">Confirm Dispatch</button>
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
              <h3 className="font-bold text-lg text-slate-900 tracking-tight">Select Products for Order</h3>
              <button onClick={() => setShowItemModal(false)} className="text-slate-400 hover:text-slate-700">✕</button>
            </div>
            <div className="p-4 border-b border-slate-200 bg-white shrink-0"><input type="text" placeholder="Search by SKU or Name..." value={productSearch} onChange={e => setProductSearch(e.target.value)} className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500" /></div>
            <div className="overflow-y-auto p-2 bg-slate-50 flex-1">
              {filteredProducts.map(p => {
                const isChecked = tempSelectedItems[p.id]?.checked || false;
                return (
                  <div key={p.id} className={`flex flex-col sm:flex-row justify-between gap-4 p-4 rounded-xl border transition-colors mb-2 ${isChecked ? 'bg-emerald-50/50 border-emerald-300' : 'bg-white border-slate-200'}`}>
                    <label className="flex items-center gap-3 cursor-pointer w-full sm:w-1/2">
                      <input type="checkbox" checked={isChecked} onChange={() => handleToggleProduct(p)} className="w-5 h-5 text-emerald-600 rounded cursor-pointer" />
                      <div><p className="font-bold text-sm text-slate-900">{p.name}</p><p className="text-[10px] text-slate-500 font-mono tracking-wider">{p.sku}</p></div>
                    </label>
                    {isChecked && (
                      <div className="flex gap-3 w-full sm:w-1/2">
                        <div className="w-1/3"><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">Qty</label><input type="number" min="1" value={tempSelectedItems[p.id]?.qty || 1} onChange={e => handleUpdateTempItem(p.id, 'qty', Number(e.target.value))} className="w-full px-3 py-2 text-sm font-black border border-emerald-200 rounded-lg outline-none" /></div>
                        <div className="w-2/3"><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">Unit Price (₱)</label><input type="number" min="0" value={tempSelectedItems[p.id]?.price} onChange={e => handleUpdateTempItem(p.id, 'price', Number(e.target.value))} className="w-full px-3 py-2 text-sm font-black border border-emerald-200 rounded-lg outline-none" /></div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="p-5 border-t border-slate-200 bg-white flex gap-3">
              <button onClick={() => setShowItemModal(false)} className="flex-1 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl">Cancel</button>
              <button onClick={handleConfirmAddItems} className="flex-1 py-3 bg-emerald-600 text-white font-black uppercase tracking-wider rounded-xl shadow-sm">Add Items</button>
            </div>
          </div>
        </div>
      )}

      {/* PRINT FALLBACK MODAL (Simplified for brevity, refer to original for full print template) */}
      {printSO && (
        <div className="hidden print:block fixed inset-0 w-full h-full bg-white z-[99999] text-black font-sans p-8">
           <h1 className="text-3xl font-black tracking-widest uppercase mb-8">INVOICE: {printSO.soNumber}</h1>
           <table className="w-full text-left mb-8 border-collapse border border-black"><thead className="border-b border-black"><tr><th className="p-2 border border-black">Item</th><th className="p-2 border border-black">Qty</th><th className="p-2 border border-black">Total</th></tr></thead><tbody>{printSO.items.map(i => <tr key={i.id}><td className="p-2 border border-black">{i.productName}</td><td className="p-2 border border-black">{i.quantity}</td><td className="p-2 border border-black">₱{i.total.toLocaleString()}</td></tr>)}</tbody></table>
           <h2 className="text-xl font-bold">Total: ₱{printSO.totalAmount.toLocaleString()}</h2>
        </div>
      )}
    </div>
  );
}