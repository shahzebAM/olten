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
  category: string; // Added category field
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

  // --- CATEGORY & PRICING STATES ---
  const [categories, setCategories] = useState<{ id: string, name: string }[]>([]);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
  const [pricingCategory, setPricingCategory] = useState('');
  const [categoryPrices, setCategoryPrices] = useState<Record<number, string>>({});
  const [bulkPercentage, setBulkPercentage] = useState('');
  const [allProducts, setAllProducts] = useState<any[]>([]);

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
      let url = `${API_BASE_URL}/sales/customers?company=${encodeURIComponent(selectedCompany)}&page=${currentPage}&limit=${limit}`;
      if (debouncedSearch) {
        url += `&search=${encodeURIComponent(debouncedSearch)}`;
      }

      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch");
      
      const responseData = await res.json();
      
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

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/sales/customer-categories?company=${selectedCompany}`);
      if (res.ok) setCategories(await res.json());
    } catch (e) {
      console.error("Failed to fetch categories");
    }
  }, [API_BASE_URL, selectedCompany]);

  useEffect(() => {
    fetchCustomers();
    fetchCategories();
  }, [fetchCustomers, fetchCategories]);

  // --- ACTIONS ---
  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModal.data.category) {
        return showToast("Customer Category is required.", "error");
    }
    
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

  // --- CATEGORY ACTIONS ---
  const handleCreateCategory = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newCategoryName.trim()) return;
      try {
         const res = await fetch(`${API_BASE_URL}/sales/customer-categories`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: newCategoryName.trim(), company: selectedCompany })
          });
          if (!res.ok) throw new Error();
          setNewCategoryName('');
          fetchCategories();
          showToast("Category created.", "success");
      } catch (e) {
          showToast("Failed to create category.", "error");
      }
  };

  const handleDeleteCategory = async (id: string) => {
      if (!window.confirm("Delete this category? Customers assigned to it will still retain the name but it won't be selectable.")) return;
      try {
         await fetch(`${API_BASE_URL}/sales/customer-categories/${id}`, { method: 'DELETE' });
          fetchCategories();
          showToast("Category deleted.", "success");
      } catch (e) {
          showToast("Failed to delete category.", "error");
      }
  };

  // --- PRICING ACTIONS ---
  const openPricingEditor = async (catName: string) => {
    setPricingCategory(catName);
    setIsLoading(true);
    try {
      const [prodRes, priceRes] = await Promise.all([
        fetch(`${API_BASE_URL}/products?company=${selectedCompany}`),
       fetch(`${API_BASE_URL}/sales/category-prices?company=${selectedCompany}&categoryName=${encodeURIComponent(catName)}`)
      ]);
      
      const prods = await prodRes.json();
      const prices = await priceRes.json();
      
      setAllProducts(prods);
      
      const priceMap: Record<number, string> = {};
      prices.forEach((p: any) => { priceMap[p.productId] = String(p.price) });
      
      // Pre-fill with default selling price if no specific category price exists
      prods.forEach((p: any) => {
          if (!priceMap[p.id]) {
              priceMap[p.id] = String(p.sellingPrice || 0);
          }
      });

      setCategoryPrices(priceMap);
      setIsPricingModalOpen(true);
      setIsCategoryModalOpen(false); // Close category manager if open
    } catch (e) {
        showToast("Failed to load pricing data.", "error");
    } finally {
        setIsLoading(false);
    }
  };

  const applyBulkPercentage = () => {
    const pct = parseFloat(bulkPercentage);
    if (isNaN(pct)) return;
    
    const nextPrices = { ...categoryPrices };
    allProducts.forEach(p => {
      const base = Number(p.sellingPrice) || 0;
      const newPrice = base + (base * (pct / 100)); 
      nextPrices[p.id] = newPrice.toFixed(2);
    });
    
    setCategoryPrices(nextPrices);
    setBulkPercentage('');
  };

  const saveCategoryPrices = async () => {
    setIsLoading(true);
    try {
        const payload = Object.entries(categoryPrices)
        .map(([productId, price]) => ({ productId: Number(productId), price: Number(price) }))
        .filter(p => !isNaN(p.price));

       const res = await fetch(`${API_BASE_URL}/sales/category-prices/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: selectedCompany, categoryName: pricingCategory, prices: payload })
        });
        
        if (!res.ok) throw new Error();
        
        setIsPricingModalOpen(false);
        showToast("Category pricing successfully updated!", "success");
    } catch (e) {
        showToast("Failed to save pricing.", "error");
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
          
          {isAuthorizedAdmin && (
              <button 
                onClick={() => setIsCategoryModalOpen(true)}
                className="w-full text-left px-4 py-3 rounded-lg font-bold text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition-colors mt-2"
              >
                Categories & Pricing
              </button>
          )}
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden bg-slate-50">
        <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0 shadow-sm z-10">
          <div><h2 className="text-2xl font-black text-slate-800 tracking-tight">{selectedCompany} <span className="text-slate-400 font-medium">| Customer Details</span></h2></div>
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
              <div className="flex gap-2">
                 {isAuthorizedAdmin && (
                    <button 
                        onClick={() => setIsCategoryModalOpen(true)}
                        className="md:hidden px-4 py-3 bg-white border border-slate-200 text-slate-700 font-bold uppercase text-xs rounded-xl shadow-sm hover:bg-slate-50 transition-colors"
                    >
                        Pricing
                    </button>
                 )}
                <button 
                    onClick={() => setEditModal({ isOpen: true, data: { name: '', company: selectedCompany, contact: '', phone: '', email: '', address: '', creditLimit: 0, balance: 0, category: 'General' } })} 
                    className="px-6 py-3 bg-indigo-600 text-white font-bold uppercase text-xs rounded-xl shadow-sm hover:bg-indigo-700 transition-colors whitespace-nowrap"
                >
                    + Register Customer
                </button>
              </div>
            </div>

            {/* DATA TABLE */}
           {/* DATA TABLE */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col overflow-hidden">
              <div className="overflow-x-auto w-full relative">
                {isLoading && (
                  <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] z-10 flex items-center justify-center">
                    <div className="font-bold text-indigo-600 animate-pulse uppercase tracking-widest text-sm">Syncing Records...</div>
                  </div>
                )}
                {/* Removed whitespace-nowrap and min-w to prevent horizontal scrolling */}
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3 sm:px-4 font-black text-slate-500 uppercase tracking-widest text-[9px] sm:text-[10px] hidden sm:table-cell w-20 sm:w-24">Client Code</th>
                      <th className="py-2.5 px-3 sm:px-4 font-black text-slate-500 uppercase tracking-widest text-[9px] sm:text-[10px]">Entity / Name</th>
                      <th className="py-2.5 px-3 sm:px-4 font-black text-slate-500 uppercase tracking-widest text-[9px] sm:text-[10px] hidden md:table-cell w-24">Category</th>
                      <th className="py-2.5 px-3 sm:px-4 font-black text-slate-500 uppercase tracking-widest text-[9px] sm:text-[10px]">Contact Info</th>
                      <th className="py-2.5 px-3 sm:px-4 font-black text-slate-500 uppercase tracking-widest text-[9px] sm:text-[10px] hidden lg:table-cell w-48">Address</th>
                      <th className="py-2.5 px-3 sm:px-4 font-black text-slate-500 uppercase tracking-widest text-[9px] sm:text-[10px] text-right w-24 sm:w-28">Balance</th>
                      <th className="py-2.5 px-3 sm:px-4 font-black text-slate-500 uppercase tracking-widest text-[9px] sm:text-[10px] text-center hidden xl:table-cell w-20">Status</th>
                      <th className="py-2.5 px-3 sm:px-4 font-black text-slate-500 uppercase tracking-widest text-[9px] sm:text-[10px] text-right w-32 sm:w-40">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {customers.length === 0 && !isLoading ? (
                      <tr><td colSpan={8} className="py-12 text-center text-slate-400 font-medium">No customer records found.</td></tr>
                    ) : (
                      customers.map(c => (
                        <tr key={c.id || Math.random()} className="hover:bg-slate-50 transition-colors group">
                          
                          {/* Client Code - Hidden on Mobile */}
                          <td className="py-2 px-3 sm:px-4 font-mono text-[10px] sm:text-xs text-slate-500 uppercase hidden sm:table-cell align-top mt-0.5">{c.id ? c.id.slice(0, 8) : 'N/A'}</td>
                          
                          {/* Entity Name - Always Visible & Wraps naturally */}
                          <td className="py-2 px-3 sm:px-4 align-top">
                            <div className="font-bold text-slate-900 text-xs sm:text-sm leading-tight">{c.name || 'Unknown'}</div>
                            <div className="flex flex-wrap items-center gap-2 mt-1">
                               {/* Mobile Category Fallback */}
                               <span className="md:hidden px-1.5 py-0.5 bg-slate-100 border border-slate-200 text-slate-600 text-[8px] font-bold uppercase rounded">{c.category || 'General'}</span>
                               <span className="text-[9px] font-bold uppercase tracking-widest text-indigo-600">{c.company || 'Unknown'}</span>
                            </div>
                          </td>
                          
                          {/* Category - Hidden on Mobile */}
                          <td className="py-2 px-3 sm:px-4 hidden md:table-cell align-top mt-0.5">
                              <span className="px-2 py-1 bg-slate-100 border border-slate-200 text-slate-700 text-[9px] font-bold uppercase rounded-md">{c.category || 'General'}</span>
                          </td>
                          
                          {/* Contact Info - Compacted */}
                          <td className="py-2 px-3 sm:px-4 text-[10px] sm:text-xs text-slate-600 align-top mt-0.5">
                            <div className="font-semibold text-slate-800 leading-tight">{c.contact || 'No Contact'}</div>
                            <div className="text-slate-500 mt-0.5">{c.phone || '-'} | {c.email || '-'}</div>
                          </td>
                          
                          {/* Address - Hidden on small screens, truncated heavily */}
                          <td className="py-2 px-3 sm:px-4 text-[10px] sm:text-xs text-slate-500 hidden lg:table-cell align-top mt-0.5">
                            <div className="truncate max-w-[150px] xl:max-w-[200px]" title={c.address || ''}>{c.address || 'N/A'}</div>
                          </td>
                          
                          {/* Balance - Always visible, restricted wrapping */}
                          <td className="py-2 px-3 sm:px-4 text-right font-black text-slate-900 text-[11px] sm:text-sm align-top mt-0.5 whitespace-nowrap">
                            ₱{(c.balance || 0).toLocaleString()}
                          </td>
                          
                          {/* Status - Hidden on most screens to save space */}
                          <td className="py-2 px-3 sm:px-4 text-center hidden xl:table-cell align-top mt-0.5">
                            <span className="px-2 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 text-[9px] font-black uppercase rounded-md">Active</span>
                          </td>
                          
                          {/* Actions - Always visible, never wraps */}
                          <td className="py-2 px-3 sm:px-4 text-right space-x-2 sm:space-x-3 whitespace-nowrap align-top mt-0.5">
                            <button onClick={() => setViewCustomer(c)} className="text-indigo-600 hover:text-indigo-900 font-bold text-[10px] sm:text-[11px] uppercase tracking-wider underline">View</button>
                            {onRouteToOrderSlip && c.id && (
                              <button onClick={() => onRouteToOrderSlip(c.id)} className="px-2 sm:px-3 py-1.5 bg-slate-900 text-white rounded-lg text-[9px] sm:text-[10px] font-bold uppercase hover:bg-slate-800 transition-colors shadow-sm inline-block">Create O.S.</button>
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

      {/* CATEGORY MANAGEMENT MODAL */}
      {isCategoryModalOpen && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
                  <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
                      <h3 className="text-xl font-black text-slate-900 tracking-tight uppercase">Customer Categories</h3>
                      <button type="button" onClick={() => setIsCategoryModalOpen(false)} className="text-slate-400 hover:text-slate-700 font-black text-xl">✕</button>
                  </div>
                  
                  <div className="p-6 flex-1 overflow-y-auto">
                      <form onSubmit={handleCreateCategory} className="mb-8 flex gap-2">
                          <input 
                              type="text" 
                              required 
                              placeholder="New Category Name..." 
                              value={newCategoryName} 
                              onChange={e => setNewCategoryName(e.target.value)} 
                              className="flex-1 px-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
                          />
                          <button type="submit" className="px-5 py-3 bg-indigo-600 text-white font-bold uppercase text-xs rounded-xl shadow-sm hover:bg-indigo-700 transition-colors">Add</button>
                      </form>

                      <div className="space-y-3">
                          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Existing Categories & Pricing</h4>
                          {categories.length === 0 ? (
                              <p className="text-sm text-slate-500 text-center py-4 border border-dashed border-slate-300 rounded-xl">No custom categories yet. "General" is used by default.</p>
                          ) : (
                              categories.map(cat => (
                                  <div key={cat.id} className="flex items-center justify-between p-4 bg-white border border-slate-200 rounded-xl shadow-sm">
                                      <span className="font-bold text-slate-800 uppercase">{cat.name}</span>
                                      <div className="flex gap-2">
                                          <button onClick={() => openPricingEditor(cat.name)} className="px-3 py-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg text-[10px] font-black uppercase tracking-wider hover:bg-amber-100 transition-colors">Edit Pricing</button>
                                          <button onClick={() => handleDeleteCategory(cat.id)} className="px-3 py-1.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-lg text-[10px] font-black uppercase tracking-wider hover:bg-rose-100 transition-colors">Delete</button>
                                      </div>
                                  </div>
                              ))
                          )}
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* PRICING EDITOR MODAL */}
   {/* PRICING EDITOR MODAL */}
      {isPricingModalOpen && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[160] flex items-center justify-center sm:p-4">
              <div className="bg-white sm:rounded-3xl shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col h-full sm:h-auto sm:max-h-[95vh] animate-in zoom-in-95 duration-200">
                  <div className="p-4 sm:p-6 border-b border-slate-100 flex justify-between items-center bg-amber-50 shrink-0">
                      <div>
                          <h3 className="text-lg sm:text-xl font-black text-amber-900 tracking-tight uppercase">Category Pricing</h3>
                          <p className="text-[10px] sm:text-xs font-bold text-amber-700 tracking-widest uppercase mt-1">Editing Tier: {pricingCategory}</p>
                      </div>
                      <button type="button" onClick={() => setIsPricingModalOpen(false)} className="text-amber-400 hover:text-amber-700 font-black text-xl px-2">✕</button>
                  </div>

                  <div className="p-4 bg-white border-b border-slate-200 flex flex-col sm:flex-row gap-4 items-center justify-between shrink-0">
                      <div className="flex items-center gap-3 w-full sm:w-auto">
                          <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider whitespace-nowrap">Bulk Adjust (%)</label>
                          <input 
                              type="number" 
                              placeholder="e.g. 10 or -5" 
                              value={bulkPercentage} 
                              onChange={e => setBulkPercentage(e.target.value)} 
                              className="w-full sm:w-32 px-3 py-2 border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-amber-500 shadow-sm"
                          />
                          <button onClick={applyBulkPercentage} className="px-4 py-2 bg-slate-900 text-white font-bold uppercase text-[10px] rounded-lg shadow-sm hover:bg-slate-800 transition-colors shrink-0">Apply</button>
                      </div>
                      <p className="text-[10px] font-bold text-slate-400 max-w-xs text-right hidden sm:block">Positive numbers increase price, negative numbers grant a discount.</p>
                  </div>

                  <div className="flex-1 overflow-y-auto p-0 bg-slate-50">
                      {/* Removed whitespace-nowrap to stop horizontal scrolling */}
                      <table className="w-full text-left text-sm">
                          <thead className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
                              <tr>
                                  <th className="py-2 px-3 sm:px-6 font-black text-slate-500 uppercase tracking-widest text-[9px] sm:text-[10px] hidden sm:table-cell w-32">SKU</th>
                                  <th className="py-2 px-3 sm:px-6 font-black text-slate-500 uppercase tracking-widest text-[9px] sm:text-[10px]">Product Name</th>
                                  <th className="py-2 px-3 sm:px-6 font-black text-slate-500 uppercase tracking-widest text-[9px] sm:text-[10px] text-right w-24 sm:w-32">Std Price</th>
                                  <th className="py-2 px-3 sm:px-6 font-black text-amber-600 uppercase tracking-widest text-[9px] sm:text-[10px] text-right w-28 sm:w-36">Category Price</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                              {allProducts.map(p => (
                                  <tr key={p.id} className="hover:bg-amber-50/30 transition-colors">
                                      {/* Hidden on mobile, shown on desktop */}
                                      <td className="py-1.5 px-3 sm:px-6 font-mono text-[10px] sm:text-xs text-slate-500 hidden sm:table-cell">{p.sku}</td>
                                      
                                      <td className="py-1.5 px-3 sm:px-6">
                                        <div className="font-bold text-[11px] sm:text-xs text-slate-800 uppercase leading-tight">{p.name}</div>
                                        {/* SKU falls back here under the name only on mobile */}
                                        <div className="sm:hidden font-mono text-[9px] text-slate-400 uppercase mt-0.5">{p.sku}</div>
                                      </td>
                                      
                                      <td className="py-1.5 px-3 sm:px-6 text-right font-mono text-[11px] sm:text-xs text-slate-500">₱{Number(p.sellingPrice).toFixed(2)}</td>
                                      
                                      <td className="py-1.5 px-3 sm:px-6 text-right">
                                          <input 
                                              type="number" 
                                              step="0.01"
                                              value={categoryPrices[p.id] !== undefined ? categoryPrices[p.id] : ''} 
                                              onChange={e => setCategoryPrices({...categoryPrices, [p.id]: e.target.value})} 
                                              className="w-full min-w-[70px] max-w-[120px] px-2 sm:px-3 py-1 sm:py-1.5 border border-slate-200 rounded-md text-[11px] sm:text-sm font-black text-amber-900 outline-none focus:ring-2 focus:ring-amber-500 text-right bg-white shadow-sm"
                                          />
                                      </td>
                                  </tr>
                              ))}
                          </tbody>
                      </table>
                  </div>

                  <div className="p-4 sm:p-6 border-t border-slate-100 bg-white shrink-0 flex justify-end gap-3">
                      <button type="button" onClick={() => setIsPricingModalOpen(false)} className="px-5 py-2.5 bg-slate-100 text-slate-700 font-bold uppercase text-xs rounded-xl shadow-sm hover:bg-slate-200 transition-colors">Cancel</button>
                      <button onClick={saveCategoryPrices} disabled={isLoading} className="px-8 py-2.5 bg-amber-500 text-white font-bold uppercase text-xs rounded-xl shadow-sm hover:bg-amber-600 transition-colors disabled:opacity-50">
                          {isLoading ? 'Saving...' : 'Save Rules'}
                      </button>
                  </div>
              </div>
          </div>
      )}

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
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Category</p>
                  <p className="text-sm font-bold text-slate-900 uppercase">{viewCustomer.category || 'General'}</p>
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
                <div className="bg-slate-900 text-white p-5 rounded-2xl border border-slate-800 shadow-inner lg:col-span-3">
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
            
            <form onSubmit={handleSaveCustomer} className="p-8 flex flex-col gap-6 max-h-[75vh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Business / Entity Name *</label>
                  <input required type="text" value={editModal.data.name || ''} onChange={e => setEditModal({ ...editModal, data: { ...editModal.data, name: e.target.value } })} className="px-4 py-3 border border-slate-200 rounded-xl font-bold outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Category *</label>
                  <select 
                    required 
                    value={editModal.data.category || ''} 
                    onChange={e => setEditModal({ ...editModal, data: { ...editModal.data, category: e.target.value } })}
                    className="px-4 py-3 border border-slate-200 rounded-xl font-bold outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm bg-white"
                  >
                    <option value="">Select Category...</option>
                    <option value="General">General</option>
                    {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Contact Person</label>
                  <input type="text" value={editModal.data.contact || ''} onChange={e => setEditModal({ ...editModal, data: { ...editModal.data, contact: e.target.value } })} className="px-4 py-3 border border-slate-200 rounded-xl font-bold outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Contact Number</label>
                  <input type="text" value={editModal.data.phone || ''} onChange={e => setEditModal({ ...editModal, data: { ...editModal.data, phone: e.target.value } })} className="px-4 py-3 border border-slate-200 rounded-xl font-bold outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm" />
                </div>
                <div className="flex flex-col gap-1.5 sm:col-span-2">
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