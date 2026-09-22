import React, { useState, useEffect, useMemo, useRef } from 'react';

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

  // --- DATA STATES ---
  const [rootFolderId, setRootFolderId] = useState<string | null>(null);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [files, setFiles] = useState<DriveFile[]>([]);
  
  // --- WORKSPACE STATES ---
  const [activeMenu, setActiveMenu] = useState<'Home' | 'Recent' | 'Starred' | 'Trash'>('Home');
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<DriveFile | null>(null);
  
  // --- SEARCH & AI STATES ---
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchingAi, setIsSearchingAi] = useState(false);
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);

  // --- MODAL STATES ---
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
  const fetchDirectory = async () => {
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
      if (!selectedFolderId) setSelectedFolderId(data.companyFolderId);
    } catch (err: any) {
      showToast(err.message || 'Error loading workspace', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDirectory();
  }, [selectedCompany]);

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
        body: JSON.stringify({ query: searchQuery, model: 'gemini-1.5-flash' })
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
    
    const formData = new FormData();
    formData.append('file', file);
    if (selectedFolderId && selectedFolderId !== rootFolderId) {
      formData.append('targetFolderId', selectedFolderId);
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
        body: JSON.stringify({ folderName: newFolderName })
      });
      if (!res.ok) throw new Error();
      setNewFolderName('');
      setIsNewFolderModalOpen(false);
      showToast('Folder created', 'success');
      fetchDirectory();
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

  // --- API: DELETE FILE/FOLDER ---
  const handleDelete = async (id: string, isFolder: boolean) => {
    if (!window.confirm(`Permanently delete this ${isFolder ? 'folder and its contents' : 'file'}?`)) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/docs/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      showToast('Deleted successfully', 'success');
      if (selectedFile?.id === id) setSelectedFile(null);
      if (selectedFolderId === id) setSelectedFolderId(rootFolderId);
      fetchDirectory();
    } catch {
      showToast('Failed to delete', 'error');
    }
  };

  // --- FILTERING LOGIC ---
  const activeFiles = useMemo(() => {
    let filtered = files;
    if (selectedFolderId) filtered = filtered.filter(f => f.parents?.includes(selectedFolderId));
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(f => f.name.toLowerCase().includes(q));
    }
    return filtered.sort((a, b) => new Date(b.createdTime || 0).getTime() - new Date(a.createdTime || 0).getTime());
  }, [files, selectedFolderId, searchQuery]);

  // --- HELPERS ---
  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Unknown Date';
    return new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const getFileIconInfo = (mimeType: string) => {
    if (mimeType.includes('document') || mimeType.includes('word')) return { color: 'bg-blue-500', label: 'W' };
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return { color: 'bg-emerald-500', label: 'X' };
    if (mimeType.includes('pdf')) return { color: 'bg-rose-500', label: 'PDF' };
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return { color: 'bg-amber-500', label: 'P' };
    if (mimeType.includes('image')) return { color: 'bg-purple-500', label: 'IMG' };
    return { color: 'bg-slate-500', label: 'TXT' };
  };

  return (
    <div className="flex flex-col h-screen w-full bg-[#FAFAFA] font-sans text-slate-800 overflow-hidden">
      
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[100] px-5 py-3 rounded-xl shadow-xl font-bold text-sm border ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>
          {toast.message}
        </div>
      )}

      {/* HEADER */}
      <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0 z-20">
        <div className="flex items-center gap-4 w-1/4">
          <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
          </button>
          <div className="flex items-center gap-2 font-black tracking-tight text-lg text-slate-800">
            {selectedCompany} Workspace
          </div>
        </div>

        <div className="flex-1 flex justify-center">
          <form onSubmit={handleGeminiSearch} className="relative w-full max-w-2xl group">
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input 
              type="text" 
              placeholder="Search files locally... or press Enter to ask Gemini AI" 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-[#F3F4F6] text-sm pl-11 pr-24 py-2.5 rounded-full outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent border border-transparent transition-all placeholder:text-slate-400 font-medium"
            />
            <button type="submit" disabled={isSearchingAi || !searchQuery.trim()} className="absolute right-1.5 top-1/2 -translate-y-1/2 px-4 py-1.5 bg-indigo-100 text-indigo-700 hover:bg-indigo-600 hover:text-white rounded-full text-[10px] font-black uppercase tracking-widest transition-colors disabled:opacity-50">
              {isSearchingAi ? 'Thinking...' : 'Ask AI'}
            </button>
          </form>
        </div>

        <div className="w-1/4 flex justify-end items-center gap-4">
          <button onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="text-sm font-bold bg-slate-900 text-white px-5 py-2 rounded-xl hover:bg-slate-800 transition-colors flex items-center gap-2 shadow-sm disabled:opacity-50">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
            {isUploading ? 'Uploading...' : 'Upload'}
          </button>
          <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
        </div>
      </header>

      {/* MAIN 3-PANE WORKSPACE */}
      <main className="flex flex-1 overflow-hidden">
        
        {/* PANE 1: LEFT SIDEBAR */}
        <aside className="w-[260px] bg-[#F9F9FB] border-r border-slate-200 flex flex-col py-6 shrink-0 overflow-y-auto">
          <div className="px-4 space-y-1 mb-8">
            <button onClick={() => { setActiveMenu('Home'); setSelectedFolderId(rootFolderId); setSelectedFile(null); }} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-bold transition-colors ${activeMenu === 'Home' ? 'bg-slate-200/60 text-slate-900' : 'text-slate-600 hover:bg-slate-100'}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg> Home
            </button>
            <button onClick={() => setActiveMenu('Recent')} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-bold transition-colors ${activeMenu === 'Recent' ? 'bg-slate-200/60 text-slate-900' : 'text-slate-600 hover:bg-slate-100'}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> Recent
            </button>
            <button onClick={() => setActiveMenu('Starred')} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-bold transition-colors ${activeMenu === 'Starred' ? 'bg-slate-200/60 text-slate-900' : 'text-slate-600 hover:bg-slate-100'}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg> Starred
            </button>
          </div>

          <div className="px-4">
            <div className="flex items-center justify-between px-3 mb-3">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Folders</span>
              <button onClick={() => setIsNewFolderModalOpen(true)} className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors" title="Create Subfolder">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg>
              </button>
            </div>
            <div className="space-y-1">
              {folders.map(folder => (
                <div key={folder.id} className="group flex items-center justify-between px-3 py-2 rounded-lg transition-colors hover:bg-slate-100">
                  <button 
                    onClick={() => { setSelectedFolderId(folder.id); setSelectedFile(null); }}
                    className={`flex-1 flex items-center gap-3 text-sm truncate ${selectedFolderId === folder.id ? 'text-indigo-700 font-bold' : 'text-slate-600 font-medium'}`}
                  >
                    <svg className={`w-4 h-4 shrink-0 ${selectedFolderId === folder.id ? 'text-indigo-500' : 'text-slate-400'}`} fill="currentColor" viewBox="0 0 24 24"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
                    <span className="truncate">{folder.name}</span>
                  </button>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button onClick={() => { setRenameTarget({ id: folder.id, name: folder.name }); setNewRenameValue(folder.name); }} className="p-1.5 text-slate-400 hover:text-amber-500 rounded hover:bg-white" title="Rename"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg></button>
                    <button onClick={() => handleDelete(folder.id, true)} className="p-1.5 text-slate-400 hover:text-rose-500 rounded hover:bg-white" title="Delete"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* PANE 2: FILE LIST (MIDDLE COLUMN) */}
        <section className="w-[360px] bg-white border-r border-slate-200 flex flex-col shrink-0">
          <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-white z-10">
            <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              {selectedFolderId === rootFolderId ? 'Root Directory' : folders.find(f => f.id === selectedFolderId)?.name || 'Files'}
            </h2>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-1 relative">
            
            {/* GEMINI AI ANSWER BOX */}
            {aiAnswer && (
              <div className="mx-2 mb-4 p-4 bg-indigo-50 border border-indigo-100 rounded-xl shadow-sm relative animate-in fade-in slide-in-from-top-2">
                <button onClick={() => setAiAnswer(null)} className="absolute top-2 right-2 p-1 text-indigo-300 hover:text-indigo-600 bg-white rounded-md shadow-sm"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg></button>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="w-2 h-2 bg-indigo-600 rounded-full animate-pulse"></span>
                  <span className="text-[10px] font-black uppercase tracking-widest text-indigo-800">Gemini AI Engine</span>
                </div>
                <p className="text-xs font-medium text-slate-700 leading-relaxed whitespace-pre-wrap">{aiAnswer}</p>
              </div>
            )}

            {isLoading ? (
              <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div></div>
            ) : activeFiles.length === 0 ? (
              <div className="text-center py-16 text-[10px] font-black text-slate-300 uppercase tracking-widest">No files found</div>
            ) : (
              activeFiles.map(file => {
                const icon = getFileIconInfo(file.mimeType);
                const isSelected = selectedFile?.id === file.id;
                
                return (
                  <div 
                    key={file.id} 
                    onClick={() => setSelectedFile(file)}
                    className={`flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-all border ${isSelected ? 'bg-indigo-50 border-indigo-100 shadow-sm' : 'bg-transparent border-transparent hover:bg-slate-50'}`}
                  >
                    <div className={`w-8 h-8 rounded shrink-0 flex items-center justify-center text-white text-[10px] font-black ${icon.color}`}>
                      {icon.label}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className={`text-sm truncate ${isSelected ? 'font-bold text-indigo-900' : 'font-medium text-slate-700'}`}>{file.name}</h4>
                      <p className={`text-[11px] mt-0.5 ${isSelected ? 'text-indigo-600' : 'text-slate-400'}`}>
                        {formatDate(file.createdTime)} • {file.size ? (parseInt(file.size) / 1024).toFixed(1) + ' KB' : 'Drive Doc'}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* PANE 3: DOCUMENT PREVIEW (RIGHT COLUMN) */}
        <section className="flex-1 bg-white flex flex-col relative overflow-hidden">
          {selectedFile ? (
            <>
              {/* Document Toolbar */}
              <div className="h-16 border-b border-slate-100 flex justify-between items-center px-8 shrink-0 bg-white z-10 absolute top-0 left-0 right-0">
                <div className="flex items-center gap-3 truncate max-w-[50%]">
                  <div className="w-8 h-8 rounded bg-slate-100 flex items-center justify-center text-slate-500 shrink-0">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                  </div>
                  <div className="truncate">
                    <h3 className="text-sm font-bold text-slate-900 truncate">{selectedFile.name}</h3>
                    <p className="text-[10px] text-slate-400 uppercase tracking-widest">{formatDate(selectedFile.createdTime)}</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => { setRenameTarget({ id: selectedFile.id, name: selectedFile.name }); setNewRenameValue(selectedFile.name); }} className="px-4 py-2 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg> Rename
                  </button>
                  <button onClick={() => window.open(selectedFile.webViewLink, '_blank')} className="px-4 py-2 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg> Open in Drive
                  </button>
                  <div className="w-px h-6 bg-slate-200 mx-1"></div>
                  <button onClick={() => handleDelete(selectedFile.id, false)} className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors" title="Delete File">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
              </div>

              {/* Document Canvas */}
              <div className="flex-1 overflow-y-auto pt-24 pb-12 px-8 lg:px-16 bg-[#F8FAFC]">
                <div className="max-w-4xl mx-auto bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden h-[75vh] flex flex-col">
                  {selectedFile.webViewLink ? (
                    <iframe 
                      src={selectedFile.webViewLink.replace('/view', '/preview')} 
                      className="w-full h-full border-0"
                      title={selectedFile.name}
                      sandbox="allow-scripts allow-same-origin allow-popups"
                    />
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center p-10 text-center">
                      <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center text-slate-400 mb-4"><svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg></div>
                      <h3 className="text-lg font-bold text-slate-700">Preview not available</h3>
                      <button onClick={() => window.open(selectedFile.webViewLink, '_blank')} className="mt-4 px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-lg transition-colors">Open externally</button>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            /* EMPTY STATE */
            <div className="flex-1 flex flex-col items-center justify-center bg-slate-50">
              <div className="w-20 h-20 mb-6 bg-white rounded-2xl shadow-sm border border-slate-100 flex items-center justify-center">
                <svg className="w-10 h-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              </div>
              <h3 className="text-xl font-black text-slate-400 tracking-tight">Select a file to preview</h3>
              <p className="text-sm font-medium text-slate-400 mt-2">Choose a document from the middle column.</p>
            </div>
          )}
        </section>

      </main>

      {/* --- MODALS --- */}
      
      {/* Create Folder Modal */}
      {isNewFolderModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-base font-black text-slate-800 uppercase tracking-tight mb-4">Create Subfolder</h3>
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
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-base font-black text-slate-800 uppercase tracking-tight mb-4">Rename Item</h3>
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

    </div>
  );
}