import React, { useState, useEffect } from 'react';
import { DndContext, closestCenter, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// --- DRAG AND DROP WRAPPER COMPONENT ---
function SortableModuleCard({ id, children, disabled = false }: { id: string; children: React.ReactNode; disabled?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ 
    id, 
    disabled 
  });
  
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 1,
    opacity: isDragging ? 0.9 : 1,
  };

  return (
    <div 
      ref={setNodeRef} 
      style={style} 
      {...(disabled ? {} : attributes)} 
      {...(disabled ? {} : listeners)} 
      className={`h-full w-full ${disabled ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'} ${isDragging ? 'touch-none scale-105 drop-shadow-2xl' : ''} transition-all duration-200`}
    >
      {children}
    </div>
  );
}

export default function CompanyModule({ 
  isGateway, allowedCompanies, hasUsers, onSelectCompany, onManageUsers, onLogout,
  selectedCompany, loginUsername, currentUser, adminUsers = [],
  hasPayroll, hasAiDocs, hasProducts, hasInventory, hasWarehouses, hasPurchasing, hasSales,
  onChangeCompany, onSelectModule, onAddCompany, onRemoveCompany, companiesList = [], API_BASE_URL
}: any) {
  
  const [showAddModal, setShowAddModal] = useState(false);
  const [newCompany, setNewCompany] = useState('');
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  // --- WIDGET & DRAG AND DROP STATES ---
  const [moduleOrder, setModuleOrder] = useState<string[]>([]);
  const [isDraggingGrid, setIsDraggingGrid] = useState(false);
  const [isOnlineWidgetOpen, setIsOnlineWidgetOpen] = useState(false); // DEFAULT TO CLOSED
  
  // Check if current user is allowed to rearrange modules and view admin tools
  const isAdmin = currentUser?.role === 'Super Admin' || hasUsers;

  // The delay makes it so a quick click triggers the button, but holding for 250ms starts the drag.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  );

  // --- REAL-TIME WIDGET ENGINE (Pulls instantly from App.tsx 3-sec polling) ---
  const realActiveUsers = React.useMemo(() => {
    if (!isAdmin || !Array.isArray(adminUsers)) return [];
    
    // Strict Filter: Only users actually tracked as online in the database
    const onlineUsersOnly = adminUsers.filter((u: any) => 
      u.isOnline === true || 
      (loginUsername && u.username.toLowerCase() === loginUsername.toLowerCase())
    );

    const colors = ['bg-sky-100 text-sky-700', 'bg-emerald-100 text-emerald-700', 'bg-purple-100 text-purple-700', 'bg-amber-100 text-amber-700', 'bg-rose-100 text-rose-700', 'bg-indigo-100 text-indigo-700'];
    
    const formattedUsers = onlineUsersOnly.map((u: any, index: number) => {
      const isMe = loginUsername && u.username.toLowerCase() === loginUsername.toLowerCase();
      return {
        id: u.id || index,
        name: u.username,
        company: isMe ? (selectedCompany || 'Gateway Entry') : 'System Connected',
        initials: u.username.substring(0, 2).toUpperCase(),
        color: colors[index % colors.length],
        isMe: isMe
      };
    });
    
    // Put the currently logged in Super Admin at the top
    formattedUsers.sort((a: any, b: any) => (b.isMe ? 1 : 0) - (a.isMe ? 1 : 0));
    return formattedUsers;
  }, [adminUsers, isAdmin, loginUsername, selectedCompany]);

  useEffect(() => {
    if (!isGateway || isDraggingGrid) return; 

    const activeIds: string[] = [];
    if (hasSales) activeIds.push('customers', 'create_os', 'sales_orders');
    if (hasPurchasing) activeIds.push('suppliers', 'purchase_orders'); 
    if (hasProducts || hasInventory || hasWarehouses) activeIds.push('inventory');
    if (hasPayroll) activeIds.push('payroll');
    if (hasAiDocs) activeIds.push('ai_docs');

    const dbOrder = currentUser?.moduleOrder;
    const savedOrder = (Array.isArray(dbOrder) && dbOrder.length > 0) 
      ? dbOrder 
      : JSON.parse(localStorage.getItem(`module_order_${loginUsername}`) || '[]');
    
    const mergedOrder = [
      ...savedOrder.filter((id: string) => activeIds.includes(id)),
      ...activeIds.filter((id: string) => !savedOrder.includes(id))
    ];
    
    setModuleOrder((prev) => {
      if (JSON.stringify(prev) !== JSON.stringify(mergedOrder)) return mergedOrder;
      return prev;
    });
  }, [isGateway, hasSales, hasPurchasing, hasProducts, hasInventory, hasWarehouses, hasPayroll, hasAiDocs, loginUsername, currentUser, isDraggingGrid]);

  const handleDragEnd = async (event: DragEndEvent) => {
    setIsDraggingGrid(false); 
    if (!isAdmin) return;
    
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = moduleOrder.indexOf(active.id as string);
      const newIndex = moduleOrder.indexOf(over.id as string);
      const newOrder = arrayMove(moduleOrder, oldIndex, newIndex);
      
      setModuleOrder(newOrder);
      localStorage.setItem(`module_order_${loginUsername}`, JSON.stringify(newOrder));
      
      if (!API_BASE_URL) {
        showToast("Error: API_BASE_URL prop is missing from App.tsx!", "error");
        return; 
      }

      try {
        const res = await fetch(`${API_BASE_URL}/admins/${currentUser?.id || loginUsername}/preferences`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ moduleOrder: newOrder })
        });
        if (res.ok) showToast("Layout synced across devices.", "success");
        else showToast(`Database sync failed: ${res.status}`, "error");
      } catch (err) {
        console.warn("Failed to save layout to DB", err);
        showToast("Network error. Saved locally.", "error");
      }
    }
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newCompany.trim();
    if (trimmed) {
      if (companiesList.includes(trimmed)) return showToast("A workspace with this name already exists.", "error");
      onAddCompany(trimmed);
      showToast(`Workspace "${trimmed}" created successfully.`, "success");
      setNewCompany('');
      setShowAddModal(false);
    }
  };

  const handleRemoveClick = (e: React.MouseEvent, company: string) => {
    e.stopPropagation();
    const confirmName = window.prompt(`CRITICAL WARNING: This will remove the "${company}" workspace from the system.\n\nPlease type "${company}" to confirm:`);
    if (confirmName === company) {
      onRemoveCompany(company);
      showToast(`Workspace "${company}" deleted securely.`, "success");
    } else if (confirmName !== null) {
      showToast("Workspace name did not match. Deletion cancelled.", "error");
    }
  };

  const getCompanyTheme = (name: string) => {
    const lower = name.toLowerCase();
    if (lower === 'surgicom') return { title: 'text-blue-950', sub: 'Trading Corporation', iconBg: 'bg-blue-50', icon: 'text-blue-600', borderHover: 'hover:border-blue-400' };
    if (lower === 'olten') return { title: 'text-indigo-950', sub: 'Instruments', iconBg: 'bg-indigo-50', icon: 'text-indigo-600', borderHover: 'hover:border-indigo-400' };
    if (lower === 'ordent') return { title: 'text-amber-900', sub: 'Dental Clinic', iconBg: 'bg-amber-50', icon: 'text-amber-600', borderHover: 'hover:border-amber-400' };
    return { title: 'text-slate-900', sub: 'Workspace Environment', iconBg: 'bg-slate-100', icon: 'text-slate-600', borderHover: 'hover:border-slate-400' };
  };

  // --- ONLINE STATUS WIDGET (SUPER ADMIN ONLY) ---
  const renderOnlineWidget = () => {
    if (!isAdmin) return null;

    return (
      <div className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-[150] w-[calc(100vw-2rem)] sm:w-72 shadow-2xl rounded-2xl overflow-hidden animate-in slide-in-from-bottom-8 fade-in duration-500 flex flex-col border border-slate-200/60 transition-all">
        {/* Widget Header (Toggle) */}
        <div onClick={() => setIsOnlineWidgetOpen(!isOnlineWidgetOpen)} className="bg-slate-900/95 backdrop-blur px-4 py-3 flex items-center justify-between cursor-pointer border-b border-white/10 hover:bg-slate-800 transition-colors">
          <div className="flex items-center gap-2.5">
            <div className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </div>
            <span className="text-[11px] font-black text-white uppercase tracking-widest">Active Sessions</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-bold text-slate-300 bg-slate-800 px-2 py-0.5 rounded-md">{realActiveUsers.length} Online</span>
            <svg className={`w-4 h-4 text-slate-400 transition-transform duration-300 ${isOnlineWidgetOpen ? '' : 'rotate-180'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
          </div>
        </div>
        
        {/* Widget Body (Collapsible) */}
        {isOnlineWidgetOpen && (
          <div className="flex flex-col max-h-56 overflow-y-auto bg-white/95 backdrop-blur divide-y divide-slate-100">
             {realActiveUsers.map(u => (
               <div key={u.id} className="px-4 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-black uppercase shadow-sm ${u.color}`}>
                      {u.initials}
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs font-black text-slate-800 leading-none flex items-center gap-1.5">
                        {u.name} {u.isMe && <span className="text-[8px] bg-slate-200 text-slate-600 px-1 py-0.5 rounded">(YOU)</span>}
                      </span>
                      <span className="text-[9px] font-bold text-slate-400 mt-1 uppercase tracking-wider truncate max-w-[140px]">{u.company}</span>
                    </div>
                  </div>
                  {/* Static Green Indicator per user */}
                  <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.6)]"></div>
               </div>
             ))}
             {realActiveUsers.length === 0 && (
               <div className="px-4 py-6 text-center text-xs font-bold text-slate-400">Loading system users...</div>
             )}
          </div>
        )}
      </div>
    );
  };

  // --- RENDER DYNAMIC MODULE CARDS ---
  const renderModuleCard = (id: string) => {
    const rightArrow = (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    );

    switch (id) {
      case 'suppliers':
        return (
          <button onClick={() => onSelectModule('suppliers')} className="group flex items-center justify-between p-5 bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md hover:border-fuchsia-300 transition-all text-left w-full h-full focus:outline-none focus:ring-4 focus:ring-slate-400/10">
            <div className="flex items-center gap-4 min-w-0 flex-1">
              <div className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center bg-fuchsia-50 group-hover:scale-105 transition-transform">
                <svg className="w-6 h-6 text-fuchsia-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-[15px] font-bold text-slate-800 truncate transition-colors group-hover:text-fuchsia-800">Supplier Directory</h3>
                <p className="text-xs font-medium text-slate-500 truncate mt-0.5">Manage vendors and compliance profiles.</p>
              </div>
            </div>
            <div className="flex-shrink-0 ml-4 text-slate-300 group-hover:text-fuchsia-500 transition-colors">{rightArrow}</div>
          </button>
        );
      case 'customers':
        return (
          <button onClick={() => onSelectModule('customers')} className="group flex items-center justify-between p-5 bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md hover:border-emerald-300 transition-all text-left w-full h-full focus:outline-none focus:ring-4 focus:ring-slate-400/10">
            <div className="flex items-center gap-4 min-w-0 flex-1">
              <div className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center bg-emerald-50 group-hover:scale-105 transition-transform">
                <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-[15px] font-bold text-slate-800 truncate transition-colors group-hover:text-emerald-800">Customer Directory</h3>
                <p className="text-xs font-medium text-slate-500 truncate mt-0.5">Manage clients and view profiles.</p>
              </div>
            </div>
            <div className="flex-shrink-0 ml-4 text-slate-300 group-hover:text-emerald-500 transition-colors">{rightArrow}</div>
          </button>
        );
      case 'create_os':
        return (
          <button onClick={() => onSelectModule('create_os')} className="group flex items-center justify-between p-5 bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md hover:border-teal-300 transition-all text-left w-full h-full focus:outline-none focus:ring-4 focus:ring-slate-400/10">
            <div className="flex items-center gap-4 min-w-0 flex-1">
              <div className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center bg-teal-50 group-hover:scale-105 transition-transform">
                <svg className="w-6 h-6 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-[15px] font-bold text-slate-800 truncate transition-colors group-hover:text-teal-800">Create Order Slip</h3>
                <p className="text-xs font-medium text-slate-500 truncate mt-0.5">Draft and process new customer orders.</p>
              </div>
            </div>
            <div className="flex-shrink-0 ml-4 text-slate-300 group-hover:text-teal-500 transition-colors">{rightArrow}</div>
          </button>
        );
      case 'sales_orders':
        return (
          <button onClick={() => onSelectModule('sales_orders')} className="group flex items-center justify-between p-5 bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md hover:border-violet-300 transition-all text-left w-full h-full focus:outline-none focus:ring-4 focus:ring-slate-400/10">
            <div className="flex items-center gap-4 min-w-0 flex-1">
              <div className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center bg-violet-50 group-hover:scale-105 transition-transform">
                <svg className="w-6 h-6 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-[15px] font-bold text-slate-800 truncate transition-colors group-hover:text-violet-800">O.S. Ledger</h3>
                <p className="text-xs font-medium text-slate-500 truncate mt-0.5">View, print, and manage order slips.</p>
              </div>
            </div>
            <div className="flex-shrink-0 ml-4 text-slate-300 group-hover:text-violet-500 transition-colors">{rightArrow}</div>
          </button>
        );
      case 'purchase_orders':
        return (
          <button onClick={() => onSelectModule('purchase_orders')} className="group flex items-center justify-between p-5 bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md hover:border-sky-300 transition-all text-left w-full h-full focus:outline-none focus:ring-4 focus:ring-slate-400/10">
            <div className="flex items-center gap-4 min-w-0 flex-1">
              <div className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center bg-sky-50 group-hover:scale-105 transition-transform">
                <svg className="w-6 h-6 text-sky-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" /></svg>
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-[15px] font-bold text-slate-800 truncate transition-colors group-hover:text-sky-800">Procurement (P.O.)</h3>
                <p className="text-xs font-medium text-slate-500 truncate mt-0.5">Manage POs, verify deliveries & track.</p>
              </div>
            </div>
            <div className="flex-shrink-0 ml-4 text-slate-300 group-hover:text-sky-500 transition-colors">{rightArrow}</div>
          </button>
        );
      case 'inventory':
        return (
          <button onClick={() => onSelectModule('inventory')} className="group flex items-center justify-between p-5 bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md hover:border-blue-300 transition-all text-left w-full h-full focus:outline-none focus:ring-4 focus:ring-slate-400/10">
            <div className="flex items-center gap-4 min-w-0 flex-1">
              <div className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center bg-blue-50 group-hover:scale-105 transition-transform">
                <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-[15px] font-bold text-slate-800 truncate transition-colors group-hover:text-blue-800">Master Inventory</h3>
                <p className="text-xs font-medium text-slate-500 truncate mt-0.5">Catalog, stock ledger, and facilities.</p>
              </div>
            </div>
            <div className="flex-shrink-0 ml-4 text-slate-300 group-hover:text-blue-500 transition-colors">{rightArrow}</div>
          </button>
        );
      case 'payroll':
        return (
          <button onClick={() => onSelectModule('payroll')} className="group flex items-center justify-between p-5 bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md hover:border-indigo-300 transition-all text-left w-full h-full focus:outline-none focus:ring-4 focus:ring-slate-400/10">
            <div className="flex items-center gap-4 min-w-0 flex-1">
              <div className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center bg-indigo-50 group-hover:scale-105 transition-transform">
                <svg className="w-6 h-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-[15px] font-bold text-slate-800 truncate transition-colors group-hover:text-indigo-800">Payroll Engine</h3>
                <p className="text-xs font-medium text-slate-500 truncate mt-0.5">Manage salaries, bonuses, and deductions.</p>
              </div>
            </div>
            <div className="flex-shrink-0 ml-4 text-slate-300 group-hover:text-indigo-500 transition-colors">{rightArrow}</div>
          </button>
        );
      case 'ai_docs':
        return (
          <button onClick={() => onSelectModule('ai_docs')} className="group flex items-center justify-between p-5 bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md hover:border-rose-300 transition-all text-left w-full h-full focus:outline-none focus:ring-4 focus:ring-slate-400/10">
            <div className="flex items-center gap-4 min-w-0 flex-1">
              <div className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center bg-rose-50 group-hover:scale-105 transition-transform">
                <svg className="w-6 h-6 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-[15px] font-bold text-slate-800 truncate transition-colors group-hover:text-rose-800">AI Docs Engine</h3>
                <p className="text-xs font-medium text-slate-500 truncate mt-0.5">Generate letters, SOPs, & docs.</p>
              </div>
            </div>
            <div className="flex-shrink-0 ml-4 text-slate-300 group-hover:text-rose-500 transition-colors">{rightArrow}</div>
          </button>
        );
      default:
        return null;
    }
  };

  // --- WORKSPACE LIST VIEW (GATEWAY OFF) ---
  if (!isGateway) {
    const available = companiesList.filter((c: string) => allowedCompanies[c]);

    return (
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center p-4 sm:p-8 font-sans selection:bg-slate-200 relative pb-24">
        
        {/* TOAST MOVED TO TOP RIGHT */}
        {toast && (
          <div className={`fixed top-6 right-6 z-[200] px-5 py-3.5 rounded-xl shadow-xl font-semibold flex items-center gap-3 animate-in slide-in-from-top-8 fade-in border ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>
            {toast.message}
          </div>
        )}

        {showAddModal && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
              <div className="p-5 border-b bg-slate-800 text-white">
                <h3 className="font-bold text-lg tracking-wide">Register Workspace</h3>
              </div>
              <form onSubmit={handleAdd} className="p-6 flex flex-col gap-5">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-600 uppercase tracking-wide">Organization Name</label>
                  <input type="text" required value={newCompany} onChange={e => setNewCompany(e.target.value)} className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-slate-500 shadow-sm" placeholder="e.g. Apex Corp" />
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setShowAddModal(false)} className="flex-1 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors">Cancel</button>
                  <button type="submit" className="flex-1 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl transition-colors">Save Org</button>
                </div>
              </form>
            </div>
          </div>
        )}

        <div className="w-full max-w-5xl">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-12 gap-6">
            <div>
              <h1 className="text-3xl sm:text-[32px] font-black text-[#1E293B] tracking-tight">Select Organization</h1>
              <p className="text-[#64748B] mt-1 text-[15px] font-medium">Choose a company workspace to proceed.</p>
            </div>
            
            <div className="flex flex-wrap items-center gap-3">
              {hasUsers && (
                <>
                  <button onClick={() => setShowAddModal(true)} className="px-5 py-2.5 bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#0F172A] rounded-xl font-bold transition-colors text-sm flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                    Add Company
                  </button>
                  <button onClick={onManageUsers} className="px-5 py-2.5 bg-[#0F172A] hover:bg-[#1E293B] text-white rounded-xl shadow-md shadow-slate-900/10 font-bold transition-colors text-sm flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                    Manage Users
                  </button>
                </>
              )}
              <button onClick={onLogout} className="px-5 py-2.5 bg-white border border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC] rounded-xl shadow-sm font-bold transition-colors text-sm">
                Secure Logout
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {available.length === 0 ? (
              <div className="col-span-full text-center py-12 text-slate-500 font-medium bg-white rounded-2xl border border-slate-200">
                No workspaces assigned to your account.
              </div>
            ) : available.map((company: string) => {
              const theme = getCompanyTheme(company);
              
              return (
                <div key={company} className="relative group/card">
                  <button onClick={() => onSelectCompany(company)} className={`w-full bg-white p-8 rounded-2xl shadow-[0_2px_10px_-3px_rgba(0,0,0,0.05)] border border-[#E2E8F0] ${theme.borderHover} hover:shadow-md transition-all text-left flex flex-col justify-between h-[180px] group`}>
                    <div>
                      <h2 className={`text-[22px] font-black ${theme.title} tracking-tight pr-8 transition-colors`}>{company}</h2>
                      <p className="text-[13px] text-[#64748B] mt-1 font-medium">{theme.sub}</p>
                    </div>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${theme.iconBg} group-hover:translate-x-1.5 transition-transform duration-300`}>
                      <svg className={`w-4 h-4 ${theme.icon}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </button>
                  
                  {hasUsers && (
                    <button 
                      onClick={(e) => handleRemoveClick(e, company)} 
                      className="absolute top-5 right-5 p-1.5 text-[#CBD5E1] hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all opacity-0 group-hover/card:opacity-100"
                      title="Delete Workspace"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* INJECT ONLINE WIDGET HERE */}
        {renderOnlineWidget()}
      </div>
    );
  }

  // --- GATEWAY VIEW (WITH DRAG & DROP) ---
  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center p-4 sm:p-8 font-sans selection:bg-slate-200 relative pb-24">
      
      {/* TOAST MOVED TO TOP RIGHT */}
      {toast && (
        <div className={`fixed top-6 right-6 z-[200] px-5 py-3.5 rounded-xl shadow-xl font-semibold flex items-center gap-3 animate-in slide-in-from-top-8 fade-in border ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>
          {toast.message}
        </div>
      )}

      {/* GATEWAY HEADER */}
      <div className="w-full max-w-[1440px] mx-auto px-6 lg:px-8 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-10">
        <div className="w-full sm:w-auto">
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">{selectedCompany} Workspace</h1>
          <p className="text-slate-500 text-sm mt-1">Logged in as <span className="font-bold text-slate-700">{loginUsername}</span> ({currentUser?.role || 'Admin'})</p>
        </div>
        <div className="flex flex-col sm:flex-row w-full sm:w-auto gap-3 shrink-0">
          <button onClick={onChangeCompany} className="flex-1 sm:flex-none w-full sm:w-auto px-4 sm:px-5 py-2.5 bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-xl shadow-sm font-bold transition-colors text-sm text-center">Switch Org</button>
          <button onClick={onLogout} className="flex-1 sm:flex-none w-full sm:w-auto px-4 sm:px-5 py-2.5 bg-slate-900 text-white hover:bg-slate-800 rounded-xl shadow-sm font-bold transition-colors text-sm text-center">Logout</button>
        </div>
      </div>

      <DndContext 
        sensors={sensors} 
        collisionDetection={closestCenter} 
        onDragStart={() => setIsDraggingGrid(true)} 
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={moduleOrder} strategy={rectSortingStrategy}>
          
          <div className="w-full max-w-[1440px] mx-auto px-6 lg:px-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            
            {moduleOrder.map(moduleId => (
              <SortableModuleCard key={moduleId} id={moduleId} disabled={!isAdmin}>
                {renderModuleCard(moduleId)}
              </SortableModuleCard>
            ))}

          </div>
        </SortableContext>
      </DndContext>

      {/* INJECT ONLINE WIDGET HERE */}
      {renderOnlineWidget()}
    </div>
  );
}