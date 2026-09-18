import React, { useState, useEffect, useCallback } from 'react';

interface DriveItem {
  id: string;
  name: string;
  mimeType?: string;
  webViewLink?: string;
  parents?: string[];
}

interface AiDocsModuleProps {
  selectedCompany: string;
  loginUsername: string;
  API_BASE_URL: string;
  onBack: () => void;
}

export default function AiDocsModule({ selectedCompany, loginUsername, API_BASE_URL, onBack }: AiDocsModuleProps) {
  const [folders, setFolders] = useState<DriveItem[]>([]);
  const [files, setFiles] = useState<DriveItem[]>([]);
  const [companyFolderId, setCompanyFolderId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [currentFolder, setCurrentFolder] = useState<{ id: string; name: string } | null>(null);

  // Upload/New Folder States
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [destinationChoice, setDestinationChoice] = useState<'root' | 'subfolder'>('root');
  const [selectedSubfolderId, setSelectedSubfolderId] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);
  const [isNewFolderModalOpen, setIsNewFolderModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // Search & AI States
  const [searchQuery, setSearchQuery] = useState('');
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState('gemini-3.6-flash');
  const [isSearching, setIsSearching] = useState(false);

  // --- BULK DELETION STATES ---
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchDirectory = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/api/docs/directory`, {
        headers: { 'x-company': selectedCompany },
      });
      const data = await res.json();
      setFolders(data.folders || []);
      setFiles(data.files || []);
      setCompanyFolderId(data.companyFolderId || '');
    } catch (err) {
      console.error('Failed to fetch directory', err);
    } finally {
      setLoading(false);
    }
  }, [selectedCompany, API_BASE_URL]);

  useEffect(() => {
    fetchDirectory();
  }, [fetchDirectory]);

  // Handle Document Upload
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', selectedFile);

    const targetFolder = destinationChoice === 'subfolder' ? selectedSubfolderId : companyFolderId;
    if (targetFolder) formData.append('targetFolderId', targetFolder);

    try {
      const res = await fetch(`${API_BASE_URL}/api/docs/upload`, {
        method: 'POST',
        headers: {
          'x-company': selectedCompany,
          'x-username': loginUsername,
        },
        body: formData,
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || `Server Error: ${res.status}`);

      alert(`Document uploaded successfully!`);
      setSelectedFile(null);
      setIsUploadModalOpen(false);
      fetchDirectory();
    } catch (err: any) {
      alert(`Failed to upload document: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  // Handle New Folder Creation
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;

    try {
      const res = await fetch(`${API_BASE_URL}/api/docs/folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-company': selectedCompany },
        body: JSON.stringify({ folderName: newFolderName }),
      });
      if (!res.ok) throw new Error();
      setNewFolderName('');
      setIsNewFolderModalOpen(false);
      fetchDirectory();
    } catch {
      alert('Could not create folder.');
    }
  };

  // Handle Search & Ask Gemini
  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setAiAnswer(null);

    try {
      const res = await fetch(`${API_BASE_URL}/api/docs/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-company': selectedCompany, 'x-username': loginUsername },
        body: JSON.stringify({ query: searchQuery, model: selectedModel }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Search failed');

      setAiAnswer(data.answer);
    } catch (err: any) {
      setAiAnswer(`Error: ${err.message}`);
    } finally {
      setIsSearching(false);
    }
  };

  // Helper variables for UI rendering
  const rootFiles = files.filter(f => !folders.some(folder => f.parents?.includes(folder.id)));
  const currentFolderFiles = currentFolder && currentFolder.id !== 'root' 
    ? files.filter(f => f.parents?.includes(currentFolder.id)) 
    : rootFiles;

  const totalSelectable = currentFolder ? currentFolderFiles.length : (folders.length + rootFiles.length);

  // --- BULK DELETION LOGIC ---
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      let idsToSelect: string[] = [];
      if (!currentFolder) {
        // At root level, select all folders and root files
        idsToSelect = [
          ...folders.map(f => f.id),
          ...rootFiles.map(f => f.id)
        ];
      } else {
        // Inside a subfolder, select all files
        idsToSelect = currentFolderFiles.map(f => f.id);
      }
      setSelectedItemIds(idsToSelect);
    } else {
      setSelectedItemIds([]);
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedItemIds(prev => prev.includes(id) ? prev.filter(itemId => itemId !== id) : [...prev, id]);
  };

  const handleDeleteSelected = async () => {
    if (selectedItemIds.length === 0) return;
    if (!window.confirm(`Permanently wipe ${selectedItemIds.length} items from Drive and Database?`)) return;

    setIsDeleting(true);
    try {
      await Promise.all(selectedItemIds.map(id => 
        fetch(`${API_BASE_URL}/api/docs/${id}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' }
        })
      ));
      
      setSelectedItemIds([]);
      setIsDeleteMode(false);
      fetchDirectory(); 
    } catch (error) {
      alert("Failed to delete some items.");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-slate-900 font-sans flex flex-col">
      <header className="border-b border-slate-100 px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
          </button>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">{selectedCompany} Workspace</h1>
            <p className="text-xs text-slate-400 font-medium tracking-wide">Google Drive & Gemini Index</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={() => setIsNewFolderModalOpen(true)} className="px-4 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
            + New Folder
          </button>
          <button onClick={() => setIsUploadModalOpen(true)} className="px-6 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-sm font-bold tracking-wide transition-colors shadow-sm">
            Upload Document
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-8 py-10 flex flex-col items-center">
        <form onSubmit={handleSearchSubmit} className="w-full max-w-2xl mb-12">
          <div className="relative flex items-center">
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={`Search ${selectedCompany} documents with Gemini...`} className="w-full pl-14 pr-24 py-4 bg-white border-2 border-slate-300 focus:border-indigo-600 rounded-full text-base font-medium shadow-sm outline-none transition-all placeholder:text-slate-400" />
            <div className="absolute left-5 text-slate-400">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            </div>
            <button type="submit" disabled={isSearching} className="absolute right-3 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50">
              {isSearching ? 'Scanning...' : 'Search'}
            </button>
          </div>

          <div className="flex items-center justify-center gap-3 mt-4">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">AI Engine:</span>
            <button type="button" onClick={() => setSelectedModel('gemini-3.6-flash')} className={`px-4 py-1.5 rounded-full text-[10px] font-bold transition-all shadow-sm ${selectedModel === 'gemini-3.6-flash' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'}`}>⚡ 3.6 Flash (Fast)</button>
            <button type="button" onClick={() => setSelectedModel('gemini-3.5-flash-lite')} className={`px-4 py-1.5 rounded-full text-[10px] font-bold transition-all shadow-sm ${selectedModel === 'gemini-3.5-flash-lite' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'}`}>🪙 3.5 Flash-Lite (Credit Saver)</button>
          </div>

          {isSearching && (
            <div className="w-full h-1 mt-6 bg-indigo-50 rounded-full overflow-hidden flex">
              <div className="w-1/3 h-full bg-indigo-500 rounded-full animate-[ping_1.5s_cubic-bezier(0,0,0.2,1)_infinite]"></div>
            </div>
          )}
        </form>

        {aiAnswer && (
          <div className="w-full max-w-3xl mb-10 p-6 bg-slate-50 border border-indigo-100 rounded-2xl shadow-sm">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-200">
              <span className="text-xs font-black tracking-widest text-indigo-700 uppercase">Gemini AI Answer</span>
              <button onClick={() => setAiAnswer(null)} className="text-xs font-bold text-slate-400 hover:text-slate-600">Close</button>
            </div>
            <p className="text-sm leading-relaxed text-slate-700 font-medium whitespace-pre-wrap">{aiAnswer}</p>
          </div>
        )}

        <div className="w-full">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 text-sm">
              <button onClick={() => setCurrentFolder(null)} className={`font-bold transition-colors ${currentFolder ? 'text-indigo-600 hover:underline' : 'text-slate-800 uppercase tracking-widest text-sm'}`}>Drive Directory</button>
              {currentFolder && (
                <>
                  <span className="text-slate-400 font-bold">/</span>
                  <span className="font-extrabold text-slate-800 flex items-center gap-1.5 bg-amber-100 text-amber-900 px-3 py-1 rounded-md text-xs">📁 {currentFolder.name}</span>
                </>
              )}
            </div>
            {currentFolder && (
              <button onClick={() => setCurrentFolder(null)} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-lg transition-colors">← Back</button>
            )}
          </div>

          {/* DELETION CONTROLS */}
          <div className="flex justify-between items-center bg-slate-50 border border-slate-200 p-3 rounded-xl mb-6">
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <input type="checkbox" checked={isDeleteMode} onChange={(e) => { setIsDeleteMode(e.target.checked); setSelectedItemIds([]); }} className="w-5 h-5 text-rose-600 focus:ring-rose-500 rounded border-slate-300 cursor-pointer" />
              <span className="text-xs font-black uppercase tracking-widest text-slate-700">Enable Deletion Mode</span>
            </label>
            
            {isDeleteMode && (
              <div className="flex items-center gap-4 animate-in fade-in slide-in-from-left-4">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-600 uppercase tracking-widest select-none">
                  <input type="checkbox" onChange={handleSelectAll} checked={selectedItemIds.length > 0 && selectedItemIds.length === totalSelectable} className="w-4 h-4 rounded text-indigo-600 border-slate-300 cursor-pointer" />
                  Select All
                </label>
                <button onClick={handleDeleteSelected} disabled={selectedItemIds.length === 0 || isDeleting} className="px-5 py-2 bg-rose-100 text-rose-700 hover:bg-rose-200 disabled:opacity-50 text-[10px] font-black uppercase tracking-widest rounded-lg transition-colors shadow-sm">
                  {isDeleting ? 'Deleting...' : `Delete Selected (${selectedItemIds.length})`}
                </button>
              </div>
            )}
          </div>

          {loading ? (
            <div className="text-center py-20 text-slate-400 font-medium">Loading Drive workspace...</div>
          ) : (
            <div className="space-y-8">
              {!currentFolder ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {/* The Protect Root Block */}
                  <div className="group relative flex flex-col items-center justify-center p-4 bg-white/60 border border-slate-200 rounded-2xl transition-all duration-200 shadow-sm text-center w-full">
                    {isDeleteMode && (
                       <input type="checkbox" disabled title="Root folder cannot be deleted" className="absolute top-2 left-2 w-5 h-5 rounded text-rose-600 border-slate-300 disabled:opacity-30 disabled:cursor-not-allowed" />
                    )}
                    <button onClick={() => setCurrentFolder({ id: 'root', name: `${selectedCompany} Root` })} className="w-full flex flex-col items-center">
                      <div className="text-4xl mb-2">📁</div>
                      <span className="font-bold text-sm text-slate-800">{selectedCompany} Root</span>
                      <span className="text-[11px] font-semibold text-slate-400 mt-0.5">{rootFiles.length} files</span>
                    </button>
                  </div>

                  {folders.map((folder) => (
                    <div key={folder.id} className="group relative flex flex-col items-center justify-center p-4 bg-white/60 hover:bg-amber-50/40 border border-slate-200 hover:border-amber-300 rounded-2xl transition-all duration-200 shadow-sm text-center w-full">
                      {isDeleteMode && (
                        <input type="checkbox" checked={selectedItemIds.includes(folder.id)} onChange={() => handleToggleSelect(folder.id)} className="absolute top-2 left-2 w-5 h-5 rounded text-rose-600 border-slate-300 cursor-pointer z-10" />
                      )}
                      <button onClick={() => setCurrentFolder({ id: folder.id, name: folder.name })} className="w-full flex flex-col items-center">
                        <div className="text-4xl mb-2">📁</div>
                        <span className="font-bold text-sm text-slate-800 truncate max-w-full">{folder.name}</span>
                        <span className="text-[11px] font-semibold text-slate-400 mt-0.5">{files.filter(f => f.parents?.includes(folder.id)).length} files</span>
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {currentFolderFiles.length === 0 && <div className="col-span-full text-center py-10 text-slate-400">Empty folder</div>}
                  {currentFolderFiles.map(file => (
                    <div key={file.id} className="flex items-center justify-between p-4 bg-white hover:bg-slate-50 rounded-xl border border-slate-200 shadow-sm transition-all">
                      <div className="flex items-center gap-3 truncate">
                        {isDeleteMode && (
                           <input type="checkbox" checked={selectedItemIds.includes(file.id)} onChange={() => handleToggleSelect(file.id)} className="w-5 h-5 rounded text-rose-600 border-slate-300 cursor-pointer shrink-0" />
                        )}
                        <span className="text-xl shrink-0">
                          {file.mimeType?.includes('image') ? '🖼️' : '📄'}
                        </span>
                        <span className="text-xs font-semibold text-slate-700 truncate">{file.name}</span>
                      </div>
                      <a href={file.webViewLink} target="_blank" rel="noreferrer" className="text-[10px] text-indigo-600 font-bold shrink-0 ml-2 bg-indigo-50 px-2 py-1 rounded">Open ↗</a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* MODALS */}
      {isUploadModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-8 max-w-lg w-full shadow-2xl border border-slate-100">
            <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight mb-2">Upload Document</h3>
            <p className="text-xs font-bold text-slate-500 mb-2">Gemini Supports: PDF, TXT, CSV, MD, PNG, JPEG, WEBP.</p>
            <form onSubmit={handleUploadSubmit} className="space-y-6 mt-4">
              
              {/* UPDATED ACCEPT ATTRIBUTE */}
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 hover:border-slate-400 p-6 rounded-2xl cursor-pointer">
                <span className="text-xs font-bold text-slate-600 text-center">{selectedFile ? selectedFile.name : 'Click to select Document or Image'}</span>
                <input 
                  type="file" 
                  accept=".pdf, .txt, .csv, .md, image/jpeg, image/png, image/webp" 
                  className="hidden" 
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} 
                />
              </label>

              <div className="space-y-3">
                <label className="text-xs font-bold text-slate-600 uppercase tracking-wider block">Target Location in Drive</label>
                <div className="flex items-center gap-3">
                  <input type="radio" id="destRoot" name="destChoice" checked={destinationChoice === 'root'} onChange={() => setDestinationChoice('root')} className="text-indigo-600 focus:ring-indigo-500" />
                  <label htmlFor="destRoot" className="text-sm font-semibold text-slate-700">Root Folder (/{selectedCompany})</label>
                </div>
                <div className="flex items-center gap-3">
                  <input type="radio" id="destSub" name="destChoice" checked={destinationChoice === 'subfolder'} onChange={() => setDestinationChoice('subfolder')} className="text-indigo-600 focus:ring-indigo-500" />
                  <label htmlFor="destSub" className="text-sm font-semibold text-slate-700">Specific subfolder</label>
                </div>
                {destinationChoice === 'subfolder' && (
                  <select value={selectedSubfolderId} onChange={(e) => setSelectedSubfolderId(e.target.value)} className="w-full mt-2 p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none" required>
                    <option value="">-- Choose Subfolder --</option>
                    {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button type="button" onClick={() => setIsUploadModalOpen(false)} className="px-5 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-500">Cancel</button>
                <button type="submit" disabled={!selectedFile || isUploading} className="px-6 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-bold disabled:opacity-50">{isUploading ? 'Uploading...' : 'Confirm Upload'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isNewFolderModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl">
            <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight mb-4">New Folder</h3>
            <form onSubmit={handleCreateFolder} className="space-y-4">
              <input type="text" placeholder="Folder name..." value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold outline-none focus:border-indigo-600" required />
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setIsNewFolderModalOpen(false)} className="px-4 py-2 rounded-xl text-sm font-bold text-slate-500">Cancel</button>
                <button type="submit" className="px-5 py-2 rounded-xl bg-slate-900 text-white text-sm font-bold">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}