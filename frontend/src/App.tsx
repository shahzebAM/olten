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
import PurchasingModule from './modules/PurchasingModule';

const rawUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
export const API_BASE_URL = rawUrl.endsWith('/') ? rawUrl.slice(0, -1) : rawUrl;

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginUsername, setLoginUsername] = useState('');
  
  const [activeModule, setActiveModule] = useState<'none' | 'payroll' | 'ai_docs' | 'products' | 'inventory' | 'warehouses' | 'users' | 'purchasing'>('none');
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  
  const [companiesList, setCompaniesList] = useState<string[]>(() => {
    const saved = localStorage.getItem('companies_list');
    return saved ? JSON.parse(saved) : ['Surgicom', 'Olten', 'Ordent'];
  });

  const [globalModules, setGlobalModules] = useState(() => {
    const saved = localStorage.getItem('dev_global_modules');
    return saved ? JSON.parse(saved) : { payroll: true, ai_docs: true, products: true, inventory: true, warehouses: true, purchasing: true };
  });

  const isDeveloper = loginUsername === 'system_dev';

  useEffect(() => { fetch(`${API_BASE_URL}/settings`).catch(() => {}); }, []);
  useEffect(() => {
    if (!isAuthenticated || isDeveloper) return;
    fetchAdmins();
    const interval = setInterval(() => { fetchAdmins(); }, 3000);
    return () => clearInterval(interval);
  }, [isAuthenticated, isDeveloper]);

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

  const handleAddCompany = (newCompany: string) => {
    if (!companiesList.includes(newCompany)) {
      const updated = [...companiesList, newCompany];
      setCompaniesList(updated);
      localStorage.setItem('companies_list', JSON.stringify(updated));
    }
  };

  const handleRemoveCompany = (companyToRemove: string) => {
    const updated = companiesList.filter(c => c !== companyToRemove);
    setCompaniesList(updated);
    localStorage.setItem('companies_list', JSON.stringify(updated));
    if (selectedCompany === companyToRemove) setSelectedCompany(null);
  };

  const currentUser = adminUsers.find(u => u.username.toLowerCase() === loginUsername.trim().toLowerCase());
  const isCurrentUserSuperAdmin = currentUser?.role === 'Super Admin';
  const hasUsers = isCurrentUserSuperAdmin;

  const allowedCompanies = isCurrentUserSuperAdmin
    ? companiesList.reduce((acc, c) => ({ ...acc, [c]: true }), {})
    : (currentUser?.modules?.companies || {});

  const isPrivacyRoute = window.location.pathname === '/privacy';

  if (!isAuthenticated) return <AuthModule onLoginSuccess={(user: string) => { setIsAuthenticated(true); setLoginUsername(user); }} isPrivacyRoute={isPrivacyRoute} API_BASE_URL={API_BASE_URL} />;
  if (isDeveloper) return <DeveloperModule onLogout={handleLogout} globalModules={globalModules} setGlobalModules={setGlobalModules} />;
  
  if (!selectedCompany && activeModule !== 'users') return (
    <CompanyModule 
      isGateway={false} allowedCompanies={allowedCompanies} hasUsers={hasUsers} 
      companiesList={companiesList} onAddCompany={handleAddCompany} onRemoveCompany={handleRemoveCompany} 
      onSelectCompany={setSelectedCompany} onManageUsers={() => setActiveModule('users')} onLogout={handleLogout} 
    />
  );

  if (activeModule === 'none') {
    const userHasPayroll = isCurrentUserSuperAdmin || currentUser?.modules?.payroll === true;
    const userHasAiDocs = isCurrentUserSuperAdmin || currentUser?.modules?.ai_docs === true;
    const userHasProducts = isCurrentUserSuperAdmin || currentUser?.modules?.products === true;
    const userHasInventory = isCurrentUserSuperAdmin || currentUser?.modules?.inventory === true;
    const userHasWarehouses = isCurrentUserSuperAdmin || currentUser?.modules?.warehouses === true;
    const userHasPurchasing = isCurrentUserSuperAdmin || currentUser?.modules?.purchasing === true;
    
    return <CompanyModule 
      isGateway={true} selectedCompany={selectedCompany!} loginUsername={loginUsername} currentUser={currentUser} 
      hasPayroll={userHasPayroll && globalModules.payroll} hasAiDocs={userHasAiDocs && globalModules.ai_docs} 
      hasProducts={userHasProducts && globalModules.products} hasInventory={userHasInventory && globalModules.inventory} 
      hasWarehouses={userHasWarehouses && globalModules.warehouses} hasPurchasing={userHasPurchasing && globalModules.purchasing}
      onChangeCompany={() => setSelectedCompany(null)} onSelectModule={setActiveModule} onLogout={handleLogout} 
    />;
  }

  if (activeModule === 'purchasing') return <PurchasingModule selectedCompany={selectedCompany!} loginUsername={loginUsername} API_BASE_URL={API_BASE_URL} onLogout={handleLogout} onBack={() => setActiveModule('none')} />;
  if (activeModule === 'warehouses') return <WarehouseModule selectedCompany={selectedCompany!} loginUsername={loginUsername} API_BASE_URL={API_BASE_URL} onLogout={handleLogout} onBack={() => setActiveModule('none')} />;
  if (activeModule === 'inventory') return <InventoryModule selectedCompany={selectedCompany!} loginUsername={loginUsername} API_BASE_URL={API_BASE_URL} onLogout={handleLogout} onBack={() => setActiveModule('none')} />;
  if (activeModule === 'products') return <ProductModule selectedCompany={selectedCompany!} loginUsername={loginUsername} API_BASE_URL={API_BASE_URL} onLogout={handleLogout} onBack={() => setActiveModule('none')} />;
  if (activeModule === 'ai_docs') return <AiDocsModule selectedCompany={selectedCompany!} loginUsername={loginUsername} onBack={() => setActiveModule('none')} />;
  if (activeModule === 'payroll') return <PayrollModule selectedCompany={selectedCompany!} loginUsername={loginUsername} API_BASE_URL={API_BASE_URL} onLogout={handleLogout} onBack={() => setActiveModule('none')} />;
  
  if (activeModule === 'users') return (
    <UserControlModule 
      adminUsers={adminUsers} setAdminUsers={setAdminUsers} fetchAdmins={fetchAdmins} loginUsername={loginUsername} 
      isCurrentUserSuperAdmin={isCurrentUserSuperAdmin} API_BASE_URL={API_BASE_URL} globalModules={globalModules} 
      companiesList={companiesList} 
      onBack={() => setActiveModule('none')} onLogout={handleLogout} 
    />
  );

  return null;
}