import React, { useState, useEffect } from 'react';
import AuthModule from './modules/AuthModule';
import CompanyModule from './modules/CompanyModule';
import UserControlModule from './modules/UserControlModule';
import PayrollModule from './modules/PayrollModule';
import AiDocsModule from './modules/AiDocsModule';
import DeveloperModule from './modules/DeveloperModule';

const rawUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
export const API_BASE_URL = rawUrl.endsWith('/') ? rawUrl.slice(0, -1) : rawUrl;

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginUsername, setLoginUsername] = useState('');
  const [activeModule, setActiveModule] = useState<'none' | 'payroll' | 'ai_docs' | 'users'>('none');
  const [selectedCompany, setSelectedCompany] = useState<'Surgicom' | 'Olten' | 'Ordent' | null>(null);
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  
  // Developer's Master Switches
  const [globalModules, setGlobalModules] = useState(() => {
    const saved = localStorage.getItem('dev_global_modules');
    return saved ? JSON.parse(saved) : { payroll: true, ai_docs: true };
  });

  const isDeveloper = loginUsername === 'system_dev';

  // Fetch settings & trigger 3-second live sync loop
  useEffect(() => { fetch(`${API_BASE_URL}/settings`).catch(() => {}); }, []);
  useEffect(() => {
    if (!isAuthenticated || isDeveloper) return;
    fetchAdmins();
    const interval = setInterval(() => { fetchAdmins(); }, 3000);
    return () => clearInterval(interval);
  }, [isAuthenticated, isDeveloper]);

  // UNIFIED LIVE SECURITY WATCHER (Kicks users out instantly if access is revoked)
  useEffect(() => {
    if (!isAuthenticated || adminUsers.length === 0 || isDeveloper) return;
    
    const activeAccount = adminUsers.find((u) => u.username.toLowerCase() === loginUsername.trim().toLowerCase());
    
    // 1. Account Deleted?
    if (!activeAccount) {
      handleLogout();
      return;
    }

    // 2. Company Access Revoked?
    if (activeAccount.role !== 'Super Admin' && selectedCompany && !activeAccount.modules?.companies?.[selectedCompany]) {
      setSelectedCompany(null);
    }

    // 3. Module Access Revoked? (Checks BOTH Developer Global Switch & Super Admin DB Assignment)
    const userHasPayroll = activeAccount.role === 'Super Admin' || activeAccount.modules?.payroll === true;
    const userHasAiDocs = activeAccount.role === 'Super Admin' || activeAccount.modules?.ai_docs === true;
    
    const finalHasPayroll = userHasPayroll && globalModules.payroll;
    const finalHasAiDocs = userHasAiDocs && globalModules.ai_docs;

    if (activeModule === 'payroll' && !finalHasPayroll) setActiveModule('none');
    if (activeModule === 'ai_docs' && !finalHasAiDocs) setActiveModule('none');

  }, [adminUsers, globalModules, selectedCompany, activeModule, isAuthenticated, isDeveloper, loginUsername]);

  // Sync dev config instantly across multiple browser tabs
  useEffect(() => {
    const syncConfig = () => {
      const saved = localStorage.getItem('dev_global_modules');
      if (saved) setGlobalModules(JSON.parse(saved));
    };
    window.addEventListener('storage', syncConfig);
    return () => window.removeEventListener('storage', syncConfig);
  }, []);

  const fetchAdmins = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/admins`);
      if (response.ok) {
        const data = await response.json();
        setAdminUsers(data);
      }
    } catch (error) { console.error("Could not fetch admins"); }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setLoginUsername('');
    setActiveModule('none');
    setSelectedCompany(null);
  };

  const currentUser = adminUsers.find(u => u.username.toLowerCase() === loginUsername.trim().toLowerCase());
  const isCurrentUserSuperAdmin = currentUser?.role === 'Super Admin';
  const hasUsers = isCurrentUserSuperAdmin;

  const allowedCompanies = isCurrentUserSuperAdmin
    ? { Surgicom: true, Olten: true, Ordent: true }
    : (currentUser?.modules?.companies || { Surgicom: false, Olten: false, Ordent: false });

  const isPrivacyRoute = window.location.pathname === '/privacy';

  // --- ROUTING ENGINE ---
  if (!isAuthenticated) return <AuthModule onLoginSuccess={(user: string) => { setIsAuthenticated(true); setLoginUsername(user); }} isPrivacyRoute={isPrivacyRoute} API_BASE_URL={API_BASE_URL} />;
  
  if (isDeveloper) return <DeveloperModule onLogout={handleLogout} globalModules={globalModules} setGlobalModules={setGlobalModules} />;
  
  if (!selectedCompany && activeModule !== 'users') return <CompanyModule isGateway={false} allowedCompanies={allowedCompanies} hasUsers={hasUsers} onSelectCompany={setSelectedCompany} onManageUsers={() => setActiveModule('users')} onLogout={handleLogout} />;

  // Module Gateway (Calculates combined permissions to show/hide module buttons)
  if (activeModule === 'none') {
    const userHasPayroll = isCurrentUserSuperAdmin || currentUser?.modules?.payroll === true;
    const userHasAiDocs = isCurrentUserSuperAdmin || currentUser?.modules?.ai_docs === true;
    
    const finalHasPayroll = userHasPayroll && globalModules.payroll;
    const finalHasAiDocs = userHasAiDocs && globalModules.ai_docs;

    return <CompanyModule isGateway={true} selectedCompany={selectedCompany!} loginUsername={loginUsername} currentUser={currentUser} hasPayroll={finalHasPayroll} hasAiDocs={finalHasAiDocs} onChangeCompany={() => setSelectedCompany(null)} onSelectModule={setActiveModule} onLogout={handleLogout} />;
  }

  // Active Modules
  if (activeModule === 'ai_docs') return <AiDocsModule selectedCompany={selectedCompany!} loginUsername={loginUsername} onBack={() => setActiveModule('none')} />;
  if (activeModule === 'users') return <UserControlModule adminUsers={adminUsers} setAdminUsers={setAdminUsers} fetchAdmins={fetchAdmins} loginUsername={loginUsername} isCurrentUserSuperAdmin={isCurrentUserSuperAdmin} API_BASE_URL={API_BASE_URL} globalModules={globalModules} onBack={() => setActiveModule('none')} onLogout={handleLogout} />;
  if (activeModule === 'payroll') return <PayrollModule selectedCompany={selectedCompany!} loginUsername={loginUsername} API_BASE_URL={API_BASE_URL} onLogout={handleLogout} onBack={() => setActiveModule('none')} />;

  return null;
}