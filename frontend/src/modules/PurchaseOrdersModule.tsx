import React, { useState, useEffect, useCallback } from 'react';

// --- INTERFACES ---
interface POItem { 
  id: string; 
  productId: number; 
  sku: string; 
  productName: string; 
  requestedQty: number; 
  confirmedQty?: number;
  shortageQty?: number;
  unitCost: number; 
  lineTotal: number; 
}

interface PurchaseOrder {
  id: string;
  poNumber: string;
  company: string;
  osReference: string | null;
  status: string;
  subtotal: number;
  vatApplied: boolean;
  vatAmount: number;
  grandTotal: number;
  createdBy: string;
  createdAt: string;
  items: POItem[];
}

interface PurchaseOrdersModuleProps {
  selectedCompany: string;
  loginUsername: string;
  API_BASE_URL: string;
  onBack: () => void;
}

export default function PurchaseOrdersModule({ selectedCompany, loginUsername, API_BASE_URL, onBack }: PurchaseOrdersModuleProps) {
  const isAuthorizedAdmin = ['admin', 'ali', 'super admin'].includes(loginUsername?.toLowerCase() || '');

  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  // Modals
  const [viewPo, setViewPo] = useState<PurchaseOrder | null>(null);
  const [receivePo, setReceivePo] = useState<PurchaseOrder | null>(null);
  const [receiveItems, setReceiveItems] = useState<any[]>([]);

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ message: msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchPurchaseOrders = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/procurement/purchase-orders?company=${encodeURIComponent(selectedCompany)}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setPurchaseOrders(data || []);
    } catch (e) {
      showToast("Error loading Purchase Orders.", "error");
    } finally {
      setIsLoading(false);
    }
  }, [selectedCompany, API_BASE_URL]);

  useEffect(() => { 
    fetchPurchaseOrders(); 
  }, [fetchPurchaseOrders]);

  // --- RECEIVE WORKFLOW (PHASE 8) ---
  const openReceiveModal = (po: PurchaseOrder) => {
    setReceivePo(po);
    setReceiveItems(po.items.map(i => ({
      ...i,
      confirmedQty: i.confirmedQty !== undefined && i.confirmedQty !== null ? i.confirmedQty : i.requestedQty,
      shortageQty: i.shortageQty || 0
    })));
  };

  const handleUpdateReceiveQty = (index: number, val: string) => {
    const updated = [...receiveItems];
    if (val === '') {
      updated[index].confirmedQty = '';
      updated[index].shortageQty = updated[index].requestedQty;
    } else {
      const confirmed = parseInt(val, 10);
      const requested = updated[index].requestedQty;
      updated[index].confirmedQty = isNaN(confirmed) ? '' : confirmed;
      updated[index].shortageQty = isNaN(confirmed) ? requested : Math.max(0, requested - confirmed);
    }
    setReceiveItems(updated);
  };

  const handleReceiveSubmit = async () => {
    if (!receivePo) return;
    
    const isValid = receiveItems.every(i => typeof i.confirmedQty === 'number' && !isNaN(i.confirmedQty) && i.confirmedQty >= 0);
    if (!isValid) return showToast("Enter a valid received quantity for all items.", "error");

    setIsLoading(true);
    try {
      const payload = {
        user: loginUsername,
        verifications: receiveItems.map(i => ({
          itemId: i.id,
          confirmedQty: Number(i.confirmedQty)
        }))
      };

      const res = await fetch(`${API_BASE_URL}/procurement/purchase-orders/${receivePo.id}/receive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error();
      
      showToast("Purchase Order received successfully. Shortages logged.", "success");
      setReceivePo(null);
      fetchPurchaseOrders();
    } catch (e) {
      showToast("Failed to receive Purchase Order.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelPo = async (id: string) => {
    if (!window.confirm("Void this Purchase Order? It will remain in history as Cancelled.")) return;
    try {
      const res = await fetch(`${API_BASE_URL}/procurement/purchase-orders/${id}/cancel`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: loginUsername })
      });
      if (!res.ok) throw new Error();
      showToast("Purchase Order cancelled.", "success");
      setViewPo(null);
      fetchPurchaseOrders();
    } catch (e) {
      showToast("Failed to cancel P.O.", "error");
    }
  };

  const handleHardDeletePo = async (id: string) => {
    if (!isAuthorizedAdmin) return showToast("Unauthorized action.", "error");
    if (!window.confirm("CRITICAL WARNING: This will permanently wipe this P.O. Are you sure?")) return;
    try {
      const res = await fetch(`${API_BASE_URL}/procurement/purchase-orders/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      showToast("Purchase Order permanently deleted.", "success");
      fetchPurchaseOrders();
    } catch (e) {
      showToast("Failed to delete P.O.", "error");
    }
  };

  return (
    <div className="flex flex-col h-screen w-full bg-[#F8FAFC] font-sans text-slate-900 overflow-hidden">
      
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[100] px-5 py-3.5 rounded-xl shadow-xl font-bold text-sm ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>
          {toast.message}
        </div>
      )}

      <header className="h-16 sm:h-20 bg-white border-b border-slate-200 flex items-center justify-between px-6 sm:px-8 shrink-0 shadow-sm z-10 print:hidden">
        <div><h2 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight">Enterprise ERP <span className="text-slate-400 font-medium">| P.O. Procurement Ledger</span></h2></div>
        <button onClick={onBack} className="px-4 py-2 sm:py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-[10px] sm:text-xs font-bold uppercase tracking-wider transition-colors shadow-sm border border-slate-200">
          Back to Gateway
        </button>
      </header>

      <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 print:hidden flex flex-col">
        <div className="w-full max-w-7xl mx-auto space-y-4 sm:space-y-6 flex-1 flex flex-col">

          {/* LEDGER TABLE */}
          <div className="bg-white border border-slate-300 rounded-2xl shadow-sm flex flex-col flex-1 overflow-hidden relative">
            {isLoading && (
              <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] z-10 flex items-center justify-center">
                <div className="font-bold text-sky-600 animate-pulse uppercase tracking-widest text-sm bg-white px-6 py-3 rounded-full shadow-lg border border-sky-100">Syncing P.O. Ledger...</div>
              </div>
            )}
            <div className="flex-1 overflow-auto w-full">
              <table className="w-full text-left text-sm whitespace-nowrap min-w-[1100px] border-collapse">
                <thead className="bg-slate-50 shadow-sm sticky top-0 z-20">
                  <tr>
                    <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] border-b border-slate-200">P.O. Number</th>
                    <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] border-b border-slate-200">O.S. Reference</th>
                    <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] text-center border-b border-slate-200">Items</th>
                    <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] text-right border-b border-slate-200">Total Value</th>
                    <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] text-center border-b border-slate-200">Status</th>
                    <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] border-b border-slate-200">Generated By</th>
                    <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] text-right border-b border-slate-200">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {purchaseOrders.length === 0 && !isLoading ? (
                    <tr><td colSpan={7} className="py-20 text-center text-slate-400 font-medium">No Purchase Orders generated yet.</td></tr>
                  ) : (
                    purchaseOrders.map(po => (
                      <tr key={po.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-3.5 px-6 font-mono text-sm font-black text-sky-700">{po.poNumber}</td>
                        <td className="py-3.5 px-6 font-mono text-xs font-bold text-slate-400">{po.osReference || 'N/A'}</td>
                        <td className="py-3.5 px-6 text-center font-black text-slate-700">{po.items?.length || 0}</td>
                        <td className="py-3.5 px-6 text-right font-black text-slate-900 font-mono">₱{Number(po.grandTotal).toLocaleString('en-PH', {minimumFractionDigits: 2})}</td>
                        <td className="py-3.5 px-6 text-center">
                          <span className={`px-3 py-1.5 text-[9px] font-black uppercase tracking-wider rounded-md 
                            ${po.status === 'Cancelled' ? 'bg-rose-100 text-rose-700' : 
                              po.status === 'Generated' ? 'bg-sky-100 text-sky-700' : 
                              po.status === 'Partially Received' ? 'bg-amber-100 text-amber-700' : 
                              po.status === 'Received' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700'}`}>
                            {po.status}
                          </span>
                        </td>
                        <td className="py-3.5 px-6 text-xs font-bold text-slate-500 uppercase">{po.createdBy}</td>
                        <td className="py-3.5 px-6 text-right space-x-2">
                          {po.status !== 'Cancelled' && (
                            <button onClick={() => openReceiveModal(po)} className="px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md text-[9px] font-black uppercase hover:bg-emerald-100 transition-colors shadow-sm">Receive</button>
                          )}
                          <button onClick={() => setViewPo(po)} className="px-3 py-1.5 bg-white text-slate-700 border border-slate-300 rounded-md text-[9px] font-black uppercase hover:bg-slate-50 transition-colors shadow-sm">View</button>
                          {isAuthorizedAdmin && (
                            <button onClick={() => handleHardDeletePo(po.id)} className="px-3 py-1.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-md text-[9px] font-black uppercase hover:bg-rose-100 transition-colors shadow-sm">Del</button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>

      {/* RECEIVE PO MODAL */}
      {receivePo && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[200] flex justify-center items-center p-4 sm:p-8">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 max-h-full">
            
            <div className="p-6 border-b border-slate-200 flex justify-between items-center bg-slate-50 shrink-0">
              <div>
                <h3 className="text-xl font-black text-slate-900 tracking-tight uppercase">Receive Purchase Order: {receivePo.poNumber}</h3>
                <p className="text-xs font-bold text-slate-500 tracking-widest mt-1 uppercase">Verify Supplier Delivery vs Requested Qty</p>
              </div>
              <button type="button" onClick={() => setReceivePo(null)} className="text-slate-400 hover:text-slate-700 font-black text-xl">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 bg-white relative">
              <table className="w-full text-left text-sm whitespace-nowrap border-collapse">
                <thead className="bg-slate-50 border-y border-slate-200">
                  <tr>
                    <th className="py-3 px-4 font-black text-slate-500 uppercase tracking-widest text-[10px]">SKU / Product</th>
                    <th className="py-3 px-4 font-black text-sky-600 uppercase tracking-widest text-[10px] text-center w-28 bg-sky-50/50">Ordered</th>
                    <th className="py-3 px-4 font-black text-emerald-600 uppercase tracking-widest text-[10px] text-center w-36 bg-emerald-50/50">Delivered / Received</th>
                    <th className="py-3 px-4 font-black text-rose-600 uppercase tracking-widest text-[10px] text-center w-28 bg-rose-50/50">Shortage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {receiveItems.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="py-4 px-4 border border-slate-100">
                        <div className="font-bold text-slate-900 truncate max-w-[300px]">{item.productName}</div>
                        <div className="text-[10px] font-mono text-slate-500">{item.sku}</div>
                      </td>
                      <td className="py-4 px-4 border border-slate-100 text-center font-black text-sky-700 bg-sky-50/20">
                        {item.requestedQty}
                      </td>
                      <td className="py-2 px-4 border border-slate-100 bg-emerald-50/20 relative">
                        <input 
                          type="number" min="0" value={item.confirmedQty} 
                          onChange={e => handleUpdateReceiveQty(idx, e.target.value)} 
                          className={`w-full px-2 py-2.5 text-center font-black text-lg bg-white border-2 rounded outline-none shadow-sm transition-all
                            ${item.shortageQty > 0 ? 'border-rose-400 text-rose-700 focus:border-rose-600' : 'border-emerald-300 text-emerald-700 focus:border-emerald-600'}
                          `} 
                        />
                      </td>
                      <td className={`py-4 px-4 text-center border border-slate-100 font-black text-lg ${item.shortageQty > 0 ? 'text-rose-600 bg-rose-50/40' : 'text-slate-300'}`}>
                        {item.shortageQty}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-6 border-t border-slate-200 bg-slate-50 shrink-0 flex justify-between items-center">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                Missing items automatically route to Shortages.
              </p>
              <button 
                onClick={handleReceiveSubmit} 
                disabled={isLoading} 
                className="px-8 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 text-white font-black uppercase tracking-wider rounded-xl transition-colors shadow-lg"
              >
                {isLoading ? "Processing..." : "Confirm Delivery"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW PO MODAL */}
      {viewPo && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex justify-center p-4 sm:p-8 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl my-auto flex flex-col">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0 rounded-t-2xl">
              <div>
                <h3 className="text-xl font-black text-slate-900 tracking-tight">P.O. Detail View</h3>
                <p className="text-xs font-mono uppercase text-slate-500 tracking-widest mt-1">Ref: {viewPo.osReference || 'Direct'}</p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setViewPo(null)} className="px-4 py-2.5 bg-white border border-slate-300 text-slate-700 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-slate-50 shadow-sm transition-colors">Close</button>
              </div>
            </div>

            <div className="p-8 bg-white flex-1">
              <div className="flex justify-between items-start mb-10 border-b-2 border-slate-900 pb-6">
                <div>
                  <h1 className="text-3xl font-black text-slate-900 uppercase tracking-tighter">{selectedCompany}</h1>
                  <p className="text-sm font-bold text-slate-500 mt-1 uppercase tracking-widest">Purchase Order</p>
                </div>
                <div className="text-right">
                  <h2 className="text-2xl font-mono font-black text-sky-700">{viewPo.poNumber}</h2>
                  <p className="text-sm font-bold text-slate-500 mt-1 uppercase tracking-widest">Date: {new Date(viewPo.createdAt).toLocaleDateString()}</p>
                  {viewPo.status === 'Cancelled' && <p className="text-lg font-black text-rose-600 uppercase mt-2 border-2 border-rose-600 inline-block px-3 py-1">VOID / CANCELLED</p>}
                </div>
              </div>

              <table className="w-full text-left text-sm mb-12 border-collapse">
                <thead className="border-y-2 border-slate-900 bg-slate-50/50">
                  <tr>
                    <th className="py-3 px-3 font-black text-slate-900 uppercase text-xs w-32 border-r border-slate-200">SKU</th>
                    <th className="py-3 px-3 font-black text-slate-900 uppercase text-xs border-r border-slate-200">Description</th>
                    <th className="py-3 px-3 font-black text-slate-900 uppercase text-xs text-center w-24 border-r border-slate-200">Ordered</th>
                    <th className="py-3 px-3 font-black text-slate-900 uppercase text-xs text-center w-24 border-r border-slate-200">Received</th>
                    <th className="py-3 px-3 font-black text-slate-900 uppercase text-xs text-right w-32 border-r border-slate-200">Unit Cost</th>
                    <th className="py-3 px-3 font-black text-slate-900 uppercase text-xs text-right w-32">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {viewPo.items.map((item, idx) => (
                    <tr key={idx}>
                      <td className="py-3 px-3 font-mono text-xs border-r border-slate-200 font-bold text-slate-700">{item.sku}</td>
                      <td className="py-3 px-3 font-bold text-slate-900 border-r border-slate-200">
                        {item.productName}
                        {item.shortageQty && item.shortageQty > 0 ? (
                          <span className="ml-2 px-1.5 py-0.5 bg-rose-100 text-rose-700 text-[9px] font-black uppercase rounded">Short {item.shortageQty}</span>
                        ) : null}
                      </td>
                      <td className="py-3 px-3 text-center font-bold border-r border-slate-200 text-slate-500">{item.requestedQty}</td>
                      <td className="py-3 px-3 text-center font-black border-r border-slate-200 text-emerald-700">{item.confirmedQty !== undefined && item.confirmedQty !== null ? item.confirmedQty : '-'}</td>
                      <td className="py-3 px-3 text-right border-r border-slate-200 font-mono text-slate-700">₱{Number(item.unitCost).toLocaleString('en-PH', {minimumFractionDigits:2})}</td>
                      <td className="py-3 px-3 text-right font-black font-mono text-slate-900">₱{Number(item.lineTotal).toLocaleString('en-PH', {minimumFractionDigits:2})}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="flex justify-end border-t-2 border-slate-900 pt-6">
                <div className="w-72 space-y-3">
                  <div className="flex justify-between text-xl font-black text-slate-900 pt-1">
                    <span>Total Cost:</span>
                    <span className="font-mono text-sky-700">₱{Number(viewPo.grandTotal).toLocaleString('en-PH', {minimumFractionDigits:2})}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-slate-200 bg-slate-50 flex justify-between items-center rounded-b-2xl">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Generated by: {viewPo.createdBy}</span>
              {viewPo.status !== 'Cancelled' && (
                <button onClick={() => handleCancelPo(viewPo.id)} className="px-5 py-2.5 bg-white border border-rose-200 text-rose-600 font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-rose-50 shadow-sm transition-colors">Cancel P.O.</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}