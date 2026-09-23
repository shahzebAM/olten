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
  onCreateNew?: () => void; 
}

export default function OrderSlipsModule({ selectedCompany, loginUsername, API_BASE_URL, onBack, onCreateNew }: OrderSlipsModuleProps) {
  const isAuthorizedAdmin = ['admin', 'ali', 'super admin'].includes(loginUsername?.toLowerCase() || '');

  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isGeneratingFo, setIsGeneratingFo] = useState(false);
  
  // --- DATA STATES ---
  const [allSlips, setAllSlips] = useState<OrderSlip[]>([]);
  const [activeTab, setActiveTab] = useState<'OS' | 'FO'>('OS');
  const [searchQuery, setSearchQuery] = useState('');

  // --- MODAL STATES ---
  const [viewSlip, setViewSlip] = useState<OrderSlip | null>(null);
  const [foNumberInput, setFoNumberInput] = useState('');

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

  useEffect(() => { fetchOrderSlips(); }, [fetchOrderSlips]);

  // PRE-CALCULATE NEXT FO NUMBER WHEN VIEWING AN OS
  useEffect(() => {
    if (viewSlip && viewSlip.osNumber.startsWith('OS') && viewSlip.status !== 'Finalized Order' && viewSlip.status !== 'Cancelled' && viewSlip.status !== 'Returned') {
      const foSlips = allSlips.filter(s => s.osNumber.startsWith('FO'));
      foSlips.sort((a, b) => parseInt(b.osNumber.replace(/\D/g, '') || '0') - parseInt(a.osNumber.replace(/\D/g, '') || '0'));
      
      const lastFo = foSlips.length > 0 ? foSlips[0] : null;
      if (lastFo) {
        const match = lastFo.osNumber.match(/(\d+)$/); 
        if (match) {
          const nextNum = parseInt(match[0], 10) + 1;
          const prefix = lastFo.osNumber.substring(0, match.index);
          const padding = match[0].length;
          setFoNumberInput(`${prefix}${String(nextNum).padStart(padding, '0')}`);
        } else {
          setFoNumberInput('FO-000001');
        }
      } else {
        setFoNumberInput('FO-000001');
      }
    }
  }, [viewSlip, allSlips]);

  // --- FILTERING LOGIC ---
  const filteredSlips = useMemo(() => {
    let filtered = allSlips.filter(s => activeTab === 'OS' ? s.osNumber.startsWith('OS') : s.osNumber.startsWith('FO'));
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(s => 
        s.osNumber.toLowerCase().includes(q) || (s.referenceOs && s.referenceOs.toLowerCase().includes(q)) || (s.customer && s.customer.name.toLowerCase().includes(q))
      );
    }
    return filtered;
  }, [allSlips, activeTab, searchQuery]);

  // --- GENERATE FO DIRECTLY FROM LEDGER ---
  const handleGenerateFoFromLedger = async () => {
    if (!viewSlip || !foNumberInput.trim()) return;
    setIsGeneratingFo(true);
    try {
      const payload = {
        osNumber: foNumberInput.trim(), referenceOs: viewSlip.osNumber, company: selectedCompany, customerId: viewSlip.customerId,
        isVatApplied: viewSlip.vatApplied, vatRate: viewSlip.vatRate, subtotal: viewSlip.subtotal, vatAmount: viewSlip.vatAmount, grandTotal: viewSlip.grandTotal, user: loginUsername,
        items: viewSlip.items.map(i => ({ productId: i.productId, sku: i.sku, productName: i.productName, requestedQty: Number(i.requestedQty), unitPrice: Number(i.unitPrice), lineTotal: Number(i.lineTotal) }))
      };

      const res = await fetch(`${API_BASE_URL}/sales/order-slips`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error("Failed to generate FO");
      
      await fetch(`${API_BASE_URL}/sales/order-slips/${viewSlip.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'Finalized Order', user: loginUsername })
      });

      showToast("Final Order Generated & Stock Deducted by Backend!", "success");
      setViewSlip(null);
      fetchOrderSlips();
    } catch(e: any) { showToast(e.message || "Failed to generate Final Order", "error"); } finally { setIsGeneratingFo(false); }
  };

  const processStatusChange = async (slip: OrderSlip, newStatus: 'Cancelled' | 'Returned') => {
    const isFO = slip.osNumber.startsWith('FO');
    let confirmMsg = `Are you sure you want to mark this document as ${newStatus}?`;

    if (!isFO) {
      confirmMsg = `Notice: Marking an OS as ${newStatus} is safe. However, if an active Final Order exists for this OS, the backend will strictly block this action. Proceed?`;
    } else {
      confirmMsg = `Marking this Final Order as ${newStatus} will safely restore deducted stock to the Office.\n\nBecause this is a Final Order, its original parent Order Slip (${slip.referenceOs}) will also be automatically marked as ${newStatus}. Proceed?`;
    }

    if (!window.confirm(confirmMsg)) return;

    setIsLoading(true);
    try {
      // 1. Cancel the target slip (FO or OS)
      const res = await fetch(`${API_BASE_URL}/sales/order-slips/${slip.id}/cancel`, { 
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: loginUsername, status: newStatus }) 
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || `Failed to process cancellation.`);
      }

      // 2. AUTO-CASCADING CANCELLATION: If this is an FO, find and cancel its parent OS automatically
      if (isFO && slip.referenceOs) {
        const parentOs = allSlips.find(s => s.osNumber === slip.referenceOs);
        if (parentOs && parentOs.status !== newStatus) {
          try {
            await fetch(`${API_BASE_URL}/sales/order-slips/${parentOs.id}/cancel`, { 
              method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: loginUsername, status: newStatus }) 
            });
          } catch (parentErr) {
            console.warn("Parent OS Auto-Cancel failed:", parentErr);
          }
        }
      }

      showToast(`Document(s) marked as ${newStatus}!`, "success");
      setViewSlip(null);
      fetchOrderSlips(); 
    } catch (e: any) { showToast(e.message || "Failed to process cancellation.", "error"); } finally { setIsLoading(false); }
  };

  const handleHardDelete = async (slip: OrderSlip) => {
    if (!isAuthorizedAdmin) return showToast("Unauthorized action.", "error");
    const isFO = slip.osNumber.startsWith('FO');
    let confirmMsg = "CRITICAL WARNING: This will permanently wipe this record from the database. Are you sure?";
    
    if (!isFO) {
      confirmMsg = "Notice: Deleting this OS is safe. However, if a Final Order exists for this OS, the backend will strictly block this action. Proceed?";
    } else {
      confirmMsg = "CRITICAL WARNING: You are deleting a Final Order. The backend will restore the stock, and also permanently wipe its parent OS. Proceed?";
    }

    if (!window.confirm(confirmMsg)) return;

    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/sales/order-slips/${slip.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || "Failed to delete record.");
      }

      showToast("Records permanently deleted.", "success");
      fetchOrderSlips();
    } catch (e: any) { showToast(e.message || "Failed to delete record.", "error"); } finally { setIsLoading(false); }
  };

  const handlePrint = () => window.print();

  return (
    <div className="flex flex-col h-screen w-full bg-[#F8FAFC] font-sans text-slate-900 overflow-hidden">
      
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[100] px-5 py-3.5 rounded-xl shadow-xl font-bold text-sm print:hidden ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>
          {toast.message}
        </div>
      )}

      {/* HEADER WITH OS GEN BUTTON */}
      <header className="h-16 sm:h-20 bg-white border-b border-slate-200 flex items-center justify-between px-6 sm:px-8 shrink-0 shadow-sm z-10 print:hidden">
        <div><h2 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight">Enterprise ERP <span className="text-slate-400 font-medium">| Document Ledger</span></h2></div>
        <div className="flex gap-3">
          {onCreateNew && (
            <button onClick={onCreateNew} className="px-4 py-2 sm:py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[10px] sm:text-xs font-bold uppercase tracking-wider transition-colors shadow-sm">OS Gen</button>
          )}
          <button onClick={onBack} className="px-4 py-2 sm:py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-[10px] sm:text-xs font-bold uppercase tracking-wider transition-colors shadow-sm border border-slate-200">Back to Gateway</button>
        </div>
      </header>

      {/* NAVIGATION TABS & SEARCH */}
      <div className="bg-white border-b border-slate-200 px-6 sm:px-8 py-4 shrink-0 flex flex-col sm:flex-row justify-between items-center gap-4 print:hidden">
        <div className="flex bg-slate-100 p-1 rounded-xl shadow-inner w-full sm:w-auto">
          <button onClick={() => setActiveTab('OS')} className={`flex-1 sm:flex-none px-6 py-2.5 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'OS' ? 'bg-white text-indigo-700 shadow border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}>Order Slips (Drafts)</button>
          <button onClick={() => setActiveTab('FO')} className={`flex-1 sm:flex-none px-6 py-2.5 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'FO' ? 'bg-white text-teal-700 shadow border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}>Final Orders (Logged)</button>
        </div>

        <div className="w-full sm:w-72">
          <input 
            type="text" placeholder="Search Doc or Customer..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
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

      {/* VIEW & PRINT MODAL WITH GENERATE FO CAPABILITY */}
      {viewSlip && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[250] flex justify-center p-4 sm:p-8 overflow-hidden print:p-0 print:bg-white print:block">
          
          <style type="text/css" media="print">{`@page { size: auto; margin: 0; }`}</style>

          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl my-auto print:shadow-none print:m-0 print:rounded-none flex flex-col max-h-full print:max-h-none">
            
            <div className="p-6 border-b border-slate-200 flex justify-between items-center bg-slate-50 shrink-0 print:hidden rounded-t-2xl">
              <div>
                <h3 className="text-xl font-black text-slate-900 tracking-tight uppercase">Document View: {viewSlip.osNumber}</h3>
                <p className="text-xs font-mono uppercase text-slate-500 tracking-widest mt-1">Status: {viewSlip.status}</p>
              </div>
              <div className="flex gap-3 items-center">
                
                {/* NEW FO GENERATION WITH THICK TEAL STYLING */}
                {viewSlip.osNumber.startsWith('OS') && viewSlip.status !== 'Finalized Order' && viewSlip.status !== 'Cancelled' && viewSlip.status !== 'Returned' && (
                  <div className="flex items-center gap-2 bg-teal-50 p-2 rounded-xl border-2 border-teal-200 shadow-sm mr-2">
                    <input type="text" value={foNumberInput} onChange={(e) => setFoNumberInput(e.target.value.toUpperCase())} className="w-36 px-3 py-2 text-sm font-mono font-black text-slate-900 bg-white border-2 border-teal-400 rounded-lg outline-none focus:border-teal-600 uppercase placeholder:text-slate-400 placeholder:font-medium" placeholder="FO-000000" />
                    <button onClick={handleGenerateFoFromLedger} disabled={isGeneratingFo || !foNumberInput} className="px-5 py-2.5 bg-teal-600 text-white text-[11px] font-black uppercase tracking-widest rounded-lg hover:bg-teal-700 disabled:bg-slate-400 shadow-sm transition-colors">
                      {isGeneratingFo ? 'Gen...' : 'Gen Final Order'}
                    </button>
                  </div>
                )}

                <button onClick={handlePrint} className="px-5 py-2.5 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-indigo-700 shadow-sm transition-colors">Print Document</button>
                <button onClick={() => setViewSlip(null)} className="px-4 py-2.5 bg-white border border-slate-300 text-slate-700 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-slate-50 shadow-sm transition-colors">Close</button>
              </div>
            </div>

            {/* PRINT CONTAINER */}
            <div className="p-8 print:pt-12 print:px-8 print:pb-8 bg-white flex-1 overflow-y-auto print:overflow-visible relative">
              
              {/* FIXED TOP-LAYER WATERMARK WITH INK MULTIPLY EFFECT */}
              {(viewSlip.status === 'Cancelled' || viewSlip.status === 'Returned') && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-50 opacity-25 mix-blend-multiply">
                  <div className="text-[120px] font-black text-rose-600 uppercase tracking-tighter rotate-[-30deg] border-8 border-rose-600 px-12 py-4 rounded-3xl">
                    {viewSlip.status}
                  </div>
                </div>
              )}

              <div className="relative z-10">
                {/* Top Header - Company & Title */}
                <div className="flex justify-between items-end border-b-2 border-slate-900 pb-3 mb-6">
                  <h1 className="text-3xl print:text-2xl font-black text-slate-900 uppercase tracking-widest leading-none">
                    {selectedCompany}
                  </h1>
                  <h2 className="text-lg font-black text-slate-900 uppercase tracking-widest leading-none">
                    {viewSlip.osNumber.startsWith('FO') ? 'Final Order' : 'Order Slip'}
                  </h2>
                </div>
                
                {/* Billed To (Left) & OS Number (Right) */}
                <div className="flex justify-between items-start mb-6">
                  
                  <div className="text-left flex flex-col items-start">
                    <h4 className="text-[11px] font-black text-slate-800 uppercase tracking-widest mb-0.5">Billed To</h4>
                    <div className="font-black text-base text-black uppercase leading-tight">{viewSlip.customer?.name || 'Unknown Customer'}</div>
                  </div>

                  <div className="text-right flex flex-col items-end">
                    <h2 className={`text-2xl font-mono font-black leading-none ${viewSlip.osNumber.startsWith('FO') ? 'text-teal-700' : 'text-indigo-700'}`}>{viewSlip.osNumber}</h2>
                    {viewSlip.osNumber.startsWith('FO') && viewSlip.referenceOs && (
                      <div className="mt-1 inline-block bg-slate-100 border border-slate-300 px-2 py-0.5 rounded-md text-[10px] font-black text-slate-600 tracking-widest uppercase">REF: {viewSlip.referenceOs}</div>
                    )}
                    <p className="text-xs font-bold text-slate-500 mt-2 uppercase tracking-widest">
                      Date: {new Date(viewSlip.createdAt).toLocaleDateString()} &nbsp; Time: {new Date(viewSlip.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>

                </div>

                <table className="w-full text-left text-sm mb-12 border-collapse bg-white">
                  <thead className="border-y-2 border-slate-900 bg-slate-50/50 print:bg-transparent">
                    <tr>
                      <th className="py-2 px-2 font-black text-black uppercase text-[11px] tracking-wider w-32">SKU</th>
                      <th className="py-2 px-2 font-black text-black uppercase text-[11px] tracking-wider">Description</th>
                      <th className="py-2 px-2 font-black text-black uppercase text-[11px] tracking-wider text-center w-16">Qty</th>
                      <th className="py-2 px-2 font-black text-black uppercase text-[11px] tracking-wider text-right w-28">Unit Price</th>
                      <th className="py-2 px-2 font-black text-black uppercase text-[11px] tracking-wider text-right w-32">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-300 print:divide-slate-400">
                    {viewSlip.items.map((item: any, idx: number) => (
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