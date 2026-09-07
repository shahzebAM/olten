import React, { useState, useEffect } from 'react';
import InventoryModule from './modules/InventoryModule';
import AuthModule from './modules/AuthModule';
import CompanyModule from './modules/CompanyModule';
import UserControlModule from './modules/UserControlModule';
import PayrollModule from './modules/PayrollModule';
import AiDocsModule from './modules/AiDocsModule';
import DeveloperModule from './modules/DeveloperModule';
import ProductModule from './modules/ProductModule';
import WarehouseModule from './modules/WarehouseModule';

const rawUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
export const API_BASE_URL = rawUrl.endsWith('/') ? rawUrl.slice(0, -1) : rawUrl;

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginUsername, setLoginUsername] = useState('');
  
  const [activeModule, setActiveModule] = useState<'none' | 'payroll' | 'ai_docs' | 'products' | 'inventory' | 'warehouses' | 'users'>('none');
  const [selectedCompany, setSelectedCompany] = useState<'Surgicom' | 'Olten' | 'Ordent' | null>(null);
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  
  const [globalModules, setGlobalModules] = useState(() => {
    const saved = localStorage.getItem('dev_global_modules');
    return saved ? JSON.parse(saved) : { payroll: true, ai_docs: true, products: true, inventory: true, warehouses: true };
  });

  const isDeveloper = loginUsername === 'system_dev';

  useEffect(() => { fetch(`${API_BASE_URL}/settings`).catch(() => {}); }, []);
  useEffect(() => {
    if (!isAuthenticated || isDeveloper) return;
    fetchAdmins();
    const interval = setInterval(() => { fetchAdmins(); }, 3000);
    return () => clearInterval(interval);
  }, [isAuthenticated, isDeveloper]);

  useEffect(() => {
    if (!isAuthenticated || adminUsers.length === 0 || isDeveloper) return;
    
    const activeAccount = adminUsers.find((u) => u.username.toLowerCase() === loginUsername.trim().toLowerCase());
    if (!activeAccount) { handleLogout(); return; }

    if (activeAccount.role !== 'Super Admin' && selectedCompany && !activeAccount.modules?.companies?.[selectedCompany]) {
      setSelectedCompany(null);
    }

    const userHasPayroll = activeAccount.role === 'Super Admin' || activeAccount.modules?.payroll === true;
    const userHasAiDocs = activeAccount.role === 'Super Admin' || activeAccount.modules?.ai_docs === true;
    const userHasProducts = activeAccount.role === 'Super Admin' || activeAccount.modules?.products === true;
    const userHasInventory = activeAccount.role === 'Super Admin' || activeAccount.modules?.inventory === true;
    const userHasWarehouses = activeAccount.role === 'Super Admin' || activeAccount.modules?.warehouses === true;
    
    const finalHasPayroll = userHasPayroll && globalModules.payroll;
    const finalHasAiDocs = userHasAiDocs && globalModules.ai_docs;
    const finalHasProducts = userHasProducts && globalModules.products;
    const finalHasInventory = userHasInventory && globalModules.inventory;
    const finalHasWarehouses = userHasWarehouses && globalModules.warehouses;

    if (activeModule === 'payroll' && !finalHasPayroll) setActiveModule('none');
    if (activeModule === 'ai_docs' && !finalHasAiDocs) setActiveModule('none');
    if (activeModule === 'products' && !finalHasProducts) setActiveModule('none');
    if (activeModule === 'inventory' && !finalHasInventory) setActiveModule('none');
    if (activeModule === 'warehouses' && !finalHasWarehouses) setActiveModule('none');

  }, [adminUsers, globalModules, selectedCompany, activeModule, isAuthenticated, isDeveloper, loginUsername]);

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

  if (!isAuthenticated) return <AuthModule onLoginSuccess={(user: string) => { setIsAuthenticated(true); setLoginUsername(user); }} isPrivacyRoute={isPrivacyRoute} API_BASE_URL={API_BASE_URL} />;
  if (isDeveloper) return <DeveloperModule onLogout={handleLogout} globalModules={globalModules} setGlobalModules={setGlobalModules} />;
  if (!selectedCompany && activeModule !== 'users') return <CompanyModule isGateway={false} allowedCompanies={allowedCompanies} hasUsers={hasUsers} onSelectCompany={setSelectedCompany} onManageUsers={() => setActiveModule('users')} onLogout={handleLogout} />;

  if (activeModule === 'none') {
    const userHasPayroll = isCurrentUserSuperAdmin || currentUser?.modules?.payroll === true;
    const userHasAiDocs = isCurrentUserSuperAdmin || currentUser?.modules?.ai_docs === true;
    const userHasProducts = isCurrentUserSuperAdmin || currentUser?.modules?.products === true;
    const userHasInventory = isCurrentUserSuperAdmin || currentUser?.modules?.inventory === true;
    const userHasWarehouses = isCurrentUserSuperAdmin || currentUser?.modules?.warehouses === true;
    
    const finalHasPayroll = userHasPayroll && globalModules.payroll;
    const finalHasAiDocs = userHasAiDocs && globalModules.ai_docs;
    const finalHasProducts = userHasProducts && globalModules.products;
    const finalHasInventory = userHasInventory && globalModules.inventory;
    const finalHasWarehouses = userHasWarehouses && globalModules.warehouses;

    return <CompanyModule isGateway={true} selectedCompany={selectedCompany!} loginUsername={loginUsername} currentUser={currentUser} hasPayroll={finalHasPayroll} hasAiDocs={finalHasAiDocs} hasProducts={finalHasProducts} hasInventory={finalHasInventory} hasWarehouses={finalHasWarehouses} onChangeCompany={() => setSelectedCompany(null)} onSelectModule={setActiveModule} onLogout={handleLogout} />;
  }

  if (activeModule === 'warehouses') return <WarehouseModule selectedCompany={selectedCompany!} loginUsername={loginUsername} API_BASE_URL={API_BASE_URL} onLogout={handleLogout} onBack={() => setActiveModule('none')} />;
  if (activeModule === 'inventory') return <InventoryModule selectedCompany={selectedCompany!} loginUsername={loginUsername} API_BASE_URL={API_BASE_URL} onLogout={handleLogout} onBack={() => setActiveModule('none')} />;
  if (activeModule === 'products') return <ProductModule selectedCompany={selectedCompany!} loginUsername={loginUsername} API_BASE_URL={API_BASE_URL} onLogout={handleLogout} onBack={() => setActiveModule('none')} />;
  if (activeModule === 'ai_docs') return <AiDocsModule selectedCompany={selectedCompany!} loginUsername={loginUsername} onBack={() => setActiveModule('none')} />;
  if (activeModule === 'users') return <UserControlModule adminUsers={adminUsers} setAdminUsers={setAdminUsers} fetchAdmins={fetchAdmins} loginUsername={loginUsername} isCurrentUserSuperAdmin={isCurrentUserSuperAdmin} API_BASE_URL={API_BASE_URL} globalModules={globalModules} onBack={() => setActiveModule('none')} onLogout={handleLogout} />;
  if (activeModule === 'payroll') return <PayrollModule selectedCompany={selectedCompany!} loginUsername={loginUsername} API_BASE_URL={API_BASE_URL} onLogout={handleLogout} onBack={() => setActiveModule('none')} />;

  return null;
}