import React, { useState, useEffect } from 'react';
import AuthModule from './modules/AuthModule';
import CompanyModule from './modules/CompanyModule';
import UserControlModule from './modules/UserControlModule';
import PayrollModule from './modules/PayrollModule';
import AiDocsModule from './modules/AiDocsModule';
import DeveloperModule from './modules/DeveloperModule';
import MasterInventory from './modules/MasterInventory';
import OrderSlipsModule from './modules/OrderSlipsModule';

// NEW SPLIT & UNIFIED MODULES
import CustomerModule from './modules/CustomerModule';
import CreateOSModule from './modules/CreateOSModule';
import PurchaseOrdersModule from './modules/PurchaseOrdersModule';
import SupplierModule from './modules/SupplierModule';

const rawUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
export const API_BASE_URL = rawUrl.endsWith('/') ? rawUrl.slice(0, -1) : rawUrl;

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginUsername, setLoginUsername] = useState('');
  
  const [activeModule, setActiveModule] = useState<'none' | 'payroll' | 'ai_docs' | 'products' | 'inventory' | 'warehouses' | 'users' | 'customers' | 'sales_orders' | 'suppliers' | 'purchase_orders' | 'create_os'>('none');
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [targetCustomerId, setTargetCustomerId] = useState<string | null>(null);
  
  const [companiesList, setCompaniesList] = useState<string[]>(['Surgicom', 'Olten', 'Ordent']);

  const [globalModules, setGlobalModules] = useState<any>(() => {
    const saved = localStorage.getItem('dev_global_modules');
    return saved ? JSON.parse(saved) : { payroll: true, ai_docs: true, products: true, inventory: true, warehouses: true, purchasing: true, sales: true };
  });

  const isDeveloper = loginUsername === 'system_dev';

  // --- ONLINE STATUS TRACKER (LOGIN & BROWSER CLOSE) ---
  const currentUser = adminUsers.find(u => u.username.toLowerCase() === loginUsername.trim().toLowerCase());

  useEffect(() => {
    if (isAuthenticated && currentUser?.id && !isDeveloper) {
      fetch(`${API_BASE_URL}/admins/${currentUser.id}/status`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isOnline: true })
      }).catch(() => {});
    }
  }, [isAuthenticated, currentUser?.id, isDeveloper]);

  useEffect(() => {
    const handleUnload = () => {
      if (currentUser?.id) {
        fetch(`${API_BASE_URL}/admins/${currentUser.id}/status`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isOnline: false }), keepalive: true
        }).catch(()=>{});
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [currentUser?.id]);

  // ==========================================
  // REAL-TIME 3-SECOND DEVELOPER SYNC
  // ==========================================
  useEffect(() => {
    const handleStorage = (e: any) => {
      if (e.key === 'dev_global_modules' && e.newValue) {
        setGlobalModules(JSON.parse(e.newValue));
      }
    };
    window.addEventListener('storage', handleStorage);

    const syncInterval = setInterval(() => {
      const saved = localStorage.getItem('dev_global_modules');
      if (saved) {
        const parsed = JSON.parse(saved);
        setGlobalModules((prev: any) => {
          if (JSON.stringify(prev) !== JSON.stringify(parsed)) return parsed;
          return prev;
        });
      }
    }, 3000);

    return () => {
      window.removeEventListener('storage', handleStorage);
      clearInterval(syncInterval);
    };
  }, []);

  useEffect(() => { 
    fetchCompanies();
    fetch(`${API_BASE_URL}/settings`).catch(() => {}); 
  }, []);
  
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

  const handleLogout = async () => {
    if (currentUser?.id) {
      try {
        await fetch(`${API_BASE_URL}/admins/${currentUser.id}/status`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isOnline: false })
        });
      } catch (e) {}
    }
    setIsAuthenticated(false);
    setLoginUsername('');
    setActiveModule('none');
    setSelectedCompany(null);
  };

  const handleAddCompany = async (newCompany: string) => {
    if (!companiesList.includes(newCompany)) {
      try {
        const res = await fetch(`${API_BASE_URL}/companies`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newCompany })
        });
        
        if (!res.ok) {
          alert("Database Error: Could not save the workspace.");
          return; 
        }

        setCompaniesList([...companiesList, newCompany]);
      } catch (e) { 
        alert("Network Error: Could not reach the backend server.");
        console.error(e); 
      }
    }
  };

  const handleRemoveCompany = async (companyToRemove: string) => {
    try {
      await fetch(`${API_BASE_URL}/companies/${companyToRemove}`, { method: 'DELETE' });
      setCompaniesList(companiesList.filter(c => c !== companyToRemove));
      if (selectedCompany === companyToRemove) setSelectedCompany(null);
    } catch (e) { console.error(e); }
  };

  const isCurrentUserSuperAdmin = currentUser?.role === 'Super Admin';
  const hasUsers = isCurrentUserSuperAdmin;

  const allowedCompanies = isCurrentUserSuperAdmin
    ? companiesList.reduce((acc, c) => ({ ...acc, [c]: true }), {})
    : (currentUser?.modules?.companies || {});

  // STRICT ACCESS KICK-OUT LISTENER
  useEffect(() => {
    if (!currentUser && !isCurrentUserSuperAdmin) return;

    if (!isCurrentUserSuperAdmin && selectedCompany && !currentUser.modules?.companies?.[selectedCompany]) {
      setSelectedCompany(null);
      setActiveModule('none');
      return;
    }

    if (activeModule !== 'none' && activeModule !== 'users') {
      const requiredPermission = 
        (activeModule === 'customers' || activeModule === 'sales_orders' || activeModule === 'create_os') ? 'sales' :
        (activeModule === 'suppliers' || activeModule === 'purchase_orders') ? 'purchasing' :
        (activeModule === 'products' || activeModule === 'inventory' || activeModule === 'warehouses') ? 'master_inventory' : 
        activeModule;

      const isGloballyDisabled = globalModules[requiredPermission] === false;
      const isUserDisabled = !isCurrentUserSuperAdmin && currentUser?.modules?.[requiredPermission] === false;
      
      if (isGloballyDisabled || isUserDisabled) {
        setActiveModule('none');
      }
    }
  }, [currentUser, selectedCompany, activeModule, isCurrentUserSuperAdmin, globalModules]);

  const isPrivacyRoute = window.location.pathname === '/privacy';

  if (!isAuthenticated) return <AuthModule onLoginSuccess={(user: string) => { setIsAuthenticated(true); setLoginUsername(user); }} isPrivacyRoute={isPrivacyRoute} API_BASE_URL={API_BASE_URL} />;
  
  if (isDeveloper) return <DeveloperModule onLogout={handleLogout} globalModules={globalModules} setGlobalModules={setGlobalModules} />;
  
  if (!selectedCompany && activeModule !== 'users') return (
    <CompanyModule 
      isGateway={false} allowedCompanies={allowedCompanies} hasUsers={hasUsers} 
      companiesList={companiesList} onAddCompany={handleAddCompany} onRemoveCompany={handleRemoveCompany} 
      onSelectCompany={setSelectedCompany} onManageUsers={() => setActiveModule('users')} onLogout={handleLogout} 
      loginUsername={loginUsername} currentUser={currentUser} API_BASE_URL={API_BASE_URL}
      adminUsers={adminUsers} // <-- FED DIRECTLY FROM THE LIVE POLLING
    />
  );

  if (activeModule === 'none') {
    const userHasPayroll = isCurrentUserSuperAdmin || currentUser?.modules?.payroll === true;
    const userHasAiDocs = isCurrentUserSuperAdmin || currentUser?.modules?.ai_docs === true;
    const userHasProducts = isCurrentUserSuperAdmin || currentUser?.modules?.products === true;
    const userHasInventory = isCurrentUserSuperAdmin || currentUser?.modules?.inventory === true;
    const userHasWarehouses = isCurrentUserSuperAdmin || currentUser?.modules?.warehouses === true;
    const userHasPurchasing = isCurrentUserSuperAdmin || currentUser?.modules?.purchasing === true;
    const userHasSales = isCurrentUserSuperAdmin || currentUser?.modules?.sales === true;
    
    return <CompanyModule 
      isGateway={true} selectedCompany={selectedCompany!} loginUsername={loginUsername} currentUser={currentUser} 
      hasPayroll={userHasPayroll && globalModules.payroll} hasAiDocs={userHasAiDocs && globalModules.ai_docs} 
      hasProducts={userHasProducts && globalModules.products} hasInventory={userHasInventory && globalModules.inventory} 
      hasWarehouses={userHasWarehouses && globalModules.warehouses} hasPurchasing={userHasPurchasing && globalModules.purchasing}
      hasSales={userHasSales && globalModules.sales}
      onChangeCompany={() => setSelectedCompany(null)} onSelectModule={setActiveModule} onLogout={handleLogout} API_BASE_URL={API_BASE_URL}
      adminUsers={adminUsers} // <-- FED DIRECTLY FROM THE LIVE POLLING
    />
  }

  // ALL MODULE ROUTES
  if (activeModule === 'customers') return <CustomerModule selectedCompany={selectedCompany!} loginUsername={loginUsername} API_BASE_URL={API_BASE_URL} onBack={() => setActiveModule('none')} onRouteToOrderSlip={(id: string) => { setTargetCustomerId(id); setActiveModule('create_os'); }} />;
  if (activeModule === 'create_os') return <CreateOSModule selectedCompany={selectedCompany!} loginUsername={loginUsername} API_BASE_URL={API_BASE_URL} initialCustomerId={targetCustomerId} onBack={() => { setActiveModule('none'); setTargetCustomerId(null); }} onViewLedger={() => setActiveModule('sales_orders')} />;
  if (activeModule === 'products' || activeModule === 'inventory' || activeModule === 'warehouses') return <MasterInventory selectedCompany={selectedCompany!} loginUsername={loginUsername} API_BASE_URL={API_BASE_URL} onLogout={handleLogout} onBack={() => setActiveModule('none')} />;
  if (activeModule === 'ai_docs') return <AiDocsModule selectedCompany={selectedCompany!} loginUsername={loginUsername} API_BASE_URL={API_BASE_URL} onBack={() => setActiveModule('none')} />;
  if (activeModule === 'payroll') return <PayrollModule selectedCompany={selectedCompany!} loginUsername={loginUsername} API_BASE_URL={API_BASE_URL} onLogout={handleLogout} onBack={() => setActiveModule('none')} />;
  if (activeModule === 'sales_orders') return <OrderSlipsModule selectedCompany={selectedCompany!} loginUsername={loginUsername} API_BASE_URL={API_BASE_URL} onBack={() => setActiveModule('none')} onCreateNew={() => setActiveModule('create_os')} />;
  if (activeModule === 'purchase_orders') return <PurchaseOrdersModule selectedCompany={selectedCompany!} loginUsername={loginUsername} API_BASE_URL={API_BASE_URL} onBack={() => setActiveModule('none')} />;
  if (activeModule === 'suppliers') return <SupplierModule selectedCompany={selectedCompany!} loginUsername={loginUsername} API_BASE_URL={API_BASE_URL} onBack={() => setActiveModule('none')} />;

  if (activeModule === 'users') return (
    <UserControlModule 
      adminUsers={adminUsers} setAdminUsers={setAdminUsers} fetchAdmins={fetchAdmins} loginUsername={loginUsername} 
      isCurrentUserSuperAdmin={isCurrentUserSuperAdmin} API_BASE_URL={API_BASE_URL} globalModules={globalModules} 
      companiesList={companiesList} onBack={() => setActiveModule('none')} onLogout={handleLogout} 
    />
  );

  return null;
}