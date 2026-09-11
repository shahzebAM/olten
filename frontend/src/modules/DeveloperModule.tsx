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
    role: 'Admin', // CRITICAL FIX: Reverted to 'Admin' to match Auth system
    status: 'Active',
    modules: {
      payroll: false,
      ai_docs: false,
      master_inventory: true, 
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
    
    // Safety fallback: if user is stuck as "Staff", force them to "Admin" in the edit window
    let currentRole = user.role || 'Admin';
    if (currentRole.toLowerCase() === 'staff') {
      currentRole = 'Admin';
    }

    setFormData({
      username: user.username,
      password: '', 
      role: currentRole,
      status: user.status || 'Active',
      modules: {
        payroll: Boolean(user.modules?.payroll),
        ai_docs: Boolean(user.modules?.ai_docs),
        master_inventory: Boolean(user.modules?.master_inventory ?? user.modules?.inventory ?? true),
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
      (nextModules as any)[moduleKey] = !(nextModules as any)[moduleKey];
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
        payload.password = formData.password;
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
      showToast(err.message || "Operation failed. Verify database connectivity.", "error");
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
    <div className="flex h-screen w-full bg-slate-50 font-sans text-slate-900 overflow-hidden">
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[100] px-5 py-3.5 rounded-none border-2 shadow-[8px_8px_0px_0px_rgba(15,23,42,1)] font-bold text-sm ${toast.type === 'success' ? 'bg-white border-emerald-500 text-emerald-700' : 'bg-white border-rose-500 text-rose-700'}`}>
          {toast.message}
        </div>
      )}

      {/* MAIN WORKSPACE */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-20 bg-white border-b-2 border-slate-900 flex items-center justify-between px-6 shrink-0 shadow-sm z-10">
          <div>
            <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tighter">Access & Governance</h2>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Staff Credentials & Module Privileges</p>
          </div>
          <div className="flex gap-4">
            <button onClick={onBack} className="px-4 py-2 bg-transparent border-2 border-slate-900 text-slate-900 font-black uppercase text-xs hover:bg-slate-900 hover:text-white transition-colors">
              Gateway
            </button>
            <button onClick={onLogout} className="px-4 py-2 bg-rose-500 border-2 border-slate-900 text-white font-black uppercase text-xs shadow-[4px_4px_0px_0px_rgba(15,23,42,1)] hover:translate-y-1 hover:shadow-none transition-all">
              Logout
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6 max-w-7xl mx-auto w-full space-y-6">
          <div className="flex justify-between items-center bg-white border-2 border-slate-900 p-6 shadow-[8px_8px_0px_0px_rgba(15,23,42,1)]">
            <div>
              <h3 className="font-black text-slate-900 uppercase tracking-wider">Registered Personnel</h3>
              <p className="text-xs text-slate-500 font-medium">Control module availability and workspace memberships per account.</p>
            </div>
            {isCurrentUserSuperAdmin && (
              <button 
                onClick={openCreateModal}
                className="px-6 py-3 bg-blue-600 border-2 border-slate-900 text-white font-black uppercase text-xs shadow-[4px_4px_0px_0px_rgba(15,23,42,1)] hover:translate-y-1 hover:shadow-none transition-all"
              >
                + Register New Account
              </button>
            )}
          </div>

          {/* ACCOUNTS TABLE */}
          <div className="bg-white border-2 border-slate-900 shadow-[8px_8px_0px_0px_rgba(15,23,42,1)] overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[900px]">
              <thead className="bg-slate-900 text-white">
                <tr>
                  <th className="py-3 px-4 text-xs font-black uppercase tracking-widest border-2 border-slate-900">User ID</th>
                  <th className="py-3 px-4 text-xs font-black uppercase tracking-widest border-2 border-slate-900">Role</th>
                  <th className="py-3 px-4 text-xs font-black uppercase tracking-widest border-2 border-slate-900">Status</th>
                  <th className="py-3 px-4 text-xs font-black uppercase tracking-widest border-2 border-slate-900">Assigned Modules</th>
                  <th className="py-3 px-4 text-xs font-black uppercase tracking-widest border-2 border-slate-900 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y-2 divide-slate-200">
                {adminUsers.map(user => {
                  const isSuper = user.role === 'Super Admin';
                  return (
                    <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-4 px-4 font-black uppercase text-sm border-r-2 border-slate-200">
                        {user.username}
                        {user.username.toLowerCase() === loginUsername.toLowerCase() && (
                          <span className="ml-2 text-[9px] font-black uppercase px-1.5 py-0.5 bg-blue-100 text-blue-800 border border-blue-300">You</span>
                        )}
                      </td>
                      <td className="py-4 px-4 border-r-2 border-slate-200">
                        <span className={`px-2 py-1 text-[10px] font-black uppercase border-2 ${isSuper ? 'border-purple-600 bg-purple-50 text-purple-700' : 'border-slate-800 bg-slate-100 text-slate-800'}`}>
                          {user.role}
                        </span>
                      </td>
                      <td className="py-4 px-4 border-r-2 border-slate-200">
                        <span className={`px-2 py-0.5 text-[10px] font-black uppercase border ${user.status === 'Active' ? 'border-emerald-500 text-emerald-700 bg-emerald-50' : 'border-rose-500 text-rose-700 bg-rose-50'}`}>
                          {user.status || 'Active'}
                        </span>
                      </td>
                      <td className="py-4 px-4 border-r-2 border-slate-200">
                        {isSuper ? (
                          <span className="text-xs font-bold text-purple-700 uppercase">Universal System Clearance</span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {(user.modules?.master_inventory || user.modules?.inventory) && <span className="px-2 py-0.5 bg-blue-50 border border-blue-200 text-blue-700 font-bold text-[10px] uppercase">Master Inventory</span>}
                            {user.modules?.purchasing && <span className="px-2 py-0.5 bg-slate-100 border border-slate-300 text-slate-700 font-bold text-[10px] uppercase">Purchasing</span>}
                            {user.modules?.sales && <span className="px-2 py-0.5 bg-slate-100 border border-slate-300 text-slate-700 font-bold text-[10px] uppercase">Sales</span>}
                            {user.modules?.payroll && <span className="px-2 py-0.5 bg-slate-100 border border-slate-300 text-slate-700 font-bold text-[10px] uppercase">Payroll</span>}
                            {user.modules?.ai_docs && <span className="px-2 py-0.5 bg-slate-100 border border-slate-300 text-slate-700 font-bold text-[10px] uppercase">AI Docs</span>}
                          </div>
                        )}
                      </td>
                      <td className="py-4 px-4 text-right">
                        {isCurrentUserSuperAdmin && (
                          <div className="flex justify-end gap-2">
                            <button onClick={() => openEditModal(user)} className="px-3 py-1.5 bg-white border-2 border-slate-900 text-slate-900 text-[10px] font-black uppercase hover:bg-slate-900 hover:text-white transition-colors">
                              Edit
                            </button>
                            {user.username.toLowerCase() !== loginUsername.toLowerCase() && (
                              <button onClick={() => handleDeleteUser(user.id, user.username)} className="px-3 py-1.5 bg-white border-2 border-slate-900 text-rose-600 text-[10px] font-black uppercase hover:bg-rose-50 transition-colors">
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
        </main>
      </div>

      {/* EDIT / CREATE MODAL */}
      {modalOpen && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
          <div className="bg-white border-2 border-slate-900 shadow-[8px_8px_0px_0px_rgba(15,23,42,1)] w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col">
            <div className="p-5 border-b-2 border-slate-900 flex justify-between items-center bg-slate-100">
              <h2 className="text-xl font-black text-slate-900 uppercase">
                {editingUserId ? `Configure Account: ${formData.username}` : 'Create Admin Member'}
              </h2>
              <button onClick={() => setModalOpen(false)} className="font-black text-slate-900 hover:text-rose-600 uppercase text-sm">
                Close
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-black uppercase">Username</label>
                  <input 
                    type="text" 
                    required 
                    value={formData.username} 
                    onChange={e => setFormData({ ...formData, username: e.target.value })} 
                    className="px-4 py-2 border-2 border-slate-900 font-bold outline-none" 
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-black uppercase">Password {editingUserId && '(Leave blank to retain)'}</label>
                  <input 
                    type="password" 
                    required={!editingUserId} 
                    value={formData.password} 
                    onChange={e => setFormData({ ...formData, password: e.target.value })} 
                    className="px-4 py-2 border-2 border-slate-900 font-bold outline-none" 
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-black uppercase">Account Role</label>
                  <select 
                    value={formData.role} 
                    onChange={e => setFormData({ ...formData, role: e.target.value })}
                    className="px-4 py-2 border-2 border-slate-900 font-bold outline-none bg-white"
                  >
                    <option value="Admin">Standard Admin</option>
                    <option value="Super Admin">Super Admin</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-black uppercase">Account Status</label>
                  <select 
                    value={formData.status} 
                    onChange={e => setFormData({ ...formData, status: e.target.value })}
                    className="px-4 py-2 border-2 border-slate-900 font-bold outline-none bg-white"
                  >
                    <option value="Active">Active</option>
                    <option value="Suspended">Suspended</option>
                  </select>
                </div>
              </div>

              {/* MODULE ACCESS ASSIGNMENT */}
              {formData.role !== 'Super Admin' && (
                <div className="space-y-4">
                  <div className="border-2 border-slate-900 p-4 bg-slate-50">
                    <label className="text-xs font-black uppercase block mb-3 text-slate-800">Module Access Clearances</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={formData.modules.master_inventory} 
                          onChange={() => handleModuleToggle('master_inventory')}
                          className="w-5 h-5 border-2 border-slate-900" 
                        />
                        <span className="font-bold text-xs uppercase">Master Inventory (Catalog & Hubs)</span>
                      </label>
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={formData.modules.purchasing} 
                          onChange={() => handleModuleToggle('purchasing')}
                          className="w-5 h-5 border-2 border-slate-900" 
                        />
                        <span className="font-bold text-xs uppercase">Purchasing & POs</span>
                      </label>
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={formData.modules.sales} 
                          onChange={() => handleModuleToggle('sales')}
                          className="w-5 h-5 border-2 border-slate-900" 
                        />
                        <span className="font-bold text-xs uppercase">Sales & Orders</span>
                      </label>
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={formData.modules.payroll} 
                          onChange={() => handleModuleToggle('payroll')}
                          className="w-5 h-5 border-2 border-slate-900" 
                        />
                        <span className="font-bold text-xs uppercase">Payroll System</span>
                      </label>
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={formData.modules.ai_docs} 
                          onChange={() => handleModuleToggle('ai_docs')}
                          className="w-5 h-5 border-2 border-slate-900" 
                        />
                        <span className="font-bold text-xs uppercase">AI Document Workspace</span>
                      </label>
                    </div>
                  </div>

                  {/* WORKSPACE CLEARANCES */}
                  <div className="border-2 border-slate-900 p-4 bg-slate-50">
                    <label className="text-xs font-black uppercase block mb-3 text-slate-800">Allowed Companies & Workspaces</label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {companiesList.map(comp => (
                        <label key={comp} className="flex items-center gap-2 cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={Boolean(formData.modules.companies[comp])} 
                            onChange={() => handleCompanyToggle(comp)}
                            className="w-4 h-4 border-2 border-slate-900" 
                          />
                          <span className="font-bold text-xs uppercase">{comp}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <button 
                type="submit" 
                disabled={isProcessing} 
                className="w-full py-4 bg-slate-900 text-white font-black uppercase border-2 border-slate-900 hover:bg-transparent hover:text-slate-900 transition-colors disabled:opacity-50 mt-2"
              >
                {isProcessing ? 'Saving...' : 'Apply User Credentials'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}