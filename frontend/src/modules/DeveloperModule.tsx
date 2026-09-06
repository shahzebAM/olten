import React, { useState } from 'react';

export default function DeveloperModule({ onLogout, globalModules, setGlobalModules }: any) {
  const [localConfig, setLocalConfig] = useState(globalModules);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => { setToast(null); }, 3000);
  };

  const handleToggle = (module: string) => {
    setLocalConfig((prev: any) => ({
      ...prev,
      [module]: !prev[module]
    }));
  };

  const saveConfiguration = () => {
    localStorage.setItem('dev_global_modules', JSON.stringify(localConfig));
    setGlobalModules(localConfig);
    showToast("Global system modules committed instantly.", "success");
  };

  return (
    <div className="min-h-screen bg-slate-950 text-emerald-400 font-mono flex flex-col p-4 sm:p-6 lg:p-12 selection:bg-emerald-900">
      
      {toast && (
        <div className="fixed top-4 right-4 sm:top-6 sm:right-6 z-50 px-5 py-3 border border-emerald-500 bg-emerald-950/90 text-emerald-400 text-sm font-bold shadow-[0_0_15px_rgba(16,185,129,0.2)] rounded">
          {toast.message}
        </div>
      )}

      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 border-b border-slate-800 pb-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black uppercase tracking-widest text-emerald-500 drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]">System Override</h1>
          <p className="text-[10px] sm:text-xs text-slate-500 mt-2 uppercase tracking-[0.2em]">Master Module Distribution</p>
        </div>
        <button onClick={onLogout} className="w-full sm:w-auto px-5 py-3 sm:py-2 text-xs font-bold uppercase tracking-widest border border-rose-500/50 text-rose-500 hover:bg-rose-500 hover:text-white transition-colors text-center">
          Terminate Session
        </button>
      </header>

      <div className="flex-1 w-full max-w-3xl mx-auto flex flex-col justify-center">
        <div className="bg-slate-900 border border-slate-800 shadow-2xl relative overflow-hidden flex flex-col w-full">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-transparent opacity-50"></div>

          <div className="p-6 sm:p-8 lg:p-12 flex-1 w-full">
            <h2 className="text-xs sm:text-sm font-bold text-white mb-6 sm:mb-8 border-b border-slate-800 pb-4 flex items-center gap-3 uppercase tracking-widest">
              <span className="w-2 h-2 bg-emerald-500 animate-pulse inline-block shrink-0"></span>
              Global Application Features
            </h2>

            <div className="flex flex-col gap-4 sm:gap-5 w-full">
              <label className="flex flex-row items-center justify-between cursor-pointer group bg-slate-950 px-4 sm:px-6 py-4 sm:py-5 border border-slate-800 hover:border-slate-700 transition-colors w-full">
                <span className="text-sm sm:text-lg font-black text-slate-300 group-hover:text-emerald-400 transition-colors tracking-widest uppercase">Payroll Engine</span>
                <input 
                  type="checkbox" 
                  checked={localConfig.payroll} 
                  onChange={() => handleToggle('payroll')}
                  className="w-5 h-5 sm:w-6 sm:h-6 accent-emerald-500 bg-slate-800 border-slate-700 cursor-pointer shrink-0 ml-4"
                />
              </label>

              <label className="flex flex-row items-center justify-between cursor-pointer group bg-slate-950 px-4 sm:px-6 py-4 sm:py-5 border border-slate-800 hover:border-slate-700 transition-colors w-full">
                <span className="text-sm sm:text-lg font-black text-slate-300 group-hover:text-emerald-400 transition-colors tracking-widest uppercase">AI Documentation</span>
                <input 
                  type="checkbox" 
                  checked={localConfig.ai_docs} 
                  onChange={() => handleToggle('ai_docs')}
                  className="w-5 h-5 sm:w-6 sm:h-6 accent-emerald-500 bg-slate-800 border-slate-700 cursor-pointer shrink-0 ml-4"
                />
              </label>
            </div>
          </div>

          <div className="p-6 sm:p-10 bg-slate-950 border-t border-slate-800 flex justify-center sm:justify-end shrink-0 w-full">
            <button onClick={saveConfiguration} className="w-full sm:w-auto px-6 sm:px-10 py-4 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black text-xs sm:text-sm uppercase tracking-[0.15em] transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)] text-center">
              Commit Configuration
            </button>
          </div>
          
        </div>
      </div>
    </div>
  );
}