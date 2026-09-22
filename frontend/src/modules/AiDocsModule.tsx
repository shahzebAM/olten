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

interface DocumentWorkspaceProps {
  selectedCompany: string;
  loginUsername: string;
  API_BASE_URL: string;
  onBack: () => void;
}

export default function DocumentWorkspace({ selectedCompany, loginUsername, API_BASE_URL, onBack }: DocumentWorkspaceProps) {
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);

  // --- DATA STATES ---
  const [rootFolderId, setRootFolderId] = useState<string | null>(null);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [files, setFiles] = useState<DriveFile[]>([]);
  
  // --- LAYOUT STATES ---
  const [activeMenu, setActiveMenu] = useState<'Home' | 'Recent' | 'Starred' | 'Shared' | 'Trash'>('Home');
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<DriveFile | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ message: msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // --- API: FETCH DIRECTORY ---
  const fetchDirectory = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/docs/directory`, {
        headers: { 'x-company': selectedCompany, 'x-username': loginUsername }
      });
      if (!res.ok) throw new Error('Failed to load directory');
      const data = await res.json();
      
      setRootFolderId(data.companyFolderId);
      setFolders(data.folders || []);
      setFiles(data.files || []);
      if (!selectedFolderId) setSelectedFolderId(data.companyFolderId);
    } catch (err: any) {
      showToast(err.message || 'Error loading files', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDirectory();
  }, [selectedCompany]);

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
      const res = await fetch(`${API_BASE_URL}/docs/upload`, {
        method: 'POST',
        headers: { 'x-company': selectedCompany, 'x-username': loginUsername },
        body: formData,
      });
      if (!res.ok) throw new Error('Upload failed');
      showToast('File uploaded successfully', 'success');
      fetchDirectory();
    } catch (err: any) {
      showToast(err.message || 'Upload failed', 'error');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // --- API: DELETE FILE ---
  const handleDeleteFile = async (fileId: string) => {
    if (!window.confirm('Move to trash?')) return;
    try {
      const res = await fetch(`${API_BASE_URL}/docs/${fileId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      showToast('Moved to trash', 'success');
      if (selectedFile?.id === fileId) setSelectedFile(null);
      fetchDirectory();
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  // --- FILTERING LOGIC ---
  const activeFiles = useMemo(() => {
    let filtered = files;
    
    // Filter by Folder
    if (selectedFolderId) {
      filtered = filtered.filter(f => f.parents?.includes(selectedFolderId));
    }

    // Filter by Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(f => f.name.toLowerCase().includes(q));
    }

    // Sort: Newest first
    return filtered.sort((a, b) => new Date(b.createdTime || 0).getTime() - new Date(a.createdTime || 0).getTime());
  }, [files, selectedFolderId, searchQuery]);

  // --- HELPERS: ICONS & DATES ---
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
    return { color: 'bg-slate-400', label: 'TXT' };
  };

  return (
    <div className="flex flex-col h-screen w-full bg-[#FAFAFA] font-sans text-slate-800 overflow-hidden">
      
      {/* TOAST NOTIFICATION */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[100] px-5 py-3 rounded-lg shadow-xl font-bold text-sm border ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>
          {toast.message}
        </div>
      )}

      {/* TOP HEADER (MAC-STYLE) */}
      <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 shrink-0 z-20">
        <div className="flex items-center gap-6 w-1/4">
          <div className="flex gap-2">
            <div className="w-3 h-3 rounded-full bg-rose-400 cursor-pointer" onClick={onBack}></div>
            <div className="w-3 h-3 rounded-full bg-amber-400"></div>
            <div className="w-3 h-3 rounded-full bg-emerald-400"></div>
          </div>
          <div className="flex items-center gap-2 font-bold text-sm text-slate-700">
            <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 24 24"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/></svg>
            MyFiles
          </div>
        </div>

        <div className="flex-1 flex justify-center">
          <div className="relative w-full max-w-xl">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input 
              type="text" 
              placeholder="Search files, folders, or content..." 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-[#F3F4F6] text-sm pl-10 pr-4 py-1.5 rounded-md outline-none focus:ring-2 focus:ring-blue-500 transition-shadow placeholder:text-slate-400 font-medium"
            />
          </div>
        </div>

        <div className="w-1/4 flex justify-end items-center gap-4">
          <button onClick={() => fileInputRef.current?.click()} className="text-sm font-bold text-slate-600 hover:text-slate-900 flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
            Upload
          </button>
          <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
          <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs">
            {loginUsername.substring(0, 2).toUpperCase()}
          </div>
        </div>
      </header>

      {/* MAIN 3-PANE WORKSPACE */}
      <main className="flex flex-1 overflow-hidden">
        
        {/* PANE 1: LEFT SIDEBAR */}
        <aside className="w-[240px] bg-[#F9F9FB] border-r border-slate-200 flex flex-col py-4 shrink-0 overflow-y-auto">
          <div className="px-3 space-y-1 mb-8">
            <button onClick={() => { setActiveMenu('Home'); setSelectedFolderId(rootFolderId); setSelectedFile(null); }} className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeMenu === 'Home' ? 'bg-slate-200/50 text-slate-900' : 'text-slate-600 hover:bg-slate-100'}`}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
              Home
            </button>
            <button onClick={() => setActiveMenu('Recent')} className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeMenu === 'Recent' ? 'bg-slate-200/50 text-slate-900' : 'text-slate-600 hover:bg-slate-100'}`}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              Recent
            </button>
            <button onClick={() => setActiveMenu('Starred')} className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeMenu === 'Starred' ? 'bg-slate-200/50 text-slate-900' : 'text-slate-600 hover:bg-slate-100'}`}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
              Starred
            </button>
            <button onClick={() => setActiveMenu('Trash')} className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeMenu === 'Trash' ? 'bg-slate-200/50 text-slate-900' : 'text-slate-600 hover:bg-slate-100'}`}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              Trash
            </button>
          </div>

          <div className="px-3">
            <div className="flex items-center justify-between px-3 mb-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Folders</span>
              <button className="text-slate-400 hover:text-slate-600"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg></button>
            </div>
            <div className="space-y-0.5">
              {folders.map(folder => (
                <button 
                  key={folder.id} 
                  onClick={() => { setSelectedFolderId(folder.id); setSelectedFile(null); }}
                  className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-sm transition-colors ${selectedFolderId === folder.id ? 'bg-blue-50 text-blue-700 font-bold' : 'text-slate-600 font-medium hover:bg-slate-100'}`}
                >
                  <svg className={`w-4 h-4 ${selectedFolderId === folder.id ? 'text-blue-500' : 'text-blue-400'}`} fill="currentColor" viewBox="0 0 24 24"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
                  <span className="truncate">{folder.name}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* PANE 2: FILE LIST (MIDDLE COLUMN) */}
        <section className="w-[320px] bg-white border-r border-slate-200 flex flex-col shrink-0">
          <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-white z-10">
            <h2 className="text-xs font-black uppercase tracking-widest text-slate-400">
              {selectedFolderId === rootFolderId ? 'Root Directory' : folders.find(f => f.id === selectedFolderId)?.name || 'Files'}
            </h2>
            <button className="text-slate-400 hover:text-slate-600">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" /></svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            {isLoading ? (
              <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div></div>
            ) : activeFiles.length === 0 ? (
              <div className="text-center py-10 text-xs font-bold text-slate-400 uppercase tracking-widest">No files found</div>
            ) : (
              activeFiles.map(file => {
                const icon = getFileIconInfo(file.mimeType);
                const isSelected = selectedFile?.id === file.id;
                
                return (
                  <div 
                    key={file.id} 
                    onClick={() => setSelectedFile(file)}
                    className={`flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-all border ${isSelected ? 'bg-blue-50 border-blue-100 shadow-sm' : 'bg-transparent border-transparent hover:bg-slate-50'}`}
                  >
                    <div className={`w-8 h-8 rounded shrink-0 flex items-center justify-center text-white text-[10px] font-black ${icon.color}`}>
                      {icon.label}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className={`text-sm truncate ${isSelected ? 'font-bold text-blue-900' : 'font-medium text-slate-800'}`}>{file.name}</h4>
                      <p className={`text-[11px] mt-0.5 ${isSelected ? 'text-blue-600' : 'text-slate-400'}`}>
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
              <div className="h-16 border-b border-slate-100 flex justify-between items-center px-8 shrink-0 bg-white/80 backdrop-blur-sm z-10 absolute top-0 left-0 right-0">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded bg-slate-100 flex items-center justify-center text-slate-500">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">{selectedFile.name}</h3>
                    <p className="text-[10px] text-slate-400 uppercase tracking-widest">{formatDate(selectedFile.createdTime)}</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <button className="p-2 text-slate-400 hover:text-amber-400 transition-colors"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg></button>
                  <button className="px-4 py-1.5 border border-slate-200 rounded-md text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
                    Share
                  </button>
                  <button onClick={() => handleDeleteFile(selectedFile.id)} className="p-2 text-slate-400 hover:text-rose-500 transition-colors ml-2"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                </div>
              </div>

              {/* Document Canvas */}
              <div className="flex-1 overflow-y-auto pt-24 pb-12 px-12 lg:px-24">
                
                {/* Simulated clean document header */}
                <div className="max-w-3xl mx-auto mb-10">
                  <h1 className="text-4xl font-black text-slate-900 tracking-tight">{selectedFile.name.replace(/\.[^/.]+$/, "")}</h1>
                  <p className="text-sm font-medium text-slate-500 mt-3 italic">A securely synced document from your Google Drive workspace.</p>
                </div>

                <div className="max-w-3xl mx-auto bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden h-[600px] flex flex-col">
                  {selectedFile.webViewLink ? (
                    <iframe 
                      src={selectedFile.webViewLink.replace('/view', '/preview')} 
                      className="w-full h-full border-0"
                      title={selectedFile.name}
                      sandbox="allow-scripts allow-same-origin allow-popups"
                    />
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center p-10 text-center">
                      <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center text-slate-400 mb-4">
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      </div>
                      <h3 className="text-lg font-bold text-slate-700">Preview not available</h3>
                      <p className="text-sm text-slate-500 mt-2">This file type cannot be previewed natively.</p>
                      <button onClick={() => window.open(selectedFile.webViewLink, '_blank')} className="mt-6 px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg transition-colors">
                        Open in Google Drive
                      </button>
                    </div>
                  )}
                </div>

                <div className="max-w-3xl mx-auto mt-8 pt-6 border-t border-slate-100 flex justify-between items-center text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  <span>Workspace Sync: Active</span>
                  <span>Last edited {formatDate(selectedFile.createdTime)}</span>
                </div>
              </div>
            </>
          ) : (
            /* EMPTY STATE */
            <div className="flex-1 flex flex-col items-center justify-center bg-slate-50/50">
              <div className="w-24 h-24 mb-6">
                <svg className="w-full h-full text-slate-200" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              </div>
              <h3 className="text-xl font-black text-slate-400">Select a file to preview</h3>
              <p className="text-sm font-medium text-slate-400 mt-2">Choose a document from the middle column.</p>
            </div>
          )}
        </section>

      </main>
    </div>
  );
}