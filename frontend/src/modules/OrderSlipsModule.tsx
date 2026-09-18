import React, { useState, useEffect, useMemo, useCallback } from 'react';

// --- INTERFACES ---
interface OrderItem {
  id: string;
  productId: number;
  sku: string;
  productName: string;
  requestedQty: number;
  unitPrice: number;
  lineTotal: number;
}

interface OrderSlip {
  id: string;
  osNumber: string;
  referenceOs?: string | null;
  company: string;
  customerId: string;
  customer?: { id: string; name: string; company: string };
  status: string;
  subtotal: number;
  vatApplied: boolean;
  vatRate: number;
  vatAmount: number;
  grandTotal: number;
  createdBy: string;
  createdAt: string;
  items: OrderItem[];
}

interface OrderSlipsModuleProps {
  selectedCompany: string;
  loginUsername: string;
  API_BASE_URL: string;
  onBack: () => void;
}

export default function OrderSlipsModule({ selectedCompany, loginUsername, API_BASE_URL, onBack }: OrderSlipsModuleProps) {
  const isAuthorizedAdmin = ['admin', 'ali', 'super admin'].includes(loginUsername?.toLowerCase() || '');

  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  
  // --- DATA STATES ---
  const [allSlips, setAllSlips] = useState<OrderSlip[]>([]);
  const [activeTab, setActiveTab] = useState<'OS' | 'FO'>('OS');
  const [searchQuery, setSearchQuery] = useState('');

  // --- MODAL STATES ---
  const [viewSlip, setViewSlip] = useState<OrderSlip | null>(null);

  const showToast = (msg: string, type: 'success' | 'error') => { 
    setToast({ message: msg, type }); 
    setTimeout(() => setToast(null), 3500); 
  };

  const fetchOrderSlips = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/sales/order-slips?company=${encodeURIComponent(selectedCompany)}&limit=500`);
      if (!res.ok) throw new Error("Failed to fetch records.");
      const data = await res.json();
      setAllSlips(data.data || []);
    } catch (e) {
      showToast("Error loading records.", "error");
    } finally {
      setIsLoading(false);
    }
  }, [selectedCompany, API_BASE_URL]);

  useEffect(() => {
    fetchOrderSlips();
  }, [fetchOrderSlips]);

  // --- FILTERING LOGIC ---
  const filteredSlips = useMemo(() => {
    let filtered = allSlips.filter(s => 
      activeTab === 'OS' ? s.osNumber.startsWith('OS') : s.osNumber.startsWith('FO')
    );

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(s => 
        s.osNumber.toLowerCase().includes(q) || 
        (s.referenceOs && s.referenceOs.toLowerCase().includes(q)) ||
        (s.customer && s.customer.name.toLowerCase().includes(q))
      );
    }

    return filtered;
  }, [allSlips, activeTab, searchQuery]);

  // --- CASCADE CANCEL / RETURN / DELETE ENGINE ---
  const processStatusChange = async (slip: OrderSlip, newStatus: 'Cancelled' | 'Returned') => {
    const isFO = slip.osNumber.startsWith('FO');
    const linkedFo = allSlips.find(s => s.referenceOs === slip.osNumber && s.osNumber.startsWith('FO') && s.status !== 'Cancelled' && s.status !== 'Returned');

    let confirmMsg = `Are you sure you want to mark this document as ${newStatus}?`;
    if (!isFO && linkedFo) {
      confirmMsg = `This OS has a linked Final Order (${linkedFo.osNumber}). Marking this OS as ${newStatus} will ALSO cancel the Final Order and safely restore the warehouse stock. Proceed?`;
    } else if (isFO && (newStatus === 'Cancelled' || newStatus === 'Returned')) {
      confirmMsg = `Marking this Final Order as ${newStatus} will safely restore deducted stock. Proceed?`;
    }

    if (!window.confirm(confirmMsg)) return;

    setIsLoading(true);
    try {
      // 1. Update the clicked record
      const res = await fetch(`${API_BASE_URL}/sales/order-slips/${slip.id}`, { 
        method: 'PATCH', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ status: newStatus, user: loginUsername }) 
      });
      if (!res.ok) throw new Error(`Failed to update status.`);

      const concurrentStockUpdates: any[] = [];

      // 2. If it's an FO, restore stock directly
      if (isFO) {
        slip.items.forEach(item => {
          const restoreQty = Math.abs(Number(item.requestedQty));
          concurrentStockUpdates.push(
            fetch(`${API_BASE_URL}/sales/order-slips/adjust-stock/${item.productId}`, {
              method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ officeStockAdjustment: restoreQty, quantity: restoreQty }) 
            }).catch(err => console.warn(`Stock Restore Fail for FO item:`, err))
          );
        });

        // Cascade cancel parent OS
        if (slip.referenceOs) {
          const parentOs = allSlips.find(s => s.osNumber === slip.referenceOs);
          if (parentOs) {
            concurrentStockUpdates.push(
              fetch(`${API_BASE_URL}/sales/order-slips/${parentOs.id}`, { 
                method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: newStatus, user: loginUsername }) 
              })
            );
          }
        }
      } 
      // 3. If OS with a linked FO, cascade cancel the FO and restore its stock
      else if (linkedFo) {
        concurrentStockUpdates.push(
          fetch(`${API_BASE_URL}/sales/order-slips/${linkedFo.id}`, { 
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: newStatus, user: loginUsername }) 
          })
        );
        linkedFo.items.forEach((item: any) => {
          const restoreQty = Math.abs(Number(item.requestedQty));
          concurrentStockUpdates.push(
            fetch(`${API_BASE_URL}/sales/order-slips/adjust-stock/${item.productId}`, {
              method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ officeStockAdjustment: restoreQty, quantity: restoreQty }) 
            }).catch(err => console.warn(`Stock Restore Fail for linked FO item:`, err))
          );
        });
      }

      await Promise.all(concurrentStockUpdates);

      showToast(`Document marked as ${newStatus} & Stock Restored!`, "success");
      setViewSlip(null);
      fetchOrderSlips(); 
    } catch (e: any) { 
      showToast(e.message || "Failed to process cancellation.", "error"); 
    } finally { 
      setIsLoading(false); 
    }
  };

  const handleHardDelete = async (slip: OrderSlip) => {
    if (!isAuthorizedAdmin) return showToast("Unauthorized action.", "error");
    
    const isFO = slip.osNumber.startsWith('FO');
    const linkedFo = allSlips.find(s => s.referenceOs === slip.osNumber && s.osNumber.startsWith('FO'));

    let confirmMsg = "CRITICAL WARNING: This will permanently wipe this record from the database. Are you sure?";
    if (!isFO && linkedFo) {
      confirmMsg = `WARNING: This OS has a linked Final Order (${linkedFo.osNumber}). You must delete the Final Order first to safely restore stock!`;
      window.alert(confirmMsg);
      return;
    } else if (isFO && slip.status !== 'Cancelled' && slip.status !== 'Returned') {
      confirmMsg = "CRITICAL WARNING: You are hard-deleting an ACTIVE Final Order. This will permanently wipe the record AND attempt to safely restore the stock. Proceed with extreme caution.";
    }

    if (!window.confirm(confirmMsg)) return;

    setIsLoading(true);
    try {
      // Restore stock if deleting an active FO
      if (isFO && slip.status !== 'Cancelled' && slip.status !== 'Returned') {
        const concurrentStockUpdates = slip.items.map(item => {
          const restoreQty = Math.abs(Number(item.requestedQty));
          return fetch(`${API_BASE_URL}/sales/order-slips/adjust-stock/${item.productId}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ officeStockAdjustment: restoreQty, quantity: restoreQty }) 
          }).catch(err => console.warn(`Stock Restore Fail:`, err));
        });
        await Promise.all(concurrentStockUpdates);
      }

      const res = await fetch(`${API_BASE_URL}/sales/order-slips/${slip.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error("Failed to delete record.");

      showToast("Record permanently deleted.", "success");
      fetchOrderSlips();
    } catch (e: any) {
      showToast(e.message || "Failed to delete record.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handlePrint = () => window.print();

  return (
    <div className="flex flex-col h-screen w-full bg-[#F8FAFC] font-sans text-slate-900 overflow-hidden">
      
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[100] px-5 py-3.5 rounded-xl shadow-xl font-bold text-sm print:hidden ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>
          {toast.message}
        </div>
      )}

      {/* HEADER */}
      <header className="h-16 sm:h-20 bg-white border-b border-slate-200 flex items-center justify-between px-6 sm:px-8 shrink-0 shadow-sm z-10 print:hidden">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight">Enterprise ERP <span className="text-slate-400 font-medium">| Document Ledger</span></h2>
        </div>
        <button onClick={onBack} className="px-4 py-2 sm:py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-[10px] sm:text-xs font-bold uppercase tracking-wider transition-colors shadow-sm border border-slate-200">
          Back to Gateway
        </button>
      </header>

      {/* NAVIGATION TABS & SEARCH */}
      <div className="bg-white border-b border-slate-200 px-6 sm:px-8 py-4 shrink-0 flex flex-col sm:flex-row justify-between items-center gap-4 print:hidden">
        <div className="flex bg-slate-100 p-1 rounded-xl shadow-inner w-full sm:w-auto">
          <button 
            onClick={() => setActiveTab('OS')} 
            className={`flex-1 sm:flex-none px-6 py-2.5 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'OS' ? 'bg-white text-indigo-700 shadow border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Order Slips (Drafts)
          </button>
          <button 
            onClick={() => setActiveTab('FO')} 
            className={`flex-1 sm:flex-none px-6 py-2.5 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'FO' ? 'bg-white text-teal-700 shadow border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Final Orders (Logged)
          </button>
        </div>

        <div className="w-full sm:w-72">
          <input 
            type="text" 
            placeholder="Search Doc or Customer..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all uppercase placeholder:normal-case"
          />
        </div>
      </div>

      {/* MAIN TABLE */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 print:hidden flex flex-col">
        <div className="bg-white border border-slate-300 rounded-2xl shadow-sm flex flex-col flex-1 overflow-hidden relative">
          
          {isLoading && (
            <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] z-10 flex items-center justify-center">
              <div className="font-bold text-indigo-600 animate-pulse uppercase tracking-widest text-sm bg-white px-6 py-3 rounded-full shadow-lg border border-indigo-100">Syncing Ledger...</div>
            </div>
          )}

          <div className="flex-1 overflow-auto w-full">
            <table className="w-full text-left text-sm whitespace-nowrap min-w-[1000px] border-collapse">
              <thead className="bg-slate-50 shadow-sm sticky top-0 z-20">
                <tr>
                  <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] border-b border-slate-200">Document No.</th>
                  {activeTab === 'FO' && <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] border-b border-slate-200">O.S. Reference</th>}
                  <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] border-b border-slate-200">Customer</th>
                  <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] border-b border-slate-200">Date</th>
                  <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] text-right border-b border-slate-200">Total Value</th>
                  <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] text-center border-b border-slate-200">Status</th>
                  <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] text-right border-b border-slate-200">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredSlips.length === 0 && !isLoading ? (
                  <tr><td colSpan={activeTab === 'FO' ? 7 : 6} className="py-20 text-center text-slate-400 font-medium">No records found.</td></tr>
                ) : (
                  filteredSlips.map(slip => (
                    <tr key={slip.id} className="hover:bg-slate-50 transition-colors">
                      <td className={`py-3.5 px-6 font-mono text-sm font-black ${slip.osNumber.startsWith('FO') ? 'text-teal-700' : 'text-indigo-700'}`}>{slip.osNumber}</td>
                      {activeTab === 'FO' && <td className="py-3.5 px-6 font-mono text-xs font-bold text-slate-400">{slip.referenceOs || '-'}</td>}
                      <td className="py-3.5 px-6 font-bold text-slate-900 uppercase truncate max-w-[200px]">{slip.customer?.name}</td>
                      <td className="py-3.5 px-6 font-bold text-slate-500 text-xs uppercase tracking-wider">{new Date(slip.createdAt).toLocaleDateString()}</td>
                      <td className="py-3.5 px-6 text-right font-black text-slate-900 font-mono">₱{Number(slip.grandTotal).toLocaleString('en-PH', {minimumFractionDigits: 2})}</td>
                      <td className="py-3.5 px-6 text-center">
                        <span className={`px-3 py-1.5 text-[9px] font-black uppercase tracking-wider rounded-md 
                          ${slip.status === 'Cancelled' ? 'bg-rose-100 text-rose-700' : 
                            slip.status === 'Returned' ? 'bg-amber-100 text-amber-700' : 
                            slip.status === 'Finalized Order' ? 'bg-teal-100 text-teal-800' : 
                            slip.status === 'Order Updated' ? 'bg-indigo-100 text-indigo-800' : 
                            'bg-slate-100 text-slate-700'}`}>
                          {slip.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-6 text-right space-x-2">
                        <button onClick={() => setViewSlip(slip)} className="px-3 py-1.5 bg-white text-slate-700 border border-slate-300 rounded-md text-[9px] font-black uppercase hover:bg-slate-50 transition-colors shadow-sm">View</button>
                        
                        {slip.status !== 'Cancelled' && slip.status !== 'Returned' && (
                          <button onClick={() => processStatusChange(slip, 'Cancelled')} className="px-3 py-1.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-md text-[9px] font-black uppercase hover:bg-rose-100 transition-colors shadow-sm">Cancel</button>
                        )}
                        
                        {isAuthorizedAdmin && (
                          <button onClick={() => handleHardDelete(slip)} className="px-3 py-1.5 bg-slate-800 text-white rounded-md text-[9px] font-black uppercase hover:bg-slate-900 transition-colors shadow-sm">Del</button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* VIEW & PRINT MODAL */}
      {viewSlip && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[250] flex justify-center p-4 sm:p-8 overflow-hidden print:p-0 print:bg-white print:block">
          
          <style type="text/css" media="print">{`@page { size: auto; margin: 0; }`}</style>

          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl my-auto print:shadow-none print:m-0 print:rounded-none flex flex-col max-h-full print:max-h-none">
            
            <div className="p-6 border-b border-slate-200 flex justify-between items-center bg-slate-50 shrink-0 print:hidden rounded-t-2xl">
              <div>
                <h3 className="text-xl font-black text-slate-900 tracking-tight uppercase">Document View: {viewSlip.osNumber}</h3>
                <p className="text-xs font-mono uppercase text-slate-500 tracking-widest mt-1">Status: {viewSlip.status}</p>
              </div>
              <div className="flex gap-3">
                <button onClick={handlePrint} className="px-5 py-2.5 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-indigo-700 shadow-sm transition-colors">Print Document</button>
                <button onClick={() => setViewSlip(null)} className="px-4 py-2.5 bg-white border border-slate-300 text-slate-700 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-slate-50 shadow-sm transition-colors">Close</button>
              </div>
            </div>

            {/* PRINT CONTAINER WITH ALL CAPS */}
            <div className="p-8 print:pt-12 print:px-8 print:pb-8 bg-white flex-1 overflow-y-auto print:overflow-visible relative">
              
              {/* WATERMARKS FOR CANCELLED/RETURNED */}
              {(viewSlip.status === 'Cancelled' || viewSlip.status === 'Returned') && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0 opacity-10">
                  <div className="text-[120px] font-black text-rose-600 uppercase tracking-tighter rotate-[-30deg] border-8 border-rose-600 px-12 py-4 rounded-3xl">
                    {viewSlip.status}
                  </div>
                </div>
              )}

              <div className="relative z-10">
                <h2 className="hidden print:block text-center text-xl font-black uppercase mb-8 tracking-widest text-slate-900">{selectedCompany}</h2>
                <div className="flex justify-between items-start mb-10 border-b-2 border-slate-900 pb-6">
                  <div>
                    <h1 className="text-3xl font-black text-slate-900 uppercase tracking-tighter print:hidden">{selectedCompany}</h1>
                    <p className="text-sm font-bold text-slate-500 mt-1 uppercase tracking-widest">{viewSlip.osNumber.startsWith('FO') ? 'Final Order' : 'Order Slip'}</p>
                  </div>
                  <div className="text-right">
                    <h2 className={`text-2xl font-mono font-black ${viewSlip.osNumber.startsWith('FO') ? 'text-teal-700' : 'text-indigo-700'}`}>{viewSlip.osNumber}</h2>
                    <p className="text-sm font-bold text-slate-500 mt-1 uppercase tracking-widest">Date: {new Date(viewSlip.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>

                <div className="mb-8">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 border-b border-slate-100 pb-1">Billed To</h4>
                  <div className="font-black text-lg text-slate-900 uppercase">{viewSlip.customer?.name || 'Unknown Customer'}</div>
                  <div className="text-xs font-mono text-slate-500 uppercase mt-1">Code: {viewSlip.customerId.slice(0,8)}</div>
                </div>

                <table className="w-full text-left text-sm mb-12 border-collapse bg-white">
                  <thead className="border-y-2 border-slate-900 bg-slate-50/50">
                    <tr>
                      <th className="py-3 px-3 font-black text-slate-900 uppercase text-xs w-32 border-r border-slate-200">SKU</th>
                      <th className="py-3 px-3 font-black text-slate-900 uppercase text-xs border-r border-slate-200">Description</th>
                      <th className="py-3 px-3 font-black text-slate-900 uppercase text-xs text-center w-24 border-r border-slate-200">Qty</th>
                      <th className="py-3 px-3 font-black text-slate-900 uppercase text-xs text-right w-32 border-r border-slate-200">Unit Price</th>
                      <th className="py-3 px-3 font-black text-slate-900 uppercase text-xs text-right w-32">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {viewSlip.items.map((item: any, idx: number) => (
                      <tr key={idx}>
                        <td className="py-3 px-3 font-mono text-xs border-r border-slate-200 font-bold text-slate-700 uppercase">{item.sku}</td>
                        <td className="py-3 px-3 font-bold text-slate-900 border-r border-slate-200 uppercase">{item.productName}</td>
                        <td className="py-3 px-3 text-center font-bold border-r border-slate-200 text-slate-500">{item.requestedQty}</td>
                        <td className="py-3 px-3 text-right border-r border-slate-200 font-mono text-slate-700">₱{Number(item.unitPrice).toLocaleString('en-PH', {minimumFractionDigits:2})}</td>
                        <td className="py-3 px-3 text-right font-black font-mono text-slate-900">₱{Number(item.lineTotal).toLocaleString('en-PH', {minimumFractionDigits:2})}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="flex justify-end border-t-2 border-slate-900 pt-6">
                  <div className="w-72 space-y-3">
                    <div className="flex justify-between text-sm font-bold text-slate-600"><span>Subtotal:</span><span className="font-mono">₱{Number(viewSlip.subtotal).toLocaleString('en-PH', {minimumFractionDigits:2})}</span></div>
                    <div className="flex justify-between text-sm font-bold text-slate-600 border-b border-slate-200 pb-3"><span>VAT (12%):</span><span className="font-mono">₱{Number(viewSlip.vatAmount).toLocaleString('en-PH', {minimumFractionDigits:2})}</span></div>
                    <div className="flex justify-between text-xl font-black text-slate-900 pt-1"><span>Total:</span><span className={`font-mono ${viewSlip.osNumber.startsWith('FO') ? 'text-teal-700' : 'text-indigo-700'}`}>₱{Number(viewSlip.grandTotal).toLocaleString('en-PH', {minimumFractionDigits:2})}</span></div>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-slate-200 bg-slate-50 print:hidden flex justify-between items-center rounded-b-2xl shrink-0">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Prepared by: {viewSlip.createdBy}</span>
              {viewSlip.status !== 'Cancelled' && viewSlip.status !== 'Returned' && (
                <div className="flex gap-2">
                  <button onClick={() => processStatusChange(viewSlip, 'Returned')} className="px-4 py-2 bg-white border border-amber-300 text-amber-700 font-black text-[10px] uppercase tracking-widest rounded-lg hover:bg-amber-50 shadow-sm transition-colors">Mark Returned</button>
                  <button onClick={() => processStatusChange(viewSlip, 'Cancelled')} className="px-4 py-2 bg-white border border-rose-300 text-rose-700 font-black text-[10px] uppercase tracking-widest rounded-lg hover:bg-rose-50 shadow-sm transition-colors">Mark Cancelled</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}