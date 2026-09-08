import React, { useState } from 'react';

export default function DeveloperModule({ onLogout, globalModules, setGlobalModules }: any) {
  const [toast, setToast] = useState<{ message: string } | null>(null);

  const toggleModule = (key: string) => {
    const updated = { ...globalModules, [key]: !globalModules[key] };
    setGlobalModules(updated);
    localStorage.setItem('dev_global_modules', JSON.stringify(updated));
    setToast({ message: `System Module: ${key.toUpperCase()} is now ${updated[key] ? 'ENABLED' : 'DISABLED'}.` });
    setTimeout(() => setToast(null), 3000);
  };

  const systemModules = [
    { id: 'purchasing', name: 'Procurement Engine', desc: 'Supplier and PO Management', icon: 'M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z', color: 'text-amber-600', bg: 'bg-amber-100', border: 'border-amber-200' },
    { id: 'products', name: 'Product Manager', desc: 'Master SKUs and Pricing', icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4', color: 'text-purple-600', bg: 'bg-purple-100', border: 'border-purple-200' },
    { id: 'inventory', name: 'Inventory Control', desc: 'Stock Ledger and Adjustments', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2', color: 'text-sky-600', bg: 'bg-sky-100', border: 'border-sky-200' },
    { id: 'warehouses', name: 'Multi-Warehouse', desc: 'Hub Routing and Transfers', icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4', color: 'text-teal-600', bg: 'bg-teal-100', border: 'border-teal-200' },
    { id: 'payroll', name: 'Payroll Engine', desc: 'Salaries and Deductions', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z', color: 'text-indigo-600', bg: 'bg-indigo-100', border: 'border-indigo-200' },
    { id: 'ai_docs', name: 'AI Docs Engine', desc: 'Automated Document Generation', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', color: 'text-rose-600', bg: 'bg-rose-100', border: 'border-rose-200' }
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-300 flex flex-col font-mono selection:bg-slate-700">
      
      {toast && (
        <div className="fixed top-6 right-6 z-50 px-5 py-3.5 rounded-xl shadow-2xl font-bold flex items-center gap-3 animate-in slide-in-from-top-4 fade-in bg-slate-800 text-emerald-400 border border-slate-700">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
          {toast.message}
        </div>
      )}

      <header className="bg-slate-900 border-b border-slate-800 px-6 sm:px-10 py-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black text-white tracking-widest uppercase">System Developer Console</h1>
          <p className="text-slate-500 text-xs mt-1">Global Feature Flags & Module Configuration</p>
        </div>
        <button onClick={onLogout} className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-bold transition-colors border border-slate-700">Exit Console</button>
      </header>

      <main className="flex-1 p-6 sm:p-10 max-w-7xl mx-auto w-full">
        <div className="mb-8 border-l-4 border-amber-500 bg-amber-500/10 p-4 rounded-r-lg">
          <h2 className="text-amber-500 font-bold uppercase tracking-widest text-sm mb-1">Global Module State</h2>
          <p className="text-slate-400 text-xs leading-relaxed">Changes made here globally mount or unmount core business logic modules across the entire SaaS infrastructure. Disabling a module removes it from all workspaces instantly.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {systemModules.map((mod) => {
            const isEnabled = globalModules[mod.id];
            
            return (
              <div key={mod.id} className={`p-6 rounded-2xl border transition-all duration-300 ${isEnabled ? 'bg-slate-900 border-slate-700' : 'bg-slate-900/40 border-slate-800/50 grayscale opacity-60'}`}>
                <div className="flex justify-between items-start mb-6">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${isEnabled ? `${mod.bg} ${mod.color} ${mod.border}` : 'bg-slate-800 text-slate-500 border-slate-700'}`}>
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d={mod.icon} /></svg>
                  </div>
                  
                  {/* Toggle Switch */}
                  <button 
                    onClick={() => toggleModule(mod.id)} 
                    className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors duration-300 ${isEnabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
                  >
                    <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform duration-300 ${isEnabled ? 'translate-x-8' : 'translate-x-1'}`} />
                  </button>
                </div>
                
                <h3 className={`text-lg font-bold ${isEnabled ? 'text-white' : 'text-slate-500'}`}>{mod.name}</h3>
                <p className="text-xs text-slate-400 mt-1">{mod.desc}</p>
                
                <div className="mt-6 pt-4 border-t border-slate-800 flex justify-between items-center text-[10px] font-bold uppercase tracking-widest">
                  <span className="text-slate-500">Status</span>
                  <span className={isEnabled ? 'text-emerald-400' : 'text-rose-500'}>{isEnabled ? 'Mounted' : 'Unmounted'}</span>
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}