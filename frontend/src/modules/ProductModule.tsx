import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';

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

// 1. IN-MEMORY CACHES (Survives component unmounts!)
let cachedProducts: Record<string, Product[]> = {};
let currentValidImages: Record<string, string> = {}; // Tracks valid image by SKU
let globalImageVault: Record<string, string> = {};   // Backs up replaced/deleted images by SKU

export default function ProductModule({ selectedCompany, loginUsername, API_BASE_URL, onLogout, onBack }: any) {
  
  // 2. Initialize state directly from the cache if it exists
  const [products, setProducts] = useState<Product[]>(cachedProducts[selectedCompany] || []);
  
  const [activeTab, setActiveTab] = useState<'dashboard' | 'list' | 'add' | 'low_stock'>('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  
  // Image Preview Modal State
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // Filters State
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filterCategory, setFilterCategory] = useState('All');
  const [filterDateAdded, setFilterDateAdded] = useState('');

  const initialForm: Omit<Product, 'id' | 'currentStock' | 'company' | 'createdAt' | 'deletedAt'> & { previousImageUrl?: string } = {
    name: '', sku: '', category: 'General', purchasePrice: 0, sellingPrice: 0,
    minQuantity: 10, reorderLevel: 20, unit: 'pcs', isActive: true, 
    vatSetting: 'Vatable', imageUrl: '', barcode: '', previousImageUrl: ''
  };
  
  const [formData, setFormData] = useState(initialForm);
  const [editingId, setEditingId] = useState<number | null>(null);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  // 🛡️ BACKGROUND VAULT TRACKER: Now strictly matches by SKU to survive database imports
  const updateImageVault = (data: Product[]) => {
    data.forEach(p => {
      if (!p.sku) return;
      const current = currentValidImages[p.sku];
      const incoming = p.imageUrl;

      if ((!incoming || !incoming.startsWith('data:image')) && current) {
        globalImageVault[p.sku] = current;
      } else if (incoming && incoming.startsWith('data:image')) {
        if (current && current !== incoming) {
          globalImageVault[p.sku] = current;
        }
        currentValidImages[p.sku] = incoming;
      }
    });
  };

  // 3. Custom setter to keep the cache perfectly synced with the UI
  const syncProducts = (updater: (prev: Product[]) => Product[]) => {
    setProducts((prev) => {
      const next = updater(prev);
      cachedProducts[selectedCompany] = next;
      updateImageVault(next); // Run the silent backup tracker
      return next;
    });
  };

  const fetchProducts = async (force = false) => {
    // 4. BLOCK UNNECESSARY FETCHES: If we already have the data, stop here!
    if (!force && cachedProducts[selectedCompany]) return;

    try {
      const response = await fetch(`${API_BASE_URL}/products?company=${selectedCompany}`);
      if (response.ok) {
        const data = await response.json();
        updateImageVault(data); // Back up images before rendering
        cachedProducts[selectedCompany] = data; 
        setProducts(data);
      }
    } catch (error) {
      console.warn("Backend not connected yet. Using local state for UI demonstration.");
    }
  };

  useEffect(() => { fetchProducts(); }, [selectedCompany]);

  // Image Upload Handler (Converts File to Base64 String Link)
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      setFormData(prev => ({ ...prev, imageUrl: reader.result as string }));
    };
    reader.readAsDataURL(file);
  };

  // INLINE TABLE UPLOAD HANDLER
  const handleQuickImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, id: number) => {
    const file = e.target.files?.[0];
    if (!file) return;

    showToast("Uploading image...", "success");

    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64String = reader.result as string;
      syncProducts(prev => prev.map(p => p.id === id ? { ...p, imageUrl: base64String } : p));
      
      try {
        const response = await fetch(`${API_BASE_URL}/products/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl: base64String })
        });
        if (!response.ok) throw new Error();
        showToast("Image loaded successfully.", "success");
      } catch (error) {
        showToast("Failed to save image to database.", "error");
        fetchProducts(true);
      }
    };
    reader.readAsDataURL(file);
  };

  // SINGLE IMAGE RESTORE HANDLER (Matches by SKU)
  const restoreSingleImage = async (id: number, sku: string) => {
    const vaultImg = globalImageVault[sku];
    if (!vaultImg) return;
    
    try {
      // Instantly swap the vault image into the UI
      syncProducts(prev => prev.map(p => p.id === id ? { ...p, imageUrl: vaultImg } : p));
      
      // Execute backend patch
      await fetch(`${API_BASE_URL}/products/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: vaultImg })
      });
      showToast("Image reloaded from vault.", "success");
    } catch (e) {
      showToast("Failed to reload image.", "error");
      fetchProducts(true);
    }
  };

  // GLOBAL BULK RESTORE HANDLER (Matches by SKU)
  const restoreAllImages = async () => {
    setIsImporting(true);
    showToast("Scanning vault for missing images by SKU...", "success");
    let restoredCount = 0;
    
    // Find all products that have a missing/corrupted image but have a matching SKU in the vault
    const productsToRestore = products.filter(p => 
      globalImageVault[p.sku] && (!p.imageUrl || p.imageUrl.includes('[Base64'))
    );
    
    for (const p of productsToRestore) {
       try {
          const vaultImg = globalImageVault[p.sku];
          await fetch(`${API_BASE_URL}/products/${p.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageUrl: vaultImg })
          });
          restoredCount++;
       } catch(e) {
          console.error(`Failed to restore image for product ${p.sku}`);
       }
    }
    
    if (restoredCount > 0) {
      showToast(`Successfully restored ${restoredCount} images from vault.`, "success");
      fetchProducts(true); // Refresh table to show recovered images
    } else {
      showToast("No missing images found to restore.", "success");
    }
    setIsImporting(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    
    const today = new Date().toISOString().split('T')[0];
    const existingProduct = products.find(p => p.id === editingId);
    
    // Safely remove the vault tracking property from the final payload sent to backend
    const { previousImageUrl, ...cleanFormData } = formData;
    
    const finalData = { 
      ...cleanFormData, 
      company: selectedCompany, 
      barcode: cleanFormData.barcode || cleanFormData.sku.toUpperCase(),
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
      
      // Update local UI and Cache simultaneously
      if (!editingId) {
        syncProducts(prev => [...prev, { ...finalData, id: Date.now(), currentStock: 0 } as Product]);
      } else {
        syncProducts(prev => prev.map(p => p.id === editingId ? { ...p, ...finalData } as Product : p));
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
    // Inject the exact vault image into the form state for editing via SKU matching
    setFormData({ ...editableData, previousImageUrl: globalImageVault[prod.sku] || prod.imageUrl });
    setEditingId(prod.id);
    setActiveTab('add');
  };

  const handleDelete = async (id: number) => {
    try {
      syncProducts(prev => prev.filter(p => p.id !== id));
      await fetch(`${API_BASE_URL}/products/${id}`, { method: 'DELETE' });
      showToast("Product permanently deleted.", "success");
    } catch (e) {
      showToast("Failed to delete product.", "error");
      fetchProducts(true);
    }
  };

  const toggleStatus = async (id: number, currentStatus: boolean) => {
    const today = new Date().toISOString().split('T')[0];
    const newDeletedAt = currentStatus ? today : null;
    
    try {
      syncProducts(prev => prev.map(p => p.id === id ? { ...p, isActive: !currentStatus, deletedAt: newDeletedAt } : p));
      await fetch(`${API_BASE_URL}/products/${id}/status`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !currentStatus, deletedAt: newDeletedAt })
      });
      showToast(currentStatus ? "Product deactivated." : "Product reactivated.", "success");
    } catch (e) {
      syncProducts(prev => prev.map(p => p.id === id ? { ...p, isActive: currentStatus, deletedAt: currentStatus ? null : today } : p));
      showToast("Failed to update status.", "error");
    }
  };

  const handleExportExcel = async () => {
    try {
      showToast("Generating Excel file...", "success");
      const response = await fetch(`${API_BASE_URL}/products?company=${selectedCompany}`);
      if (!response.ok) throw new Error();
      
      const data = await response.json();
      
      if (data.length === 0) {
        showToast("No products found to export.", "error");
        return;
      }

      // Format data to prevent Excel character limit crashes
      const safeExcelData = data.map((product: Product) => {
        const safeProduct = { ...product };
        if (safeProduct.imageUrl && safeProduct.imageUrl.length > 30000) {
          safeProduct.imageUrl = "[Base64 Image Data Excluded - Too Large for Excel]";
        }
        return safeProduct;
      });

      const worksheet = XLSX.utils.json_to_sheet(safeExcelData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Master Products");
      
      XLSX.writeFile(workbook, `${selectedCompany}_Products_Backup_${new Date().toISOString().split('T')[0]}.xlsx`);
      showToast("Excel backup downloaded successfully.", "success");
    } catch (error) {
      showToast("Failed to generate Excel backup.", "error");
    }
  };

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    showToast("Reading Excel file...", "success");

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const workbook = XLSX.read(bstr, { type: 'binary' });
        const worksheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[worksheetName];
        const data = XLSX.utils.sheet_to_json(worksheet) as Product[];

        let successCount = 0;

        for (const item of data) {
          const { id, ...productData } = item;
          const response = await fetch(`${API_BASE_URL}/products`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...productData, company: selectedCompany })
          });
          if (response.ok) successCount++;
        }

        showToast(`Import complete. Added ${successCount} products.`, "success");
        fetchProducts(true);
      } catch (error) {
        showToast("Error processing Excel file.", "error");
      } finally {
        setIsImporting(false);
        e.target.value = '';
      }
    };
    reader.readAsBinaryString(file);
  };

  const clearFilters = () => {
    setSearchQuery('');
    setFilterCategory('All');
    setFilterDateAdded('');
  };

  const companyProducts = products.filter(p => p.company === selectedCompany);
  
  const lowStockProducts = companyProducts.filter(p => p.currentStock <= p.reorderLevel && p.isActive);
  const lowStockCount = lowStockProducts.length;

  const filteredProducts = companyProducts.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.sku.toLowerCase().includes(searchQuery.toLowerCase());
    if (searchQuery && !matchesSearch) return false;
    if (filterCategory !== 'All' && p.category !== filterCategory) return false;
    if (filterDateAdded) {
      const pDate = p.createdAt ? String(p.createdAt).split('T')[0] : '';
      if (pDate !== filterDateAdded) return false;
    }
    return true;
  });

  const categories = ['All', ...Array.from(new Set(companyProducts.map(p => p.category)))];

  const getPageTitle = () => {
    if (activeTab === 'dashboard') return 'Inventory Overview';
    if (activeTab === 'list') return 'Product Master List';
    if (activeTab === 'low_stock') return 'Low Stock Alerts';
    return editingId ? 'Edit Product' : 'Register New Product';
  };

  return (
    <div className="flex h-screen w-full bg-slate-50 font-sans text-slate-900 overflow-hidden selection:bg-purple-100">
      
      {/* FLOATING LIGHTBOX */}
      {previewImage && (
        <div 
          className="fixed inset-0 bg-slate-950/90 backdrop-blur-sm z-[200] flex items-center justify-center p-4 sm:p-8 animate-in fade-in duration-200"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-7xl max-h-[90vh] flex flex-col items-center justify-center">
            <button 
              className="absolute -top-12 right-0 text-slate-400 hover:text-white transition-colors bg-slate-800 hover:bg-slate-700 rounded-full p-2 shadow-lg"
              onClick={() => setPreviewImage(null)}
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            <img src={previewImage} alt="Preview" className="max-w-full max-h-[90vh] object-contain rounded-2xl shadow-2xl border border-slate-700/50" onClick={(e) => e.stopPropagation()} />
          </div>
        </div>
      )}

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
          <h1 className="text-xl font-black text-white tracking-wider uppercase">{selectedCompany} <span className="text-purple-500">Products</span></h1>
          <button onClick={() => setIsMobileMenuOpen(false)} className="md:hidden text-slate-400 hover:text-white">
             <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto py-6 px-3 space-y-1">
          <div className="px-3 pb-2 text-xs font-bold text-slate-500 uppercase tracking-widest">Workspace</div>
          <button onClick={() => { setActiveTab('dashboard'); setIsMobileMenuOpen(false); }} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all font-semibold text-sm ${activeTab === 'dashboard' ? 'bg-purple-600 text-white shadow-md shadow-purple-900/20' : 'hover:bg-slate-800 hover:text-white'}`}>Overview</button>
          
          <div className="px-3 pt-6 pb-2 text-xs font-bold text-slate-500 uppercase tracking-widest">Master Data</div>
          <button onClick={() => { setActiveTab('list'); setIsMobileMenuOpen(false); }} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all font-semibold text-sm ${activeTab === 'list' ? 'bg-purple-600 text-white shadow-md shadow-purple-900/20' : 'hover:bg-slate-800 hover:text-white'}`}>Product Records</button>
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

        <main className="flex-1 overflow-y-auto p-4 sm:p-8 relative z-0">
          <div className="max-w-6xl mx-auto space-y-6 sm:space-y-8 pb-12">

            {/* DASHBOARD TAB */}
            {activeTab === 'dashboard' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col justify-center">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Active Products</p>
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
                  <h3 className="text-lg font-bold text-white mb-2">Product Master Setup</h3>
                  <p className="text-sm text-slate-400">Products created here are synchronized automatically with Inventory, Purchasing, and Sales modules.</p>
                  
                  <div className="flex flex-wrap items-center gap-4 mt-6">
                    <button onClick={() => { setActiveTab('add'); setEditingId(null); setFormData(initialForm); }} className="w-full sm:w-auto px-6 py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl shadow-sm transition-colors text-sm">
                      Add First Product
                    </button>
                    
                    <button onClick={handleExportExcel} className="w-full sm:w-auto px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-emerald-400 font-bold rounded-xl shadow-sm transition-colors text-sm border border-slate-700 flex items-center justify-center gap-2">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                      Export Excel
                    </button>

                    <label className={`w-full sm:w-auto px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-amber-400 font-bold rounded-xl shadow-sm transition-colors text-sm border border-slate-700 flex items-center justify-center gap-2 cursor-pointer ${isImporting ? 'opacity-50 pointer-events-none' : ''}`}>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                      {isImporting ? 'Importing...' : 'Import Excel'}
                      <input type="file" accept=".xlsx, .xls" className="hidden" onChange={handleImportExcel} disabled={isImporting} />
                    </label>
                  </div>
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
                    <div className="flex w-full sm:w-auto gap-3">
                      <button onClick={restoreAllImages} disabled={isImporting} className="flex-1 sm:flex-none px-4 py-2 bg-slate-800 hover:bg-slate-700 text-sky-400 text-sm font-bold rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50 whitespace-nowrap">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                        <span className="hidden sm:inline">Restore All Images</span>
                        <span className="sm:hidden">Restore Images</span>
                      </button>
                      <button onClick={() => { setActiveTab('add'); setEditingId(null); setFormData(initialForm); }} className="flex-1 sm:flex-none px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-bold rounded-xl shadow-sm transition-colors whitespace-nowrap">
                        + Register New Product
                      </button>
                    </div>
                  </div>

                  {showFilters && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 bg-white border border-slate-200 rounded-xl mt-2 animate-in slide-in-from-top-2 fade-in duration-200">
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
                                
                                {/* INTERACTIVE IMAGE / RESTORE CELL */}
                                <div className="relative group w-16 h-16 sm:w-20 sm:h-20 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                                  {p.imageUrl && !p.imageUrl.includes('[Base64') ? (
                                    // 1. Normal Valid Image Block
                                    <>
                                      <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover cursor-pointer" onClick={() => setPreviewImage(p.imageUrl)} />
                                      <label className="absolute inset-0 bg-slate-900/60 opacity-0 group-hover:opacity-100 flex items-center justify-center cursor-pointer transition-opacity backdrop-blur-[1px] z-10" title="Change Image">
                                        <svg className="w-6 h-6 sm:w-8 sm:h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                                        <input type="file" accept="image/*" className="hidden" onChange={(e) => handleQuickImageUpload(e, p.id)} />
                                      </label>

                                      {/* EXPAND IMAGE BUTTON (TOP RIGHT) */}
                                      <button
                                        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setPreviewImage(p.imageUrl); }}
                                        className="absolute top-1 right-1 bg-slate-900/80 hover:bg-black text-white p-1 rounded sm:rounded-md shadow-md z-20 opacity-0 group-hover:opacity-100 transition-all hover:scale-110"
                                        title="View Full Image"
                                      >
                                         <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
                                      </button>
                                      
                                      {/* Persistent Reload Button if a previous image exists in the vault */}
                                      {globalImageVault[p.sku] && globalImageVault[p.sku] !== p.imageUrl && (
                                        <button
                                          onClick={(e) => { e.stopPropagation(); restoreSingleImage(p.id, p.sku); }}
                                          className="absolute top-1 left-1 bg-amber-500 hover:bg-amber-600 text-white p-1 rounded sm:rounded-md shadow-md z-20 transition-transform hover:scale-110"
                                          title="Reload Previous Image"
                                        >
                                          <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                        </button>
                                      )}
                                    </>
                                  ) : globalImageVault[p.sku] ? (
                                    // 2. Missing/Corrupted Image Block -> Render the "Vault Memory" Layout
                                    <div className="relative w-full h-full rounded-xl border-2 border-dashed border-slate-300 overflow-hidden bg-slate-50 group">
                                      <img src={globalImageVault[p.sku]} alt="Vault" className="w-full h-full object-cover opacity-40 grayscale cursor-pointer" onClick={() => setPreviewImage(globalImageVault[p.sku])} />
                                      
                                      {/* EXPAND VAULT IMAGE BUTTON (TOP RIGHT) */}
                                      <button
                                        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setPreviewImage(globalImageVault[p.sku]); }}
                                        className="absolute top-1 right-1 bg-slate-900/80 hover:bg-black text-white p-1 rounded sm:rounded-md shadow-md z-20 opacity-0 group-hover:opacity-100 transition-all hover:scale-110"
                                        title="View Original Image"
                                      >
                                         <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
                                      </button>

                                      <div className="absolute inset-0 flex items-center justify-center pb-3 sm:pb-4 pointer-events-none z-10">
                                        <button
                                          onClick={(e) => { e.stopPropagation(); restoreSingleImage(p.id, p.sku); }}
                                          className="bg-slate-800 hover:bg-slate-900 text-white px-2 py-1 rounded-md text-[9px] sm:text-[11px] font-bold shadow-lg flex items-center gap-1 transition-all transform hover:scale-105 pointer-events-auto"
                                        >
                                          <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                          Restore
                                        </button>
                                      </div>
                                      <div className="absolute bottom-0 inset-x-0 bg-slate-600/90 text-white text-[7px] sm:text-[8px] font-black text-center py-0.5 sm:py-1 uppercase tracking-widest backdrop-blur-sm cursor-pointer" onClick={() => setPreviewImage(globalImageVault[p.sku])}>
                                        Vault Memory
                                      </div>
                                    </div>
                                  ) : (
                                    // 3. Completely Missing Image & Empty Vault Block -> Show Upload Icon
                                    <label className="w-full h-full flex items-center justify-center cursor-pointer hover:bg-purple-50 transition-colors group" title="Upload Image">
                                      <svg className="w-6 h-6 sm:w-8 sm:h-8 text-slate-300 group-hover:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                      <svg className="w-6 h-6 sm:w-8 sm:h-8 text-purple-600 hidden group-hover:block" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                                      <input type="file" accept="image/*" className="hidden" onChange={(e) => handleQuickImageUpload(e, p.id)} />
                                    </label>
                                  )}
                                </div>

                                <div>
                                  <h3 className="font-bold text-slate-900">{p.name}</h3>
                                  <p className="text-[11px] text-slate-500 font-mono mt-0.5">SKU: {p.sku} | Barcode: {p.barcode}</p>
                                  <div className="flex gap-2 mt-1 items-center">
                                    <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[9px] font-bold uppercase rounded">{p.category}</span>
                                    <span className="text-[9px] text-slate-400 font-medium">Added: {p.createdAt ? String(p.createdAt).split('T')[0] : ''}</span>
                                    {p.deletedAt && <span className="text-[9px] text-rose-400 font-medium border-l border-slate-200 pl-2">Deleted: {String(p.deletedAt).split('T')[0]}</span>}
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
                              <div className="flex items-center justify-end gap-3">
                                <button onClick={() => handleEdit(p)} className="text-purple-600 hover:text-purple-800 text-xs font-bold uppercase tracking-wider">Edit</button>
                                <button onClick={() => handleDelete(p.id)} className="text-rose-500 hover:text-rose-700 text-xs font-bold uppercase tracking-wider">Delete</button>
                              </div>
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
                    Products Requiring Restock
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
                            <p className="text-slate-500 mt-1">No products currently require restocking.</p>
                          </td>
                        </tr>
                      ) : (
                        lowStockProducts.map(p => (
                          <tr key={p.id} className="hover:bg-rose-50/30 transition-colors">
                            <td className="py-4 px-6">
                              <div className="flex items-center gap-4">
                                
                                {/* INTERACTIVE IMAGE CELL FOR LOW STOCK */}
                                <div className="relative group w-12 h-12 sm:w-14 sm:h-14 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                                  {p.imageUrl && !p.imageUrl.includes('[Base64') ? (
                                    <>
                                      <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover cursor-pointer" onClick={() => setPreviewImage(p.imageUrl)} />
                                      <label className="absolute inset-0 bg-slate-900/60 opacity-0 group-hover:opacity-100 flex items-center justify-center cursor-pointer transition-opacity backdrop-blur-[1px] z-10" title="Change Image">
                                        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                                        <input type="file" accept="image/*" className="hidden" onChange={(e) => handleQuickImageUpload(e, p.id)} />
                                      </label>

                                      {/* EXPAND BUTTON */}
                                      <button
                                        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setPreviewImage(p.imageUrl); }}
                                        className="absolute top-0.5 right-0.5 bg-slate-900/80 hover:bg-black text-white p-1 rounded shadow-md z-20 opacity-0 group-hover:opacity-100 transition-all hover:scale-110"
                                        title="View Full Image"
                                      >
                                         <svg className="w-2.5 h-2.5 sm:w-3 sm:h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
                                      </button>
                                    </>
                                  ) : globalImageVault[p.sku] ? (
                                    <div className="relative w-full h-full rounded-lg border-2 border-dashed border-slate-300 overflow-hidden bg-slate-50 group">
                                      <img src={globalImageVault[p.sku]} alt="Vault" className="w-full h-full object-cover opacity-40 grayscale" />
                                      
                                      {/* EXPAND VAULT BUTTON */}
                                      <button
                                        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setPreviewImage(globalImageVault[p.sku]); }}
                                        className="absolute top-0.5 right-0.5 bg-slate-900/80 hover:bg-black text-white p-1 rounded shadow-md z-20 opacity-0 group-hover:opacity-100 transition-all hover:scale-110"
                                        title="View Original Image"
                                      >
                                         <svg className="w-2.5 h-2.5 sm:w-3 sm:h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
                                      </button>

                                      <div className="absolute inset-0 flex items-center justify-center pb-2 pointer-events-none z-10">
                                        <button
                                          onClick={(e) => { e.stopPropagation(); restoreSingleImage(p.id, p.sku); }}
                                          className="bg-slate-800 hover:bg-slate-900 text-white px-1.5 py-0.5 rounded text-[8px] font-bold shadow-lg flex items-center gap-1 transition-all transform hover:scale-105 pointer-events-auto"
                                        >
                                          <svg className="w-2.5 h-2.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <label className="w-full h-full flex items-center justify-center cursor-pointer hover:bg-purple-50 transition-colors group" title="Upload Image">
                                      <svg className="w-5 h-5 text-slate-300 group-hover:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                      <svg className="w-4 h-4 text-purple-600 hidden group-hover:block" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                                      <input type="file" accept="image/*" className="hidden" onChange={(e) => handleQuickImageUpload(e, p.id)} />
                                    </label>
                                  )}
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
                              <div className="flex items-center justify-end gap-3">
                                <button onClick={() => handleEdit(p)} className="text-purple-600 hover:text-purple-800 text-xs font-bold uppercase tracking-wider">Edit</button>
                                <button onClick={() => handleDelete(p.id)} className="text-rose-500 hover:text-rose-700 text-xs font-bold uppercase tracking-wider">Delete</button>
                              </div>
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
                <h2 className="text-xl font-bold text-purple-950 mb-6">{editingId ? 'Edit Product Configuration' : 'Register Master Product'}</h2>
                
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
                        <label className="text-sm font-medium text-slate-700">SKU / Product Code <span className="text-rose-500">*</span></label>
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

                  {/* IMAGE UPLOAD SECTION */}
                  <div className="flex flex-col gap-1.5 w-full">
                    <label className="text-sm font-medium text-slate-700">Product Image (Upload File or Paste Link)</label>
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                      <label className="cursor-pointer px-5 py-2.5 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-xl text-sm font-bold text-slate-700 transition-colors whitespace-nowrap shadow-sm">
                        Choose File
                        <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                      </label>
                      <span className="text-slate-400 text-xs font-bold uppercase hidden sm:block">OR</span>
                      <input 
                        type="text" 
                        value={formData.imageUrl} 
                        onChange={e => setFormData({...formData, imageUrl: e.target.value})} 
                        className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-purple-600 shadow-sm" 
                        placeholder="https://example.com/image.jpg" 
                      />
                    </div>
                    
                    {/* Live Form Image Preview & Vault */}
                    <div className="flex gap-4 mt-3">
                      
                      {/* Current Active Form Image */}
                      {formData.imageUrl && !formData.imageUrl.includes('[Base64') && (
                        <div className="relative w-32 h-32 rounded-xl border border-slate-200 overflow-hidden bg-slate-50 shadow-sm group shrink-0">
                          <img src={formData.imageUrl} alt="Current Preview" className="w-full h-full object-cover" />
                          
                          {/* Remove Image (Top Left) */}
                          <button 
                            type="button"
                            onClick={() => setFormData({...formData, imageUrl: ''})}
                            className="absolute top-2 left-2 bg-rose-500/90 hover:bg-rose-600 text-white p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity shadow-sm z-10"
                            title="Remove Current Image"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>

                          {/* Expand Image (Top Right) */}
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); e.preventDefault(); setPreviewImage(formData.imageUrl); }}
                            className="absolute top-2 right-2 bg-slate-900/80 hover:bg-black text-white p-1.5 rounded-lg shadow-md z-10 opacity-0 group-hover:opacity-100 transition-all hover:scale-110"
                            title="View Full Image"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
                          </button>
                        </div>
                      )}

                      {/* Image Vault (Previous Form Image) */}
                      {formData.previousImageUrl && formData.previousImageUrl !== formData.imageUrl && !formData.previousImageUrl.includes('[Base64') && (
                        <div className="relative w-32 h-32 rounded-xl border-2 border-dashed border-slate-300 overflow-hidden bg-slate-100 shadow-inner shrink-0 group">
                          <img src={formData.previousImageUrl} alt="Vault" className="w-full h-full object-cover opacity-40 grayscale" />
                          
                          {/* Expand Vault Image (Top Right) */}
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); e.preventDefault(); setPreviewImage(formData.previousImageUrl!); }}
                            className="absolute top-2 right-2 bg-slate-900/80 hover:bg-black text-white p-1.5 rounded-lg shadow-md z-20 opacity-0 group-hover:opacity-100 transition-all hover:scale-110"
                            title="View Original Image"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
                          </button>

                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <button 
                              type="button"
                              onClick={() => setFormData({...formData, imageUrl: formData.previousImageUrl!})}
                              className="bg-slate-800/90 hover:bg-slate-900 text-white px-3 py-2 rounded-lg text-xs font-bold shadow-xl flex items-center gap-1.5 transition-all transform hover:scale-105 pointer-events-auto"
                            >
                              <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                              Restore
                            </button>
                          </div>
                          <div className="absolute bottom-0 inset-x-0 bg-slate-800/50 text-white text-[9px] font-bold text-center py-0.5 uppercase tracking-widest backdrop-blur-sm pointer-events-none">
                            Vault Memory
                          </div>
                        </div>
                      )}
                    </div>
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