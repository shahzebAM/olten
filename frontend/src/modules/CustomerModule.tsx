import React, { useState, useEffect, useCallback } from 'react';

// --- INTERFACES ---
interface Customer {
  id: string;
  company: string;
  name: string;
  contact: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  creditLimit: number;
  balance: number;
  createdAt: string;
  category: string;
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
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('');

  // --- MODAL STATES ---
  const [viewCustomer, setViewCustomer] = useState<Customer | null>(null);
  const [editModal, setEditModal] = useState<{ isOpen: boolean; data: Partial<Customer> }>({ isOpen: false, data: {} });

  // --- CATEGORY & PRICING STATES ---
  const [categories, setCategories] = useState<{ id: string, name: string }[]>([]);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
  const [pricingCategory] = useState('');
  const [categoryPrices, setCategoryPrices] = useState<Record<number, string>>({});
  const [bulkPercentage, setBulkPercentage] = useState('');
  const [allProducts] = useState<any[]>([]);
  const [pricingSearch, setPricingSearch] = useState('');

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

      if (selectedCategoryFilter) { // <--- ADD THIS BLOCK
        url += `&category=${encodeURIComponent(selectedCategoryFilter)}`;
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
  }, [selectedCompany, currentPage, limit, debouncedSearch, selectedCategoryFilter, API_BASE_URL]);

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
  }, [fetchCustomers, selectedCategoryFilter]); // Added selectedCategoryFilter here

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

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
    
    setIsLoading(true);
    try {
      await fetch(`${API_BASE_URL}/sales/customers/${id}`, { method: 'DELETE' });
      showToast("Customer record deleted instantly.", "success");
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

  // --- PRICING SEARCH FILTER ---
// --- PRICING SEARCH FILTER ---
  const filteredProducts = React.useMemo(() => {
    let result = allProducts;
    
    // If you only want to show products that belong to the active pricingCategory:
    // (Uncomment the line below if your Product interface has a category field you want to match)
    // result = result.filter(p => p.category === pricingCategory);

    if (!pricingSearch.trim()) return result;
    
    const q = pricingSearch.toLowerCase();
    return result.filter(p => 
      p.name?.toLowerCase().includes(q) || 
      p.sku?.toLowerCase().includes(q)
    );
  }, [allProducts, pricingSearch, pricingCategory]);

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
                Categories
              </button>
          )}

          
        </div>
        
      </aside>

      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden bg-slate-50">

          <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-4 sm:px-8 shrink-0 shadow-sm z-10">
          <div><h2 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight">{selectedCompany} <span className="text-slate-400 font-medium hidden sm:inline">| Customer Details</span></h2></div>
          <button type="button" onClick={onBack} className="px-4 sm:px-5 py-2 sm:py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-[10px] sm:text-xs font-bold uppercase tracking-wider transition-colors shrink-0">Exit</button>
        </header>

   {/* NEW MOBILE & TABLET MENU TABS (Hidden on Desktop) */}
        <div className="flex md:hidden bg-white border-b border-slate-200 shrink-0 w-full shadow-sm z-10 overflow-x-auto whitespace-nowrap">
          <button className="px-6 py-3.5 text-[10px] font-black text-indigo-600 border-b-[3px] border-indigo-600 uppercase tracking-widest bg-indigo-50/30">
            Customers
          </button>
          <button 
            onClick={() => setEditModal({ isOpen: true, data: { name: '', company: selectedCompany, contact: '', phone: '', email: '', website: '', address: '', creditLimit: 0, balance: 0, category: 'General' } })} 
            className="px-6 py-3.5 text-[10px] font-bold text-slate-500 border-b-[3px] border-transparent hover:text-slate-800 uppercase tracking-widest transition-colors"
          >
            + Register
          </button>
          {isAuthorizedAdmin && (
            <button 
              onClick={() => setIsCategoryModalOpen(true)} 
              className="px-6 py-3.5 text-[10px] font-bold text-slate-500 border-b-[3px] border-transparent hover:text-slate-800 uppercase tracking-widest transition-colors"
            >
              Category & Pricing
            </button>
          )}
        </div>

        <main className="flex-1 overflow-y-auto p-4 sm:p-8">
          <div className="max-w-[1400px] mx-auto space-y-6">
            
          {/* ACTION BAR */}
           {/* ACTION BAR */}
            <div className="flex flex-col sm:flex-row justify-between gap-4">
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                <div className="relative w-full sm:w-80">
                  <svg className="w-5 h-5 absolute left-4 top-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                  <input 
                    type="text" 
                    placeholder="Search Name, Code, Phone..." 
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm transition-shadow"
                  />
                </div>
                
                {/* CATEGORY FILTER DROPDOWN */}
                <select
                  value={selectedCategoryFilter}
                  onChange={e => { setSelectedCategoryFilter(e.target.value); setCurrentPage(1); }}
                  className="w-full sm:w-48 px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm transition-shadow appearance-none"
                >
                  <option value="">All Categories</option>
                  <option value="General">General</option>
                  {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </div>
            <div className="hidden md:flex shrink-0">
                <button 
                  onClick={() => setEditModal({ isOpen: true, data: { name: '', company: selectedCompany, contact: '', phone: '', email: '', website: '', address: '', creditLimit: 0, balance: 0, category: 'General' } })}
                  className="w-full sm:w-auto px-5 py-3 bg-indigo-600 text-white font-bold uppercase tracking-wider text-xs rounded-xl shadow-sm hover:bg-indigo-700 transition-colors"
                >
                  + Register Customer
                </button>
              </div>
            </div>


            {/* DATA TABLE - EXCEL STYLE COMPACT WITH TEXT WRAP */}
            <div className="bg-white border border-slate-300 shadow-sm flex flex-col overflow-hidden">
              <div className="w-full relative">
                {isLoading && (
                  <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] z-10 flex items-center justify-center">
                    <div className="font-bold text-indigo-600 animate-pulse uppercase tracking-widest text-xs">Syncing...</div>
                  </div>
                )}
                
                <table className="w-full text-left text-xs border-collapse table-fixed">
                  <thead className="bg-slate-100 border-b border-slate-300">
                    <tr>
                      <th className="border border-slate-300 py-2.5 px-3 font-bold text-slate-700 uppercase text-[10px] tracking-wider w-20 sm:w-24 hidden sm:table-cell">Code</th>
                      <th className="border border-slate-300 py-2.5 px-3 font-bold text-slate-700 uppercase text-[10px] tracking-wider">Entity / Name</th>
                      <th className="border border-slate-300 py-2.5 px-3 font-bold text-slate-700 uppercase text-[10px] tracking-wider w-24 sm:w-28 hidden md:table-cell">Category</th>
                      <th className="border border-slate-300 py-2.5 px-3 font-bold text-slate-700 uppercase text-[10px] tracking-wider w-40 hidden lg:table-cell">Contact</th>
                      <th className="border border-slate-300 py-2.5 px-3 font-bold text-slate-700 uppercase text-[10px] tracking-wider w-48 hidden xl:table-cell">Address</th>
                      <th className="border border-slate-300 py-2.5 px-3 font-bold text-slate-700 uppercase text-[10px] tracking-wider text-right w-24 sm:w-28">Balance</th>
                      <th className="border border-slate-300 py-2.5 px-3 font-bold text-slate-700 uppercase text-[10px] tracking-wider text-center w-20">Edit</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white">
                    {customers.length === 0 && !isLoading ? (
                      <tr><td colSpan={7} className="py-8 text-center text-slate-400 font-medium border border-slate-300">No customer records found.</td></tr>
                    ) : (
                      customers.map(c => (
                        <tr key={c.id || Math.random()} className="hover:bg-indigo-50/30 transition-colors">
                          
                          <td className="border border-slate-300 py-1.5 px-3 font-mono text-[10px] text-slate-500 uppercase hidden sm:table-cell break-words whitespace-normal align-top">
                            {c.id ? c.id : 'N/A'}
                          </td>
                          
                          <td className="border border-slate-300 py-1.5 px-3 break-words whitespace-normal align-top">
                            <div className="font-bold text-slate-900 text-[11px] sm:text-xs leading-tight">{c.name || 'Unknown'}</div>
                            <div className="flex flex-wrap items-center gap-1.5 mt-1">
                               <span className="md:hidden px-1.5 py-0.5 bg-slate-100 border border-slate-200 text-slate-600 text-[8px] font-bold uppercase rounded leading-none">{c.category || 'General'}</span>
                               <span className="text-[9px] font-bold uppercase tracking-widest text-indigo-600 break-words">{c.company || 'Unknown'}</span>
                            </div>
                          </td>
                          
                          <td className="border border-slate-300 py-1.5 px-3 hidden md:table-cell text-[10px] uppercase font-medium text-slate-700 break-words whitespace-normal align-top">
                              {c.category || 'General'}
                          </td>
                          
                          <td className="border border-slate-300 py-1.5 px-3 hidden lg:table-cell text-[10px] text-slate-600 break-words whitespace-normal align-top leading-relaxed">
                            {c.contact && <div>{c.contact}</div>}
                            {c.phone && <div>{c.phone}</div>}
                            {c.email && <div>{c.email}</div>}
                            {c.website && <div className="text-indigo-500 underline break-words"><a href={c.website.startsWith('http') ? c.website : `https://${c.website}`} target="_blank" rel="noopener noreferrer">{c.website}</a></div>}
                            {!c.contact && !c.phone && !c.email && !c.website && '-'}
                          </td>
                          
                          <td className="border border-slate-300 py-1.5 px-3 hidden xl:table-cell text-[10px] text-slate-500 break-words whitespace-normal align-top leading-relaxed">
                            {c.address || 'N/A'}
                          </td>
                          
                          <td className="border border-slate-300 py-1.5 px-3 text-right font-mono font-bold text-slate-900 text-[11px] sm:text-xs break-words whitespace-normal align-top">
                            ₱{(c.balance || 0).toLocaleString()}
                          </td>
                          
                          <td className="border border-slate-300 py-1.5 px-3 text-center whitespace-nowrap align-top">
                            <div className="flex items-center justify-center gap-2">
                              <button onClick={() => setEditModal({ isOpen: true, data: c })} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors" title="Edit Profile">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                              </button>
                              {isAuthorizedAdmin && (
                                <button onClick={() => handleDeleteCustomer(c.id)} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors" title="Delete Instantly">
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                </button>
                              )}
                            </div>
                          </td>
                          
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              
              {/* PAGINATION CONTROLS */}
              <div className="p-3 border-t border-slate-300 bg-slate-100 flex items-center justify-between text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest">
                <div>Showing {customers.length} of {totalRecords}</div>
                <div className="flex gap-1.5 sm:gap-2">
                  <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1 || isLoading} className="px-3 py-1.5 bg-white border border-slate-300 rounded shadow-sm hover:bg-slate-50 disabled:opacity-50 transition-colors">Prev</button>
                  <span className="px-4 py-1.5 bg-white border border-slate-300 rounded shadow-sm">{currentPage} / {totalPages}</span>
                  <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages || isLoading} className="px-3 py-1.5 bg-white border border-slate-300 rounded shadow-sm hover:bg-slate-50 disabled:opacity-50 transition-colors">Next</button>
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
                 <div className="p-4 sm:p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
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
                          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Categories</h4>
                          {categories.length === 0 ? (
                              <p className="text-sm text-slate-500 text-center py-4 border border-dashed border-slate-300 rounded-xl">No custom categories yet. "General" is used by default.</p>
                          ) : (
                              categories.map(cat => (
                                 <div key={cat.id} className="flex items-center justify-between p-4 bg-white border border-slate-200 rounded-xl shadow-sm">
          <span className="font-bold text-slate-800 uppercase">{cat.name}</span>
          <div className="flex gap-2">
              {/* Edit Pricing button removed - Pricing is now managed in Master Inventory */}
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
                      
                      {/* NEW SEARCH BAR UI */}
                      <div className="relative w-full sm:w-80 shrink-0">
                        <svg className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                        <input 
                          type="text" 
                          placeholder="Search SKU or Name..." 
                          value={pricingSearch}
                          onChange={e => setPricingSearch(e.target.value)}
                          className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-amber-500 transition-shadow"
                        />
                      </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-0 bg-slate-50">
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
                              {/* CHANGED FROM allProducts.map TO filteredProducts.map */}
                              {filteredProducts.length === 0 ? (
                                <tr>
                                  <td colSpan={4} className="py-8 text-center text-slate-400 font-medium">No matching products found.</td>
                                </tr>
                              ) : (
                                filteredProducts.map(p => (
                                    <tr key={p.id} className="hover:bg-amber-50/30 transition-colors">
                                        <td className="py-1.5 px-3 sm:px-6 font-mono text-[10px] sm:text-xs text-slate-500 hidden sm:table-cell">{p.sku}</td>
                                        <td className="py-1.5 px-3 sm:px-6">
                                          <div className="font-bold text-[11px] sm:text-xs text-slate-800 uppercase leading-tight">{p.name}</div>
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
                                ))
                              )}
                          </tbody>
                      </table>
                  </div>

                  <div className="p-4 sm:p-6 border-t border-slate-100 bg-white shrink-0 flex justify-end gap-3">
                      <button type="button" onClick={() => { setIsPricingModalOpen(false); setPricingSearch(''); }} className="px-5 py-2.5 bg-slate-100 text-slate-700 font-bold uppercase text-xs rounded-xl shadow-sm hover:bg-slate-200 transition-colors">Cancel</button>
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
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Website</p>
                  {viewCustomer.website ? (
                    <a href={viewCustomer.website.startsWith('http') ? viewCustomer.website : `https://${viewCustomer.website}`} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-indigo-600 break-words underline">
                        {viewCustomer.website}
                    </a>
                  ) : (
                    <p className="text-sm font-bold text-slate-900 break-words">N/A</p>
                  )}
                </div>
                <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100 lg:col-span-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Physical Address</p>
                  <p className="text-sm font-medium text-slate-900 leading-relaxed">{viewCustomer.address || 'N/A'}</p>
                </div>
                <div className="bg-slate-900 text-white p-5 rounded-2xl border border-slate-800 shadow-inner lg:col-span-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Outstanding Balance</p>
                  <p className="text-2xl font-black">₱{(viewCustomer.balance || 0).toLocaleString()}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* EDIT / CREATE MODAL */}
      {editModal.isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
         <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[95vh] animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
              <h3 className="text-xl font-black text-slate-900 tracking-tight uppercase">{editModal.data.id ? 'Edit Customer Record' : 'Register New Customer'}</h3>
              <button type="button" onClick={() => setEditModal({ isOpen: false, data: {} })} className="text-slate-400 hover:text-slate-700 font-black text-xl">✕</button>
            </div>
            
           <form onSubmit={handleSaveCustomer} className="p-4 sm:p-8 flex flex-col gap-4 sm:gap-6 flex-1 overflow-y-auto">
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
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Email Address</label>
                  <input type="email" value={editModal.data.email || ''} onChange={e => setEditModal({ ...editModal, data: { ...editModal.data, email: e.target.value } })} className="px-4 py-3 border border-slate-200 rounded-xl font-bold outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Website URL</label>
                  <input type="url" placeholder="https://..." value={editModal.data.website || ''} onChange={e => setEditModal({ ...editModal, data: { ...editModal.data, website: e.target.value } })} className="px-4 py-3 border border-slate-200 rounded-xl font-bold outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm" />
                </div>
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Physical Address</label>
                  <input type="text" value={editModal.data.address || ''} onChange={e => setEditModal({ ...editModal, data: { ...editModal.data, address: e.target.value } })} className="px-4 py-3 border border-slate-200 rounded-xl font-medium outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm" />
                </div>
              </div>
              <button type="submit" disabled={isLoading} className="mt-4 w-full py-4 bg-slate-900 text-white rounded-xl font-black uppercase tracking-wider hover:bg-slate-800 transition-colors shadow-md disabled:opacity-50 shrink-0">
                {isLoading ? 'Saving...' : 'Save Customer Record'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
