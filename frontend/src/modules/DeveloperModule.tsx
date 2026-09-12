import React, { useState } from 'react';

interface DeveloperModuleProps {
  onLogout: () => void;
  globalModules: Record<string, boolean>;
  setGlobalModules: React.Dispatch<React.SetStateAction<any>>;
}

export default function DeveloperModule({ onLogout, globalModules, setGlobalModules }: DeveloperModuleProps) {
  const [toast, setToast] = useState<string | null>(null);

  // CRITICAL FIX: Fallback to an empty object if globalModules hasn't loaded yet
  const safeModules = globalModules || {};

  const showNotification = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleToggle = (moduleKey: string) => {
    setGlobalModules((prev: any) => {
      // Ensure prev state is not null before copying
      const prevState = prev || {};
      const updated = { ...prevState, [moduleKey]: !prevState[moduleKey] };

      // Sync legacy keys so the Gateway doesn't hide it from standard users
      if (moduleKey === 'master_inventory') {
        updated.inventory = updated.master_inventory;
        updated.products = updated.master_inventory;
        updated.warehouses = updated.master_inventory;
      }

      localStorage.setItem('dev_global_modules', JSON.stringify(updated));
      return updated;
    });

    showNotification(`Updated ${moduleKey.replace('_', ' ').toUpperCase()} status`);
  };

  const handleResetAll = () => {
    const defaults = {
      payroll: true,
      ai_docs: true,
      master_inventory: true,
      inventory: true,  
      products: true,   
      warehouses: true, 
      purchasing: true,
      sales: true
    };
    setGlobalModules(defaults);
    localStorage.setItem('dev_global_modules', JSON.stringify(defaults));
    showNotification("All system modules restored to Active.");
  };

  const moduleDefinitions = [
    {
      key: 'master_inventory',
      label: 'Master Inventory Control',
      description: 'Consolidated master catalog, stock ledger audit, and warehouse facilities.',
      // Safely check properties
      isActive: Boolean(safeModules.master_inventory ?? safeModules.inventory ?? true)
    },
    {
      key: 'purchasing',
      label: 'Purchasing & PO System',
      description: 'Supplier tracking, purchase orders, and wholesale supply procurement.',
      isActive: Boolean(safeModules.purchasing)
    },
    {
      key: 'sales',
      label: 'Sales Orders & Invoicing',
      description: 'Client invoices, wholesale accounts receivable, and order fulfillment.',
      isActive: Boolean(safeModules.sales)
    },
    {
      key: 'payroll',
      label: 'Payroll Engine',
      description: 'Automated time records, salary deductions, PhilHealth, SSS, and Pag-IBIG.',
      isActive: Boolean(safeModules.payroll)
    },
    {
      key: 'ai_docs',
      label: 'AI Document Intelligence',
      description: 'Document uploads, PDF vector scanning, and analytical search.',
      isActive: Boolean(safeModules.ai_docs)
    }
  ];

  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-100 font-sans flex flex-col selection:bg-rose-500 selection:text-white">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 border-2 border-rose-500 text-white px-5 py-3 shadow-[6px_6px_0px_0px_rgba(244,63,94,1)] font-bold text-xs uppercase tracking-wider animate-in fade-in">
          {toast}
        </div>
      )}

      {/* TERMINAL HEADER */}
      <header className="h-20 border-b-2 border-slate-800 bg-slate-900/60 backdrop-blur px-6 sm:px-12 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 bg-rose-500 animate-pulse rounded-full"></div>
          <div>
            <h1 className="text-lg font-black uppercase tracking-widest text-white">System Developer Console</h1>
            <p className="text-[10px] font-mono text-slate-400">Global Feature Gates & Engine Override</p>
          </div>
        </div>
        <button 
          onClick={onLogout}
          className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white font-black uppercase text-xs tracking-wider border-2 border-rose-400 shadow-[4px_4px_0px_0px_rgba(244,63,94,0.4)] transition-all"
        >
          Exit Dev
        </button>
      </header>

      {/* MAIN CONSOLE BODY */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-6 sm:p-12 space-y-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-900 border-2 border-slate-800 p-6">
          <div>
            <h2 className="text-base font-black uppercase tracking-wider text-white">System Runtime Gateways</h2>
            <p className="text-xs text-slate-400 mt-1">Disabling a module here instantly removes it across all workspaces and active user sessions.</p>
          </div>
          <button 
            onClick={handleResetAll}
            className="px-4 py-2 border-2 border-slate-700 hover:border-slate-500 text-slate-300 font-black uppercase text-xs tracking-wider transition-colors"
          >
            Enable All
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {moduleDefinitions.map((item) => (
            <div 
              key={item.key} 
              className={`p-6 border-2 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                item.isActive 
                  ? 'bg-slate-900/80 border-slate-700' 
                  : 'bg-slate-950 border-slate-800 opacity-60'
              }`}
            >
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-black uppercase tracking-wider text-white">{item.label}</h3>
                  <span className={`text-[9px] font-black uppercase px-2 py-0.5 border ${
                    item.isActive 
                      ? 'border-emerald-500 text-emerald-400 bg-emerald-950/30' 
                      : 'border-rose-500 text-rose-400 bg-rose-950/30'
                  }`}>
                    {item.isActive ? 'Active' : 'Disabled'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1 max-w-xl">{item.description}</p>
              </div>

              <button
                onClick={() => handleToggle(item.key)}
                className={`px-6 py-3 font-black uppercase text-xs tracking-wider border-2 transition-all shrink-0 ${
                  item.isActive 
                    ? 'bg-rose-500/10 border-rose-500 text-rose-400 hover:bg-rose-500 hover:text-white' 
                    : 'bg-emerald-500/10 border-emerald-500 text-emerald-400 hover:bg-emerald-500 hover:text-white'
                }`}
              >
                {item.isActive ? 'Turn Off' : 'Turn On'}
              </button>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}