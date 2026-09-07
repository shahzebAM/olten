import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';

interface Product { id: number; company: string; name: string; sku: string; category: string; purchasePrice: number; sellingPrice: number; minQuantity: number; reorderLevel: number; unit: string; isActive: boolean; imageUrl: string; currentStock: number; }
interface Movement { id: string; productId: number; productName: string; sku: string; type: 'RECEIVE' | 'ISSUE' | 'ADJUST'; quantity: number; previousStock: number; newStock: number; reference: string; remarks: string; date: string; user: string; warehouseId?: string; }
interface Warehouse { id: string; name: string; location: string; isActive: boolean; }
interface WarehouseStock { id: string; warehouseId: string; productId: number; sku: string; quantity: number; }

export default function InventoryModule({ selectedCompany, loginUsername, API_BASE_URL, onLogout, onBack }: any) {
  
  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [hubStock, setHubStock] = useState<WarehouseStock[]>([]);
  
  const [activeTab, setActiveTab] = useState<'dashboard' | 'balances' | 'movements' | 'low_stock'>('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [ledgerSearchQuery, setLedgerSearchQuery] = useState('');

  const [transactionModal, setTransactionModal] = useState<{ isOpen: boolean; product: Product | null; type: 'RECEIVE' | 'ISSUE' | 'ADJUST'; }>({ isOpen: false, product: null, type: 'RECEIVE' });
  const [editingMovement, setEditingMovement] = useState<Movement | null>(null);
  const [editingMovementForm, setEditingMovementForm] = useState({ reference: '', remarks: '' });

  const [txForm, setTxForm] = useState({ reference: '', remarks: '' });
  const [adjustQty, setAdjustQty] = useState<number | ''>('');
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [isProcessing, setIsProcessing] = useState(false);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchData = () => {
    fetch(`${API_BASE_URL}/products?company=${selectedCompany}`).then(r => r.ok ? r.json() : []).then(setProducts).catch(() => {});
    fetch(`${API_BASE_URL}/inventory-movements?company=${selectedCompany}`).then(r => r.ok ? r.json() : []).then(setMovements).catch(() => {});
    fetch(`${API_BASE_URL}/warehouses?company=${selectedCompany}`).then(r => r.ok ? r.json() : []).then(setWarehouses).catch(() => {});
    fetch(`${API_BASE_URL}/warehouse-stock?company=${selectedCompany}`).then(r => r.ok ? r.json() : []).then(setHubStock).catch(() => {});
  };

  useEffect(() => { fetchData(); }, [selectedCompany]);

  const toggleWarehouse = (wId: string, checked: boolean) => {
    const next = { ...allocations };
    if (checked) next[wId] = 1;
    else delete next[wId];
    setAllocations(next);
  };

  const executeTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transactionModal.product) return;
    
    const prod = transactionModal.product;
    const previousPhysicalStock = Number(prod.currentStock) || 0;
    
    let totalTransactionQty = 0;
    let newStock = previousPhysicalStock;

    if (transactionModal.type === 'ADJUST') {
      if (adjustQty === '' || Number(adjustQty) < 0) return showToast("Enter a valid physical count.", "error");
      totalTransactionQty = Number(adjustQty) - previousPhysicalStock;
      newStock = Number(adjustQty);
    } else {
      totalTransactionQty = Object.values(allocations).reduce((acc, val) => acc + (val || 0), 0);
      if (totalTransactionQty <= 0) return showToast("You must allocate quantity to at least one warehouse.", "error");

      if (transactionModal.type === 'RECEIVE') {
        newStock += totalTransactionQty;
        for (const [wId, qty] of Object.entries(allocations)) {
          const hubCurrent = hubStock.find(h => h.warehouseId === wId && h.productId === prod.id)?.quantity || 0;
          if (qty > hubCurrent) return showToast(`Not enough stock in ${warehouses.find(w=>w.id===wId)?.name} to receive ${qty}.`, "error");
        }
      } 
      else if (transactionModal.type === 'ISSUE') {
        if (previousPhysicalStock < totalTransactionQty) return showToast("Insufficient Master Stock to distribute.", "error");
        newStock -= totalTransactionQty;
      }
    }

    setIsProcessing(true);

    try {
      const response = await fetch(`${API_BASE_URL}/products/${prod.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentStock: newStock })
      });
      if (!response.ok) throw new Error();

      const allocationRecord = Object.entries(allocations).map(([wId, qty]) => ({ id: wId, qty }));
      const movementPayload = {
        productId: prod.id, productName: prod.name, sku: prod.sku, type: transactionModal.type,
        quantity: transactionModal.type === 'ADJUST' ? totalTransactionQty : totalTransactionQty,
        previousStock: previousPhysicalStock, newStock: newStock, reference: txForm.reference || '', remarks: txForm.remarks || '',
        user: loginUsername || 'Admin', company: selectedCompany,
        warehouseId: transactionModal.type !== 'ADJUST' ? JSON.stringify(allocationRecord) : 'MANUAL_ADJUST'
      };

      const movResponse = await fetch(`${API_BASE_URL}/inventory-movements`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(movementPayload)
      });
      if (!movResponse.ok) throw new Error();
      const savedMovement = await movResponse.json();

      if (transactionModal.type !== 'ADJUST') {
        await Promise.all(Object.entries(allocations).map(([wId, qty]) => {
          const delta = transactionModal.type === 'ISSUE' ? qty : -qty; 
          return fetch(`${API_BASE_URL}/warehouse-stock`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ company: selectedCompany, warehouseId: wId, productId: prod.id, sku: prod.sku, quantity: delta })
          });
        }));
      }

      fetchData(); 
      showToast(`Stock successfully ${transactionModal.type.toLowerCase()}d.`, "success");
      setTransactionModal({ isOpen: false, product: null, type: 'RECEIVE' });
      setTxForm({ reference: '', remarks: '' });
      setAllocations({});
      setAdjustQty('');
    } catch (e) { showToast("Failed to process transaction.", "error"); } 
    finally { setIsProcessing(false); }
  };

  const handleDeleteMovement = async (movement: Movement) => {
    showToast("Reversing transaction...", "success");
    setIsProcessing(true);
    try {
      const prod = products.find(p => String(p.id) === String(movement.productId));
      if (!prod) throw new Error("Linked product no longer exists.");

      let reversedStock = Number(prod.currentStock) || 0;
      const movQty = Number(movement.quantity) || 0;

      if (movement.type === 'RECEIVE') reversedStock -= movQty;
      if (movement.type === 'ISSUE') reversedStock += movQty;
      if (movement.type === 'ADJUST') reversedStock = Number(movement.previousStock) || 0;

      const delRes = await fetch(`${API_BASE_URL}/inventory-movements/${movement.id}`, { method: 'DELETE' });
      if (!delRes.ok) throw new Error();

      await fetch(`${API_BASE_URL}/products/${prod.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentStock: reversedStock }) });

      if (movement.warehouseId && movement.warehouseId.startsWith('[{')) {
        const recordedAllocations = JSON.parse(movement.warehouseId);
        await Promise.all(recordedAllocations.map((alloc: any) => {
          const revDelta = movement.type === 'RECEIVE' ? alloc.qty : -alloc.qty;
          return fetch(`${API_BASE_URL}/warehouse-stock`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ company: selectedCompany, warehouseId: alloc.id, productId: prod.id, sku: prod.sku, quantity: revDelta })
          });
        }));
      }

      fetchData();
      showToast("Entry removed and stock fully reversed.", "success");
    } catch (err: any) { showToast("Failed to reverse movement.", "error"); } 
    finally { setIsProcessing(false); }
  };

  const handleSaveEditMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMovement) return;
    setIsProcessing(true);
    try {
      const res = await fetch(`${API_BASE_URL}/inventory-movements/${editingMovement.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editingMovementForm) });
      if (!res.ok) throw new Error();
      setMovements(movements.map(m => m.id === editingMovement.id ? { ...m, reference: editingMovementForm.reference, remarks: editingMovementForm.remarks } : m));
      showToast("Ledger entry updated successfully.", "success");
      setEditingMovement(null);
    } catch (err) { showToast("Failed to update ledger entry.", "error"); } 
    finally { setIsProcessing(false); }
  };

  const handleClearHistory = async () => {
    if (movements.length === 0) return showToast("Ledger is empty.", "error");
    if (!window.confirm("CRITICAL WARNING: This will permanently wipe the audit trail. Physical balances will NOT be changed. Proceed?")) return;
    setIsProcessing(true);
    try {
      await fetch(`${API_BASE_URL}/inventory-movements/clear/${selectedCompany}`, { method: 'DELETE' });
      setMovements([]);
      showToast("Movement history cleared.", "success");
    } catch (e: any) { showToast("Failed to clear history.", "error"); } 
    finally { setIsProcessing(false); }
  };

  const handleExportBalances = () => {
    showToast("Exporting balances...", "success");
    const ws = XLSX.utils.json_to_sheet(products.map(p => ({ SKU: p.sku, Product: p.name, "Master Stock": p.currentStock || 0, Unit: p.unit, Status: (p.currentStock || 0) <= p.reorderLevel ? 'LOW STOCK' : 'HEALTHY' })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Master Balances");
    XLSX.writeFile(wb, `${selectedCompany}_StockBalances.xlsx`);
  };

  const handleExportMovements = () => {
    showToast("Exporting movement history...", "success");
    const ws = XLSX.utils.json_to_sheet(movements);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Stock History");
    XLSX.writeFile(wb, `${selectedCompany}_StockHistory.xlsx`);
  };

  const openTx = (product: Product, type: 'RECEIVE' | 'ISSUE' | 'ADJUST') => {
    setTransactionModal({ isOpen: true, product, type });
    setAllocations({});
    setAdjustQty(product.currentStock || 0);
    setTxForm({ reference: '', remarks: '' });
  };

  const activeProducts = products.filter(p => p.company === selectedCompany && p.isActive);
  const lowStockList = activeProducts.filter(p => (p.currentStock || 0) <= p.reorderLevel);
  const filteredProducts = activeProducts.filter(p => (p.name?.toLowerCase() || '').includes(searchQuery.toLowerCase()) || (p.sku?.toLowerCase() || '').includes(searchQuery.toLowerCase()));
  const filteredMovements = movements.filter(m => (m.productName?.toLowerCase() || '').includes(ledgerSearchQuery.toLowerCase()) || (m.sku?.toLowerCase() || '').includes(ledgerSearchQuery.toLowerCase()) || (m.reference?.toLowerCase() || '').includes(ledgerSearchQuery.toLowerCase()) || (m.type?.toLowerCase() || '').includes(ledgerSearchQuery.toLowerCase()));

  return (
    <div className="flex h-screen w-full bg-slate-50 font-sans text-slate-900 overflow-hidden selection:bg-sky-100">
      
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[100] px-5 py-3.5 rounded-xl shadow-xl font-semibold flex items-center gap-3 animate-in slide-in-from-right-8 fade-in border ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>
          {toast.message}
        </div>
      )}

      {isMobileMenuOpen && <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 md:hidden" onClick={() => setIsMobileMenuOpen(false)}></div>}

      {editingMovement && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-5 border-b bg-slate-800 text-white flex justify-between items-center">
              <div>
                <h3 className="font-bold text-lg leading-tight tracking-wide">Edit Ledger Record</h3>
                <p className="text-[10px] opacity-80 uppercase tracking-widest">{editingMovement.sku}</p>
              </div>
            </div>
            <form onSubmit={handleSaveEditMovement} className="p-6 flex flex-col gap-4">
              <div className="bg-amber-50 text-amber-800 p-3 rounded-xl border border-amber-200 text-xs font-medium mb-2">
                <span className="font-bold">Note:</span> Quantities cannot be edited directly. To change quantities, delete this record to reverse the inventory math and create a new entry.
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-600 uppercase tracking-wide">Reference (PO / Invoice #)</label>
                <input type="text" value={editingMovementForm.reference} onChange={e => setEditingMovementForm({...editingMovementForm, reference: e.target.value})} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-sky-500 shadow-sm" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-600 uppercase tracking-wide">Remarks</label>
                <input type="text" value={editingMovementForm.remarks} onChange={e => setEditingMovementForm({...editingMovementForm, remarks: e.target.value})} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-sky-500 shadow-sm" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setEditingMovement(null)} className="flex-1 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors">Cancel</button>
                <button type="submit" disabled={isProcessing} className="flex-1 px-4 py-2.5 bg-sky-600 hover:bg-sky-700 text-white font-bold rounded-xl transition-colors disabled:opacity-50">
                  {isProcessing ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {transactionModal.isOpen && transactionModal.product && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
            <div className={`p-5 border-b flex items-center justify-between text-white ${transactionModal.type === 'RECEIVE' ? 'bg-emerald-600' : transactionModal.type === 'ISSUE' ? 'bg-rose-600' : 'bg-sky-600'}`}>
              <div className="flex items-center gap-3">
                <svg className="w-6 h-6 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  {transactionModal.type === 'RECEIVE' && <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />}
                  {transactionModal.type === 'ISSUE' && <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />}
                  {transactionModal.type === 'ADJUST' && <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />}
                </svg>
                <div>
                  <h3 className="font-bold text-lg leading-tight uppercase tracking-wide">{transactionModal.type} STOCK</h3>
                  <p className="text-[10px] opacity-80 uppercase tracking-widest">{transactionModal.product.sku}</p>
                </div>
              </div>
              <button type="button" onClick={() => setTransactionModal({ isOpen: false, product: null, type: 'RECEIVE' })} className="text-white/70 hover:text-white transition-colors">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            <form onSubmit={executeTransaction} className="p-4 sm:p-6 flex flex-col gap-4 sm:gap-5 max-h-[80vh] overflow-y-auto">
              <div className="flex justify-between items-center bg-slate-50 p-3 sm:p-4 rounded-xl border border-slate-100">
                <div className="min-w-0 pr-4">
                  <div className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-widest">Item</div>
                  <div className="font-bold text-slate-800 truncate">{transactionModal.product.name}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-widest">Master Balance</div>
                  <div className="font-black text-lg sm:text-xl text-slate-800">{transactionModal.product.currentStock || 0} {transactionModal.product.unit}</div>
                </div>
              </div>

              {transactionModal.type !== 'ADJUST' ? (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                  <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
                    <label className="text-xs font-bold text-slate-600 uppercase tracking-wide">Multi-Hub Distribution</label>
                  </div>
                  <div className="max-h-[200px] overflow-y-auto divide-y divide-slate-100">
                    {warehouses.length === 0 ? (
                      <div className="p-4 text-center text-sm text-slate-500 font-medium">No warehouses registered. Create one in the Multi-Warehouse module.</div>
                    ) : warehouses.map(w => {
                      const curStk = hubStock.find(h => h.warehouseId === w.id && h.productId === transactionModal.product?.id)?.quantity || 0;
                      return (
                        <div key={w.id} className={`flex items-center justify-between p-3 sm:p-4 transition-colors ${allocations[w.id] ? 'bg-sky-50/30' : 'hover:bg-slate-50'}`}>
                          <label className="flex items-center gap-3 cursor-pointer flex-1">
                            <input type="checkbox" checked={!!allocations[w.id]} onChange={e => toggleWarehouse(w.id, e.target.checked)} className="w-5 h-5 rounded border-slate-300 text-sky-600 focus:ring-sky-500" />
                            <div>
                              <div className="font-bold text-slate-800 text-sm">{w.name}</div>
                              <div className="text-[10px] font-medium text-slate-500 uppercase">Hub Qty: <span className="font-bold text-slate-700">{curStk}</span></div>
                            </div>
                          </label>
                          {allocations[w.id] !== undefined && (
                            <div className="relative w-24">
                              <input type="number" min="1" max={transactionModal.type === 'RECEIVE' ? curStk : undefined} required value={allocations[w.id] || ''} onChange={e => setAllocations({...allocations, [w.id]: Number(e.target.value)})} className="w-full pl-3 pr-8 py-2 border border-sky-300 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-sky-500 shadow-inner bg-white" placeholder="Qty" />
                              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400">{transactionModal.product?.unit}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="bg-slate-50 p-3 flex justify-between items-center border-t border-slate-200">
                    <span className="text-xs font-bold text-slate-600 uppercase tracking-widest">Total Selected</span>
                    <span className="text-lg font-black text-slate-900">{Object.values(allocations).reduce((a,b)=>a+(b||0),0)} {transactionModal.product?.unit}</span>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-600 uppercase tracking-wide">Master Physical Count <span className="text-rose-500">*</span></label>
                  <div className="relative">
                    <input type="number" required min="0" value={adjustQty} onChange={e => setAdjustQty(e.target.value === '' ? '' : Number(e.target.value))} className="w-full pl-4 pr-12 py-3 border border-slate-300 rounded-xl text-lg font-black outline-none focus:ring-2 focus:ring-sky-500 shadow-sm" />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">{transactionModal.product?.unit}</span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-600 uppercase tracking-wide">Ref (PO / Driver #)</label>
                  <input type="text" value={txForm.reference} onChange={e => setTxForm({...txForm, reference: e.target.value})} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-sky-500 shadow-sm" placeholder="Optional" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-600 uppercase tracking-wide">Remarks</label>
                  <input type="text" value={txForm.remarks} onChange={e => setTxForm({...txForm, remarks: e.target.value})} className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-sky-500 shadow-sm" placeholder="Condition notes" />
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <button type="button" onClick={() => setTransactionModal({ isOpen: false, product: null, type: 'RECEIVE' })} className="w-full sm:flex-1 px-4 py-3 sm:py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors">Cancel</button>
                <button type="submit" disabled={isProcessing} className={`w-full sm:flex-1 px-4 py-3 sm:py-2.5 text-white font-bold rounded-xl transition-colors disabled:opacity-50 shadow-sm ${transactionModal.type === 'RECEIVE' ? 'bg-emerald-600 hover:bg-emerald-700' : transactionModal.type === 'ISSUE' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-sky-600 hover:bg-sky-700'}`}>
                  {isProcessing ? 'Processing...' : `Confirm ${transactionModal.type}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <aside className={`fixed inset-y-0 left-0 z-50 transform bg-slate-900 text-slate-300 flex flex-col w-64 transition-transform duration-300 ease-in-out md:relative md:translate-x-0 border-r border-slate-800 shadow-2xl shrink-0 ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="h-20 flex items-center justify-between px-6 border-b border-slate-800 bg-slate-950 shrink-0">
          <h1 className="text-xl font-black text-white tracking-wider uppercase"><span className="text-sky-500">Inventory</span></h1>
          <button onClick={() => setIsMobileMenuOpen(false)} className="md:hidden text-slate-400 hover:text-white transition-colors"><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
        <div className="flex-1 overflow-y-auto py-6 px-3 space-y-1">
          <button onClick={() => { setActiveTab('dashboard'); setIsMobileMenuOpen(false); }} className={`w-full flex text-left gap-3 px-3 py-2.5 rounded-lg font-semibold text-sm transition-all ${activeTab === 'dashboard' ? 'bg-sky-600 text-white shadow-md shadow-sky-900/20' : 'hover:bg-slate-800 hover:text-white'}`}>Metrics Dashboard</button>
          <div className="px-3 pt-6 pb-2 text-xs font-bold text-slate-500 uppercase tracking-widest">Stock Control</div>
          <button onClick={() => { setActiveTab('balances'); setIsMobileMenuOpen(false); }} className={`w-full flex text-left gap-3 px-3 py-2.5 rounded-lg font-semibold text-sm transition-all ${activeTab === 'balances' ? 'bg-sky-600 text-white shadow-md shadow-sky-900/20' : 'hover:bg-slate-800 hover:text-white'}`}>Stock Balances</button>
          <button onClick={() => { setActiveTab('movements'); setIsMobileMenuOpen(false); }} className={`w-full flex text-left gap-3 px-3 py-2.5 rounded-lg font-semibold text-sm transition-all ${activeTab === 'movements' ? 'bg-sky-600 text-white shadow-md shadow-sky-900/20' : 'hover:bg-slate-800 hover:text-white'}`}>Movement Ledger</button>
          <div className="px-3 pt-6 pb-2 text-xs font-bold text-slate-500 uppercase tracking-widest">Reports</div>
          <button onClick={() => { setActiveTab('low_stock'); setIsMobileMenuOpen(false); }} className={`w-full flex justify-between items-center px-3 py-2.5 rounded-lg font-semibold text-sm transition-all ${activeTab === 'low_stock' ? 'bg-rose-600 text-white shadow-md shadow-rose-900/20' : 'hover:bg-slate-800 hover:text-white'}`}>
            Low Stock Report
            {lowStockList.length > 0 && <span className="bg-rose-500 text-white text-[10px] px-2 py-0.5 rounded-full font-black animate-pulse">{lowStockList.length}</span>}
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 h-screen">
        <header className="h-auto sm:h-20 bg-white border-b border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between px-4 sm:px-8 py-3 sm:py-0 shadow-sm relative z-10 shrink-0 gap-3 sm:gap-0">
          <div className="flex items-center gap-3 sm:gap-4 w-full sm:w-auto">
            <button onClick={() => setIsMobileMenuOpen(true)} className="md:hidden p-2 sm:p-2.5 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors border border-slate-200 shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg sm:text-2xl font-extrabold text-sky-950 tracking-tight truncate">Inventory Management</h2>
              <div className="text-[10px] sm:text-xs font-semibold text-slate-400 mt-0.5 flex items-center gap-1.5 sm:gap-2"><span>{selectedCompany}</span> <span className="hidden sm:inline">/</span> <span className="text-sky-600 truncate">Master Hub</span></div>
            </div>
          </div>
          <button onClick={onBack} className="w-full sm:w-auto flex justify-center items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-bold transition-colors border border-slate-200">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg> Gateway
          </button>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-8 relative z-0">
          <div className="max-w-7xl mx-auto space-y-6 sm:space-y-8 pb-12">
            
            {activeTab === 'dashboard' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6">
                  <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col justify-center">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Items Tracked</p>
                    <h3 className="text-4xl font-black text-sky-900 mt-1">{activeProducts.length}</h3>
                  </div>
                  <div className="bg-rose-50/30 rounded-2xl p-6 border border-rose-100 shadow-sm flex flex-col justify-center">
                    <p className="text-xs font-bold text-rose-500 uppercase tracking-wider">Low Stock Alerts</p>
                    <h3 className="text-4xl font-black text-rose-700 mt-1">{lowStockList.length}</h3>
                  </div>
                  <div className="bg-emerald-50/30 rounded-2xl p-6 border border-emerald-100 shadow-sm flex flex-col justify-center sm:col-span-2 md:col-span-1">
                    <p className="text-xs font-bold text-emerald-600 uppercase tracking-wider">Today's Transactions</p>
                    <h3 className="text-4xl font-black text-emerald-800 mt-1">{movements.filter(m => m.date?.startsWith(new Date().toISOString().split('T')[0])).length}</h3>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'balances' && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                <div className="p-4 sm:p-6 border-b border-slate-200 bg-sky-50/30">
                  <input type="text" placeholder="Search item to receive or issue..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full sm:w-[350px] px-4 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:ring-4 focus:ring-sky-600/10 focus:border-sky-600 shadow-sm transition-all" />
                </div>
                <div className="overflow-x-auto w-full pb-4">
                  <table className="w-full text-left min-w-[800px] border-collapse">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Item Identity</th>
                        <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Master Qty</th>
                        <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Reorder Lvl</th>
                        <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase text-right">Multi-Hub Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredProducts.map(p => (
                        <tr key={p.id} className="hover:bg-sky-50/30 transition-colors">
                          <td className="py-4 px-6">
                            <div className="font-bold text-slate-900">{p.name}</div>
                            <div className="text-[11px] text-slate-500 font-mono mt-0.5 tracking-wider">SKU: {p.sku}</div>
                          </td>
                          <td className="py-4 px-6">
                            <span className={`text-lg font-black ${(p.currentStock || 0) <= p.reorderLevel ? 'text-rose-600 animate-pulse' : 'text-slate-800'}`}>{p.currentStock || 0}</span>
                            <span className="text-xs font-medium text-slate-500 ml-1">{p.unit}</span>
                          </td>
                          <td className="py-4 px-6 text-sm text-slate-500 font-bold">{p.reorderLevel}</td>
                          <td className="py-4 px-6 text-right">
                            <div className="flex justify-end items-center gap-2">
                              <button onClick={() => openTx(p, 'RECEIVE')} className="px-3 py-1.5 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 text-[10px] sm:text-xs font-bold uppercase tracking-wider rounded-lg transition-colors">Recall</button>
                              <button onClick={() => openTx(p, 'ISSUE')} className="px-3 py-1.5 bg-rose-100 hover:bg-rose-200 text-rose-800 text-[10px] sm:text-xs font-bold uppercase tracking-wider rounded-lg transition-colors">Distribute</button>
                              <button onClick={() => openTx(p, 'ADJUST')} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] sm:text-xs font-bold uppercase tracking-wider rounded-lg transition-colors">Adjust Master</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'movements' && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                <div className="p-4 sm:p-6 border-b border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-sky-50/30">
                  <input type="text" placeholder="Search ledger..." value={ledgerSearchQuery} onChange={(e) => setLedgerSearchQuery(e.target.value)} className="w-full sm:w-[350px] px-4 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:ring-4 focus:ring-sky-600/10 focus:border-sky-600 shadow-sm transition-all" />
                  <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto mt-4 sm:mt-0">
                    <button onClick={handleClearHistory} disabled={isProcessing || movements.length === 0} className="w-full sm:w-auto text-sm font-bold text-rose-600 hover:text-rose-800 transition-colors text-left sm:text-right border border-rose-200 px-4 py-2 rounded-xl bg-white shadow-sm disabled:opacity-50">Clear History</button>
                    <button onClick={handleExportMovements} className="w-full sm:w-auto text-sm font-bold text-sky-600 hover:text-sky-800 transition-colors text-left sm:text-right border border-sky-200 px-4 py-2 rounded-xl bg-white shadow-sm">Export History</button>
                  </div>
                </div>
                <div className="overflow-x-auto w-full pb-4">
                  <table className="w-full text-left min-w-[1000px] border-collapse">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Date</th>
                        <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Item</th>
                        <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Type</th>
                        <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase text-right">Master Delta</th>
                        <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Destinations / Ref</th>
                        <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredMovements.map(m => {
                        let parsedHubs: any[] = [];
                        if (m.warehouseId && m.warehouseId.startsWith('[{')) {
                          try { parsedHubs = JSON.parse(m.warehouseId); } catch(e) {}
                        }
                        
                        return (
                          <tr key={m.id} className="hover:bg-slate-50 transition-colors group">
                            <td className="py-4 px-6 text-xs font-medium text-slate-500 whitespace-nowrap">{new Date(m.date).toLocaleString()}</td>
                            <td className="py-4 px-6">
                              <div className="font-bold text-slate-900 text-sm">{m.productName}</div>
                              <div className="text-[10px] text-slate-400 font-mono mt-0.5 tracking-wider">{m.sku}</div>
                            </td>
                            <td className="py-4 px-6">
                              <span className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-widest ${m.type === 'RECEIVE' ? 'bg-emerald-100 text-emerald-800' : m.type === 'ISSUE' ? 'bg-rose-100 text-rose-800' : 'bg-slate-200 text-slate-800'}`}>{m.type}</span>
                            </td>
                            <td className={`py-4 px-6 text-right font-black text-sm ${m.type === 'RECEIVE' ? 'text-emerald-600' : m.type === 'ISSUE' ? 'text-rose-600' : 'text-slate-800'}`}>
                              {m.type === 'RECEIVE' ? '+' : m.type === 'ISSUE' ? '-' : ''}{m.quantity}
                            </td>
                            <td className="py-4 px-6">
                              <div className="flex flex-wrap gap-1.5 mb-1">
                                {parsedHubs.length > 0 ? parsedHubs.map((h, i) => (
                                  <span key={i} className="px-2 py-0.5 bg-sky-50 border border-sky-100 text-sky-700 text-[10px] font-bold rounded">
                                    {warehouses.find(w=>w.id === h.id)?.name || 'Hub'} ({h.qty})
                                  </span>
                                )) : <span className="text-xs text-slate-400 font-medium">Master Adjust</span>}
                              </div>
                              <div className="text-xs font-bold text-slate-700">{m.reference || ''} <span className="font-normal text-slate-400">({m.user})</span></div>
                            </td>
                            <td className="py-4 px-6 text-right">
                              <div className="flex items-center justify-end gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => { setEditingMovementForm({ reference: m.reference || '', remarks: m.remarks || '' }); setEditingMovement(m); }} className="text-sky-600 hover:text-sky-800 text-xs font-bold uppercase tracking-wider transition-colors">Edit</button>
                                <button onClick={() => handleDeleteMovement(m)} disabled={isProcessing} className="text-rose-500 hover:text-rose-700 text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50">Delete</button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
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