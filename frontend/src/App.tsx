import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import AuthModule from './modules/AuthModule';
import CompanyModule from './modules/CompanyModule';
import UserControlModule from './modules/UserControlModule';
import PayrollModule from './modules/PayrollModule';
import AiDocsModule from './modules/AiDocsModule';
import MasterInventory from './modules/MasterInventory';
import OrderSlipsModule from './modules/OrderSlipsModule';
import ProductQRModule from './modules/ProductQRModule';
import ErpShell from './components/ErpShell';
import { normalizeWorkspaceMenuGroups, workspaceTitle } from './lib/workspaceNavigation';
import type { WorkspaceMenuGroup } from './lib/workspaceNavigation';
import './erp.css';

// NEW SPLIT & UNIFIED MODULES
import CustomerModule from './modules/CustomerModule';
import CreateOSModule from './modules/CreateOSModule';
import PurchaseOrdersModule from './modules/PurchaseOrdersModule';
import SupplierModule from './modules/SupplierModule';
import ImportationModule from './modules/ImportationModule';
import FulfillmentModule from './modules/FulfillmentModule';
import { hasPhase3Access, phase3Scope } from './lib/phase3Access';
import type { Phase3View } from './lib/phase3Access';
import { resolveApiConfig } from './lib/apiConfig';
import { clearApiSession, getApiAuthHeaders, expireApiSession } from './lib/apiSession';

const apiConfig = resolveApiConfig(import.meta.env.VITE_API_BASE_URL, import.meta.env.DEV);
export const API_BASE_URL = apiConfig.baseUrl;
const Phase3Module = lazy(() => import('./modules/Phase3Module'));

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginUsername, setLoginUsername] = useState('');
  const [loginNotice, setLoginNotice] = useState('');
  
