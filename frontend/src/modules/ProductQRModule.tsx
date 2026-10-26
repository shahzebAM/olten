import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getApiAuthHeaders } from '../lib/apiSession';
import { QRCodeSVG } from 'qrcode.react';

// --- INTERFACES ---
interface Product {
  id: number;
  company: string;
  name: string;
  sku: string;
  category: string;
  sellingPrice: number;
  currentStock: number;
  qrCodeUrl?: string | null;
}

interface ProductQRModuleProps {
  selectedCompany: string;
  loginUsername: string;
  API_BASE_URL: string;
  onBack: () => void;
}

export default function ProductQRModule({ selectedCompany, loginUsername, API_BASE_URL, onBack }: ProductQRModuleProps) {
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // --- TABS & SECURITY STATES ---
  const [activeTab, setActiveTab] = useState<'ALL' | 'PENDING'>('ALL');
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  
  // --- PAGINATION STATE ---
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50; // Rendering 50 QR codes is instant!
  
  const printRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ message: msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchProducts = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/sales/order-slips/all-products?company=${encodeURIComponent(selectedCompany)}`, { headers: { ...getApiAuthHeaders(), 'x-company': selectedCompany } });
      if (!res.ok) throw new Error("Failed to fetch products");
      const data = await res.json();
      setProducts(data || []);
    } catch (e) {
      showToast("Error loading products.", "error");
    } finally {
      setIsLoading(false);
    }
  }, [selectedCompany, API_BASE_URL]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // --- DERIVED DATA & FILTERS ---
  const pendingProducts = products.filter(p => !p.qrCodeUrl);
  const pendingCount = pendingProducts.length;

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      if (activeTab === 'PENDING' && p.qrCodeUrl) return false;
      return p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.sku.toLowerCase().includes(searchQuery.toLowerCase());
    });
  }, [products, activeTab, searchQuery]);

  // Reset to page 1 whenever user searches or switches tabs
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, activeTab]);

  // --- PAGINATION LOGIC ---
  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / itemsPerPage));
  const paginatedProducts = filteredProducts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  // --- GENERATION & SECURITY LOGIC ---
  const handleGenerateClick = async () => {
    if (pendingCount > 0) {
      setIsLoading(true);
      try {
        const response = await fetch(`${API_BASE_URL}/sales/order-slips/save-qrs`, {
          method: 'POST',
          headers: { ...getApiAuthHeaders(), 'x-company': selectedCompany, 'Content-Type': 'application/json' },
          body: JSON.stringify({ company: selectedCompany })
        });
        if (!response.ok) throw new Error('The server did not authorize or complete QR synchronization.');
        
        await fetchProducts(); 
        setActiveTab('ALL'); 
        showToast(`Successfully registered ${pendingCount} new QR codes!`, "success");
      } catch (e) {
        showToast("Failed to generate QR codes.", "error");
      } finally {
        setIsLoading(false);
      }
    } else {
      setIsPasswordModalOpen(true);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (adminPasswordInput === 'admin123' || adminPasswordInput === 'olten123' || loginUsername.toLowerCase() === 'admin') {
      setIsPasswordModalOpen(false);
      setAdminPasswordInput('');
      
      setIsLoading(true);
      try {
        const response = await fetch(`${API_BASE_URL}/sales/order-slips/save-qrs`, {
          method: 'POST', headers: { ...getApiAuthHeaders(), 'x-company': selectedCompany, 'Content-Type': 'application/json' }, body: JSON.stringify({ company: selectedCompany })
        });
        if (!response.ok) throw new Error('The server did not authorize or complete QR synchronization.');
        await fetchProducts();
        showToast("Admin verified. Database QRs forcefully synced.", "success");
      } catch (e) {
        showToast("Sync failed.", "error");
      } finally {
        setIsLoading(false);
      }
    } else {
      showToast("Incorrect Admin Password.", "error");
    }
  };

  // --- PRINT LOGIC ---
  const handlePrintQR = (product: Product) => {
    const printContent = printRefs.current[product.id];
    if (printContent) {
      const printWindow = window.open('', '', 'width=600,height=600');
      if (printWindow) {
        const qrData = encodeURIComponent(`${product.sku}  ${product.name}`);
        const qrUrl = `https://quickchart.io/qr?text=${qrData}&size=150`;

        printWindow.document.write(`
          <html>
            <head>
              <title>Print QR - ${product.sku}</title>
              <style>
                body { margin: 0; padding: 20px; display: flex; justify-content: center; align-items: center; font-family: sans-serif; }
                .sticker { border: 2px dashed #000; padding: 20px; text-align: center; width: 250px; }
                .sku { font-weight: black; font-size: 20px; margin-bottom: 5px; font-family: monospace; }
                .name { font-size: 12px; font-weight: bold; margin-bottom: 15px; color: #333; }
                img { width: 150px; height: 150px; margin: 0 auto; display: block; }
              </style>
            </head>
            <body>
              <div class="sticker">
                <div class="sku">${product.sku}</div>
                <div class="name">${product.name}</div>
                <img src="${qrUrl}" alt="QR Code" onload="window.print(); window.close();" />
              </div>
            </body>
          </html>
        `);
        printWindow.document.close();
      }
    }
  };

  return (
    <div className="flex flex-col h-screen w-full bg-[#F8FAFC] font-sans text-slate-900 overflow-hidden">
      
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[100] px-5 py-3.5 rounded-xl shadow-xl font-bold text-sm print:hidden ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>
          {toast.message}
        </div>
      )}

      {/* HEADER */}
      <header className="bg-white border-b border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between px-4 sm:px-8 py-4 sm:py-0 sm:h-20 shrink-0 shadow-sm z-10 gap-4 sm:gap-0">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight">
            {selectedCompany} <span className="text-slate-400 font-medium">| Product QRs</span>
          </h2>
        </div>
        <div className="flex w-full sm:w-auto gap-3">
          <button 
            onClick={handleGenerateClick} 
            className={`flex-1 sm:flex-none px-4 sm:px-5 py-2.5 text-white rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-wider transition-all shadow-sm border ${pendingCount > 0 ? 'bg-indigo-600 hover:bg-indigo-700 border-indigo-700' : 'bg-amber-500 hover:bg-amber-600 border-amber-600'}`}
          >
            {pendingCount > 0 ? `Generate Missing (${pendingCount})` : 'Regenerate (Admin)'}
          </button>
          <button onClick={onBack} className="flex-1 sm:flex-none px-4 sm:px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-[10px] sm:text-xs font-bold uppercase tracking-wider transition-colors shadow-sm border border-slate-200">
            Gateway
          </button>
        </div>
      </header>

      {/* SEARCH BAR & TABS */}
      <div className="bg-white border-b border-slate-200 px-4 sm:px-8 py-4 shrink-0 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
        
        <div className="w-full lg:max-w-md relative">
          <svg className="w-5 h-5 absolute left-3 top-2.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input 
            type="text" placeholder="Search SKU or Name..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all uppercase placeholder:normal-case"
          />
        </div>

        <div className="bg-slate-100 p-1 rounded-xl shadow-inner flex w-full lg:w-auto overflow-x-auto">
          <button 
            onClick={() => setActiveTab('ALL')} 
            className={`flex-1 sm:flex-none px-4 sm:px-6 py-2 rounded-lg text-[10px] sm:text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap ${activeTab === 'ALL' ? 'bg-white text-indigo-700 shadow border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}
          >
            All Products
          </button>
          <button 
            onClick={() => setActiveTab('PENDING')} 
            className={`flex-1 sm:flex-none px-4 sm:px-6 py-2 rounded-lg text-[10px] sm:text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 whitespace-nowrap ${activeTab === 'PENDING' ? 'bg-white text-rose-700 shadow border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Pending QRs
            {pendingCount > 0 && <span className="bg-rose-500 text-white px-2 py-0.5 rounded-full text-[10px] shadow-sm">{pendingCount}</span>}
          </button>
        </div>

      </div>

      {/* MAIN LIST WITH PAGINATION */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 flex flex-col">
        <div className="bg-white border border-slate-300 rounded-2xl shadow-sm flex flex-col flex-1 overflow-hidden relative">
          
          {isLoading ? (
            <div className="flex items-center justify-center p-10 sm:p-20">
              <div className="font-bold text-indigo-600 animate-pulse uppercase tracking-widest text-sm sm:text-base">Syncing Database...</div>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-auto w-full">
                <table className="w-full text-left text-sm whitespace-nowrap min-w-[600px] border-collapse">
                  <thead className="bg-slate-50 shadow-sm sticky top-0 z-20">
                    <tr>
                      <th className="py-3 sm:py-4 px-4 sm:px-6 font-black text-slate-500 uppercase tracking-widest text-[9px] sm:text-[10px] border-b border-slate-200 w-24 sm:w-32">SKU</th>
                      <th className="py-3 sm:py-4 px-4 sm:px-6 font-black text-slate-500 uppercase tracking-widest text-[9px] sm:text-[10px] border-b border-slate-200 w-full">Product Description</th>
                      <th className="hidden sm:table-cell py-3 sm:py-4 px-4 sm:px-6 font-black text-slate-500 uppercase tracking-widest text-[9px] sm:text-[10px] border-b border-slate-200 text-center w-24">Stock</th>
                      <th className="py-3 sm:py-4 px-4 sm:px-6 font-black text-slate-500 uppercase tracking-widest text-[9px] sm:text-[10px] border-b border-slate-200 text-center w-24 sm:w-32">QR Code</th>
                      <th className="py-3 sm:py-4 px-4 sm:px-6 font-black text-slate-500 uppercase tracking-widest text-[9px] sm:text-[10px] border-b border-slate-200 text-right w-24 sm:w-32">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {paginatedProducts.length === 0 ? (
                      <tr><td colSpan={5} className="py-12 sm:py-20 text-center text-slate-400 font-medium text-sm">No products found in this view.</td></tr>
                    ) : (
                      paginatedProducts.map(product => (
                        <tr key={product.id} className="hover:bg-slate-50 transition-colors h-20 sm:h-24">
                          <td className="py-2 px-4 sm:px-6 font-mono text-xs sm:text-sm font-black text-slate-900">{product.sku}</td>
                          <td className="py-2 px-4 sm:px-6 font-bold text-slate-700 text-xs sm:text-sm uppercase truncate max-w-[200px] sm:max-w-[300px] whitespace-normal leading-tight">{product.name}</td>
                          <td className="hidden sm:table-cell py-2 px-4 sm:px-6 text-center font-black text-slate-500">{product.currentStock || 0}</td>
                          
                          {/* THE QR CODE CELL */}
                          <td className="py-2 px-4 sm:px-6 text-center">
                            {product.qrCodeUrl ? (
                              <div 
                                ref={(el: HTMLDivElement | null) => { printRefs.current[product.id] = el; }}
                                className="inline-flex p-1.5 sm:p-2 bg-white border border-slate-200 rounded-lg shadow-sm"
                              >
                                <QRCodeSVG 
                                  value={`${product.sku}  ${product.name}`} 
                                  size={50}
                                  level="M" 
                                  includeMargin={false} 
                                />
                              </div>
                            ) : (
                              <span className="text-[9px] sm:text-[10px] font-black text-rose-500 uppercase tracking-widest bg-rose-50 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg border border-rose-200">
                                Pending
                              </span>
                            )}
                          </td>

                          {/* THE PRINT ACTION CELL */}
                          <td className="py-2 px-4 sm:px-6 text-right">
                            {product.qrCodeUrl && (
                              <button 
                                onClick={() => handlePrintQR(product)} 
                                className="px-3 sm:px-4 py-1.5 sm:py-2 bg-slate-900 text-white border border-slate-800 rounded-lg text-[9px] sm:text-[10px] font-black uppercase hover:bg-slate-800 transition-colors shadow-sm"
                              >
                                Print
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* PAGINATION FOOTER */}
              <div className="bg-slate-50 border-t border-slate-200 px-6 py-3 flex items-center justify-between shrink-0">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                  Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, filteredProducts.length)} of {filteredProducts.length}
                </span>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))} 
                    disabled={currentPage === 1}
                    className="px-4 py-1.5 bg-white border border-slate-300 text-slate-700 rounded-md text-xs font-black uppercase tracking-widest disabled:opacity-30 transition-all hover:bg-slate-100"
                  >
                    Prev
                  </button>
                  <button 
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} 
                    disabled={currentPage === totalPages}
                    className="px-4 py-1.5 bg-white border border-slate-300 text-slate-700 rounded-md text-xs font-black uppercase tracking-widest disabled:opacity-30 transition-all hover:bg-slate-100"
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </main>

      {/* ADMIN PASSWORD MODAL */}
      {isPasswordModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            <div className="p-4 sm:p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-base sm:text-lg font-black text-slate-900 tracking-tight uppercase">Admin Verification</h3>
              <button onClick={() => setIsPasswordModalOpen(false)} className="text-slate-400 hover:text-slate-700 font-black text-xl">✕</button>
            </div>
            <form onSubmit={handlePasswordSubmit} className="p-5 sm:p-6 flex flex-col gap-4">
              <p className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest">Enter Admin Password to proceed:</p>
              <input 
                type="password" 
                autoFocus
                required
                value={adminPasswordInput}
                onChange={(e) => setAdminPasswordInput(e.target.value)}
                className="w-full px-4 py-3 bg-white border border-slate-300 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-amber-500 shadow-sm"
                placeholder="••••••••"
              />
              <button type="submit" className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-black uppercase tracking-wider transition-colors shadow-md mt-2">
                Verify
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
