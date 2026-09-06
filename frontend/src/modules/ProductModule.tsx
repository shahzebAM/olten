import React, { useState, useEffect } from 'react';

interface Product {
  id: number;
  company: string;
  name: string;
  sku: string;
  category: string;
  purchasePrice: number;
  sellingPrice: number;
  minQuantity: number;
  reorderLevel: number;
  unit: string;
  isActive: boolean;
  vatSetting: string;
  imageUrl: string;
  barcode: string;
  currentStock: number;
  createdAt: string;
  deletedAt: string | null;
}

export default function ProductModule({ selectedCompany, loginUsername, API_BASE_URL, onLogout, onBack }: any) {
  const [products, setProducts] = useState<Product[]>([]);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'list' | 'add' | 'low_stock'>('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  // Filters State
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filterCategory, setFilterCategory] = useState('All');
  const [filterDateAdded, setFilterDateAdded] = useState('');
  const [filterDateDeleted, setFilterDateDeleted] = useState('');

  const initialForm: Omit<Product, 'id' | 'currentStock' | 'company' | 'createdAt' | 'deletedAt'> = {
    name: '', sku: '', category: 'General', purchasePrice: 0, sellingPrice: 0,
    minQuantity: 10, reorderLevel: 20, unit: 'pcs', isActive: true, 
    vatSetting: 'Vatable', imageUrl: '', barcode: ''
  };
  
  const [formData, setFormData] = useState(initialForm);
  const [editingId, setEditingId] = useState<number | null>(null);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchProducts = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/products?company=${selectedCompany}`);
      if (response.ok) {
        const data = await response.json();
        setProducts(data);
      }
    } catch (error) {
      console.warn("Backend not connected yet. Using local state for UI demonstration.");
    }
  };

  useEffect(() => { fetchProducts(); }, [selectedCompany]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    
    const today = new Date().toISOString().split('T')[0];
    const existingProduct = products.find(p => p.id === editingId);
    
    const finalData = { 
      ...formData, 
      company: selectedCompany, 
      barcode: formData.barcode || formData.sku.toUpperCase(),
      createdAt: existingProduct ? existingProduct.createdAt : today,
      deletedAt: existingProduct ? existingProduct.deletedAt : null
    };

    try {
      const url = editingId ? `${API_BASE_URL}/products/${editingId}` : `${API_BASE_URL}/products`;
      const method = editingId ? 'PATCH' : 'POST';
      
      const response = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(finalData)
      });
      
      if (!response.ok && response.status !== 404) throw new Error(); 
      
      showToast(editingId ? "Product updated successfully." : "New product added to master list.", "success");
      
      if (!editingId) {
        setProducts(prev => [...prev, { ...finalData, id: Date.now(), currentStock: 0 } as Product]);
      } else {
        setProducts(prev => prev.map(p => p.id === editingId ? { ...p, ...finalData } as Product : p));
      }

      setFormData(initialForm);
      setEditingId(null);
      setActiveTab('list');
    } catch (error) {
      showToast("Failed to save product to database.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleEdit = (prod: Product) => {
    const { id, company, currentStock, createdAt, deletedAt, ...editableData } = prod;
    setFormData(editableData);
    setEditingId(prod.id);
    setActiveTab('add');
  };

  const toggleStatus = async (id: number, currentStatus: boolean) => {
    const today = new Date().toISOString().split('T')[0];
    const newDeletedAt = currentStatus ? today : null;
    
    try {
      setProducts(prev => prev.map(p => p.id === id ? { ...p, isActive: !currentStatus, deletedAt: newDeletedAt } : p));
      await fetch(`${API_BASE_URL}/products/${id}/status`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !currentStatus, deletedAt: newDeletedAt })
      });
      showToast(currentStatus ? "Product deactivated (marked deleted)." : "Product reactivated.", "success");
    } catch (e) {
      setProducts(prev => prev.map(p => p.id === id ? { ...p, isActive: currentStatus, deletedAt: currentStatus ? null : today } : p));
      showToast("Failed to update status.", "error");
    }
  };

  const clearFilters = () => {
    setSearchQuery('');
    setFilterCategory('All');
    setFilterDateAdded('');
    setFilterDateDeleted('');
  };

  const companyProducts = products.filter(p => p.company === selectedCompany);
  
  // Dynamic Low Stock Counter (Blinks in Sidebar)
  const lowStockProducts = companyProducts.filter(p => p.currentStock <= p.reorderLevel && p.isActive);
  const lowStockCount = lowStockProducts.length;

  const filteredProducts = companyProducts.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.sku.toLowerCase().includes(searchQuery.toLowerCase());
    if (searchQuery && !matchesSearch) return false;
    
    if (filterCategory !== 'All' && p.category !== filterCategory) return false;
    if (filterDateAdded && p.createdAt !== filterDateAdded) return false;
    if (filterDateDeleted && p.deletedAt !== filterDateDeleted) return false;
    
    return true;
  });

  const categories = ['All', ...Array.from(new Set(companyProducts.map(p => p.category)))];

  const getPageTitle = () => {
    if (activeTab === 'dashboard') return 'Inventory Overview';
    if (activeTab === 'list') return 'Item Master List';
    if (activeTab === 'low_stock') return 'Low Stock Alerts';
    return editingId ? 'Edit Product' : 'Register New Product';
  };

  return (
    <div className="flex h-screen w-full bg-slate-50 font-sans text-slate-900 overflow-hidden selection:bg-purple-100">
      
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[100] px-5 py-3.5 rounded-xl shadow-xl font-semibold flex items-center gap-3 animate-in slide-in-from-right-8 slide-in-from-bottom-2 fade-in duration-300 ease-out border ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>
          {toast.message}
        </div>
      )}

      {isMobileMenuOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 md:hidden" onClick={() => setIsMobileMenuOpen(false)}></div>
      )}
      
      <aside className={`fixed inset-y-0 left-0 z-50 transform bg-slate-900 text-slate-300 flex flex-col flex-shrink-0 w-64 transition-transform duration-300 ease-in-out md:relative md:translate-x-0 border-r border-slate-800 shadow-2xl ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="h-20 flex items-center justify-between px-6 border-b border-slate-800 bg-slate-950 shrink-0">
          <h1 className="text-xl font-black text-white tracking-wider uppercase">{selectedCompany}<span className="text-purple-500">Items</span></h1>
          <button onClick={() => setIsMobileMenuOpen(false)} className="md:hidden text-slate-400 hover:text-white">
             <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto py-6 px-3 space-y-1">
          <div className="px-3 pb-2 text-xs font-bold text-slate-500 uppercase tracking-widest">Workspace</div>
          <button onClick={() => { setActiveTab('dashboard'); setIsMobileMenuOpen(false); }} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all font-semibold text-sm ${activeTab === 'dashboard' ? 'bg-purple-600 text-white shadow-md shadow-purple-900/20' : 'hover:bg-slate-800 hover:text-white'}`}>Overview</button>
          
          <div className="px-3 pt-6 pb-2 text-xs font-bold text-slate-500 uppercase tracking-widest">Master Data</div>
          <button onClick={() => { setActiveTab('list'); setIsMobileMenuOpen(false); }} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all font-semibold text-sm ${activeTab === 'list' ? 'bg-purple-600 text-white shadow-md shadow-purple-900/20' : 'hover:bg-slate-800 hover:text-white'}`}>Item Records</button>
          <button onClick={() => { setActiveTab('add'); setFormData(initialForm); setEditingId(null); setIsMobileMenuOpen(false); }} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all font-semibold text-sm ${activeTab === 'add' ? 'bg-purple-600 text-white shadow-md shadow-purple-900/20' : 'hover:bg-slate-800 hover:text-white'}`}>Register Product</button>
          
          <div className="px-3 pt-6 pb-2 text-xs font-bold text-slate-500 uppercase tracking-widest">Inventory Management</div>
          <button onClick={() => { setActiveTab('low_stock'); setIsMobileMenuOpen(false); }} className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-all font-semibold text-sm ${activeTab === 'low_stock' ? 'bg-amber-600 text-white shadow-md shadow-amber-900/20' : 'hover:bg-slate-800 hover:text-white'}`}>
            <div className="flex items-center gap-3">
              Low Stock Alerts
            </div>
            {lowStockCount > 0 && (
              <span className="bg-rose-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full animate-pulse shadow-sm shadow-rose-900/50">
                {lowStockCount}
              </span>
            )}
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        
        <header className="h-auto sm:h-20 bg-white border-b border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between px-4 sm:px-8 py-3 sm:py-0 shadow-sm relative z-10 shrink-0 gap-3 sm:gap-0">
          <div className="flex items-center gap-3 sm:gap-4 w-full sm:w-auto">
            <button onClick={() => setIsMobileMenuOpen(true)} className="md:hidden p-2 sm:p-2.5 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors border border-slate-200 shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg sm:text-2xl font-extrabold text-purple-950 tracking-tight truncate">{getPageTitle()}</h2>
              <div className="text-[10px] sm:text-xs font-semibold text-slate-400 mt-0.5 flex items-center gap-1.5 sm:gap-2">
                <span>Product Manager</span> <span className="hidden sm:inline">/</span> <span className="text-purple-600 truncate">{getPageTitle()}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto justify-end">
            <button onClick={onBack} className="flex-1 sm:flex-none flex justify-center px-4 py-2 sm:py-2 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-lg text-xs sm:text-sm font-bold transition-colors shadow-sm border border-purple-200 items-center gap-1.5 sm:gap-2 whitespace-nowrap">
              <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
              <span className="hidden sm:inline">Gateway</span>
              <span className="sm:hidden">Back</span>
            </button>
            <button onClick={onLogout} className="flex-1 sm:flex-none flex justify-center px-4 sm:px-6 py-2 sm:py-2 bg-slate-100 hover:bg-rose-50 text-slate-700 hover:text-rose-600 rounded-lg text-xs sm:text-sm font-bold transition-colors shadow-sm border border-slate-200 whitespace-nowrap">
              Logout
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-8 relative">
          <div className="max-w-6xl mx-auto space-y-6 sm:space-y-8 pb-12">

            {/* DASHBOARD TAB */}
            {activeTab === 'dashboard' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col justify-center">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Active Items</p>
                    <h3 className="text-4xl font-black text-purple-950 mt-1">{companyProducts.filter(p => p.isActive).length}</h3>
                  </div>
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col justify-center">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Low Stock Warnings</p>
                    <h3 className="text-4xl font-black text-amber-600 mt-1">{lowStockCount}</h3>
                  </div>
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col justify-center">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Valuation</p>
                    <h3 className="text-4xl font-black text-emerald-700 mt-1">₱{companyProducts.reduce((acc, p) => acc + (p.isActive ? (p.currentStock * p.purchasePrice) : 0), 0).toLocaleString()}</h3>
                  </div>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm text-slate-300">
                  <h3 className="text-lg font-bold text-white mb-2">Item Master Setup</h3>
                  <p className="text-sm text-slate-400">Products created here are synchronized automatically with Inventory, Purchasing, and Sales modules.</p>
                  <button onClick={() => { setActiveTab('add'); setEditingId(null); setFormData(initialForm); }} className="mt-6 px-6 py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl shadow-sm transition-colors text-sm">
                    Add First Product
                  </button>
                </div>
              </div>
            )}

            {/* LIST TAB */}
            {activeTab === 'list' && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                <div className="p-4 sm:p-6 border-b border-slate-200 bg-purple-50/30 flex flex-col gap-4">
                  <div className="flex flex-col sm:flex-row justify-between gap-4">
                    <div className="flex w-full sm:w-auto gap-2">
                      <input type="text" placeholder="Search by name or SKU..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full sm:w-[300px] px-4 py-2 border border-slate-300 rounded-xl text-sm focus:ring-4 focus:ring-purple-600/10 focus:border-purple-600 outline-none shadow-sm transition-all" />
                      <button onClick={() => setShowFilters(!showFilters)} className={`px-4 py-2 border rounded-xl text-sm font-bold shadow-sm transition-colors flex items-center gap-2 ${showFilters ? 'bg-purple-100 border-purple-300 text-purple-700' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>
                        <span className="hidden sm:inline">Filters</span>
                      </button>
                    </div>
                    <button onClick={() => { setActiveTab('add'); setEditingId(null); setFormData(initialForm); }} className="w-full sm:w-auto px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-bold rounded-xl shadow-sm transition-colors whitespace-nowrap">
                      + Register New Item
                    </button>
                  </div>

                  {showFilters && (
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 p-4 bg-white border border-slate-200 rounded-xl mt-2 animate-in slide-in-from-top-2 fade-in duration-200">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Category</label>
                        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none focus:border-purple-500">
                          {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                        </select>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Date Added</label>
                        <input type="date" value={filterDateAdded} onChange={(e) => setFilterDateAdded(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-purple-500" />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Date Deleted</label>
                        <input type="date" value={filterDateDeleted} onChange={(e) => setFilterDateDeleted(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-purple-500" />
                      </div>
                      <div className="flex items-end justify-end">
                        <button onClick={clearFilters} className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-800 underline transition-colors">
                          Clear Filters
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                
                <div className="overflow-x-auto w-full pb-4">
                  <table className="w-full text-left border-collapse min-w-[1000px]">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Product Details</th>
                        <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Pricing</th>
                        <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Inventory Params</th>
                        <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Status</th>
                        <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredProducts.length === 0 ? (
                        <tr><td colSpan={5} className="py-12 text-center text-slate-400 font-medium">No products match your filters.</td></tr>
                      ) : (
                        filteredProducts.map(p => (
                          <tr key={p.id} className={`hover:bg-purple-50/30 transition-colors ${!p.isActive ? 'opacity-60 grayscale-[50%]' : ''}`}>
                            <td className="py-4 px-6">
                              <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                                  {p.imageUrl ? <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" /> : <svg className="w-6 h-6 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>}
                                </div>
                                <div>
                                  <h3 className="font-bold text-slate-900">{p.name}</h3>
                                  <p className="text-[11px] text-slate-500 font-mono mt-0.5">SKU: {p.sku} | Barcode: {p.barcode}</p>
                                  <div className="flex gap-2 mt-1 items-center">
                                    <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[9px] font-bold uppercase rounded">{p.category}</span>
                                    <span className="text-[9px] text-slate-400 font-medium">Added: {p.createdAt}</span>
                                    {p.deletedAt && <span className="text-[9px] text-rose-400 font-medium border-l border-slate-200 pl-2">Deleted: {p.deletedAt}</span>}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="py-4 px-6">
                              <div className="text-sm font-bold text-slate-800">Sell: ₱{p.sellingPrice.toLocaleString()}</div>
                              <div className="text-xs text-slate-500 font-medium">Cost: ₱{p.purchasePrice.toLocaleString()}</div>
                              <div className="text-[10px] text-slate-400 uppercase tracking-widest mt-1">{p.vatSetting}</div>
                            </td>
                            <td className="py-4 px-6">
                              <div className="text-sm font-medium text-slate-600"><span className="font-bold text-slate-800">{p.currentStock}</span> {p.unit} in stock</div>
                              <div className="text-xs text-amber-600 font-medium">Reorder at: {p.reorderLevel} {p.unit}</div>
                            </td>
                            <td className="py-4 px-6">
                              <button onClick={() => toggleStatus(p.id, p.isActive)} className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-colors ${p.isActive ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-rose-100 text-rose-700 hover:bg-rose-200'}`}>
                                {p.isActive ? 'Active' : 'Deleted'}
                              </button>
                            </td>
                            <td className="py-4 px-6 text-right">
                              <button onClick={() => handleEdit(p)} className="text-purple-600 hover:text-purple-800 text-xs font-bold uppercase tracking-wider">Edit</button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* LOW STOCK TAB */}
            {activeTab === 'low_stock' && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                <div className="p-4 sm:p-6 border-b border-rose-100 bg-rose-50/50 flex flex-col gap-2">
                  <h2 className="text-lg font-bold text-rose-900 flex items-center gap-2">
                    <svg className="w-5 h-5 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    Items Requiring Restock
                  </h2>
                  <p className="text-sm text-slate-600">The following active products have fallen below their defined reorder levels.</p>
                </div>
                
                <div className="overflow-x-auto w-full pb-4">
                  <table className="w-full text-left border-collapse min-w-[1000px]">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Product Details</th>
                        <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Stock Status</th>
                        <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Reorder Parameter</th>
                        <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {lowStockProducts.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-16 text-center">
                            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-100 mb-4">
                              <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                            </div>
                            <h3 className="text-lg font-bold text-slate-800">All Stock Levels Healthy</h3>
                            <p className="text-slate-500 mt-1">No items currently require restocking.</p>
                          </td>
                        </tr>
                      ) : (
                        lowStockProducts.map(p => (
                          <tr key={p.id} className="hover:bg-rose-50/30 transition-colors">
                            <td className="py-4 px-6">
                              <div className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                                  {p.imageUrl ? <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" /> : <svg className="w-5 h-5 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>}
                                </div>
                                <div>
                                  <h3 className="font-bold text-slate-900">{p.name}</h3>
                                  <p className="text-xs text-slate-500 font-mono">SKU: {p.sku}</p>
                                </div>
                              </div>
                            </td>
                            <td className="py-4 px-6">
                              <div className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full ${p.currentStock === 0 ? 'bg-rose-600 animate-pulse' : 'bg-amber-500'}`}></span>
                                <span className={`text-sm font-black ${p.currentStock === 0 ? 'text-rose-600' : 'text-amber-600'}`}>
                                  {p.currentStock} {p.unit} remaining
                                </span>
                              </div>
                            </td>
                            <td className="py-4 px-6">
                              <div className="text-sm text-slate-700">Trigger set at: <span className="font-bold">{p.reorderLevel} {p.unit}</span></div>
                            </td>
                            <td className="py-4 px-6 text-right">
                              <button onClick={() => handleEdit(p)} className="px-4 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold rounded shadow-sm transition-colors uppercase tracking-wider">
                                View Item
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ADD / EDIT TAB */}
            {activeTab === 'add' && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 sm:p-8">
                <h2 className="text-xl font-bold text-purple-950 mb-6">{editingId ? 'Edit Product Configuration' : 'Register Master Item'}</h2>
                
                <form onSubmit={handleSubmit} className="flex flex-col gap-8">
                  
                  {/* Basic Info */}
                  <div>
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2 mb-4">Core Identifier</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <div className="flex flex-col gap-1.5 w-full">
                        <label className="text-sm font-medium text-slate-700">Product Name <span className="text-rose-500">*</span></label>
                        <input type="text" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="px-4 py-2.5 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-purple-600 shadow-sm" placeholder="e.g. Surgical Forceps" />
                      </div>
                      <div className="flex flex-col gap-1.5 w-full">
                        <label className="text-sm font-medium text-slate-700">Category</label>
                        <input type="text" required value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})} className="px-4 py-2.5 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-purple-600 shadow-sm" placeholder="e.g. Instruments" />
                      </div>
                      <div className="flex flex-col gap-1.5 w-full">
                        <label className="text-sm font-medium text-slate-700">SKU / Item Code <span className="text-rose-500">*</span></label>
                        <input type="text" required value={formData.sku} onChange={e => setFormData({...formData, sku: e.target.value})} className="px-4 py-2.5 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-purple-600 shadow-sm uppercase font-mono" placeholder="SURG-001" />
                      </div>
                      <div className="flex flex-col gap-1.5 w-full">
                        <label className="text-sm font-medium text-slate-700">Barcode Value</label>
                        <input type="text" value={formData.barcode} onChange={e => setFormData({...formData, barcode: e.target.value})} className="px-4 py-2.5 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-purple-600 shadow-sm font-mono" placeholder="Leave blank to use SKU" />
                      </div>
                    </div>
                  </div>

                  {/* Pricing Info */}
                  <div>
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2 mb-4">Commercial Details</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                      <div className="flex flex-col gap-1.5 w-full">
                        <label className="text-sm font-medium text-slate-700">Purchase Cost (₱)</label>
                        <input type="number" step="0.01" required value={formData.purchasePrice} onChange={e => setFormData({...formData, purchasePrice: parseFloat(e.target.value)})} className="px-4 py-2.5 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-purple-600 shadow-sm font-mono" />
                      </div>
                      <div className="flex flex-col gap-1.5 w-full">
                        <label className="text-sm font-medium text-slate-700">Selling Price (₱)</label>
                        <input type="number" step="0.01" required value={formData.sellingPrice} onChange={e => setFormData({...formData, sellingPrice: parseFloat(e.target.value)})} className="px-4 py-2.5 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-purple-600 shadow-sm font-mono" />
                      </div>
                      <div className="flex flex-col gap-1.5 w-full">
                        <label className="text-sm font-medium text-slate-700">VAT Setting</label>
                        <select value={formData.vatSetting} onChange={e => setFormData({...formData, vatSetting: e.target.value})} className="px-4 py-2.5 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-purple-600 shadow-sm bg-white">
                          <option value="Vatable">Vatable (12%)</option>
                          <option value="VAT Exempt">VAT Exempt</option>
                          <option value="Zero Rated">Zero Rated</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Inventory Rules */}
                  <div>
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2 mb-4">Inventory Parameters</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                      <div className="flex flex-col gap-1.5 w-full">
                        <label className="text-sm font-medium text-slate-700">Unit of Measure</label>
                        <select value={formData.unit} onChange={e => setFormData({...formData, unit: e.target.value})} className="px-4 py-2.5 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-purple-600 shadow-sm bg-white">
                          <option value="pcs">Pieces (pcs)</option>
                          <option value="box">Boxes</option>
                          <option value="kg">Kilograms (kg)</option>
                          <option value="liters">Liters (L)</option>
                        </select>
                      </div>
                      <div className="flex flex-col gap-1.5 w-full">
                        <label className="text-sm font-medium text-slate-700">Minimum Qty Warning</label>
                        <input type="number" required value={formData.minQuantity} onChange={e => setFormData({...formData, minQuantity: parseInt(e.target.value)})} className="px-4 py-2.5 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-purple-600 shadow-sm" />
                      </div>
                      <div className="flex flex-col gap-1.5 w-full">
                        <label className="text-sm font-medium text-slate-700">Reorder Level</label>
                        <input type="number" required value={formData.reorderLevel} onChange={e => setFormData({...formData, reorderLevel: parseInt(e.target.value)})} className="px-4 py-2.5 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-purple-600 shadow-sm" />
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5 w-full">
                    <label className="text-sm font-medium text-slate-700">Image URL (Optional)</label>
                    <input type="text" value={formData.imageUrl} onChange={e => setFormData({...formData, imageUrl: e.target.value})} className="px-4 py-2.5 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-purple-600 shadow-sm" placeholder="https://example.com/image.jpg" />
                  </div>

                  <div className="pt-4 border-t border-slate-200">
                    <button type="submit" disabled={isSaving} className="w-full sm:w-auto px-8 py-3.5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl shadow-sm whitespace-nowrap disabled:opacity-50 transition-colors uppercase tracking-wider text-sm">
                      {isSaving ? 'Processing...' : (editingId ? 'Update Master Record' : 'Save to Master List')}
                    </button>
                  </div>

                </form>
              </div>
            )}

          </div>
        </main>
      </div>
    </div>
  );
}