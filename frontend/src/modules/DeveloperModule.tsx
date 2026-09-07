import React from 'react';

export default function DeveloperModule({ onLogout, globalModules, setGlobalModules }: any) {
  
  const handleToggle = (moduleName: string) => {
    const nextState = { ...globalModules, [moduleName]: !globalModules[moduleName] };
    setGlobalModules(nextState);
    localStorage.setItem('dev_global_modules', JSON.stringify(nextState));
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 p-8 flex flex-col items-center font-mono">
      <div className="w-full max-w-2xl">
        <header className="flex justify-between items-center mb-10 pb-4 border-b border-slate-800">
          <div>
            <h1 className="text-2xl font-black text-white tracking-wider text-rose-500">System Developer Mode</h1>
            <p className="text-slate-500 text-sm mt-1">Master kill-switches for application modules.</p>
          </div>
          <button onClick={onLogout} className="px-5 py-2 bg-slate-800 hover:bg-rose-900 hover:text-rose-400 text-white rounded-lg font-bold transition-colors text-sm">
            Exit Dev Mode
          </button>
        </header>

        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-2xl">
          <h2 className="text-lg font-bold text-white mb-6 uppercase tracking-widest text-slate-400 text-xs">Global Module Toggles</h2>
          
          <label className="flex items-center justify-between p-4 rounded-xl bg-slate-900 hover:bg-slate-800 cursor-pointer border border-slate-800 transition-colors">
            <div>
              <div className="font-bold text-white">Payroll Engine</div>
              <div className="text-xs text-slate-500 mt-0.5">Enables/disables the payroll processing system for all companies.</div>
            </div>
            <input type="checkbox" checked={globalModules.payroll} onChange={() => handleToggle('payroll')} className="w-5 h-5 rounded border-slate-700 bg-slate-800 text-rose-500 focus:ring-rose-500 focus:ring-offset-slate-900" />
          </label>

          <label className="flex items-center justify-between p-4 rounded-xl bg-slate-900 hover:bg-slate-800 cursor-pointer border border-slate-800 transition-colors">
            <div>
              <div className="font-bold text-white">AI Documentation</div>
              <div className="text-xs text-slate-500 mt-0.5">Enables/disables the Gemini-powered document generator.</div>
            </div>
            <input type="checkbox" checked={globalModules.ai_docs} onChange={() => handleToggle('ai_docs')} className="w-5 h-5 rounded border-slate-700 bg-slate-800 text-rose-500 focus:ring-rose-500 focus:ring-offset-slate-900" />
          </label>

          <label className="flex items-center justify-between p-4 rounded-xl bg-slate-900 hover:bg-slate-800 cursor-pointer border border-slate-800 transition-colors">
            <div>
              <div className="font-bold text-white">Product Manager</div>
              <div className="text-xs text-slate-500 mt-0.5">Enables/disables the master database for item configuration.</div>
            </div>
            <input type="checkbox" checked={globalModules.products} onChange={() => handleToggle('products')} className="w-5 h-5 rounded border-slate-700 bg-slate-800 text-rose-500 focus:ring-rose-500 focus:ring-offset-slate-900" />
          </label>

          <label className="flex items-center justify-between p-4 rounded-xl bg-slate-900 hover:bg-slate-800 cursor-pointer border border-slate-800 transition-colors">
            <div>
              <div className="font-bold text-white">Inventory Control</div>
              <div className="text-xs text-slate-500 mt-0.5">Enables/disables the stock receipt and issuing module.</div>
            </div>
            <input type="checkbox" checked={globalModules.inventory} onChange={() => handleToggle('inventory')} className="w-5 h-5 rounded border-slate-700 bg-slate-800 text-rose-500 focus:ring-rose-500 focus:ring-offset-slate-900" />
          </label>
        </div>
      </div>
    </div>
  );
}