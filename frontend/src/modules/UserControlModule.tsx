import React, { useState } from 'react';

export default function UserControlModule({ 
  adminUsers, setAdminUsers, fetchAdmins, loginUsername, 
  isCurrentUserSuperAdmin, API_BASE_URL, globalModules, onBack, onLogout 
}: any) {
  
  const [newAdminModules, setNewAdminModules] = useState({ payroll: true, ai_docs: false, companies: { Surgicom: true, Olten: true, Ordent: true } });
  const [newAdminUsername, setNewAdminUsername] = useState('');
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [editingPasswordId, setEditingPasswordId] = useState<number | null>(null);
  const [newResetPassword, setNewResetPassword] = useState('');
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const isPayrollEnabled = globalModules?.payroll;
  const isAiDocsEnabled = globalModules?.ai_docs;

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => { setToast(null); }, 3500);
  };

  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAdminUsername || !newAdminPassword) return;
    setIsSaving(true);
    
    try {
      const response = await fetch(`${API_BASE_URL}/admins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: newAdminUsername.trim(), password: newAdminPassword, modules: newAdminModules })
      });
      if (!response.ok) throw new Error("Username already exists");
      await fetchAdmins(); 
      setNewAdminUsername('');
      setNewAdminPassword('');
      setNewAdminModules({ payroll: true, ai_docs: false, companies: { Surgicom: true, Olten: true, Ordent: true } });
      showToast("New user added successfully!", "success");
    } catch (error) { showToast("Failed to add user. Username might exist.", "error"); } 
    finally { setIsSaving(false); }
  };

  const handleDeleteAdmin = async (id: number, role: string) => {
    if (role === 'Super Admin') {
      const superAdminCount = adminUsers.filter((u: any) => u.role === 'Super Admin').length;
      if (superAdminCount <= 1) { showToast("Action Denied: Cannot delete the last Super Admin.", "error"); return; }
    }
    const targetUser = adminUsers.find((u: any) => u.id === id);
    try {
      const response = await fetch(`${API_BASE_URL}/admins/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error();
      showToast("User removed successfully.", "success");
      if (targetUser?.username.toLowerCase() === loginUsername.trim().toLowerCase()) {
        setTimeout(() => { onLogout(); }, 1500); return;
      }
      await fetchAdmins(); 
    } catch (error) { showToast("Failed to delete user.", "error"); }
  };

  const handleUpdateRole = async (id: number, newRole: string) => {
    const user = adminUsers.find((u: any) => u.id === id);
    if (user?.role === 'Super Admin' && newRole !== 'Super Admin') {
      const superAdminCount = adminUsers.filter((u: any) => u.role === 'Super Admin').length;
      if (superAdminCount <= 1) { showToast("Action Denied: System requires at least one Super Admin.", "error"); return; }
    }
    if (setAdminUsers) setAdminUsers(adminUsers.map((u: any) => u.id === id ? { ...u, role: newRole } : u));
    try {
      await fetch(`${API_BASE_URL}/admins/${id}/role`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: newRole }) });
      showToast(`User role changed to ${newRole}`, "success");
      await fetchAdmins();
    } catch (e) { showToast("Failed to update role.", "error"); fetchAdmins(); }
  };

  const handleUpdateModules = async (id: number, currentModules: any, toggleModule: 'payroll' | 'ai_docs') => {
    const safeModules = currentModules || { payroll: false, ai_docs: false };
    const newModules = { ...safeModules, [toggleModule]: !safeModules[toggleModule] };
    if (setAdminUsers) setAdminUsers(adminUsers.map((u: any) => u.id === id ? { ...u, modules: newModules } : u));
    try {
      const response = await fetch(`${API_BASE_URL}/admins/${id}/modules`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modules: newModules }) });
      if (!response.ok) throw new Error();
      showToast("Module access updated!", "success");
      await fetchAdmins();
    } catch (e) { showToast("Failed to update module access.", "error"); fetchAdmins(); }
  };

  const handleUpdateCompanyAccess = async (id: number, currentModules: any, toggleCompany: 'Surgicom' | 'Olten' | 'Ordent') => {
    const safeModules = currentModules || { companies: { Surgicom: false, Olten: false, Ordent: false } };
    const safeCompanies = safeModules.companies || { Surgicom: false, Olten: false, Ordent: false };
    const newModules = { ...safeModules, companies: { ...safeCompanies, [toggleCompany]: !safeCompanies[toggleCompany] } };
    if (setAdminUsers) setAdminUsers(adminUsers.map((u: any) => u.id === id ? { ...u, modules: newModules } : u));
    try {
      const response = await fetch(`${API_BASE_URL}/admins/${id}/modules`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modules: newModules }) });
      if (!response.ok) throw new Error();
      showToast("Company access updated!", "success");
      await fetchAdmins();
    } catch (e) { showToast("Failed to update company access.", "error"); fetchAdmins(); }
  };

  const handleResetPassword = async (id: number) => {
    if (!newResetPassword) { showToast("Please type a new password first.", "error"); return; }
    setIsSaving(true);
    try {
      const response = await fetch(`${API_BASE_URL}/admins/${id}/password`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: newResetPassword }) });
      if (!response.ok) throw new Error("Failed to reset password.");
      showToast("User's password has been securely reset!", "success");
      setEditingPasswordId(null); setNewResetPassword('');
    } catch (error) { showToast("Failed to reset password.", "error"); } finally { setIsSaving(false); }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center p-4 sm:p-8 font-sans selection:bg-slate-200">
      <div className="w-full max-w-6xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-800 tracking-tight">Access Management</h1>
          <p className="text-slate-500 text-sm mt-1">Assign company access and configure role permissions.</p>
        </div>
        <button onClick={onBack} className="w-full sm:w-auto justify-center px-5 py-2.5 bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-xl shadow-sm font-bold transition-colors flex items-center gap-2 text-sm shrink-0">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
          Back to Organizations
        </button>
      </div>

      <div className="w-full max-w-6xl space-y-6 pb-12">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden w-full">
          <div className="p-4 sm:p-6 border-b border-slate-200 bg-slate-50/50">
            <h2 className="text-lg font-bold text-slate-800">System Users</h2>
          </div>
          <div className="overflow-x-auto w-full">
            <table className="w-full text-left border-collapse min-w-[900px]">
              <thead className="bg-slate-100 border-b border-slate-200">
                <tr>
                  <th className="py-3.5 px-4 sm:px-6 text-xs font-semibold text-slate-600 uppercase">Username</th>
                  <th className="py-3.5 px-4 sm:px-6 text-xs font-semibold text-slate-600 uppercase">Role Level</th>
                  {isCurrentUserSuperAdmin && <th className="py-3.5 px-4 sm:px-6 text-xs font-semibold text-slate-600 uppercase text-center">Company Assignment</th>}
                  {(isPayrollEnabled || isAiDocsEnabled) && isCurrentUserSuperAdmin && <th className="py-3.5 px-4 sm:px-6 text-xs font-semibold text-slate-600 uppercase text-center">Modules Assignment</th>}
                  <th className="py-3.5 px-4 sm:px-6 text-xs font-semibold text-slate-600 uppercase text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {adminUsers.map((user: any) => (
                  <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-4 px-4 sm:px-6 font-bold text-slate-800 flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full text-white flex items-center justify-center text-xs shrink-0 ${user.role === 'Super Admin' ? 'bg-slate-800' : 'bg-slate-400'}`}>
                        {user.username.charAt(0).toUpperCase()}
                      </div>
                      <span className="truncate">{user.username}</span>
                    </td>
                    <td className="py-4 px-4 sm:px-6 text-sm text-slate-600">
                      {isCurrentUserSuperAdmin ? (
                        <select value={user.role || 'Admin'} onChange={(e) => handleUpdateRole(user.id, e.target.value)} className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-bold text-slate-700 outline-none focus:border-slate-500 shadow-sm cursor-pointer w-full sm:w-auto">
                          <option value="Admin">Standard Admin</option>
                          <option value="Super Admin">Super Admin</option>
                        </select>
                      ) : (user.role || 'Admin')}
                    </td>
                    {isCurrentUserSuperAdmin && (
                      <td className="py-4 px-4 sm:px-6">
                        {user.role !== 'Super Admin' ? (
                          <div className="flex items-center justify-center gap-3 sm:gap-4 flex-wrap">
                            <label className="flex items-center gap-1.5 cursor-pointer group hover:opacity-80">
                              <input type="checkbox" checked={user.modules?.companies?.Surgicom || false} onChange={() => handleUpdateCompanyAccess(user.id, user.modules, 'Surgicom')} className="w-4 h-4 text-emerald-600 rounded border-slate-300 cursor-pointer shrink-0" />
                              <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Sur</span>
                            </label>
                            <label className="flex items-center gap-1.5 cursor-pointer group hover:opacity-80">
                              <input type="checkbox" checked={user.modules?.companies?.Olten || false} onChange={() => handleUpdateCompanyAccess(user.id, user.modules, 'Olten')} className="w-4 h-4 text-blue-600 rounded border-slate-300 cursor-pointer shrink-0" />
                              <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Olt</span>
                            </label>
                            <label className="flex items-center gap-1.5 cursor-pointer group hover:opacity-80">
                              <input type="checkbox" checked={user.modules?.companies?.Ordent || false} onChange={() => handleUpdateCompanyAccess(user.id, user.modules, 'Ordent')} className="w-4 h-4 text-amber-600 rounded border-slate-300 cursor-pointer shrink-0" />
                              <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Ord</span>
                            </label>
                          </div>
                        ) : (<div className="text-center text-[10px] text-slate-400 uppercase tracking-widest font-bold">Unrestricted</div>)}
                      </td>
                    )}
                    {(isPayrollEnabled || isAiDocsEnabled) && isCurrentUserSuperAdmin && (
                      <td className="py-4 px-4 sm:px-6">
                        {user.role !== 'Super Admin' ? (
                          <div className="flex items-center justify-center gap-3 sm:gap-4 flex-wrap">
                            {isPayrollEnabled && (
                              <label className="flex items-center gap-1.5 cursor-pointer group hover:opacity-80">
                                <input type="checkbox" checked={user.modules?.payroll || false} onChange={() => handleUpdateModules(user.id, user.modules, 'payroll')} className="w-4 h-4 text-indigo-600 rounded border-slate-300 cursor-pointer shrink-0" />
                                <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Payroll</span>
                              </label>
                            )}
                            {isAiDocsEnabled && (
                              <label className="flex items-center gap-1.5 cursor-pointer group hover:opacity-80">
                                <input type="checkbox" checked={user.modules?.ai_docs || false} onChange={() => handleUpdateModules(user.id, user.modules, 'ai_docs')} className="w-4 h-4 text-indigo-600 rounded border-slate-300 cursor-pointer shrink-0" />
                                <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">AI Docs</span>
                              </label>
                            )}
                          </div>
                        ) : (<div className="text-center text-[10px] text-slate-400 uppercase tracking-widest font-bold">Unrestricted</div>)}
                      </td>
                    )}
                    <td className="py-4 px-4 sm:px-6 text-right">
                      {editingPasswordId === user.id ? (
                        <div className="flex items-center justify-end gap-2 mb-2">
                          <input type="text" placeholder="New Pwd" value={newResetPassword} onChange={e => setNewResetPassword(e.target.value)} className="px-2 py-1 border border-slate-300 rounded text-xs w-20 sm:w-24 shadow-sm outline-none" />
                          <button onClick={() => handleResetPassword(user.id)} className="text-emerald-600 font-bold text-xs uppercase hover:underline">Save</button>
                          <button onClick={() => setEditingPasswordId(null)} className="text-slate-400 font-bold text-xs uppercase hover:underline">X</button>
                        </div>
                      ) : (
                        <button onClick={() => setEditingPasswordId(user.id)} className="text-slate-600 hover:text-slate-900 text-[10px] tracking-wide font-bold uppercase transition-colors bg-white px-2 py-1 mb-2 sm:mb-0 mr-0 sm:mr-3 rounded border border-slate-200 shadow-sm hover:shadow block sm:inline-block ml-auto">Reset Pwd</button>
                      )}
                      <button onClick={() => handleDeleteAdmin(user.id, user.role)} className="text-red-500 hover:text-red-700 text-[11px] tracking-wider font-bold uppercase transition-colors">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-8 w-full">
          <h3 className="text-lg font-bold text-slate-800 mb-6">Register New User</h3>
          <form onSubmit={handleAddAdmin} className="flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row gap-4 sm:gap-5 items-start sm:items-end w-full">
              <div className="flex flex-col gap-1.5 w-full">
                <label className="text-sm font-medium text-slate-600">Username</label>
                <input type="text" required value={newAdminUsername} onChange={(e) => setNewAdminUsername(e.target.value)} className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-slate-500 shadow-sm" placeholder="New username" />
              </div>
              <div className="flex flex-col gap-1.5 w-full">
                <label className="text-sm font-medium text-slate-600">Password</label>
                <input type="password" required value={newAdminPassword} onChange={(e) => setNewAdminPassword(e.target.value)} className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-slate-500 shadow-sm" placeholder="••••••••" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8 pt-4 border-t border-slate-100">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-bold text-slate-700 uppercase tracking-wide">Assign Company Access</label>
                <div className="flex flex-row flex-wrap gap-4 sm:gap-8 mt-2">
                  <label className="flex items-center gap-3 cursor-pointer w-fit">
                    <input type="checkbox" checked={newAdminModules.companies.Surgicom} onChange={e => setNewAdminModules({...newAdminModules, companies: {...newAdminModules.companies, Surgicom: e.target.checked}})} className="w-5 h-5 text-emerald-600 rounded border-slate-300 focus:ring-emerald-600 shrink-0" />
                    <span className="text-sm font-medium text-slate-700">Surgicom</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer w-fit">
                    <input type="checkbox" checked={newAdminModules.companies.Olten} onChange={e => setNewAdminModules({...newAdminModules, companies: {...newAdminModules.companies, Olten: e.target.checked}})} className="w-5 h-5 text-blue-600 rounded border-slate-300 focus:ring-blue-600 shrink-0" />
                    <span className="text-sm font-medium text-slate-700">Olten</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer w-fit">
                    <input type="checkbox" checked={newAdminModules.companies.Ordent} onChange={e => setNewAdminModules({...newAdminModules, companies: {...newAdminModules.companies, Ordent: e.target.checked}})} className="w-5 h-5 text-amber-600 rounded border-slate-300 focus:ring-amber-600 shrink-0" />
                    <span className="text-sm font-medium text-slate-700">Ordent</span>
                  </label>
                </div>
              </div>

              {(isPayrollEnabled || isAiDocsEnabled) && (
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-bold text-slate-700 uppercase tracking-wide">Assign Module Access</label>
                  <div className="flex flex-row flex-wrap gap-4 sm:gap-8 mt-2">
                    {isPayrollEnabled && (
                      <label className="flex items-center gap-3 cursor-pointer w-fit">
                        <input type="checkbox" checked={newAdminModules.payroll} onChange={e => setNewAdminModules({...newAdminModules, payroll: e.target.checked})} className="w-5 h-5 text-slate-800 rounded border-slate-300 focus:ring-slate-800 shrink-0" />
                        <span className="text-sm font-medium text-slate-700">Payroll Engine</span>
                      </label>
                    )}
                    {isAiDocsEnabled && (
                      <label className="flex items-center gap-3 cursor-pointer w-fit">
                        <input type="checkbox" checked={newAdminModules.ai_docs} onChange={e => setNewAdminModules({...newAdminModules, ai_docs: e.target.checked})} className="w-5 h-5 text-slate-800 rounded border-slate-300 focus:ring-slate-800 shrink-0" />
                        <span className="text-sm font-medium text-slate-700">AI Documentation</span>
                      </label>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="pt-4 sm:pt-2">
              <button type="submit" disabled={isSaving} className="w-full sm:w-auto px-8 py-3.5 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-xl shadow-sm whitespace-nowrap disabled:opacity-50 transition-colors">
                {isSaving ? 'Registering...' : 'Save Database User'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {toast && (
        <div className={`fixed bottom-6 right-6 z-[100] px-5 py-3.5 rounded-xl shadow-xl font-semibold flex items-center gap-3 animate-in slide-in-from-right-8 slide-in-from-bottom-2 fade-in duration-300 ease-out border ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>
          {toast.type === 'success' ? (
            <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
          ) : (
            <svg className="w-5 h-5 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          )}
          {toast.message}
        </div>
      )}
    </div>
  );
}