const [activeModule, setActiveModule] = useState<'none' | 'payroll' | 'ai_docs' | 'products' | 'inventory' | 'warehouses' | 'users' | 'customers' | 'sales_orders' | 'suppliers' | 'purchase_orders' | 'create_os' | 'qr_system' | 'importation' | 'warehouse_ops' | 'customer_pos' | 'deliveries' | Phase3View>('none');
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [targetCustomerId, setTargetCustomerId] = useState<string | null>(null);
  const [invoiceDeliveryId, setInvoiceDeliveryId] = useState<string | undefined>();
  
  const [companiesList, setCompaniesList] = useState<string[]>(['Surgicom', 'Olten', 'Ordent']);

  const [globalModules, setGlobalModules] = useState<any>(() => {
    const saved = localStorage.getItem('dev_global_modules');
    return saved ? JSON.parse(saved) : { payroll: true, ai_docs: true, products: true, inventory: true, warehouses: true, purchasing: true, sales: true };
  });

  const [syncError, setSyncError] = useState('');
  const mountedRef = useRef(true);
  const authRef = useRef({ isAuthenticated, loginUsername });
  authRef.current = { isAuthenticated, loginUsername };
  const readsRef = useRef<Partial<Record<'admins' | 'companies', Promise<boolean>>>>({});
  const companyListVersionRef = useRef(0);
  const companyDeletesRef = useRef(new Map<string, Promise<void>>());
  const selectedCompanyRef = useRef(selectedCompany);
  selectedCompanyRef.current = selectedCompany;
  const controllersRef = useRef(new Set<AbortController>());
  const retrySyncRef = useRef<() => void>(() => {});

  useEffect(() => {
    mountedRef.current = true;
    const onSessionExpired = () => {
      setIsAuthenticated(false);
      setLoginUsername('');
      setAdminUsers([]);
      setActiveModule('none');
      setSelectedCompany(null);
      setSyncError('');
      setLoginNotice('Your session has expired. Please log in again.');
    };
    window.addEventListener('olten-session-expired', onSessionExpired);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('olten-session-expired', onSessionExpired);
      controllersRef.current.forEach(controller => controller.abort());
    };
  }, []);

  // --- ONLINE STATUS TRACKER (LOGIN & BROWSER CLOSE) ---
  const currentUser = adminUsers.find(u => u.username.toLowerCase() === loginUsername.trim().toLowerCase());

  const [navigation, setNavigation] = useState<{
    company: string | null; groups: WorkspaceMenuGroup[] | null; version: number; revision: number; error: string;
  }>({ company: null, groups: null, version: 0, revision: -1, error: '' });
  const [navigationRevision, setNavigationRevision] = useState(0);
  useEffect(() => {
    if (!isAuthenticated || !selectedCompany || !currentUser?.id) return;
    const controller = new AbortController();
    const company = selectedCompany;
    const headers = getApiAuthHeaders();
    const username = authRef.current.loginUsername;
    const isCurrent = () => !controller.signal.aborted && mountedRef.current && selectedCompanyRef.current === company
      && authRef.current.isAuthenticated && authRef.current.loginUsername === username
      && getApiAuthHeaders().Authorization === headers.Authorization;
    void (async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/companies/navigation?company=${encodeURIComponent(company)}`, { headers, signal: controller.signal });
        if (response.status === 401 && getApiAuthHeaders().Authorization === headers.Authorization) expireApiSession();
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(response.status === 404
          ? 'Menu settings are unavailable on this backend version. Deploy the matching backend before customizing the menu.'
          : result?.message || 'Could not load the company menu.');
        if (!Number.isSafeInteger(result?.version) || result.version < 0) throw new Error('The server returned invalid menu settings.');
        if (isCurrent()) setNavigation({ company, groups: normalizeWorkspaceMenuGroups(result.groups), version: result.version, revision: navigationRevision, error: '' });
      } catch (reason) {
        if (isCurrent()) setNavigation({ company, groups: null, version: 0, revision: navigationRevision, error: reason instanceof Error ? reason.message : 'Could not load the company menu.' });
      }
    })();
    return () => controller.abort();
  }, [isAuthenticated, selectedCompany, currentUser?.id, navigationRevision]);

  const saveNavigation = async (groups: WorkspaceMenuGroup[], version = 0) => {
    if (!selectedCompany || currentUser?.role !== 'Super Admin') throw new Error('Only a Super Admin can customize the menu.');
    const company = selectedCompany;
    const headers = getApiAuthHeaders();
    const username = authRef.current.loginUsername;
    const isCurrent = () => mountedRef.current && selectedCompanyRef.current === company && authRef.current.isAuthenticated
      && authRef.current.loginUsername === username && getApiAuthHeaders().Authorization === headers.Authorization;
    const response = await fetch(`${API_BASE_URL}/companies/navigation?company=${encodeURIComponent(company)}`, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ groups, version }),
    });
    if (response.status === 401 && getApiAuthHeaders().Authorization === headers.Authorization) expireApiSession();
    const result = await response.json().catch(() => null);
    if (response.status === 409 && isCurrent()) setNavigationRevision(value => value + 1);
    if (!response.ok) throw new Error(response.status === 409
      ? 'Another Super Admin changed this menu. Close and reopen the editor to load the latest version. Your draft has not been saved.'
      : result?.message || 'Could not save the company menu.');
    if (!Number.isSafeInteger(result?.version) || result.version < 1) throw new Error('The server returned invalid menu settings. Reload to check the saved menu.');
    if (isCurrent()) {
      setNavigation({ company, groups: normalizeWorkspaceMenuGroups(result.groups), version: result.version, revision: navigationRevision, error: '' });
    }
  };

  useEffect(() => {
    if (isAuthenticated && currentUser?.id) {
      fetch(`${API_BASE_URL}/admins/${currentUser.id}/status`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...getApiAuthHeaders() }, body: JSON.stringify({ isOnline: true })
      }).catch(() => {});
    }
  }, [isAuthenticated, currentUser?.id]);

  useEffect(() => {
    const handleUnload = () => {
      if (currentUser?.id) {
        fetch(`${API_BASE_URL}/admins/${currentUser.id}/status`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', ...getApiAuthHeaders() }, body: JSON.stringify({ isOnline: false }), keepalive: true
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

  const readAppData = useCallback((kind: 'admins' | 'companies'): Promise<boolean> => {
    if (readsRef.current[kind]) return readsRef.current[kind]!;
    const controller = new AbortController();
    controllersRef.current.add(controller);
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    const requestedUser = authRef.current.loginUsername;
    const companyListVersion = companyListVersionRef.current;
    const request = (async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/${kind}`, { signal: controller.signal, headers: getApiAuthHeaders() });
        if (response.status === 401) { expireApiSession(); return false; }
        if (!response.ok) throw new Error(`Backend request failed (HTTP ${response.status}).`);
        const data = await response.json();
        if (!Array.isArray(data)) throw new Error('The backend returned an invalid response.');
        if (!mountedRef.current || !authRef.current.isAuthenticated || authRef.current.loginUsername !== requestedUser) return false;
        if (kind === 'admins') setAdminUsers(data);
        else if (companyListVersion === companyListVersionRef.current) {
          // A snapshot requested before a completed create/delete is stale.
          setCompaniesList(data.map((company: any) => company.name));
        }
        return true;
      } catch {
        if (mountedRef.current && authRef.current.isAuthenticated && authRef.current.loginUsername === requestedUser) {
          setSyncError('Connection to the backend was lost. Changes may be out of date; reconnecting automatically.');
        }
        return false;
      } finally {
        window.clearTimeout(timeout);
        controllersRef.current.delete(controller);
        delete readsRef.current[kind];
      }
    })();
    readsRef.current[kind] = request;
    return request;
  }, []);

  const fetchAdmins = useCallback(() => readAppData('admins'), [readAppData]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let stopped = false;
    let syncing = false;
    let retryRequested = false;
    let failures = 0;
    let lastCompaniesSync = 0;
    let timer: ReturnType<typeof setTimeout>;
    const sync = async () => {
      if (stopped) return;
      if (syncing) { retryRequested = true; return; }
      if (document.hidden || !navigator.onLine) {
        if (!navigator.onLine) setSyncError('You are offline. Reconnect to refresh workspace data.');
        timer = setTimeout(sync, 30000);
        return;
      }
      syncing = true;
      const refreshCompanies = Date.now() - lastCompaniesSync >= 30000;
      const results = await Promise.all([fetchAdmins(), refreshCompanies ? readAppData('companies') : Promise.resolve(true)]);
      syncing = false;
      if (stopped) return;
      if (results.every(Boolean)) {
        failures = 0;
        setSyncError('');
        if (refreshCompanies) lastCompaniesSync = Date.now();
      } else failures += 1;
      const delay = retryRequested ? 0 : Math.min(60000, 3000 * 2 ** Math.min(failures, 5));
      retryRequested = false;
      timer = setTimeout(sync, delay);
    };
    const retry = () => {
      clearTimeout(timer);
      failures = 0;
      lastCompaniesSync = 0;
      void sync();
    };
    const onVisibility = () => { if (!document.hidden) retry(); };
    retrySyncRef.current = retry;
    void sync();
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      clearTimeout(timer);
      retrySyncRef.current = () => {};
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', onVisibility);
      controllersRef.current.forEach(controller => controller.abort());
    };
  }, [isAuthenticated, loginUsername, fetchAdmins, readAppData]);

  const handleLogout = () => {
    const headers = { 'Content-Type': 'application/json', ...getApiAuthHeaders() };
    if (currentUser?.id) {
      void fetch(`${API_BASE_URL}/admins/${currentUser.id}/status`, {
        method: 'PATCH', headers, body: JSON.stringify({ isOnline: false }), keepalive: true,
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    }
    clearApiSession();
    setSyncError('');
    setAdminUsers([]);
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
          headers: { 'Content-Type': 'application/json', ...getApiAuthHeaders() },
          body: JSON.stringify({ name: newCompany })
        });
        
        if (!res.ok) {
          alert("Database Error: Could not save the workspace.");
          return; 
        }

        companyListVersionRef.current += 1;
        setCompaniesList(previous => previous.includes(newCompany) ? previous : [...previous, newCompany]);
      } catch (e) { 
        alert("Network Error: Could not reach the backend server.");
        console.error(e); 
      }
    }
  };

  const handleRemoveCompany = (companyToRemove: string): Promise<void> => {
    const active = companyDeletesRef.current.get(companyToRemove);
    if (active) return active;
    const headers = getApiAuthHeaders();
    const request = (async () => {
      try {
        let response: Response;
        try {
          response = await fetch(`${API_BASE_URL}/companies/${encodeURIComponent(companyToRemove)}`, { method: 'DELETE', headers });
        } catch {
          throw new Error('Could not reach the backend. The workspace was not removed from this list; please retry.');
        }
        if (!response.ok) {
          if (response.status === 401 && getApiAuthHeaders().Authorization === headers.Authorization) expireApiSession();
          const details = await response.json().catch(() => null);
          const message = typeof details?.message === 'string' ? details.message : 'Could not delete the workspace and its Drive folder. Please retry.';
          throw new Error(message);
        }
        if (!mountedRef.current || !authRef.current.isAuthenticated || getApiAuthHeaders().Authorization !== headers.Authorization) return;
        companyListVersionRef.current += 1;
        setCompaniesList(previous => previous.filter(company => company !== companyToRemove));
        if (selectedCompanyRef.current === companyToRemove) {
          setSelectedCompany(null);
          setActiveModule('none');
        }
      } finally {
        companyDeletesRef.current.delete(companyToRemove);
      }
    })();
    companyDeletesRef.current.set(companyToRemove, request);
    return request;
  };

  const isCurrentUserSuperAdmin = currentUser?.role === 'Super Admin';
  const canApproveFulfillment = ['Super Admin', 'Admin'].includes(currentUser?.role) || currentUser?.modules?.warehouse_approve === true;
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
      if (['finance', 'books', 'service', 'executive', 'ai_assistant'].includes(activeModule)) {
        const allowed = hasPhase3Access(currentUser, selectedCompany, phase3Scope(activeModule as Phase3View)) || activeModule === 'finance' && hasPhase3Access(currentUser, selectedCompany, 'landed');
        if (!allowed || globalModules[activeModule] === false) setActiveModule('none');
        return;
      }
      const requiredPermission = 
        (activeModule === 'customers' || activeModule === 'sales_orders' || activeModule === 'create_os' || activeModule === 'customer_pos' || activeModule === 'deliveries') ? 'sales' :
        (activeModule === 'suppliers' || activeModule === 'purchase_orders') ? 'purchasing' :
        (activeModule === 'products' || activeModule === 'inventory' || activeModule === 'warehouses' || activeModule === 'warehouse_ops') ? 'master_inventory' :
        activeModule;

      const isPoModule = activeModule === 'purchase_orders' || activeModule === 'customer_pos';
      const isGloballyDisabled = isPoModule
        ? globalModules.sales === false && globalModules.purchasing === false
        : activeModule === 'deliveries'
        ? globalModules.sales === false && globalModules.master_inventory === false
        : globalModules[requiredPermission] === false;
      const isUserDisabled = !isCurrentUserSuperAdmin && (isPoModule
        ? !((globalModules.sales !== false && currentUser?.modules?.sales === true) || (globalModules.purchasing !== false && currentUser?.modules?.purchasing === true))
        : activeModule === 'deliveries'
        ? !((globalModules.sales !== false && currentUser?.modules?.sales === true) || (globalModules.master_inventory !== false && (currentUser?.modules?.master_inventory === true || currentUser?.modules?.inventory === true || currentUser?.modules?.warehouses === true)))
        : currentUser?.modules?.[requiredPermission] === false);
      
      if (isGloballyDisabled || isUserDisabled) {
        setActiveModule('none');
      }
    }
  }, [currentUser, selectedCompany, activeModule, isCurrentUserSuperAdmin, globalModules]);

  const isPrivacyRoute = window.location.pathname === '/privacy';

  const openWorkspaceModule = (module: typeof activeModule) => {
    setTargetCustomerId(null);
    setInvoiceDeliveryId(undefined);
    setActiveModule(module);
  };
  const returnToWorkspace = () => openWorkspaceModule('none');
  const changeWorkspaceCompany = () => {
    returnToWorkspace();
    setSelectedCompany(null);
  };

  const renderGateway = (navigationOnly = false) => {
    const userHasPayroll = isCurrentUserSuperAdmin || currentUser?.modules?.payroll === true;
    const userHasAiDocs = isCurrentUserSuperAdmin || currentUser?.modules?.ai_docs === true;
    const userHasProducts = isCurrentUserSuperAdmin || currentUser?.modules?.products === true;
    const userHasInventory = isCurrentUserSuperAdmin || currentUser?.modules?.inventory === true;
    const userHasWarehouses = isCurrentUserSuperAdmin || currentUser?.modules?.warehouses === true;
    const userHasPurchasing = isCurrentUserSuperAdmin || currentUser?.modules?.purchasing === true;
    const userHasImportation = isCurrentUserSuperAdmin || currentUser?.modules?.importation === true;
    const userHasSales = isCurrentUserSuperAdmin || currentUser?.modules?.sales === true;
    return <CompanyModule
      isGateway navigationOnly={navigationOnly} activeModule={activeModule} onWorkspace={returnToWorkspace}
      selectedCompany={selectedCompany!} loginUsername={loginUsername} currentUser={currentUser}
      navigationGroups={navigation.company === selectedCompany ? navigation.groups : null}
      navigationVersion={navigation.company === selectedCompany ? navigation.version : 0}
      navigationLoading={navigation.company !== selectedCompany || navigation.revision !== navigationRevision}
      navigationError={navigation.company === selectedCompany ? navigation.error : ''}
      onSaveNavigation={saveNavigation}
      hasPayroll={userHasPayroll && globalModules.payroll} hasAiDocs={userHasAiDocs && globalModules.ai_docs}
      hasProducts={userHasProducts && globalModules.products} hasInventory={userHasInventory && globalModules.inventory}
      hasWarehouses={userHasWarehouses && globalModules.warehouses} hasPurchasing={userHasPurchasing && globalModules.purchasing}
      hasSales={userHasSales && globalModules.sales}
      hasImportation={userHasImportation && globalModules.importation !== false}
      hasFinance={globalModules.finance !== false && (hasPhase3Access(currentUser, selectedCompany, 'finance') || hasPhase3Access(currentUser, selectedCompany, 'landed'))}
      hasBooks={globalModules.books !== false && hasPhase3Access(currentUser, selectedCompany, 'books')}
      hasService={globalModules.service !== false && hasPhase3Access(currentUser, selectedCompany, 'service')}
      hasExecutive={globalModules.executive !== false && hasPhase3Access(currentUser, selectedCompany, 'executive')}
      hasAiAssistant={globalModules.ai_assistant !== false && hasPhase3Access(currentUser, selectedCompany, 'ai')}
      onChangeCompany={changeWorkspaceCompany} onSelectModule={openWorkspaceModule} onLogout={handleLogout} API_BASE_URL={API_BASE_URL}
      adminUsers={adminUsers}
    />;
  };

  const renderModule = () => {
  if (!isAuthenticated) return <AuthModule onLoginSuccess={(user: string) => { setLoginNotice(''); setIsAuthenticated(true); setLoginUsername(user); }} sessionMessage={loginNotice} isPrivacyRoute={isPrivacyRoute} API_BASE_URL={API_BASE_URL} />;

  if (!selectedCompany && activeModule !== 'users') return (
    <CompanyModule
      isGateway={false} allowedCompanies={allowedCompanies} hasUsers={hasUsers}
      companiesList={companiesList} onAddCompany={handleAddCompany} onRemoveCompany={handleRemoveCompany}
      onSelectCompany={setSelectedCompany} onManageUsers={() => setActiveModule('users')} onLogout={handleLogout}
      loginUsername={loginUsername} currentUser={currentUser} API_BASE_URL={API_BASE_URL}
      adminUsers={adminUsers} // <-- FED DIRECTLY FROM THE LIVE POLLING
    />
  );

  if (activeModule === 'none') return renderGateway();

  // ALL MODULE ROUTES
  if (['finance', 'books', 'service', 'executive', 'ai_assistant'].includes(activeModule)) return <Suspense fallback={<p role="status" className="p-8 text-slate-600">Loading workspace…</p>}><Phase3Module key={`${selectedCompany}-${activeModule}-${currentUser?.role}-${JSON.stringify(currentUser?.modules)}`} selectedCompany={selectedCompany!} API_BASE_URL={API_BASE_URL} currentUser={currentUser} view={activeModule as Phase3View} initialDeliveryId={invoiceDeliveryId} onOpenFinance={globalModules.finance !== false && hasPhase3Access(currentUser, selectedCompany, 'finance') ? () => setActiveModule('finance') : undefined} onBack={() => { setInvoiceDeliveryId(undefined); setActiveModule('none'); }} /></Suspense>;
  if (activeModule === 'customers') return <CustomerModule selectedCompany={selectedCompany!} loginUsername={loginUsername} API_BASE_URL={API_BASE_URL} canFinance={globalModules.finance !== false && hasPhase3Access(currentUser, selectedCompany, 'finance')} onBack={() => setActiveModule('none')} onRouteToOrderSlip={(id: string) => { setTargetCustomerId(id); setActiveModule('create_os'); }} />;
  if (activeModule === 'create_os') return <CreateOSModule selectedCompany={selectedCompany!} loginUsername={loginUsername} API_BASE_URL={API_BASE_URL} initialCustomerId={targetCustomerId} onBack={() => { setActiveModule('none'); setTargetCustomerId(null); }} onViewLedger={() => setActiveModule('sales_orders')} canApprove={canApproveFulfillment} onOpenFulfillment={() => setActiveModule('deliveries')} />;
  if (activeModule === 'products' || activeModule === 'inventory' || activeModule === 'warehouses') return <MasterInventory selectedCompany={selectedCompany!} loginUsername={loginUsername} API_BASE_URL={API_BASE_URL} canFinance={globalModules.finance !== false && hasPhase3Access(currentUser, selectedCompany, 'landed')} onLogout={handleLogout} onBack={() => setActiveModule('none')} />;
  if (activeModule === 'ai_docs') return <AiDocsModule selectedCompany={selectedCompany!} loginUsername={loginUsername} API_BASE_URL={API_BASE_URL} onBack={() => setActiveModule('none')} />;
  if (activeModule === 'payroll') return <PayrollModule selectedCompany={selectedCompany!} loginUsername={loginUsername} API_BASE_URL={API_BASE_URL} onLogout={handleLogout} onBack={() => setActiveModule('none')} />;
  if (activeModule === 'sales_orders') return <OrderSlipsModule selectedCompany={selectedCompany!} loginUsername={loginUsername} API_BASE_URL={API_BASE_URL} onBack={() => setActiveModule('none')} onCreateNew={() => setActiveModule('create_os')} canApprove={canApproveFulfillment} onOpenFulfillment={() => setActiveModule('deliveries')} />;
  if (activeModule === 'purchase_orders' || activeModule === 'customer_pos') return <PurchaseOrdersModule key={`${selectedCompany}-${activeModule}`} selectedCompany={selectedCompany!} loginUsername={loginUsername} API_BASE_URL={API_BASE_URL} canPurchase={globalModules.purchasing !== false && (isCurrentUserSuperAdmin || currentUser?.modules?.purchasing === true)} initialTab={activeModule === 'customer_pos' ? 'fulfillment' : undefined} fulfillmentContent={globalModules.sales !== false && (isCurrentUserSuperAdmin || currentUser?.modules?.sales === true) ? <FulfillmentModule embedded selectedCompany={selectedCompany!} API_BASE_URL={API_BASE_URL} initialView="orders" canApprove={canApproveFulfillment} canWarehouse={globalModules.master_inventory !== false && (isCurrentUserSuperAdmin || currentUser?.modules?.master_inventory === true || currentUser?.modules?.inventory === true || currentUser?.modules?.warehouses === true)} canSales onCreateOrderSlip={() => { setTargetCustomerId(null); setActiveModule('create_os'); }} onBack={() => setActiveModule('none')} /> : undefined} onBack={() => setActiveModule('none')} />;
  if (activeModule === 'suppliers') return <SupplierModule selectedCompany={selectedCompany!} loginUsername={loginUsername} API_BASE_URL={API_BASE_URL} onBack={() => setActiveModule('none')} />;
  if (activeModule === 'importation') return <ImportationModule selectedCompany={selectedCompany!} API_BASE_URL={API_BASE_URL} canApprove={['Super Admin', 'Admin'].includes(currentUser?.role) || currentUser?.modules?.importation_approve === true} onBack={() => setActiveModule('none')} />;
  if (activeModule === 'warehouse_ops' || activeModule === 'deliveries') return <FulfillmentModule key={[selectedCompany, activeModule].join('-')} selectedCompany={selectedCompany!} API_BASE_URL={API_BASE_URL} initialView={activeModule === 'warehouse_ops' ? 'warehouse' : 'delivery'} canApprove={canApproveFulfillment} canWarehouse={globalModules.master_inventory !== false && (isCurrentUserSuperAdmin || currentUser?.modules?.master_inventory === true || currentUser?.modules?.inventory === true || currentUser?.modules?.warehouses === true)} canSales={globalModules.sales !== false && (isCurrentUserSuperAdmin || currentUser?.modules?.sales === true)} onOpenFinance={globalModules.finance !== false && hasPhase3Access(currentUser, selectedCompany, 'finance', true) ? (id: string) => { setInvoiceDeliveryId(id); setActiveModule('finance'); } : undefined} onCreateOrderSlip={() => { setTargetCustomerId(null); setActiveModule('create_os'); }} onBack={() => setActiveModule('none')} />;

  // ADD THIS LINE:
if (activeModule === 'qr_system') return <ProductQRModule selectedCompany={selectedCompany!} loginUsername={loginUsername} API_BASE_URL={API_BASE_URL} onBack={() => setActiveModule('none')} />;

  if (activeModule === 'users') return (
    <UserControlModule 
      adminUsers={adminUsers} setAdminUsers={setAdminUsers} fetchAdmins={fetchAdmins} loginUsername={loginUsername} 
      isCurrentUserSuperAdmin={isCurrentUserSuperAdmin} API_BASE_URL={API_BASE_URL} globalModules={globalModules} 
      companiesList={companiesList} onBack={() => setActiveModule('none')} onLogout={handleLogout} 
    />
  );

  return null;
  };

  return <>
    {(syncError || apiConfig.error) && <div role="alert" className="fixed left-3 right-3 top-3 z-[200] mx-auto flex max-w-3xl items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950 shadow-lg">
      <span>{apiConfig.error || syncError}</span>
      {isAuthenticated && <button type="button" onClick={() => retrySyncRef.current()} className="shrink-0 rounded-lg bg-amber-100 px-3 py-2 font-bold hover:bg-amber-200">Retry connection</button>}
    </div>}
    {isAuthenticated && selectedCompany && activeModule !== 'payroll' ? (
      <ErpShell company={selectedCompany} title={workspaceTitle(activeModule)} username={loginUsername} standalone={activeModule === 'ai_docs'}
        navigation={renderGateway(true)} onWorkspace={returnToWorkspace}
        onChangeCompany={changeWorkspaceCompany} onLogout={handleLogout}>
        {renderModule()}
      </ErpShell>
    ) : renderModule()}
  </>;
}
