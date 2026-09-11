import React, { useState } from 'react';

interface UserControlModuleProps {
  adminUsers: any[];
  setAdminUsers: React.Dispatch<React.SetStateAction<any[]>>;
  fetchAdmins: () => void;
  loginUsername: string;
  isCurrentUserSuperAdmin: boolean;
  API_BASE_URL: string;
  globalModules: Record<string, boolean>;
  companiesList: string[];
  onBack: () => void;
  onLogout: () => void;
}

export default function UserControlModule({
  adminUsers,
  setAdminUsers,
  fetchAdmins,
  loginUsername,
  isCurrentUserSuperAdmin,
  API_BASE_URL,
  globalModules,
  companiesList,
  onBack,
  onLogout
}: UserControlModuleProps) {
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);

  const initialFormState = {
    username: '',
    password: '',
    role: 'Admin', 
    status: 'Active',
    modules: {
      payroll: false,
      ai_docs: false,
      master_inventory: true, 
      inventory: true,     // explicitly tracked for Gateway compatibility
      products: true,      // explicitly tracked for Gateway compatibility
      warehouses: true,    // explicitly tracked for Gateway compatibility
      purchasing: false,
      sales: false,
      companies: {} as Record<string, boolean>
    }
  };

  const [formData, setFormData] = useState(initialFormState);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const openCreateModal = () => {
    setFormData(initialFormState);
    setEditingUserId(null);
    setModalOpen(true);
  };

  const openEditModal = (user: any) => {
    setEditingUserId(user.id);
    
    let currentRole = user.role === 'Super Admin' ? 'Super Admin' : 'Admin';
    const hasInventory = Boolean(user.modules?.master_inventory ?? user.modules?.inventory ?? true);

    setFormData({
      username: user.username,
      password: '', 
      role: currentRole,
      status: user.status || 'Active',
      modules: {
        payroll: Boolean(user.modules?.payroll),
        ai_docs: Boolean(user.modules?.ai_docs),
        master_inventory: hasInventory,
        inventory: hasInventory,
        products: hasInventory,
        warehouses: hasInventory,
        purchasing: Boolean(user.modules?.purchasing),
        sales: Boolean(user.modules?.sales),
        companies: user.modules?.companies || {}
      }
    });
    setModalOpen(true);
  };

  const handleModuleToggle = (moduleKey: string) => {
    setFormData(prev => {
      const nextModules = { ...prev.modules };
      const toggledValue = !(nextModules as any)[moduleKey];
      (nextModules as any)[moduleKey] = toggledValue;

      // Force exact synchronization in real-time for legacy keys
      if (moduleKey === 'master_inventory') {
        nextModules.inventory = toggledValue;
        nextModules.products = toggledValue;
        nextModules.warehouses = toggledValue;
      }

      return { ...prev, modules: nextModules };
    });
  };

  const handleCompanyToggle = (companyName: string) => {
    setFormData(prev => {
      const nextCompanies = { ...prev.modules.companies };
      nextCompanies[companyName] = !nextCompanies[companyName];
      return {
        ...prev,
        modules: {
          ...prev.modules,
          companies: nextCompanies
        }
      };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);

    try {
      const url = editingUserId 
        ? `${API_BASE_URL}/admins/${editingUserId}` 
        : `${API_BASE_URL}/admins`;
      const method = editingUserId ? 'PATCH' : 'POST';

      const payload: any = {
        username: formData.username.trim(),
        role: formData.role,
        status: formData.status,
        modules: formData.modules
      };

      if (formData.password && formData.password.trim() !== '') {
        payload.password = formData.password.trim();
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const backendMessage = Array.isArray(errorData.message) 
          ? errorData.message.join(', ') 
          : errorData.message || `HTTP Error ${res.status}`;
        throw new Error(backendMessage);
      }

      showToast(editingUserId ? "User permissions updated." : "New user created successfully.", "success");
      setModalOpen(false);
      fetchAdmins();
    } catch (err: any) {
      if (err.message.includes('Failed to fetch')) {
        showToast("Network Error: Could not reach the backend server.", "error");
      } else {
        showToast(err.message || "Operation failed. Verify database connectivity.", "error");
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteUser = async (id: number, targetUsername: string) => {
    if (targetUsername.toLowerCase() === loginUsername.toLowerCase()) {
      return showToast("Cannot delete your own active account.", "error");
    }
    if (!window.confirm(`Permanently remove access for user "${targetUsername}"?`)) return;

    try {
      const res = await fetch(`${API_BASE_URL}/admins/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      showToast("User removed from workspace.", "success");
      fetchAdmins();
    } catch (e) {
      showToast("Failed to delete user.", "error");
    }
  };

  return (
    <div className="flex h-screen w-full bg-[#F8FAFC] font-sans text-slate-900 overflow-hidden">
      
      {/* TOAST NOTIFICATION */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[100] px-5 py-3.5 rounded-xl shadow-xl font-bold text-sm transition-all ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'}`}>
          {toast.message}
        </div>
      )}

      {/* MAIN WORKSPACE */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0 shadow-sm z-10">
          <div>
            <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tighter">Access & Governance</h2>
          </div>
          <div className="flex gap-3">
            <button onClick={onBack} className="hidden sm:block px-5 py-2.5 bg-white border border-slate-300 text-slate-700 font-bold uppercase text-xs rounded-xl hover:bg-slate-50 transition-colors shadow-sm">
              Gateway
            </button>
            <button onClick={onLogout} className="px-5 py-2.5 bg-rose-500 text-white font-bold uppercase text-xs rounded-xl hover:bg-rose-600 transition-colors shadow-sm">
              Logout
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6 bg-[#F8FAFC]">
          <div className="max-w-7xl mx-auto space-y-6">
            
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
              <div>
                <h3 className="font-black text-slate-900 uppercase tracking-tight text-lg">Registered Personnel</h3>
                <p className="text-sm text-slate-500 font-medium mt-1">Control module availability and workspace memberships per account.</p>
              </div>
              {isCurrentUserSuperAdmin && (
                <button 
                  onClick={openCreateModal}
                  className="px-5 py-3 bg-blue-600 text-white font-bold uppercase text-xs rounded-xl shadow-sm hover:bg-blue-700 transition-colors whitespace-nowrap"
                >
                  + Register New Account
                </button>
              )}
            </div>

            {/* ACCOUNTS TABLE */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto shadow-sm">
              <table className="w-full text-left border-collapse min-w-[900px]">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="py-4 px-6 text-xs font-bold uppercase tracking-widest text-slate-500">User ID</th>
                    <th className="py-4 px-6 text-xs font-bold uppercase tracking-widest text-slate-500">Role</th>
                    <th className="py-4 px-6 text-xs font-bold uppercase tracking-widest text-slate-500">Status</th>
                    <th className="py-4 px-6 text-xs font-bold uppercase tracking-widest text-slate-500">Assigned Modules</th>
                    <th className="py-4 px-6 text-xs font-bold uppercase tracking-widest text-slate-500 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {adminUsers.map(user => {
                    const isSuper = user.role === 'Super Admin';
                    return (
                      <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-4 px-6">
                          <div className="font-black uppercase text-sm text-slate-900 flex items-center gap-2">
                            {user.username}
                            {user.username.toLowerCase() === loginUsername.toLowerCase() && (
                              <span className="text-[10px] font-bold uppercase px-2 py-0.5 bg-blue-100 text-blue-700 rounded-md">You</span>
                            )}
                          </div>
                        </td>
                        <td className="py-4 px-6">
                          <span className={`px-2.5 py-1 text-[10px] font-black uppercase rounded-md border ${isSuper ? 'border-purple-200 bg-purple-50 text-purple-700' : 'border-slate-200 bg-slate-100 text-slate-700'}`}>
                            {isSuper ? 'Super Admin' : 'Standard Admin'}
                          </span>
                        </td>
                        <td className="py-4 px-6">
                          <span className={`px-2.5 py-1 text-[10px] font-black uppercase rounded-md border ${user.status === 'Active' ? 'border-emerald-200 text-emerald-700 bg-emerald-50' : 'border-rose-200 text-rose-700 bg-rose-50'}`}>
                            {user.status || 'Active'}
                          </span>
                        </td>
                        <td className="py-4 px-6">
                          {isSuper ? (
                            <span className="text-[11px] font-bold text-purple-600 uppercase tracking-wide">Universal System Clearance</span>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {(user.modules?.master_inventory || user.modules?.inventory) && <span className="px-2 py-1 bg-blue-50 border border-blue-100 text-blue-700 font-bold text-[10px] uppercase rounded-md">Master Inventory</span>}
                              {user.modules?.purchasing && <span className="px-2 py-1 bg-slate-100 border border-slate-200 text-slate-700 font-bold text-[10px] uppercase rounded-md">Purchasing</span>}
                              {user.modules?.sales && <span className="px-2 py-1 bg-slate-100 border border-slate-200 text-slate-700 font-bold text-[10px] uppercase rounded-md">Sales</span>}
                              {user.modules?.payroll && <span className="px-2 py-1 bg-slate-100 border border-slate-200 text-slate-700 font-bold text-[10px] uppercase rounded-md">Payroll</span>}
                              {user.modules?.ai_docs && <span className="px-2 py-1 bg-slate-100 border border-slate-200 text-slate-700 font-bold text-[10px] uppercase rounded-md">AI Docs</span>}
                            </div>
                          )}
                        </td>
                        <td className="py-4 px-6 text-right">
                          {isCurrentUserSuperAdmin && (
                            <div className="flex justify-end gap-1.5">
                              <button onClick={() => openEditModal(user)} className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-[10px] font-bold uppercase hover:bg-slate-200 transition-colors">
                                Edit
                              </button>
                              {user.username.toLowerCase() !== loginUsername.toLowerCase() && (
                                <button onClick={() => handleDeleteUser(user.id, user.username)} className="px-3 py-1.5 bg-rose-50 text-rose-700 rounded-lg text-[10px] font-bold uppercase hover:bg-rose-100 transition-colors">
                                  Del
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>

      {/* EDIT / CREATE MODAL */}
      {modalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50 sticky top-0 z-20">
              <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight">
                {editingUserId ? `Configure Account: ${formData.username}` : 'Register Administrator'}
              </h2>
              <button type="button" onClick={() => setModalOpen(false)} className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-full transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-8 flex flex-col gap-6 bg-slate-50">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Username</label>
                  <input 
                    type="text" 
                    required 
                    value={formData.username} 
                    onChange={e => setFormData({ ...formData, username: e.target.value })} 
                    className="px-4 py-3 border border-slate-200 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white" 
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Password {editingUserId && '(Leave blank to retain)'}</label>
                  <input 
                    type="password" 
                    required={!editingUserId} 
                    value={formData.password} 
                    onChange={e => setFormData({ ...formData, password: e.target.value })} 
                    className="px-4 py-3 border border-slate-200 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white" 
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Account Role</label>
                  <select 
                    value={formData.role} 
                    onChange={e => setFormData({ ...formData, role: e.target.value })}
                    className="px-4 py-3 border border-slate-200 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white cursor-pointer"
                  >
                    <option value="Admin">Standard Admin</option>
                    <option value="Super Admin">Super Admin</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Account Status</label>
                  <select 
                    value={formData.status} 
                    onChange={e => setFormData({ ...formData, status: e.target.value })}
                    className="px-4 py-3 border border-slate-200 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white cursor-pointer"
                  >
                    <option value="Active">Active</option>
                    <option value="Suspended">Suspended</option>
                  </select>
                </div>
              </div>

              {/* MODULE ACCESS ASSIGNMENT */}
              {formData.role !== 'Super Admin' && (
                <div className="space-y-5">
                  <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
                    <label className="text-xs font-black uppercase block mb-4 text-slate-800 tracking-tight">Module Access Clearances</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <label className="flex items-center gap-3 cursor-pointer group">
                        <input 
                          type="checkbox" 
                          checked={formData.modules.master_inventory} 
                          onChange={() => handleModuleToggle('master_inventory')}
                          className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer" 
                        />
                        <span className="font-bold text-xs uppercase text-slate-700 group-hover:text-blue-600 transition-colors">Master Inventory</span>
                      </label>
                      <label className="flex items-center gap-3 cursor-pointer group">
                        <input 
                          type="checkbox" 
                          checked={formData.modules.purchasing} 
                          onChange={() => handleModuleToggle('purchasing')}
                          className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer" 
                        />
                        <span className="font-bold text-xs uppercase text-slate-700 group-hover:text-blue-600 transition-colors">Purchasing & POs</span>
                      </label>
                      <label className="flex items-center gap-3 cursor-pointer group">
                        <input 
                          type="checkbox" 
                          checked={formData.modules.sales} 
                          onChange={() => handleModuleToggle('sales')}
                          className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer" 
                        />
                        <span className="font-bold text-xs uppercase text-slate-700 group-hover:text-blue-600 transition-colors">Sales & Orders</span>
                      </label>
                      <label className="flex items-center gap-3 cursor-pointer group">
                        <input 
                          type="checkbox" 
                          checked={formData.modules.payroll} 
                          onChange={() => handleModuleToggle('payroll')}
                          className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer" 
                        />
                        <span className="font-bold text-xs uppercase text-slate-700 group-hover:text-blue-600 transition-colors">Payroll System</span>
                      </label>
                      <label className="flex items-center gap-3 cursor-pointer group">
                        <input 
                          type="checkbox" 
                          checked={formData.modules.ai_docs} 
                          onChange={() => handleModuleToggle('ai_docs')}
                          className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer" 
                        />
                        <span className="font-bold text-xs uppercase text-slate-700 group-hover:text-blue-600 transition-colors">AI Document Workspace</span>
                      </label>
                    </div>
                  </div>

                  {/* WORKSPACE CLEARANCES */}
                  <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
                    <label className="text-xs font-black uppercase block mb-4 text-slate-800 tracking-tight">Allowed Companies & Workspaces</label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                      {companiesList.map(comp => (
                        <label key={comp} className="flex items-center gap-3 cursor-pointer group">
                          <input 
                            type="checkbox" 
                            checked={Boolean(formData.modules.companies[comp])} 
                            onChange={() => handleCompanyToggle(comp)}
                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer" 
                          />
                          <span className="font-bold text-xs uppercase text-slate-700 group-hover:text-blue-600 transition-colors">{comp}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <button 
                type="submit" 
                disabled={isProcessing} 
                className="w-full py-4 mt-2 bg-slate-900 text-white rounded-xl font-black uppercase tracking-wider hover:bg-slate-800 transition-colors shadow-md disabled:opacity-50"
              >
                {isProcessing ? 'Saving Configuration...' : 'Apply User Credentials'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}