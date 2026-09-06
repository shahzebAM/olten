import React from 'react';

export default function CompanyModule({ 
  isGateway, allowedCompanies, hasUsers, onSelectCompany, onManageUsers, onLogout,
  selectedCompany, loginUsername, currentUser, hasPayroll, hasAiDocs, hasProducts,
  onChangeCompany, onSelectModule
}: any) {

  // --- VIEW 1: COMPANY SELECTION ---
  if (!isGateway) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center p-4 sm:p-8 font-sans selection:bg-blue-100">
        
        {/* RESPONSIVE HEADER WITH BOTH BUTTONS */}
        <div className="w-full max-w-5xl flex flex-col md:flex-row justify-between items-start md:items-center gap-5 mb-8 sm:mb-12">
          <div className="w-full md:w-auto">
            <h1 className="text-2xl sm:text-3xl font-black text-blue-950 tracking-tight">Select Organization</h1>
            <p className="text-slate-500 text-sm mt-1">Choose a company workspace to proceed.</p>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto shrink-0">
            {hasUsers && (
              <button onClick={onManageUsers} className="flex-1 sm:flex-none w-full sm:w-auto px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl shadow-sm font-bold transition-colors flex items-center justify-center gap-2 text-sm">
                <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                Manage Users
              </button>
            )}
            <button onClick={onLogout} className="flex-1 sm:flex-none w-full sm:w-auto px-5 py-2.5 bg-white border border-slate-300 text-slate-700 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 rounded-xl shadow-sm font-bold transition-colors text-sm text-center">
              Secure Logout
            </button>
          </div>
        </div>

        {/* COMPANY CARDS GRID */}
        <div className="w-full max-w-5xl grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6">
          {allowedCompanies.Surgicom && (
            <button onClick={() => onSelectCompany('Surgicom')} className="group bg-white p-6 sm:p-8 rounded-2xl shadow-sm border border-slate-200 hover:border-blue-400 hover:shadow-md transition-all text-left flex flex-col justify-between min-h-[160px] sm:min-h-[180px]">
              <div>
                <h2 className="text-xl sm:text-2xl font-black text-blue-950 group-hover:text-blue-700 transition-colors">Surgicom</h2>
                <p className="text-xs sm:text-sm text-slate-500 mt-2 font-medium">Trading Corporation</p>
              </div>
              <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white text-blue-600 transition-colors mt-6">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
              </div>
            </button>
          )}

          {allowedCompanies.Olten && (
            <button onClick={() => onSelectCompany('Olten')} className="group bg-white p-6 sm:p-8 rounded-2xl shadow-sm border border-slate-200 hover:border-indigo-400 hover:shadow-md transition-all text-left flex flex-col justify-between min-h-[160px] sm:min-h-[180px]">
              <div>
                <h2 className="text-xl sm:text-2xl font-black text-indigo-950 group-hover:text-indigo-700 transition-colors">Olten</h2>
                <p className="text-xs sm:text-sm text-slate-500 mt-2 font-medium">Instruments</p>
              </div>
              <div className="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white text-indigo-600 transition-colors mt-6">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
              </div>
            </button>
          )}

          {allowedCompanies.Ordent && (
            <button onClick={() => onSelectCompany('Ordent')} className="group bg-white p-6 sm:p-8 rounded-2xl shadow-sm border border-slate-200 hover:border-amber-400 hover:shadow-md transition-all text-left flex flex-col justify-between min-h-[160px] sm:min-h-[180px]">
              <div>
                <h2 className="text-xl sm:text-2xl font-black text-amber-950 group-hover:text-amber-600 transition-colors">Ordent</h2>
                <p className="text-xs sm:text-sm text-slate-500 mt-2 font-medium">Dental Clinic</p>
              </div>
              <div className="w-8 h-8 rounded-full bg-amber-50 flex items-center justify-center group-hover:bg-amber-500 group-hover:text-white text-amber-600 transition-colors mt-6">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
              </div>
            </button>
          )}
        </div>
      </div>
    );
  }

  // --- VIEW 2: MODULE GATEWAY ---
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center p-4 sm:p-8 font-sans selection:bg-blue-100">
      <div className="w-full max-w-5xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8 sm:mb-12">
        <div className="w-full sm:w-auto">
          <h1 className="text-2xl sm:text-3xl font-black text-blue-950 tracking-tight">{selectedCompany} Workspace</h1>
          <p className="text-slate-500 text-sm mt-1">Logged in as <span className="font-bold text-slate-700">{loginUsername}</span> ({currentUser?.role || 'Admin'})</p>
        </div>
        <div className="flex flex-col sm:flex-row w-full sm:w-auto gap-3 shrink-0">
          <button onClick={onChangeCompany} className="flex-1 sm:flex-none w-full sm:w-auto px-4 sm:px-5 py-2.5 bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-xl shadow-sm font-bold transition-colors text-sm text-center">
            Switch Org
          </button>
          <button onClick={onLogout} className="flex-1 sm:flex-none w-full sm:w-auto px-4 sm:px-5 py-2.5 bg-slate-900 text-white hover:bg-slate-800 rounded-xl shadow-sm font-bold transition-colors text-sm text-center">
            Logout
          </button>
        </div>
      </div>

      <div className="w-full max-w-5xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        
        {/* PRODUCT MODULE (Only renders if active) */}
        {hasProducts && (
          <button onClick={() => onSelectModule('products')} className="group bg-white p-6 sm:p-8 rounded-2xl shadow-sm border border-slate-200 hover:border-purple-400 hover:shadow-md transition-all text-left flex flex-col justify-between min-h-[160px] sm:min-h-[180px]">
            <div>
              <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <svg className="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-purple-950">Product Manager</h2>
              <p className="text-xs sm:text-sm text-slate-500 mt-2 font-medium">Master database of inventory items.</p>
            </div>
          </button>
        )}

        {/* PAYROLL ENGINE (Only renders if active) */}
        {hasPayroll && (
          <button onClick={() => onSelectModule('payroll')} className="group bg-white p-6 sm:p-8 rounded-2xl shadow-sm border border-slate-200 hover:border-emerald-400 hover:shadow-md transition-all text-left flex flex-col justify-between min-h-[160px] sm:min-h-[180px]">
            <div>
              <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-emerald-950">Payroll Engine</h2>
              <p className="text-xs sm:text-sm text-slate-500 mt-2 font-medium">Manage personnel, attendance, & salaries.</p>
            </div>
          </button>
        )}

        {/* AI DOCS (Only renders if active) */}
        {hasAiDocs && (
          <button onClick={() => onSelectModule('ai_docs')} className="group bg-white p-6 sm:p-8 rounded-2xl shadow-sm border border-slate-200 hover:border-indigo-400 hover:shadow-md transition-all text-left flex flex-col justify-between min-h-[160px] sm:min-h-[180px]">
            <div>
              <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-indigo-950">AI Documentation</h2>
              <p className="text-xs sm:text-sm text-slate-500 mt-2 font-medium">Generate letters and corporate documents.</p>
            </div>
          </button>
        )}

        {/* EMPTY STATE FALLBACK (If all modules are disabled/hidden) */}
        {(!hasProducts && !hasPayroll && !hasAiDocs) && (
          <div className="col-span-full bg-white p-10 sm:p-16 rounded-2xl shadow-sm border border-slate-200 border-dashed flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
            </div>
            <h2 className="text-xl font-bold text-slate-700">No Access Granted</h2>
            <p className="text-sm text-slate-500 mt-2 max-w-sm">You currently do not have permission to view any modules in this workspace. Please contact your Super Admin or Developer.</p>
          </div>
        )}
      </div>
    </div>
  );
}