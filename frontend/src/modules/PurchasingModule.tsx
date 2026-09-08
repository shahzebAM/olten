import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';

interface Supplier { id: string; name: string; contact: string; phone: string; email: string; balance: number; }
interface POItem { id?: string; productId: number; sku: string; productName: string; quantity: number; unitPrice: number; total: number; }
interface PurchaseOrder { id: string; poNumber: string; supplierId: string; supplier: Supplier; date: string; status: 'PENDING' | 'APPROVED' | 'RECEIVED' | 'CANCELLED'; totalAmount: number; items: POItem[]; user: string; }
interface Product { id: number; name: string; sku: string; purchasePrice: number; currentStock: number; reorderLevel: number; }
interface Warehouse { id: string; name: string; }

export default function PurchasingModule({ selectedCompany, loginUsername, API_BASE_URL, onLogout, onBack }: any) {
  
  const [activeTab, setActiveTab] = useState<'dashboard' | 'suppliers' | 'pos' | 'receive'>('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  const [supForm, setSupForm] = useState({ name: '', contact: '', phone: '', email: '' });
  
  const [poForm, setPoForm] = useState({ supplierId: '', poNumber: `PO-${Date.now().toString().slice(-6)}` });
  const [poItems, setPoItems] = useState<POItem[]>([]);
  const [itemForm, setItemForm] = useState({ productId: '', quantity: 1, unitPrice: 0 });

  const [receiveModal, setReceiveModal] = useState<{ isOpen: boolean, po: PurchaseOrder | null }>({ isOpen: false, po: null });
  const [receiveWarehouseId, setReceiveWarehouseId] = useState('');

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

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

  const handleCreateSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    try {
      const res = await fetch(`${API_BASE_URL}/purchasing/suppliers`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ company: selectedCompany, ...supForm }) });
      if(!res.ok) throw new Error();
      fetchData();
      showToast("Supplier registered.", "success");
      setSupForm({ name: '', contact: '', phone: '', email: '' });
    } catch (e) { showToast("Failed to add supplier.", "error"); }
    finally { setIsProcessing(false); }
  };

  const handleAddItemToPO = () => {
    const prod = products.find(p => p.id === Number(itemForm.productId));
    if (!prod || itemForm.quantity <= 0) return showToast("Invalid item or quantity.", "error");
    
    const newItem: POItem = {
      productId: prod.id, sku: prod.sku, productName: prod.name,
      quantity: Number(itemForm.quantity), unitPrice: Number(itemForm.unitPrice),
      total: Number(itemForm.quantity) * Number(itemForm.unitPrice)
    };
    
    setPoItems([...poItems, newItem]);
    setItemForm({ productId: '', quantity: 1, unitPrice: 0 });
  };

  const handleCreatePO = async (e: React.FormEvent) => {
    e.preventDefault();
    if (poItems.length === 0) return showToast("Add at least one item.", "error");
    setIsProcessing(true);
    try {
      const totalAmount = poItems.reduce((acc, item) => acc + item.total, 0);
      const payload = { company: selectedCompany, ...poForm, totalAmount, items: poItems, user: loginUsername, status: 'PENDING' };
      const res = await fetch(`${API_BASE_URL}/purchasing/pos`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) });
      if(!res.ok) throw new Error();
      fetchData();
      showToast("Purchase Order generated.", "success");
      setPoItems([]);
      setPoForm({ supplierId: '', poNumber: `PO-${Date.now().toString().slice(-6)}` });
    } catch (e) { showToast("Failed to create PO.", "error"); }
    finally { setIsProcessing(false); }
  };

  const handleUpdatePOStatus = async (id: string, status: string) => {
    setIsProcessing(true);
    try {
      const res = await fetch(`${API_BASE_URL}/purchasing/pos/${id}/status`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ status }) });
      if(!res.ok) throw new Error();
      fetchData();
      showToast(`PO marked as ${status}.`, "success");
    } catch (e) { showToast("Failed to update status.", "error"); }
    finally { setIsProcessing(false); }
  };

  const handleReceivePO = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receiveModal.po || !receiveWarehouseId) return showToast("Select a receiving warehouse.", "error");
    setIsProcessing(true);

    try {
      const po = receiveModal.po;

      await fetch(`${API_BASE_URL}/purchasing/pos/${po.id}/status`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ status: 'RECEIVED' }) });
      await fetch(`${API_BASE_URL}/purchasing/suppliers/${po.supplierId}/balance`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ amount: po.totalAmount }) });

      for (const item of po.items) {
        await fetch(`${API_BASE_URL}/warehouse-stock`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ company: selectedCompany, warehouseId: receiveWarehouseId, productId: item.productId, sku: item.sku, quantity: item.quantity }) });
        const prod = products.find(p => p.id === item.productId);
        if (prod) {
          const newMasterStock = (prod.currentStock || 0) + item.quantity;
          await fetch(`${API_BASE_URL}/products/${item.productId}`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ currentStock: newMasterStock }) });
        }
      }

      fetchData();
      showToast("PO Received! Stock and payables updated.", "success");
      setReceiveModal({ isOpen: false, po: null });
      setReceiveWarehouseId('');
    } catch (e) { showToast("Error processing receipt.", "error"); }
    finally { setIsProcessing(false); }
  };

  return (
    <div className="flex h-screen w-full bg-slate-50 font-sans text-slate-900 overflow-hidden selection:bg-amber-100">
      
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[100] px-5 py-3.5 rounded-xl shadow-xl font-semibold flex items-center gap-3 animate-in slide-in-from-right-8 fade-in border ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>
          {toast.message}
        </div>
      )}

      {isMobileMenuOpen && <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 md:hidden" onClick={() => setIsMobileMenuOpen(false)}></div>}

      {/* RECEIVE PO MODAL */}
      {receiveModal.isOpen && receiveModal.po && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-5 border-b bg-amber-600 text-white">
              <h3 className="font-bold text-lg leading-tight tracking-wide">Receive Purchase Order</h3>
              <p className="text-[10px] opacity-80 uppercase tracking-widest">{receiveModal.po.poNumber} • {receiveModal.po.supplier.name}</p>
            </div>
            <form onSubmit={handleReceivePO} className="p-6 flex flex-col gap-5">
              <div className="bg-amber-50 text-amber-800 p-3 rounded-xl border border-amber-200 text-xs font-medium">
                This will mark the PO as received, inject <strong>{receiveModal.po.items.reduce((a,b)=>a+b.quantity,0)} units</strong> into the selected warehouse, and increase the supplier payable by <strong>₱{receiveModal.po.totalAmount.toLocaleString('en-PH')}</strong>.
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-600 uppercase tracking-wide">Destination Warehouse <span className="text-rose-500">*</span></label>
                <select required value={receiveWarehouseId} onChange={e => setReceiveWarehouseId(e.target.value)} className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-amber-500 shadow-sm bg-white">
                  <option value="">Select Warehouse...</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setReceiveModal({ isOpen: false, po: null })} className="flex-1 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors">Cancel</button>
                <button type="submit" disabled={isProcessing} className="flex-1 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl transition-colors disabled:opacity-50">
                  {isProcessing ? 'Processing...' : 'Confirm Receipt'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <aside className={`fixed inset-y-0 left-0 z-50 transform bg-slate-900 text-slate-300 flex flex-col w-64 transition-transform duration-300 md:relative md:translate-x-0 border-r border-slate-800 shadow-2xl shrink-0 ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="h-20 flex items-center justify-between px-6 border-b border-slate-800 bg-slate-950 shrink-0">
          <h1 className="text-xl font-black text-white tracking-wider uppercase">Purchasing</h1>
          <button onClick={() => setIsMobileMenuOpen(false)} className="md:hidden text-slate-400 hover:text-white"><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
        <div className="flex-1 overflow-y-auto py-6 px-3 space-y-1">
          <button onClick={() => { setActiveTab('dashboard'); setIsMobileMenuOpen(false); }} className={`w-full flex text-left gap-3 px-3 py-2.5 rounded-lg font-semibold text-sm transition-all ${activeTab === 'dashboard' ? 'bg-amber-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}>Metrics</button>
          <div className="px-3 pt-6 pb-2 text-xs font-bold text-slate-500 uppercase tracking-widest">Master Data</div>
          <button onClick={() => { setActiveTab('suppliers'); setIsMobileMenuOpen(false); }} className={`w-full flex text-left gap-3 px-3 py-2.5 rounded-lg font-semibold text-sm transition-all ${activeTab === 'suppliers' ? 'bg-amber-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}>Suppliers Directory</button>
          <div className="px-3 pt-6 pb-2 text-xs font-bold text-slate-500 uppercase tracking-widest">Operations</div>
          <button onClick={() => { setActiveTab('pos'); setIsMobileMenuOpen(false); }} className={`w-full flex text-left gap-3 px-3 py-2.5 rounded-lg font-semibold text-sm transition-all ${activeTab === 'pos' ? 'bg-amber-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}>Purchase Orders</button>
          <button onClick={() => { setActiveTab('receive'); setIsMobileMenuOpen(false); }} className={`w-full flex text-left gap-3 px-3 py-2.5 rounded-lg font-semibold text-sm transition-all ${activeTab === 'receive' ? 'bg-amber-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}>Receive to Warehouse</button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 h-screen">
        <header className="h-auto sm:h-20 bg-white border-b border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between px-4 sm:px-8 py-3 sm:py-0 shadow-sm relative z-10 shrink-0 gap-3">
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button onClick={() => setIsMobileMenuOpen(true)} className="md:hidden p-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 border border-slate-200 shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
            <div>
              <h2 className="text-lg sm:text-2xl font-extrabold text-amber-950 tracking-tight">Procurement Engine</h2>
              <div className="text-[10px] sm:text-xs font-semibold text-slate-400 mt-0.5">{selectedCompany} / Purchasing</div>
            </div>
          </div>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button onClick={() => { showToast("Syncing with database...", "success"); fetchData(); }} className="w-full sm:w-auto px-4 py-2 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg text-sm font-bold transition-colors border border-amber-200 flex justify-center items-center gap-2">
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
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Active Suppliers</p>
                    <h3 className="text-4xl font-black text-amber-900 mt-1">{suppliers.length}</h3>
                  </div>
                 <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col justify-center">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Pending POs</p>
                    <h3 className="text-4xl font-black text-slate-900 mt-1">{pos.filter(p=>p.status==='PENDING').length}</h3>
                  </div>
                 <div className="bg-rose-50 rounded-2xl p-6 border border-rose-100 shadow-sm flex flex-col justify-center">
                    <p className="text-xs font-bold text-rose-500 uppercase tracking-wider">Low Stock (Reorder Needed)</p>
                    <h3 className="text-4xl font-black text-rose-700 mt-1">{products.filter(p => (p.currentStock||0) <= p.reorderLevel).length}</h3>
                  </div>
              </div>
            )}

            {activeTab === 'suppliers' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-1 bg-white rounded-2xl shadow-sm border border-slate-200 p-6 h-fit">
                  <h3 className="font-bold text-lg text-slate-900 mb-4">Register Supplier</h3>
                  <form onSubmit={handleCreateSupplier} className="flex flex-col gap-4">
                    <input type="text" required value={supForm.name} onChange={e => setSupForm({...supForm, name: e.target.value})} className="px-4 py-2 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-amber-600" placeholder="Supplier Company Name" />
                    <input type="text" value={supForm.contact} onChange={e => setSupForm({...supForm, contact: e.target.value})} className="px-4 py-2 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-amber-600" placeholder="Contact Person" />
                    <input type="text" value={supForm.phone} onChange={e => setSupForm({...supForm, phone: e.target.value})} className="px-4 py-2 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-amber-600" placeholder="Phone Number" />
                    <input type="email" value={supForm.email} onChange={e => setSupForm({...supForm, email: e.target.value})} className="px-4 py-2 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-amber-600" placeholder="Email Address" />
                    <button type="submit" disabled={isProcessing} className="py-2.5 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800 transition-colors">Add Supplier</button>
                  </form>
                </div>
                <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-x-auto">
                  <table className="w-full text-left min-w-[600px]">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="py-3 px-6 text-xs font-semibold text-slate-600 uppercase">Supplier</th>
                        <th className="py-3 px-6 text-xs font-semibold text-slate-600 uppercase">Contact</th>
                        <th className="py-3 px-6 text-xs font-semibold text-slate-600 uppercase text-right">Payable Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {suppliers.map(s => (
                        <tr key={s.id} className="hover:bg-slate-50">
                          <td className="py-3 px-6 font-bold text-slate-800">{s.name}</td>
                          <td className="py-3 px-6 text-sm text-slate-600">
                            <div>{s.contact || 'N/A'}</div>
                            <div className="text-xs text-slate-400">{s.phone}</div>
                          </td>
                          <td className="py-3 px-6 text-right font-black text-rose-600">₱{s.balance.toLocaleString('en-PH')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'pos' && (
              <div className="space-y-6">
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                  <h3 className="font-bold text-lg text-slate-900 mb-4">Draft Purchase Order</h3>
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-1 border-r border-slate-100 pr-0 lg:pr-6 space-y-4">
                      <select required value={poForm.supplierId} onChange={e => setPoForm({...poForm, supplierId: e.target.value})} className="w-full px-4 py-2 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-amber-600 bg-white">
                        <option value="">Select Supplier...</option>
                        {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                      <input type="text" required value={poForm.poNumber} onChange={e => setPoForm({...poForm, poNumber: e.target.value})} className="w-full px-4 py-2 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-amber-600" placeholder="PO Number" />
                      
                      <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Add Item</p>
                        <select value={itemForm.productId} onChange={e => {
                          const p = products.find(x => x.id === Number(e.target.value));
                          setItemForm({...itemForm, productId: e.target.value, unitPrice: p ? p.purchasePrice : 0});
                        }} className="w-full px-3 py-2 border rounded-lg text-sm bg-white outline-none focus:border-amber-500">
                          <option value="">Select Product...</option>
                          {products.map(p => <option key={p.id} value={p.id}>[{p.sku}] {p.name}</option>)}
                        </select>
                        <div className="flex gap-2">
                          <input type="number" min="1" placeholder="Qty" value={itemForm.quantity} onChange={e => setItemForm({...itemForm, quantity: Number(e.target.value)})} className="w-1/2 px-3 py-2 border rounded-lg text-sm outline-none focus:border-amber-500" />
                          <input type="number" min="0" placeholder="Price (₱)" value={itemForm.unitPrice} onChange={e => setItemForm({...itemForm, unitPrice: Number(e.target.value)})} className="w-1/2 px-3 py-2 border rounded-lg text-sm outline-none focus:border-amber-500" />
                        </div>
                        <button type="button" onClick={handleAddItemToPO} className="w-full py-2 bg-amber-100 text-amber-800 font-bold rounded-lg hover:bg-amber-200 text-sm">Add to Draft</button>
                      </div>
                    </div>
                    
                    <div className="lg:col-span-2 flex flex-col">
                      <div className="flex-1 border border-slate-200 rounded-xl overflow-hidden mb-4">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                              <th className="py-2 px-4 text-xs font-semibold text-slate-600 uppercase">Item</th>
                              <th className="py-2 px-4 text-xs font-semibold text-slate-600 uppercase text-right">Qty</th>
                              <th className="py-2 px-4 text-xs font-semibold text-slate-600 uppercase text-right">Price</th>
                              <th className="py-2 px-4 text-xs font-semibold text-slate-600 uppercase text-right">Total</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {poItems.length === 0 ? <tr><td colSpan={4} className="py-4 text-center text-slate-400">No items added yet.</td></tr> :
                              poItems.map((item, i) => (
                                <tr key={i}>
                                  <td className="py-2 px-4 font-bold">{item.productName} <span className="text-[10px] font-normal text-slate-400 block">{item.sku}</span></td>
                                  <td className="py-2 px-4 text-right">{item.quantity}</td>
                                  <td className="py-2 px-4 text-right">₱{item.unitPrice.toLocaleString('en-PH')}</td>
                                  <td className="py-2 px-4 text-right font-bold text-amber-700">₱{item.total.toLocaleString('en-PH')}</td>
                                </tr>
                              ))
                            }
                          </tbody>
                        </table>
                      </div>
                      <div className="flex justify-between items-center bg-slate-900 text-white p-4 rounded-xl">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Total Amount</p>
                          <p className="text-2xl font-black">₱{poItems.reduce((a,b)=>a+b.total,0).toLocaleString('en-PH')}</p>
                        </div>
                        <button onClick={handleCreatePO} disabled={isProcessing || poItems.length === 0 || !poForm.supplierId} className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-900 font-black rounded-lg transition-colors disabled:opacity-50">Generate PO</button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-x-auto">
                  <div className="p-4 border-b border-slate-200 bg-slate-50"><h3 className="font-bold text-slate-800">PO History & Approvals</h3></div>
                  <table className="w-full text-left min-w-[800px]">
                    <thead className="bg-white border-b border-slate-200">
                      <tr>
                        <th className="py-3 px-6 text-xs font-semibold text-slate-600 uppercase">PO Number</th>
                        <th className="py-3 px-6 text-xs font-semibold text-slate-600 uppercase">Supplier</th>
                        <th className="py-3 px-6 text-xs font-semibold text-slate-600 uppercase text-right">Total</th>
                        <th className="py-3 px-6 text-xs font-semibold text-slate-600 uppercase">Status</th>
                        <th className="py-3 px-6 text-xs font-semibold text-slate-600 uppercase text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {pos.map(po => (
                        <tr key={po.id} className="hover:bg-slate-50">
                          <td className="py-3 px-6 font-bold text-slate-800">{po.poNumber} <div className="text-[10px] text-slate-400 font-normal">{new Date(po.date).toLocaleDateString()}</div></td>
                          <td className="py-3 px-6 text-sm font-bold text-slate-700">{po.supplier?.name}</td>
                          <td className="py-3 px-6 text-right font-black text-slate-800">₱{po.totalAmount.toLocaleString('en-PH')}</td>
                          <td className="py-3 px-6">
                            <span className={`px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest ${po.status === 'PENDING' ? 'bg-amber-100 text-amber-800' : po.status === 'APPROVED' ? 'bg-sky-100 text-sky-800' : po.status === 'RECEIVED' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-800'}`}>{po.status}</span>
                          </td>
                          <td className="py-3 px-6 text-right">
                            {po.status === 'PENDING' && (
                              <button onClick={() => handleUpdatePOStatus(po.id, 'APPROVED')} className="text-sky-600 hover:text-sky-800 text-[11px] font-bold uppercase tracking-wider">Approve</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'receive' && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-4 sm:p-6 border-b border-slate-200 bg-amber-50/30">
                  <h3 className="font-bold text-lg text-slate-900">Approved Orders Awaiting Receipt</h3>
                  <p className="text-xs text-slate-500 mt-1">Select an approved order to log physical stock into a warehouse.</p>
                </div>
                <div className="overflow-x-auto w-full pb-4">
                  <table className="w-full text-left min-w-[800px] border-collapse">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">PO Details</th>
                        <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Supplier</th>
                        <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Total Items</th>
                        <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {pos.filter(p => p.status === 'APPROVED').length === 0 ? (
                        <tr><td colSpan={4} className="py-8 text-center text-sm font-medium text-slate-500">No approved POs pending receipt.</td></tr>
                      ) : pos.filter(p => p.status === 'APPROVED').map(po => (
                        <tr key={po.id} className="hover:bg-amber-50/30 transition-colors">
                          <td className="py-4 px-6">
                            <div className="font-bold text-slate-900">{po.poNumber}</div>
                            <div className="text-[10px] text-slate-400 font-mono mt-0.5 tracking-wider">{new Date(po.date).toLocaleString()}</div>
                          </td>
                          <td className="py-4 px-6 font-bold text-slate-700 text-sm">{po.supplier.name}</td>
                          <td className="py-4 px-6 text-sm text-slate-600 font-bold">{po.items.reduce((a,b)=>a+b.quantity,0)} Units</td>
                          <td className="py-4 px-6 text-right">
                            <button onClick={() => setReceiveModal({ isOpen: true, po })} className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold uppercase tracking-wider rounded-lg transition-colors shadow-sm">Receive Items</button>
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
  );
}