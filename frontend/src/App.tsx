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
  
  // Replaced localStorage with state to be populated by DB
  const [companiesList, setCompaniesList] = useState<string[]>(['Surgicom', 'Olten', 'Ordent']);

  const [globalModules, setGlobalModules] = useState(() => {
    const saved = localStorage.getItem('dev_global_modules');
    return saved ? JSON.parse(saved) : { payroll: true, ai_docs: true, products: true, inventory: true, warehouses: true, purchasing: true };
  });

  const isDeveloper = loginUsername === 'system_dev';

  useEffect(() => { 
    fetchCompanies();
    fetch(`${API_BASE_URL}/settings`).catch(() => {}); 
  }, []);
  
  // Background polling now fetches both users and companies to keep devices synced
  useEffect(() => {
    if (!isAuthenticated || isDeveloper) return;
    fetchAdmins();
    const interval = setInterval(() => { 
      fetchAdmins(); 
      fetchCompanies(); 
    }, 3000);
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

  const fetchCompanies = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/companies`);
      if (res.ok) {
        const data = await res.json();
        if (data.length > 0) {
          setCompaniesList(data.map((c: any) => c.name));
        } else {
          // Auto-seed database if it is brand new and completely empty
          await Promise.all([
            fetch(`${API_BASE_URL}/companies`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Surgicom' }) }),
            fetch(`${API_BASE_URL}/companies`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Olten' }) }),
            fetch(`${API_BASE_URL}/companies`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Ordent' }) })
          ]);
          const newRes = await fetch(`${API_BASE_URL}/companies`);
          const newData = await newRes.json();
          setCompaniesList(newData.map((c: any) => c.name));
        }
      }
    } catch (e) { console.error("Could not fetch companies"); }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setLoginUsername('');
    setActiveModule('none');
    setSelectedCompany(null);
  };

  const handleAddCompany = async (newCompany: string) => {
    if (!companiesList.includes(newCompany)) {
      try {
        await fetch(`${API_BASE_URL}/companies`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newCompany })
        });
        setCompaniesList([...companiesList, newCompany]);
      } catch (e) { console.error(e); }
    }
  };

  const handleRemoveCompany = async (companyToRemove: string) => {
    try {
      await fetch(`${API_BASE_URL}/companies/${companyToRemove}`, { method: 'DELETE' });
      setCompaniesList(companiesList.filter(c => c !== companyToRemove));
      if (selectedCompany === companyToRemove) setSelectedCompany(null);
    } catch (e) { console.error(e); }
  };

  const currentUser = adminUsers.find(u => u.username.toLowerCase() === loginUsername.trim().toLowerCase());
  const isCurrentUserSuperAdmin = currentUser?.role === 'Super Admin';
  const hasUsers = isCurrentUserSuperAdmin;

  const allowedCompanies = isCurrentUserSuperAdmin
    ? companiesList.reduce((acc, c) => ({ ...acc, [c]: true }), {})
    : (currentUser?.modules?.companies || {});

  useEffect(() => {
    if (!isCurrentUserSuperAdmin && currentUser) {
      if (selectedCompany && !currentUser.modules?.companies?.[selectedCompany]) {
        setSelectedCompany(null);
        setActiveModule('none');
      }
      else if (activeModule !== 'none' && activeModule !== 'users') {
        if (currentUser.modules && currentUser.modules[activeModule] === false) {
          setActiveModule('none');
        }
      }
    }
  }, [currentUser, selectedCompany, activeModule, isCurrentUserSuperAdmin]);

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