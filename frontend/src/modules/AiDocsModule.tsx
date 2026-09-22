import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';

// --- INTERFACES ---
interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  createdTime?: string;
  size?: string;
  parents?: string[];
}

interface DriveFolder {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
}

interface AiDocsModuleProps {
  selectedCompany: string;
  loginUsername: string;
  API_BASE_URL: string;
  onBack: () => void;
}

export default function AiDocsModule({ selectedCompany, loginUsername, API_BASE_URL, onBack }: AiDocsModuleProps) {
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);

  // --- RESPONSIVE STATES ---
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  // --- DATA STATES ---
  const [rootFolderId, setRootFolderId] = useState<string | null>(null);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [files, setFiles] = useState<DriveFile[]>([]);
  
  // --- WORKSPACE & TREE STATES ---
  const [activeMenu, setActiveMenu] = useState('Documents');
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null); // Determines where uploads/new folders go
  const [selectedFile, setSelectedFile] = useState<DriveFile | null>(null);  // Determines what is previewed
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  
  // --- MULTI-SELECT STATE ---
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  // --- SEARCH & AI STATES ---
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedModel, setSelectedModel] = useState('gemini-1.5-flash');
  const [isSearchingAi, setIsSearchingAi] = useState(false);
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);

  // --- MODAL STATES ---
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [isNewFolderModalOpen, setIsNewFolderModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renameTarget, setRenameTarget] = useState<{ id: string, name: string } | null>(null);
  const [newRenameValue, setNewRenameValue] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ message: msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // --- API: FETCH DIRECTORY ---
  const fetchDirectory = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/docs/directory`, {
        headers: { 'x-company': selectedCompany, 'x-username': loginUsername }
      });
      if (!res.ok) throw new Error('Failed to load directory');
      const data = await res.json();
      
      setRootFolderId(data.companyFolderId);
      setFolders(data.folders || []);
      setFiles(data.files || []);
      
      if (!activeFolderId) {
        setActiveFolderId(data.companyFolderId);
        setExpandedFolders(prev => new Set(prev).add(data.companyFolderId));
      }
    } catch (err: any) {
      showToast(err.message || 'Error loading workspace', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [API_BASE_URL, selectedCompany, loginUsername, activeFolderId]);

  useEffect(() => {
    fetchDirectory();
  }, [fetchDirectory]);

  // --- API: GEMINI SEARCH ---
  const handleGeminiSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearchingAi(true);
    setAiAnswer(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/docs/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-company': selectedCompany, 'x-username': loginUsername },
        body: JSON.stringify({ query: searchQuery, model: selectedModel })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'AI Search failed');
      setAiAnswer(data.answer);
    } catch (err: any) {
      setAiAnswer(`Error: ${err.message}`);
    } finally {
      setIsSearchingAi(false);
    }
  };

  // --- API: UPLOAD FILE ---
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    setIsAddMenuOpen(false);
    
    const formData = new FormData();
    formData.append('file', file);
    if (activeFolderId && activeFolderId !== rootFolderId) {
      formData.append('targetFolderId', activeFolderId);
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/docs/upload`, {
        method: 'POST',
        headers: { 'x-company': selectedCompany, 'x-username': loginUsername },
        body: formData,
      });
      if (!res.ok) throw new Error('Upload failed');
      showToast('Document uploaded successfully', 'success');
      fetchDirectory();
      if (activeFolderId) setExpandedFolders(prev => new Set(prev).add(activeFolderId));
    } catch (err: any) {
      showToast(err.message || 'Upload failed', 'error');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // --- API: CREATE FOLDER ---
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/docs/folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-company': selectedCompany },
        body: JSON.stringify({ folderName: newFolderName, parentFolderId: activeFolderId !== rootFolderId ? activeFolderId : undefined })
      });
      if (!res.ok) throw new Error();
      setNewFolderName('');
      setIsNewFolderModalOpen(false);
      showToast('Folder created', 'success');
      fetchDirectory();
      if (activeFolderId) setExpandedFolders(prev => new Set(prev).add(activeFolderId));
    } catch {
      showToast('Could not create folder', 'error');
    }
  };

  // --- API: RENAME FILE/FOLDER ---
  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameTarget || !newRenameValue.trim()) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/docs/folder/${renameTarget.id}/rename`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newName: newRenameValue.trim() })
      });
      if (!res.ok) throw new Error();
      showToast('Renamed successfully', 'success');
      setRenameTarget(null);
      if (selectedFile?.id === renameTarget.id) {
        setSelectedFile({ ...selectedFile, name: newRenameValue.trim() });
      }
      fetchDirectory();
    } catch {
      showToast('Failed to rename', 'error');
    }
  };

  // --- API: BULK DELETE ---
  const handleBulkDelete = async () => {
    if (selectedItems.size === 0) return;
    if (!window.confirm(`Permanently delete ${selectedItems.size} selected item(s)?`)) return;

    setIsLoading(true);
    try {
      const promises = Array.from(selectedItems).map(id =>
        fetch(`${API_BASE_URL}/api/docs/${id}`, { method: 'DELETE' })
      );
      await Promise.all(promises);
      showToast(`Deleted ${selectedItems.size} item(s)`, 'success');
      
      if (selectedFile && selectedItems.has(selectedFile.id)) setSelectedFile(null);
      if (activeFolderId && selectedItems.has(activeFolderId)) setActiveFolderId(rootFolderId);
      
      setSelectedItems(new Set());
      fetchDirectory();
    } catch {
      showToast('Failed to delete some items', 'error');
      fetchDirectory();
    } finally {
      setIsLoading(false);
    }
  };

  // --- TREE HELPERS ---
  const toggleFolderExpand = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const newSet = new Set(expandedFolders);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setExpandedFolders(newSet);
  };

  const toggleSelection = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSet = new Set(selectedItems);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedItems(newSet);
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.includes('document') || mimeType.includes('word')) return <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 20V4h5v7h7v9H6z"/></svg>;
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return <svg className="w-4 h-4 text-emerald-500" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 20V4h5v7h7v9H6z"/></svg>;
    if (mimeType.includes('pdf')) return <svg className="w-4 h-4 text-rose-500" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 20V4h5v7h7v9H6z"/></svg>;
    return <svg className="w-4 h-4 text-slate-400" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 20V4h5v7h7v9H6z"/></svg>;
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Unknown Date';
    return new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // --- RECURSIVE TREE RENDERER ---
  const renderTree = (parentId: string, depth: number = 0) => {
    const childFolders = folders.filter(f => f.parents?.includes(parentId));
    const childFiles = files.filter(f => f.parents?.includes(parentId));

    return (
      <div className="flex flex-col w-full" key={`group-${parentId}`}>
        {childFolders.map(folder => (
          <React.Fragment key={folder.id}>
            <div 
              onClick={() => { setActiveFolderId(folder.id); toggleFolderExpand(folder.id); }}
              className={`group flex items-center w-full px-2 py-1.5 cursor-pointer text-sm transition-colors border-l-2 ${activeFolderId === folder.id ? 'bg-indigo-50/50 border-indigo-500' : 'border-transparent hover:bg-slate-50'}`}
              style={{ paddingLeft: `${depth * 16 + 8}px` }}
            >
              <div onClick={(e) => toggleSelection(folder.id, e)} className={`w-4 h-4 mr-2 border rounded flex items-center justify-center shrink-0 transition-colors ${selectedItems.has(folder.id) ? 'bg-indigo-500 border-indigo-500' : 'border-slate-300 bg-white group-hover:border-slate-400'}`}>
                {selectedItems.has(folder.id) && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"/></svg>}
              </div>
              <button onClick={(e) => toggleFolderExpand(folder.id, e)} className="p-0.5 text-slate-400 hover:text-slate-700 shrink-0 mr-1 transition-transform" style={{ transform: expandedFolders.has(folder.id) ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"/></svg>
              </button>
              <svg className={`w-4 h-4 mr-2 shrink-0 ${activeFolderId === folder.id ? 'text-indigo-500' : 'text-blue-400'}`} fill="currentColor" viewBox="0 0 24 24"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
              <span className={`truncate flex-1 ${activeFolderId === folder.id ? 'font-bold text-indigo-900' : 'font-medium text-slate-700'}`}>{folder.name}</span>
              
              <div className="opacity-0 group-hover:opacity-100 flex items-center shrink-0 pl-2">
                <button onClick={(e) => { e.stopPropagation(); setRenameTarget({ id: folder.id, name: folder.name }); setNewRenameValue(folder.name); }} className="p-1 text-slate-400 hover:text-indigo-600 rounded" title="Rename"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg></button>
              </div>
            </div>
            {expandedFolders.has(folder.id) && renderTree(folder.id, depth + 1)}
          </React.Fragment>
        ))}

        {childFiles.map(file => (
          <div 
            key={file.id}
            onClick={() => { setSelectedFile(file); setActiveFolderId(parentId); }}
            className={`group flex items-center w-full px-2 py-1.5 cursor-pointer text-sm transition-colors border-l-2 ${selectedFile?.id === file.id ? 'bg-indigo-50/50 border-indigo-500' : 'border-transparent hover:bg-slate-50'}`}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
          >
            <div onClick={(e) => toggleSelection(file.id, e)} className={`w-4 h-4 mr-2 border rounded flex items-center justify-center shrink-0 transition-colors ${selectedItems.has(file.id) ? 'bg-indigo-500 border-indigo-500' : 'border-slate-300 bg-white group-hover:border-slate-400'}`}>
              {selectedItems.has(file.id) && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"/></svg>}
            </div>
            <div className="w-4 shrink-0 mr-1"></div> {/* Spacer for alignment with chevrons */}
            <div className="mr-2 shrink-0">{getFileIcon(file.mimeType)}</div>
            <span className={`truncate flex-1 ${selectedFile?.id === file.id ? 'font-bold text-indigo-900' : 'font-medium text-slate-600'}`}>{file.name}</span>
            
            <div className="opacity-0 group-hover:opacity-100 flex items-center shrink-0 pl-2">
              <button onClick={(e) => { e.stopPropagation(); setRenameTarget({ id: file.id, name: file.name }); setNewRenameValue(file.name); }} className="p-1 text-slate-400 hover:text-indigo-600 rounded" title="Rename"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg></button>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-screen w-full bg-[#FBFBFC] font-sans text-slate-800 overflow-hidden relative">
      
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[100] px-5 py-3 rounded-lg shadow-lg font-bold text-sm border ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>
          {toast.message}
        </div>
      )}

      {/* TOP HEADER */}
      <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 lg:px-8 shrink-0 z-30 shadow-sm relative">
        <div className="flex items-center gap-4 w-1/4">
          <button onClick={() => setIsMobileNavOpen(!isMobileNavOpen)} className="lg:hidden p-2 text-slate-500 hover:bg-slate-100 rounded-lg">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <button onClick={onBack} className="hidden lg:flex p-1.5 hover:bg-slate-100 rounded-md text-slate-400 hover:text-slate-700 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
          </button>
        </div>

        <div className="flex-1 flex justify-center max-w-3xl">
          <form onSubmit={handleGeminiSearch} className="relative w-full flex bg-[#F4F5F7] rounded-lg border border-transparent focus-within:border-indigo-300 focus-within:bg-white transition-all overflow-hidden shadow-sm">
            <div className="pl-4 flex items-center shrink-0">
              <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            </div>
            <input 
              type="text" 
              placeholder="Search documents, folders, or keywords..." 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-transparent text-sm px-3 py-2.5 outline-none placeholder:text-slate-400 font-medium"
            />
            <select 
              value={selectedModel} 
              onChange={(e) => setSelectedModel(e.target.value)}
              className="hidden sm:block bg-transparent text-xs font-bold text-slate-500 border-l border-slate-200 outline-none px-3 cursor-pointer"
            >
              <option value="gemini-1.5-flash">1.5 Flash</option>
              <option value="gemini-1.5-pro">1.5 Pro</option>
            </select>
          </form>
        </div>

        <div className="w-1/4 flex justify-end items-center gap-4">
          <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-black text-sm uppercase shadow-sm">
            {loginUsername.substring(0, 1)}
          </div>
        </div>
      </header>

      {/* MAIN 3-PANE WORKSPACE */}
      <main className="flex flex-1 overflow-hidden relative">
        
        {/* PANE 1: GLOBAL LEFT NAV */}
        <nav className={`absolute lg:static top-0 left-0 h-full w-[240px] bg-[#FBFBFC] border-r border-slate-200 flex flex-col py-6 z-40 transform transition-transform duration-300 ${isMobileNavOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:translate-x-0'}`}>
          <div className="px-6 mb-8 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500 text-white flex items-center justify-center shadow-sm">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 20V4h5v7h7v9H6z"/></svg>
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-800 leading-tight truncate">{selectedCompany}</h2>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Workspace</p>
            </div>
          </div>

          <div className="px-3 space-y-1 flex-1">
            {['Dashboard', 'Documents', 'Contracts', 'Reports', 'Shared', 'Archive'].map((menu) => (
              <button 
                key={menu}
                onClick={() => { setActiveMenu(menu); if (window.innerWidth < 1024) setIsMobileNavOpen(false); }}
                className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeMenu === menu ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
              >
                {menu === 'Dashboard' && <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>}
                {menu === 'Documents' && <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>}
                {menu === 'Contracts' && <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>}
                {menu === 'Reports' && <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>}
                {menu === 'Shared' && <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/></svg>}
                {menu === 'Archive' && <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"/></svg>}
                {menu}
              </button>
            ))}
          </div>

          <div className="px-6 mt-auto">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"/></svg>
              <div>
                <p className="text-[11px] font-black text-slate-700">Storage</p>
                <p className="text-[10px] text-slate-400 font-medium">Drive Sync Active</p>
              </div>
            </div>
            <div className="w-full bg-slate-200 h-1.5 rounded-full mt-3 overflow-hidden">
              <div className="bg-blue-500 w-1/3 h-full rounded-full"></div>
            </div>
          </div>
        </nav>

        {/* PANE 2: NESTED TREE SIDEBAR */}
        <section className={`w-full lg:w-[300px] bg-[#FBFBFC] border-r border-slate-200 flex flex-col shrink-0 transition-opacity ${selectedFile ? 'hidden lg:flex' : 'flex'}`}>
          <div className="px-5 py-5 border-b border-slate-200/60 flex justify-between items-center z-10 relative">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-black text-slate-800">All Documents</h2>
              <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" /></svg>
            </div>
            
            {/* ACTION BUTTON: CREATE / UPLOAD / DELETE */}
            {selectedItems.size > 0 ? (
              <button onClick={handleBulkDelete} disabled={isLoading} className="text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 shadow-sm">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg> Delete ({selectedItems.size})
              </button>
            ) : (
              <div className="relative">
                <button onClick={() => setIsAddMenuOpen(!isAddMenuOpen)} className="p-1.5 text-slate-500 hover:bg-slate-200 rounded-md transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg>
                </button>
                {isAddMenuOpen && (
                  <div className="absolute top-full right-0 mt-1 w-48 bg-white border border-slate-200 rounded-xl shadow-xl py-1.5 z-50 animate-in fade-in zoom-in-95">
                    <button onClick={() => fileInputRef.current?.click()} className="w-full text-left px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                      <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg> Upload File
                    </button>
                    <button onClick={() => { setIsNewFolderModalOpen(true); setIsAddMenuOpen(false); }} className="w-full text-left px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                      <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4"/></svg> New Folder
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto py-3 relative">
            
            {/* GEMINI AI ANSWER BOX */}
            {aiAnswer && (
              <div className="mx-3 mb-4 p-4 bg-white border border-indigo-100 rounded-xl shadow-sm relative animate-in fade-in slide-in-from-top-2">
                <button onClick={() => setAiAnswer(null)} className="absolute top-2 right-2 p-1 text-slate-400 hover:text-indigo-600 rounded-md"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg></button>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="w-2 h-2 bg-indigo-600 rounded-full animate-pulse"></span>
                  <span className="text-[10px] font-black uppercase tracking-widest text-indigo-800">Gemini Answer</span>
                </div>
                <p className="text-xs font-medium text-slate-700 leading-relaxed whitespace-pre-wrap">{aiAnswer}</p>
              </div>
            )}

            {isLoading ? (
              <div className="flex justify-center py-10"><div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div></div>
            ) : (
              <div className="px-2">
                {rootFolderId && renderTree(rootFolderId, 0)}
              </div>
            )}
          </div>
        </section>

        {/* PANE 3: DOCUMENT PREVIEW (RIGHT MAIN AREA) */}
        <section className={`absolute lg:static top-0 left-0 w-full lg:w-auto h-full flex-1 bg-white lg:rounded-tl-[32px] lg:border-t lg:border-l border-slate-200 lg:shadow-[-4px_4px_24px_rgba(0,0,0,0.02)] flex-col z-20 lg:z-auto transition-transform duration-300 ${selectedFile ? 'translate-x-0 flex' : 'translate-x-full lg:translate-x-0 hidden lg:flex'}`}>
          {selectedFile ? (
            <>
              {/* Preview Header */}
              <div className="h-20 lg:h-24 border-b border-slate-100 flex flex-wrap justify-between items-center px-6 lg:px-12 shrink-0 bg-white lg:rounded-tl-[32px]">
                <div className="flex items-center gap-4 truncate max-w-[60%]">
                  <button onClick={() => setSelectedFile(null)} className="lg:hidden p-2 -ml-2 text-slate-400 hover:text-slate-800 rounded-lg">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
                  </button>
                  <div className="w-10 h-10 rounded-lg bg-blue-50 hidden lg:flex items-center justify-center shrink-0">
                    {getFileIcon(selectedFile.mimeType)}
                  </div>
                  <div className="truncate">
                    <h3 className="text-base lg:text-lg font-black text-slate-900 truncate tracking-tight">{selectedFile.name.replace(/\.[^/.]+$/, "")}</h3>
                    <p className="text-[11px] font-medium text-slate-400 mt-0.5">{formatDate(selectedFile.createdTime)} • {(parseInt(selectedFile.size || '0') / 1024).toFixed(0)} KB • Edited via Drive</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-3 shrink-0">
                  <button className="hidden sm:flex px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 items-center gap-2 transition-colors shadow-sm">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/></svg> Share
                  </button>
                  <button onClick={() => window.open(selectedFile.webViewLink, '_blank')} className="hidden sm:flex px-4 py-2 border border-slate-200 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-50 items-center gap-2 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg> Download
                  </button>
                  <button className="p-2 border border-slate-200 text-slate-500 rounded-lg hover:bg-slate-50 transition-colors">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
                  </button>
                </div>
              </div>

              {/* Document Canvas Area */}
              <div className="flex-1 overflow-y-auto p-4 lg:p-12 bg-white flex justify-center">
                <div className="w-full max-w-4xl flex flex-col">
                  {/* Internal Doc Header */}
                  <div className="flex justify-between items-end mb-8 border-b border-slate-200 pb-4 hidden lg:flex">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{selectedCompany}</span>
                    <span className="text-[10px] font-bold text-rose-500 uppercase tracking-widest">Confidential</span>
                  </div>
                  
                  {/* The Document Iframe */}
                  <div className="flex-1 min-h-[60vh] bg-white rounded-lg overflow-hidden flex flex-col">
                    {selectedFile.webViewLink ? (
                      <iframe 
                        src={selectedFile.webViewLink.replace('/view', '/preview')} 
                        className="w-full h-full border-0 rounded-xl"
                        title={selectedFile.name}
                        sandbox="allow-scripts allow-same-origin allow-popups"
                      />
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center p-10 text-center bg-slate-50 rounded-xl border border-slate-100">
                        <div className="w-16 h-16 bg-white rounded-full shadow-sm flex items-center justify-center mb-4">{getFileIcon(selectedFile.mimeType)}</div>
                        <h3 className="text-lg font-black text-slate-800">Preview not available</h3>
                        <p className="text-sm font-medium text-slate-500 mt-2 max-w-sm">Google Drive cannot render this file type in a native iframe window.</p>
                        <button onClick={() => window.open(selectedFile.webViewLink, '_blank')} className="mt-6 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-lg transition-colors shadow-sm">Open externally</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            /* EMPTY STATE */
            <div className="flex-1 flex flex-col items-center justify-center">
              <div className="w-24 h-24 mb-6 bg-slate-50 rounded-3xl border border-slate-100 flex items-center justify-center">
                <svg className="w-12 h-12 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              </div>
              <h3 className="text-xl font-black text-slate-800 tracking-tight">Select a document</h3>
              <p className="text-sm font-medium text-slate-400 mt-2 text-center max-w-xs">Choose a file from the directory tree to preview it here.</p>
            </div>
          )}
        </section>

      </main>

      {/* --- MODALS --- */}
      
      {/* Create Folder Modal */}
      {isNewFolderModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-[60] animate-in fade-in">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-base font-black text-slate-800 tracking-tight mb-4">Create New Folder</h3>
            <form onSubmit={handleCreateFolder} className="space-y-4">
              <input type="text" placeholder="Folder name..." autoFocus value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-indigo-500 focus:bg-white transition-colors" required />
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setIsNewFolderModalOpen(false)} className="px-4 py-2 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-50">Cancel</button>
                <button type="submit" className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold shadow-sm">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {renameTarget && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-[60] animate-in fade-in">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-base font-black text-slate-800 tracking-tight mb-4">Rename Document</h3>
            <form onSubmit={handleRename} className="space-y-4">
              <input type="text" placeholder="New name..." autoFocus value={newRenameValue} onChange={(e) => setNewRenameValue(e.target.value)} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-amber-500 focus:bg-white transition-colors" required />
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setRenameTarget(null)} className="px-4 py-2 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-50">Cancel</button>
                <button type="submit" className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold shadow-sm">Rename</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />

    </div>
  );
}