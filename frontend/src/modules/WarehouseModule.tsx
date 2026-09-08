import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';

interface Product { id: number; name: string; sku: string; currentStock: number; }
interface Warehouse { id: string; name: string; location: string; isActive: boolean; }
interface WarehouseStock { id: string; warehouseId: string; productId: number; sku: string; quantity: number; }
interface WarehouseTransfer { id: string; sourceId: string; destinationId: string; productId: number; sku: string; quantity: number; date: string; user: string; reference: string; }

export default function WarehouseModule({ selectedCompany, loginUsername, API_BASE_URL, onLogout, onBack }: any) {
  
  const [activeTab, setActiveTab] = useState<'dashboard' | 'locations' | 'stock' | 'transfers' | 'reports'>('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [stockRecords, setStockRecords] = useState<WarehouseStock[]>([]);
  const [transfers, setTransfers] = useState<WarehouseTransfer[]>([]);

  const [whForm, setWhForm] = useState({ name: '', location: '' });
  const [transferForm, setTransferForm] = useState({ sourceId: '', destinationId: '', productId: '', quantity: 1, reference: '' });
  const [assignForm, setAssignForm] = useState({ warehouseId: '', productId: '', quantity: 1 });
  
  const [editingStock, setEditingStock] = useState<WarehouseStock | null>(null);
  const [editStockQty, setEditStockQty] = useState<number | ''>('');
  
  const [reportHubId, setReportHubId] = useState<string>('ALL');

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchData = async () => {
    try {
      const pRes = await fetch(`${API_BASE_URL}/products?company=${selectedCompany}`);
      if (pRes.ok) setProducts(await pRes.json());
      const wRes = await fetch(`${API_BASE_URL}/warehouses?company=${selectedCompany}`);
      if (wRes.ok) setWarehouses(await wRes.json());
      const stRes = await fetch(`${API_BASE_URL}/warehouse-stock?company=${selectedCompany}`);
      if (stRes.ok) setStockRecords(await stRes.json());
      const trRes = await fetch(`${API_BASE_URL}/warehouse-transfers?company=${selectedCompany}`);
      if (trRes.ok) setTransfers(await trRes.json());
    } catch (e) { console.warn("Backend not ready."); }
  };

  useEffect(() => { fetchData(); }, [selectedCompany]);

  const handleCreateWarehouse = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    try {
      const payload = { company: selectedCompany, name: whForm.name, location: whForm.location, isActive: true };
      const res = await fetch(`${API_BASE_URL}/warehouses`, { 
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) 
      });
      if(!res.ok) throw new Error();
      const savedWh = await res.json();
      setWarehouses([...warehouses, savedWh]);
      showToast("Warehouse created successfully.", "success");
      setWhForm({ name: '', location: '' });
    } catch (e) { showToast("Failed to create warehouse.", "error"); }
    finally { setIsProcessing(false); }
  };

  const handleDeleteWarehouse = async (id: string) => {
    if(!window.confirm("CRITICAL WARNING: Are you sure you want to permanently delete this warehouse? All physical stock hosted in this location and its transfer history will be eradicated immediately. This cannot be undone.")) return;
    setIsProcessing(true);
    try {
      const res = await fetch(`${API_BASE_URL}/warehouses/${id}`, { method: 'DELETE' });
      if(!res.ok) throw new Error();
      
      setWarehouses(warehouses.filter(w => w.id !== id));
      setStockRecords(stockRecords.filter(s => s.warehouseId !== id));
      setTransfers(transfers.filter(t => t.sourceId !== id && t.destinationId !== id));
      if (reportHubId === id) setReportHubId('ALL');
      
      showToast("Warehouse and all contained stock permanently deleted.", "success");
    } catch (e) { showToast("Failed to delete warehouse.", "error"); }
    finally { setIsProcessing(false); }
  };

  const handleAssignStock = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetProd = products.find(p => p.id === Number(assignForm.productId));
    if (!targetProd) return showToast("Select a valid product.", "error");
    if (assignForm.quantity <= 0) return showToast("Quantity must be positive.", "error");

    setIsProcessing(true);
    try {
      const payload = { company: selectedCompany, warehouseId: assignForm.warehouseId, productId: targetProd.id, sku: targetProd.sku, quantity: assignForm.quantity };
      const res = await fetch(`${API_BASE_URL}/warehouse-stock`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) });
      if(!res.ok) throw new Error();
      fetchData(); 
      showToast(`Assigned ${assignForm.quantity} units to warehouse.`, "success");
      setAssignForm({ warehouseId: '', productId: '', quantity: 1 });
    } catch(e) { showToast("Failed to assign stock.", "error"); }
    finally { setIsProcessing(false); }
  };

  const handleSaveEditStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStock || editStockQty === '' || Number(editStockQty) < 0) return showToast("Enter a valid quantity.", "error");
    setIsProcessing(true);
    try {
      const res = await fetch(`${API_BASE_URL}/warehouse-stock/${editingStock.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quantity: Number(editStockQty) })
      });
      if (!res.ok) throw new Error();
      setStockRecords(stockRecords.map(s => s.id === editingStock.id ? { ...s, quantity: Number(editStockQty) } : s));
      showToast("Stock quantity updated.", "success");
      setEditingStock(null);
    } catch(err) { showToast("Failed to update stock.", "error"); }
    finally { setIsProcessing(false); }
  };

  // NEW: Handle Stock Record Deletion
  const handleDeleteStock = async (id: string) => {
    setIsProcessing(true);
    try {
      const res = await fetch(`${API_BASE_URL}/warehouse-stock/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setStockRecords(stockRecords.filter(s => s.id !== id));
      showToast("Record permanently deleted.", "success");
    } catch (err) { showToast("Failed to delete stock record.", "error"); }
    finally { setIsProcessing(false); }
  };

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (transferForm.sourceId === transferForm.destinationId) return showToast("Source and destination must be different.", "error");
    const sourceStock = stockRecords.find(s => s.warehouseId === transferForm.sourceId && s.productId === Number(transferForm.productId));
    if (!sourceStock || sourceStock.quantity < transferForm.quantity) return showToast("Insufficient stock in source warehouse.", "error");

    setIsProcessing(true);
    try {
      const payload = { company: selectedCompany, ...transferForm, productId: Number(transferForm.productId), date: new Date().toISOString(), user: loginUsername };
      const res = await fetch(`${API_BASE_URL}/warehouse-transfers`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) });
      if(!res.ok) throw new Error();
      fetchData(); 
      showToast("Transfer completed successfully.", "success");
      setTransferForm({ sourceId: '', destinationId: '', productId: '', quantity: 1, reference: '' });
    } catch(e) { showToast("Transfer failed.", "error"); }
    finally { setIsProcessing(false); }
  };

  const handleExportReport = () => {
    showToast("Exporting warehouse report...", "success");
    const reportData = reportStock.map(s => ({
      "Location": warehouses.find(w => w.id === s.warehouseId)?.name || 'Unknown',
      "SKU": s.sku,
      "Product": products.find(p => p.id === s.productId)?.name || 'Unknown',
      "Quantity Hosted": s.quantity
    }));
    const ws = XLSX.utils.json_to_sheet(reportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Hub Inventory Report");
    XLSX.writeFile(wb, `${selectedCompany}_HubReport_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const reportStock = reportHubId === 'ALL' ? stockRecords : stockRecords.filter(s => s.warehouseId === reportHubId);
  const reportTotalUnits = reportStock.reduce((acc, curr) => acc + curr.quantity, 0);
  const reportUniqueSKUs = new Set(reportStock.map(s => s.productId)).size;

  return (
    <div className="flex h-screen w-full bg-slate-50 font-sans text-slate-900 overflow-hidden selection:bg-teal-100">
      
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[100] px-5 py-3.5 rounded-xl shadow-xl font-semibold flex items-center gap-3 animate-in slide-in-from-right-8 fade-in border ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>
          {toast.message}
        </div>
      )}

      {isMobileMenuOpen && <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 md:hidden" onClick={() => setIsMobileMenuOpen(false)}></div>}

      {/* EDIT STOCK MODAL */}
      {editingStock && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-5 border-b bg-teal-800 text-white">
              <h3 className="font-bold text-lg leading-tight tracking-wide">Adjust Hub Stock</h3>
              <p className="text-[10px] opacity-80 uppercase tracking-widest">{editingStock.sku}</p>
            </div>
            <form onSubmit={handleSaveEditStock} className="p-6 flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-600 uppercase tracking-wide">Physical Quantity Available <span className="text-rose-500">*</span></label>
                <input type="number" required min="0" value={editStockQty} onChange={e => setEditStockQty(e.target.value === '' ? '' : Number(e.target.value))} className="w-full px-4 py-3 border border-slate-300 rounded-xl text-lg font-black outline-none focus:ring-2 focus:ring-teal-500 shadow-sm" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setEditingStock(null)} className="flex-1 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors">Cancel</button>
                <button type="submit" disabled={isProcessing} className="flex-1 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl transition-colors disabled:opacity-50">
                  {isProcessing ? 'Saving...' : 'Update Count'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <aside className={`fixed inset-y-0 left-0 z-50 transform bg-slate-900 text-slate-300 flex flex-col w-64 transition-transform duration-300 md:relative md:translate-x-0 border-r border-slate-800 shadow-2xl shrink-0 ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="h-20 flex items-center justify-between px-6 border-b border-slate-800 bg-slate-950 shrink-0">
          <h1 className="text-xl font-black text-white tracking-wider uppercase">Warehouses</h1>
          <button onClick={() => setIsMobileMenuOpen(false)} className="md:hidden text-slate-400 hover:text-white"><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
        <div className="flex-1 overflow-y-auto py-6 px-3 space-y-1">
          <button onClick={() => { setActiveTab('dashboard'); setIsMobileMenuOpen(false); }} className={`w-full flex text-left gap-3 px-3 py-2.5 rounded-lg font-semibold text-sm transition-all ${activeTab === 'dashboard' ? 'bg-teal-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}>Overview</button>
          <div className="px-3 pt-6 pb-2 text-xs font-bold text-slate-500 uppercase tracking-widest">Network</div>
          <button onClick={() => { setActiveTab('locations'); setIsMobileMenuOpen(false); }} className={`w-full flex text-left gap-3 px-3 py-2.5 rounded-lg font-semibold text-sm transition-all ${activeTab === 'locations' ? 'bg-teal-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}>Locations Setup</button>
          <div className="px-3 pt-6 pb-2 text-xs font-bold text-slate-500 uppercase tracking-widest">Operations</div>
          <button onClick={() => { setActiveTab('stock'); setIsMobileMenuOpen(false); }} className={`w-full flex text-left gap-3 px-3 py-2.5 rounded-lg font-semibold text-sm transition-all ${activeTab === 'stock' ? 'bg-teal-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}>Assign Stock</button>
          <button onClick={() => { setActiveTab('transfers'); setIsMobileMenuOpen(false); }} className={`w-full flex text-left gap-3 px-3 py-2.5 rounded-lg font-semibold text-sm transition-all ${activeTab === 'transfers' ? 'bg-teal-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}>Inter-Hub Transfer</button>
          <div className="px-3 pt-6 pb-2 text-xs font-bold text-slate-500 uppercase tracking-widest">Analytics</div>
          <button onClick={() => { setActiveTab('reports'); setIsMobileMenuOpen(false); }} className={`w-full flex text-left gap-3 px-3 py-2.5 rounded-lg font-semibold text-sm transition-all ${activeTab === 'reports' ? 'bg-teal-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}>Hub Reports</button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 h-screen">
        <header className="h-auto sm:h-20 bg-white border-b border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between px-4 sm:px-8 py-3 sm:py-0 shadow-sm relative z-10 shrink-0 gap-3">
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button onClick={() => setIsMobileMenuOpen(true)} className="md:hidden p-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 border border-slate-200 shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
            <div>
              <h2 className="text-lg sm:text-2xl font-extrabold text-teal-950 tracking-tight">Multi-Warehouse Control</h2>
              <div className="text-[10px] sm:text-xs font-semibold text-slate-400 mt-0.5">{selectedCompany} / Location Routing</div>
            </div>
          </div>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button onClick={() => { showToast("Syncing with database...", "success"); fetchData(); }} className="w-full sm:w-auto px-4 py-2 bg-teal-50 hover:bg-teal-100 text-teal-700 rounded-lg text-sm font-bold transition-colors border border-teal-200 flex justify-center items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              Sync
            </button>
            <button onClick={onBack} className="w-full sm:w-auto px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-bold transition-colors border border-slate-200 text-center">Gateway</button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-8 relative z-0">
          <div className="max-w-7xl mx-auto space-y-6 pb-12">

            {activeTab === 'dashboard' && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
                 <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col justify-center">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Active Hubs</p>
                    <h3 className="text-4xl font-black text-teal-900 mt-1">{warehouses.length}</h3>
                  </div>
                 <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col justify-center">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Hosted Units</p>
                    <h3 className="text-4xl font-black text-slate-900 mt-1">{stockRecords.reduce((a,b)=>a+b.quantity,0)}</h3>
                  </div>
                 <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col justify-center">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Recent Transfers</p>
                    <h3 className="text-4xl font-black text-slate-900 mt-1">{transfers.length}</h3>
                  </div>
              </div>
            )}

            {activeTab === 'reports' && (
              <div className="space-y-6">
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="p-4 sm:p-6 border-b border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-teal-50/30">
                    <select value={reportHubId} onChange={e => setReportHubId(e.target.value)} className="w-full sm:w-[300px] px-4 py-2.5 border border-slate-300 rounded-xl text-sm font-bold outline-none focus:ring-4 focus:ring-teal-600/10 focus:border-teal-600 shadow-sm bg-white">
                      <option value="ALL">All Hubs & Locations</option>
                      {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                    <button onClick={handleExportReport} className="w-full sm:w-auto text-sm font-bold text-teal-700 hover:text-teal-900 transition-colors border border-teal-200 px-5 py-2.5 rounded-xl bg-white shadow-sm flex items-center justify-center gap-2">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      Export Hub Report
                    </button>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-slate-200 border-b border-slate-200">
                    <div className="bg-white p-6">
                      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Total Physical Units</p>
                      <h4 className="text-3xl font-black text-slate-800 mt-1">{reportTotalUnits}</h4>
                    </div>
                    <div className="bg-white p-6">
                      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Unique SKUs Hosted</p>
                      <h4 className="text-3xl font-black text-slate-800 mt-1">{reportUniqueSKUs}</h4>
                    </div>
                  </div>

                  <div className="overflow-x-auto w-full pb-4">
                    <table className="w-full text-left min-w-[700px]">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          {reportHubId === 'ALL' && <th className="py-3 px-6 text-xs font-semibold text-slate-600 uppercase">Hub Location</th>}
                          <th className="py-3 px-6 text-xs font-semibold text-slate-600 uppercase">Product Item</th>
                          <th className="py-3 px-6 text-xs font-semibold text-slate-600 uppercase">SKU Identity</th>
                          <th className="py-3 px-6 text-xs font-semibold text-slate-600 uppercase text-right">Physical Qty</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {reportStock.length === 0 ? (
                          <tr><td colSpan={4} className="py-8 text-center text-sm font-medium text-slate-500">No inventory found in this location.</td></tr>
                        ) : reportStock.map(s => (
                          <tr key={s.id} className="hover:bg-teal-50/30 transition-colors">
                            {reportHubId === 'ALL' && (
                              <td className="py-3.5 px-6 font-bold text-teal-800 text-sm">
                                {warehouses.find(w=>w.id===s.warehouseId)?.name || <span className="text-[10px] text-rose-500 uppercase tracking-widest font-black">Orphaned Data</span>}
                              </td>
                            )}
                            <td className="py-3.5 px-6 font-bold text-slate-900 text-sm">{products.find(p=>p.id===s.productId)?.name || <span className="text-[10px] text-rose-500 uppercase tracking-widest font-black">Orphaned Data</span>}</td>
                            <td className="py-3.5 px-6 text-xs font-mono text-slate-500">{s.sku}</td>
                            <td className="py-3.5 px-6 text-right font-black text-lg text-slate-800">{s.quantity}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'locations' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-1 bg-white rounded-2xl shadow-sm border border-slate-200 p-6 h-fit">
                  <h3 className="font-bold text-lg text-slate-900 mb-4">Register Hub</h3>
                  <form onSubmit={handleCreateWarehouse} className="flex flex-col gap-4">
                    <input type="text" required value={whForm.name} onChange={e => setWhForm({...whForm, name: e.target.value})} className="px-4 py-2 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-teal-600" placeholder="e.g. North Manila Hub" />
                    <input type="text" required value={whForm.location} onChange={e => setWhForm({...whForm, location: e.target.value})} className="px-4 py-2 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-teal-600" placeholder="Address / Region" />
                    <button type="submit" disabled={isProcessing} className="py-2.5 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800 transition-colors">Add Warehouse</button>
                  </form>
                </div>
                <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-x-auto">
                  <table className="w-full text-left min-w-[500px]">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="py-3 px-6 text-xs font-semibold text-slate-600 uppercase">Hub Name</th>
                        <th className="py-3 px-6 text-xs font-semibold text-slate-600 uppercase">Location</th>
                        <th className="py-3 px-6 text-xs font-semibold text-slate-600 uppercase text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {warehouses.map(w => (
                        <tr key={w.id} className="hover:bg-slate-50 group">
                          <td className="py-3 px-6 font-bold text-slate-800">{w.name}</td>
                          <td className="py-3 px-6 text-sm text-slate-600">{w.location}</td>
                          <td className="py-3 px-6 text-right">
                            <button onClick={() => handleDeleteWarehouse(w.id)} disabled={isProcessing} className="text-rose-500 hover:text-rose-700 text-[11px] font-bold uppercase tracking-wider transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50">Delete</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'stock' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-1 bg-white rounded-2xl shadow-sm border border-slate-200 p-6 h-fit">
                  <h3 className="font-bold text-lg text-slate-900 mb-4">Assign Received Stock</h3>
                  <form onSubmit={handleAssignStock} className="flex flex-col gap-4">
                    <select required value={assignForm.warehouseId} onChange={e => setAssignForm({...assignForm, warehouseId: e.target.value})} className="px-4 py-2 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-teal-600 bg-white">
                      <option value="">Select Warehouse...</option>
                      {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                    <select required value={assignForm.productId} onChange={e => setAssignForm({...assignForm, productId: e.target.value})} className="px-4 py-2 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-teal-600 bg-white">
                      <option value="">Select Product...</option>
                      {products.map(p => <option key={p.id} value={p.id}>[{p.sku}] {p.name}</option>)}
                    </select>
                    <input type="number" required min="1" value={assignForm.quantity} onChange={e => setAssignForm({...assignForm, quantity: Number(e.target.value)})} className="px-4 py-2 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-teal-600" placeholder="Qty" />
                    <button type="submit" disabled={isProcessing} className="py-2.5 bg-teal-600 text-white font-bold rounded-xl hover:bg-teal-700 transition-colors">Assign to Location</button>
                  </form>
                </div>
                <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-x-auto">
                  <table className="w-full text-left min-w-[500px]">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="py-3 px-6 text-xs font-semibold text-slate-600 uppercase">Warehouse</th>
                        <th className="py-3 px-6 text-xs font-semibold text-slate-600 uppercase">Product</th>
                        <th className="py-3 px-6 text-xs font-semibold text-slate-600 uppercase text-right">Qty Hosted</th>
                        <th className="py-3 px-6 text-xs font-semibold text-slate-600 uppercase text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {stockRecords.map(s => (
                        <tr key={s.id} className="hover:bg-slate-50 group">
                          <td className="py-3 px-6 font-bold text-slate-800">
                            {warehouses.find(w=>w.id===s.warehouseId)?.name || <span className="text-[10px] text-rose-500 uppercase tracking-widest font-black">Orphaned Data</span>}
                          </td>
                          <td className="py-3 px-6">
                            <div className="text-sm font-bold text-slate-700">{products.find(p=>p.id===s.productId)?.name || <span className="text-[10px] text-rose-500 uppercase tracking-widest font-black">Orphaned Data</span>}</div>
                            <div className="text-[10px] text-slate-400 font-mono">{s.sku}</div>
                          </td>
                          <td className="py-3 px-6 text-right font-black text-teal-700">{s.quantity}</td>
                          <td className="py-3 px-6 text-right">
                            <div className="flex items-center justify-end gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => { setEditStockQty(s.quantity); setEditingStock(s); }} className="text-teal-600 hover:text-teal-800 text-[11px] font-bold uppercase tracking-wider transition-colors">Edit</button>
                              <button onClick={() => handleDeleteStock(s.id)} disabled={isProcessing} className="text-rose-500 hover:text-rose-700 text-[11px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50">Delete</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            
            {activeTab === 'transfers' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-1 bg-white rounded-2xl shadow-sm border border-slate-200 p-6 h-fit">
                  <h3 className="font-bold text-lg text-slate-900 mb-4">Execute Transfer</h3>
                  <form onSubmit={handleTransfer} className="flex flex-col gap-4">
                    <select required value={transferForm.sourceId} onChange={e => setTransferForm({...transferForm, sourceId: e.target.value})} className="px-4 py-2 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-teal-600 bg-white">
                      <option value="">Source Warehouse...</option>
                      {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                    <select required value={transferForm.destinationId} onChange={e => setTransferForm({...transferForm, destinationId: e.target.value})} className="px-4 py-2 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-teal-600 bg-white">
                      <option value="">Destination Warehouse...</option>
                      {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                    <select required value={transferForm.productId} onChange={e => setTransferForm({...transferForm, productId: e.target.value})} className="px-4 py-2 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-teal-600 bg-white">
                      <option value="">Product to Move...</option>
                      {products.map(p => <option key={p.id} value={p.id}>[{p.sku}] {p.name}</option>)}
                    </select>
                    <input type="number" required min="1" value={transferForm.quantity} onChange={e => setTransferForm({...transferForm, quantity: Number(e.target.value)})} className="px-4 py-2 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-teal-600" placeholder="Qty to move" />
                    <input type="text" value={transferForm.reference} onChange={e => setTransferForm({...transferForm, reference: e.target.value})} className="px-4 py-2 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-teal-600" placeholder="Driver / Ref #" />
                    <button type="submit" disabled={isProcessing} className="py-2.5 bg-teal-600 text-white font-bold rounded-xl hover:bg-teal-700 transition-colors">Transfer Stock</button>
                  </form>
                </div>
                <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-x-auto">
                  <table className="w-full text-left min-w-[700px]">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="py-3 px-6 text-xs font-semibold text-slate-600 uppercase">Date</th>
                        <th className="py-3 px-6 text-xs font-semibold text-slate-600 uppercase">Movement</th>
                        <th className="py-3 px-6 text-xs font-semibold text-slate-600 uppercase">Item</th>
                        <th className="py-3 px-6 text-xs font-semibold text-slate-600 uppercase text-right">Qty</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {transfers.map(t => (
                        <tr key={t.id} className="hover:bg-slate-50">
                          <td className="py-3 px-6 text-xs text-slate-500">{new Date(t.date).toLocaleString()}</td>
                          <td className="py-3 px-6">
                            <div className="text-xs font-bold text-rose-600 shrink-0">From: {warehouses.find(w=>w.id===t.sourceId)?.name || 'Deleted Hub'}</div>
                            <div className="text-xs font-bold text-emerald-600 mt-0.5 shrink-0">To: {warehouses.find(w=>w.id===t.destinationId)?.name || 'Deleted Hub'}</div>
                          </td>
                          <td className="py-3 px-6 font-bold text-sm text-slate-800">{t.sku}</td>
                          <td className="py-3 px-6 text-right font-black text-slate-800">{t.quantity}</td>
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