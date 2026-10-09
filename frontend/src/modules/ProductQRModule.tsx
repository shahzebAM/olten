import React, { useState, useEffect, useCallback, useRef } from 'react';

// --- INTERFACES ---
interface Product {
  id: number;
  company: string;
  name: string;
  sku: string;
  category: string;
  sellingPrice: number;
  currentStock: number;
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

  // --- QR & SECURITY STATES ---
  const [showQRs, setShowQRs] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  
  // Create a ref to hold the printable areas
  const printRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ message: msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchProducts = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/sales/order-slips/search-products?company=${encodeURIComponent(selectedCompany)}&q=a`); 
      // Note: If you have a dedicated 'get all products' endpoint, use it here instead of the search endpoint.
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

  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    p.sku.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleGenerateClick = () => {
    if (!showQRs) {
      // First click: Generate instantly
      setShowQRs(true);
      showToast("QR Codes Generated!", "success");
    } else {
      // Second click: Ask for admin password
      setIsPasswordModalOpen(true);
    }
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Simple frontend check (You can replace this with an API call to verify the admin password if you want strict security)
    if (adminPasswordInput === 'admin123' || adminPasswordInput === 'olten123' || loginUsername.toLowerCase() === 'admin') {
      setIsPasswordModalOpen(false);
      setAdminPasswordInput('');
      setShowQRs(false); // Reset or do whatever the "second click" is supposed to do
      showToast("QR System reset successfully.", "success");
    } else {
      showToast("Incorrect Admin Password.", "error");
    }
  };

  const handlePrintQR = (product: Product) => {
    const printContent = printRefs.current[product.id];
    if (printContent) {
      const printWindow = window.open('', '', 'width=600,height=600');
      if (printWindow) {
        printWindow.document.write(`
          <html>
            <head>
              <title>Print QR - ${product.sku}</title>
              <style>
                body { margin: 0; padding: 20px; display: flex; justify-content: center; align-items: center; font-family: sans-serif; }
                .sticker { border: 2px dashed #000; padding: 20px; text-align: center; width: 250px; }
                .sku { font-weight: bold; font-size: 24px; margin-bottom: 5px; }
                .name { font-size: 14px; margin-bottom: 15px; color: #333; }
                img { width: 150px; height: 150px; }
              </style>
            </head>
            <body>
              <div class="sticker">
                <div class="sku">${product.sku}</div>
                <div class="name">${product.name}</div>
                <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(`SKU:${product.sku} \vert{} Name:${product.name}`)}" alt="QR Code" />
              </div>
              <script>
                window.onload = function() { window.print(); window.close(); }
              </script>
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
      <header className="h-16 sm:h-20 bg-white border-b border-slate-200 flex items-center justify-between px-6 sm:px-8 shrink-0 shadow-sm z-10">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight">
            {selectedCompany} <span className="text-slate-400 font-medium">| Product QR System</span>
          </h2>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={handleGenerateClick} 
            className={`px-5 py-2.5 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-sm border ${showQRs ? 'bg-amber-500 hover:bg-amber-600 border-amber-600' : 'bg-indigo-600 hover:bg-indigo-700 border-indigo-700'}`}
          >
            {showQRs ? 'Generate QR (Admin)' : 'Generate QR'}
          </button>
          <button onClick={onBack} className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors shadow-sm border border-slate-200">
            Back to Gateway
          </button>
        </div>
      </header>

      {/* SEARCH BAR */}
      <div className="bg-white border-b border-slate-200 px-6 sm:px-8 py-4 shrink-0 flex items-center justify-between">
        <div className="w-full max-w-md relative">
          <svg className="w-5 h-5 absolute left-3 top-2.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input 
            type="text" placeholder="Search by SKU or Name..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all uppercase placeholder:normal-case"
          />
        </div>
      </div>

      {/* MAIN LIST */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
        <div className="bg-white border border-slate-300 rounded-2xl shadow-sm flex flex-col flex-1 overflow-hidden relative">
          
          {isLoading ? (
            <div className="flex items-center justify-center p-20">
              <div className="font-bold text-indigo-600 animate-pulse uppercase tracking-widest">Loading Products...</div>
            </div>
          ) : (
            <div className="flex-1 overflow-auto w-full">
              <table className="w-full text-left text-sm whitespace-nowrap min-w-[800px] border-collapse">
                <thead className="bg-slate-50 shadow-sm sticky top-0 z-20">
                  <tr>
                    <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] border-b border-slate-200 w-32">SKU</th>
                    <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] border-b border-slate-200 w-full">Product Description</th>
                    <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] border-b border-slate-200 text-center w-24">Stock</th>
                    <th className={`py-4 px-6 font-black text-indigo-600 uppercase tracking-widest text-[10px] border-b border-slate-200 text-center transition-all ${showQRs ? 'w-48 opacity-100' : 'w-0 opacity-0 overflow-hidden px-0 border-none'}`}>
                      QR Code
                    </th>
                    <th className={`py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] border-b border-slate-200 text-right transition-all ${showQRs ? 'w-32 opacity-100' : 'w-0 opacity-0 overflow-hidden px-0 border-none'}`}>
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredProducts.length === 0 ? (
                    <tr><td colSpan={5} className="py-20 text-center text-slate-400 font-medium">No products found.</td></tr>
                  ) : (
                    filteredProducts.map(product => (
                      <tr key={product.id} className="hover:bg-slate-50 transition-colors h-24">
                        <td className="py-2 px-6 font-mono text-sm font-black text-slate-900">{product.sku}</td>
                        <td className="py-2 px-6 font-bold text-slate-700 uppercase truncate max-w-[300px] whitespace-normal leading-tight">{product.name}</td>
                        <td className="py-2 px-6 text-center font-black text-slate-500">{product.currentStock || 0}</td>
                        
                        {/* THE QR CODE CELL */}
                        <td className={`py-2 px-6 text-center transition-all ${showQRs ? 'opacity-100' : 'w-0 opacity-0 overflow-hidden p-0'}`}>
                          {showQRs && (
                            <div 
                           ref={(el: HTMLDivElement | null) => { printRefs.current[product.id] = el; }}
                              className="flex items-center justify-center p-2 bg-white border border-slate-200 rounded-lg shadow-sm"
                            >
                              <img 
                                src={`https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${encodeURIComponent(`SKU:${product.sku} \vert{} Name:${product.name}`)}`} 
                                alt={`QR for ${product.sku}`} 
                                className="w-16 h-16"
                              />
                            </div>
                          )}
                        </td>

                        {/* THE PRINT ACTION CELL */}
                        <td className={`py-2 px-6 text-right transition-all ${showQRs ? 'opacity-100' : 'w-0 opacity-0 overflow-hidden p-0'}`}>
                          {showQRs && (
                            <button 
                              onClick={() => handlePrintQR(product)} 
                              className="px-4 py-2 bg-slate-900 text-white border border-slate-800 rounded-lg text-[10px] font-black uppercase hover:bg-slate-800 transition-colors shadow-sm"
                            >
                              Print Sticker
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* ADMIN PASSWORD MODAL */}
      {isPasswordModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-black text-slate-900 tracking-tight uppercase">Admin Verification</h3>
              <button onClick={() => setIsPasswordModalOpen(false)} className="text-slate-400 hover:text-slate-700 font-black text-xl">✕</button>
            </div>
            <form onSubmit={handlePasswordSubmit} className="p-6 flex flex-col gap-4">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Enter Admin Password to proceed:</p>
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