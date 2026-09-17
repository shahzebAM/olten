import React, { useState, useEffect, useCallback } from 'react';

// --- INTERFACES ---
interface Customer {
  id: string;
  company: string;
  name: string;
  contact: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  creditLimit: number;
  balance: number;
  createdAt: string;
}

interface CustomerModuleProps {
  selectedCompany: string;
  loginUsername: string;
  API_BASE_URL: string;
  onBack: () => void;
  onRouteToOrderSlip?: (customerId: string) => void;
}

export default function CustomerModule({ selectedCompany, loginUsername, API_BASE_URL, onBack, onRouteToOrderSlip }: CustomerModuleProps) {
  const isAuthorizedAdmin = loginUsername?.toLowerCase() === 'admin' || loginUsername?.toLowerCase() === 'ali' || loginUsername?.toLowerCase() === 'super admin';

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  // --- PAGINATION & SEARCH STATES ---
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [limit] = useState(15);

  // --- MODAL STATES ---
  const [viewCustomer, setViewCustomer] = useState<Customer | null>(null);
  const [editModal, setEditModal] = useState<{ isOpen: boolean; data: Partial<Customer> }>({ isOpen: false, data: {} });

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ message: msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // --- DEBOUNCE SEARCH ---
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setCurrentPage(1); 
    }, 400);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  // --- SAFE SERVER-SIDE FETCH ---
  const fetchCustomers = useCallback(async () => {
    setIsLoading(true);
    try {
      // Replaced new URL() with standard string concatenation to prevent parsing crashes
      let url = `${API_BASE_URL}/sales/customers?company=${encodeURIComponent(selectedCompany)}&page=${currentPage}&limit=${limit}`;
      if (debouncedSearch) {
        url += `&search=${encodeURIComponent(debouncedSearch)}`;
      }

      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch");
      
      const responseData = await res.json();
      
      // Handle both paginated object and legacy array fallback safely
      if (Array.isArray(responseData)) {
        setCustomers(responseData);
        setTotalPages(1);
        setTotalRecords(responseData.length);
      } else {
        setCustomers(responseData?.data || []);
        setTotalPages(responseData?.totalPages || 1);
        setTotalRecords(responseData?.total || 0);
      }
    } catch (e) {
      showToast("Error loading customers.", "error");
    } finally {
      setIsLoading(false);
    }
  }, [selectedCompany, currentPage, limit, debouncedSearch, API_BASE_URL]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  // --- ACTIONS ---
  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const isNew = !editModal.data.id;
      const url = isNew ? `${API_BASE_URL}/sales/customers` : `${API_BASE_URL}/sales/customers/${editModal.data.id}`;
      const method = isNew ? 'POST' : 'PATCH';

      const payload = { ...editModal.data, company: selectedCompany };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error();
      
      showToast(`Customer ${isNew ? 'registered' : 'updated'} successfully.`, "success");
      setEditModal({ isOpen: false, data: {} });
      fetchCustomers();
    } catch (e) {
      showToast("Failed to save customer.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteCustomer = async (id: string) => {
    if (!isAuthorizedAdmin) return showToast("Unauthorized action.", "error");
    if (!window.confirm("CRITICAL: Are you sure you want to permanently delete this customer record?")) return;
    
    setIsLoading(true);
    try {
      await fetch(`${API_BASE_URL}/sales/customers/${id}`, { method: 'DELETE' });
      showToast("Customer record removed.", "success");
      fetchCustomers();
      setViewCustomer(null);
    } catch (e) {
      showToast("Deletion failed. Record may be tied to existing orders.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-full bg-[#F8FAFC] font-sans text-slate-900 overflow-hidden">
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[100] px-5 py-3.5 rounded-xl shadow-xl font-bold text-sm transition-all ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>
          {toast.message}
        </div>
      )}

      {/* SIDEBAR */}
      <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col shrink-0 hidden md:flex z-20">
        <div className="h-20 flex items-center px-6 border-b border-slate-800 bg-slate-950">
          <h1 className="text-lg font-black text-white uppercase tracking-wider leading-tight">Client Directory</h1>
        </div>
        <div className="flex-1 py-6 px-3 space-y-1">
          <p className="px-3 pb-2 text-[10px] font-black uppercase tracking-widest text-slate-500">Relationships</p>
          <button className="w-full text-left px-4 py-3 rounded-lg font-bold text-sm bg-indigo-600 text-white shadow-sm">Customers</button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden bg-slate-50">
        <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0 shadow-sm z-10">
          <div><h2 className="text-2xl font-black text-slate-800 tracking-tight">Enterprise Bingo <span className="text-slate-400 font-medium">| Customer Details</span></h2></div>
          <button type="button" onClick={onBack} className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors">Exit Gateway</button>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-8">
          <div className="max-w-[1400px] mx-auto space-y-6">
            
            {/* ACTION BAR */}
            <div className="flex flex-col sm:flex-row justify-between gap-4">
              <div className="relative w-full sm:w-96">
                <svg className="w-5 h-5 absolute left-4 top-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                <input 
                  type="text" 
                  placeholder="Search Name, Code, Phone, Email..." 
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm transition-shadow"
                />
              </div>
              <button 
                onClick={() => setEditModal({ isOpen: true, data: { name: '', company: selectedCompany, contact: '', phone: '', email: '', address: '', creditLimit: 0, balance: 0 } })} 
                className="px-6 py-3 bg-indigo-600 text-white font-bold uppercase text-xs rounded-xl shadow-sm hover:bg-indigo-700 transition-colors whitespace-nowrap"
              >
                + Register Customer
              </button>
            </div>

            {/* DATA TABLE */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden">
              <div className="overflow-x-auto w-full relative">
                {isLoading && (
                  <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] z-10 flex items-center justify-center">
                    <div className="font-bold text-indigo-600 animate-pulse uppercase tracking-widest text-sm">Syncing Records...</div>
                  </div>
                )}
                <table className="w-full text-left text-sm whitespace-nowrap min-w-[1100px]">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px]">Client Code</th>
                      <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px]">Entity / Name</th>
                      <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px]">Contact Info</th>
                      <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px]">Address</th>
                      <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] text-right">Balance</th>
                      <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] text-center">Status</th>
                      <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {customers.length === 0 && !isLoading ? (
                      <tr><td colSpan={7} className="py-16 text-center text-slate-400 font-medium">No customer records found.</td></tr>
                    ) : (
                      customers.map(c => (
                        <tr key={c.id || Math.random()} className="hover:bg-slate-50 transition-colors group">
                          <td className="py-4 px-6 font-mono text-xs text-slate-500 uppercase">{c.id ? c.id.slice(0, 8) : 'N/A'}</td>
                          <td className="py-4 px-6">
                            <div className="font-bold text-slate-900 text-base">{c.name || 'Unknown'}</div>
                            <div className="text-[10px] font-bold uppercase tracking-widest text-indigo-600 mt-0.5">{c.company || 'Unknown'}</div>
                          </td>
                          <td className="py-4 px-6 text-xs text-slate-600">
                            <div className="font-semibold text-slate-800">{c.contact || 'No Contact'}</div>
                            <div className="text-slate-500">{c.phone || '-'} | {c.email || '-'}</div>
                          </td>
                          <td className="py-4 px-6 text-xs text-slate-500 truncate max-w-[200px]">{c.address || 'N/A'}</td>
                          <td className="py-4 px-6 text-right font-black text-slate-900">₱{(c.balance || 0).toLocaleString()}</td>
                          <td className="py-4 px-6 text-center">
                            <span className="px-2.5 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-black uppercase rounded-md">Active</span>
                          </td>
                          <td className="py-4 px-6 text-right space-x-3">
                            <button onClick={() => setViewCustomer(c)} className="text-indigo-600 hover:text-indigo-900 font-bold text-[11px] uppercase tracking-wider underline">View</button>
                            {onRouteToOrderSlip && c.id && (
                              <button onClick={() => onRouteToOrderSlip(c.id)} className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-[10px] font-bold uppercase hover:bg-slate-800 transition-colors shadow-sm inline-block">Create O.S.</button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              
              {/* PAGINATION CONTROLS */}
              <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-widest">
                <div>Showing {customers.length} of {totalRecords} records</div>
                <div className="flex gap-2">
                  <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1 || isLoading} className="px-3 py-1.5 bg-white border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-50">Prev</button>
                  <span className="px-3 py-1.5 bg-white border border-slate-200 rounded">{currentPage} / {totalPages}</span>
                  <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages || isLoading} className="px-3 py-1.5 bg-white border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-50">Next</button>
                </div>
              </div>
            </div>

          </div>
        </main>
      </div>

      {/* --- MODALS --- */}

      {/* VIEW CUSTOMER MODAL */}
      {viewCustomer && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[95vh] animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
              <div>
                <h3 className="text-xl font-black text-slate-900 tracking-tight">{viewCustomer.name}</h3>
                <p className="text-xs font-mono uppercase text-slate-500 tracking-widest mt-1">Code: {viewCustomer.id}</p>
              </div>
              <div className="flex items-center gap-4">
                {onRouteToOrderSlip && viewCustomer.id && (
                  <button onClick={() => { onRouteToOrderSlip(viewCustomer.id); setViewCustomer(null); }} className="px-5 py-2.5 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-colors shadow-sm hover:bg-indigo-700">Create O.S.</button>
                )}
                <button type="button" onClick={() => setViewCustomer(null)} className="text-slate-400 hover:text-slate-700 font-black text-xl">✕</button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-8 bg-white space-y-8">
              {/* Profile Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Company / Entity</p>
                  <p className="text-sm font-bold text-slate-900">{viewCustomer.company}</p>
                </div>
                <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Primary Contact</p>
                  <p className="text-sm font-bold text-slate-900">{viewCustomer.contact || 'N/A'}</p>
                  <p className="text-xs font-medium text-slate-500 mt-1">{viewCustomer.phone || '-'}</p>
                </div>
                <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Email Address</p>
                  <p className="text-sm font-bold text-slate-900 break-words">{viewCustomer.email || 'N/A'}</p>
                </div>
                <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100 lg:col-span-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Physical Address</p>
                  <p className="text-sm font-medium text-slate-900 leading-relaxed">{viewCustomer.address || 'N/A'}</p>
                </div>
                <div className="bg-slate-900 text-white p-5 rounded-2xl border border-slate-800 shadow-inner">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Outstanding Balance</p>
                  <p className="text-2xl font-black">₱{(viewCustomer.balance || 0).toLocaleString()}</p>
                </div>
              </div>

              {/* Order History Placeholder Structure */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden">
                <div className="bg-slate-50 p-4 border-b border-slate-200">
                  <h4 className="font-black text-sm uppercase tracking-widest text-slate-700">Order Slip History</h4>
                </div>
                <div className="p-8 text-center bg-white">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-100 mb-4">
                    <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  </div>
                  <h5 className="font-bold text-slate-900">No Orders Found</h5>
                  <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">This customer does not have any Order Slips registered in the system yet. Click "Create O.S." to begin an order.</p>
                </div>
              </div>
            </div>

            {/* Admin Controls */}
            <div className="p-6 border-t border-slate-100 bg-slate-50 shrink-0 flex justify-between items-center">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Added: {viewCustomer.createdAt ? new Date(viewCustomer.createdAt).toLocaleDateString() : 'N/A'}</div>
              <div className="flex gap-3">
                <button onClick={() => { setEditModal({ isOpen: true, data: viewCustomer }); setViewCustomer(null); }} className="px-5 py-2.5 bg-white border border-slate-300 text-slate-700 font-bold text-xs uppercase tracking-wider rounded-xl hover:bg-slate-100 transition-colors">Edit Profile</button>
                {isAuthorizedAdmin && (
                  <button onClick={() => handleDeleteCustomer(viewCustomer.id)} className="px-5 py-2.5 bg-rose-50 text-rose-700 border border-rose-200 font-bold text-xs uppercase tracking-wider rounded-xl hover:bg-rose-100 transition-colors">Delete</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* EDIT / CREATE MODAL */}
      {editModal.isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-xl font-black text-slate-900 tracking-tight uppercase">{editModal.data.id ? 'Edit Customer Record' : 'Register New Customer'}</h3>
              <button type="button" onClick={() => setEditModal({ isOpen: false, data: {} })} className="text-slate-400 hover:text-slate-700 font-black text-xl">✕</button>
            </div>
            
            <form onSubmit={handleSaveCustomer} className="p-8 flex flex-col gap-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Business / Entity Name *</label>
                  <input required type="text" value={editModal.data.name || ''} onChange={e => setEditModal({ ...editModal, data: { ...editModal.data, name: e.target.value } })} className="px-4 py-3 border border-slate-200 rounded-xl font-bold outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Contact Person</label>
                  <input type="text" value={editModal.data.contact || ''} onChange={e => setEditModal({ ...editModal, data: { ...editModal.data, contact: e.target.value } })} className="px-4 py-3 border border-slate-200 rounded-xl font-bold outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Contact Number</label>
                  <input type="text" value={editModal.data.phone || ''} onChange={e => setEditModal({ ...editModal, data: { ...editModal.data, phone: e.target.value } })} className="px-4 py-3 border border-slate-200 rounded-xl font-bold outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Email Address</label>
                  <input type="email" value={editModal.data.email || ''} onChange={e => setEditModal({ ...editModal, data: { ...editModal.data, email: e.target.value } })} className="px-4 py-3 border border-slate-200 rounded-xl font-bold outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm" />
                </div>
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Physical Address</label>
                  <input type="text" value={editModal.data.address || ''} onChange={e => setEditModal({ ...editModal, data: { ...editModal.data, address: e.target.value } })} className="px-4 py-3 border border-slate-200 rounded-xl font-medium outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm" />
                </div>
              </div>
              <button type="submit" disabled={isLoading} className="mt-4 w-full py-4 bg-slate-900 text-white rounded-xl font-black uppercase tracking-wider hover:bg-slate-800 transition-colors shadow-md disabled:opacity-50">
                {isLoading ? 'Saving...' : 'Save Customer Record'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}