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

  // --- SMART VIEWER STATES ---
  const [previewItem, setPreviewItem] = useState<DriveItem | null>(null);
  const [previewHighlightTerms, setPreviewHighlightTerms] = useState<string[]>([]);
  const [rawTextContent, setRawTextContent] = useState<string | null>(null);
  const [isLoadingRawText, setIsLoadingRawText] = useState(false);

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
  const [selectedModel, setSelectedModel] = useState('gemini-3.5-flash-lite');
  const [isSearching, setIsSearching] = useState(false);

  // Bulk Deletion States
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchDirectory = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/api/docs/directory`, { headers: { 'x-company': selectedCompany }});
      const data = await res.json();
      setFolders(data.folders || []);
      setFiles(data.files || []);
      setCompanyFolderId(data.companyFolderId || '');
    } catch (err) { console.error('Failed to fetch directory', err); } finally { setLoading(false); }
  }, [selectedCompany, API_BASE_URL]);

  useEffect(() => { fetchDirectory(); }, [fetchDirectory]);

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!selectedFile) return;
    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', selectedFile);
    const targetFolder = destinationChoice === 'subfolder' ? selectedSubfolderId : companyFolderId;
    if (targetFolder) formData.append('targetFolderId', targetFolder);

    try {
      const res = await fetch(`${API_BASE_URL}/api/docs/upload`, { method: 'POST', headers: { 'x-company': selectedCompany, 'x-username': loginUsername }, body: formData });
      if (!res.ok) throw new Error("Upload Failed");
      alert(`Document uploaded successfully!`);
      setSelectedFile(null); setIsUploadModalOpen(false); fetchDirectory();
    } catch (err: any) { alert(`Failed to upload document: ${err.message}`); } finally { setIsUploading(false); }
  };

const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault(); if (!newFolderName.trim()) return;
    try {
      const payload = {
        company: selectedCompany,
        folderName: newFolderName,
        // If inside a subfolder, send its ID. Otherwise send undefined to default to Root.
        parentFolderId: currentFolder && currentFolder.id !== 'root' ? currentFolder.id : undefined
      };
      const res = await fetch(`${API_BASE_URL}/api/docs/folder`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-company': selectedCompany }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error();
      setNewFolderName(''); setIsNewFolderModalOpen(false); fetchDirectory();
    } catch { alert('Could not create folder.'); }
  };

  const handleRenameFolder = async (e: React.MouseEvent, folderId: string, currentName: string) => {
    e.stopPropagation(); // Prevents navigating into the folder when clicking rename
    const newName = window.prompt("Enter new folder name:", currentName);
    if (!newName || newName.trim() === "" || newName === currentName) return;

    try {
      const res = await fetch(`${API_BASE_URL}/api/docs/folder/${folderId}/rename`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newName })
      });
      if (!res.ok) throw new Error();
      fetchDirectory(); 
    } catch (err) {
      alert("Failed to rename folder.");
    }
  };

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!searchQuery.trim()) return;
    setIsSearching(true); setAiAnswer(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/docs/search`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-company': selectedCompany, 'x-username': loginUsername }, body: JSON.stringify({ query: searchQuery, model: selectedModel }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Search failed');
      setAiAnswer(data.answer);
    } catch (err: any) { setAiAnswer(`Error: ${err.message}`); } finally { setIsSearching(false); }
  };

  // --- SMART VIEWER ENGINE ---
  const extractKeywordsFromAi = (answer: string) => {
    const words = answer.match(/\b[A-Z][a-z]{3,}\b|\b[a-zA-Z]{6,}\b/g) || [];
    return Array.from(new Set(words));
  };

  const openSmartViewer = async (file: DriveItem, fromAiSearch: boolean = false) => {
    setPreviewItem(file);
    setRawTextContent(null);
    
    if (fromAiSearch && aiAnswer) {
      setPreviewHighlightTerms(extractKeywordsFromAi(aiAnswer));
    } else {
      setPreviewHighlightTerms([]);
    }

    const isTextFile = file.mimeType?.includes('text/plain') || file.name.endsWith('.txt') || file.name.endsWith('.md');
    
    if (isTextFile) {
      setIsLoadingRawText(true);
      try {
        const res = await fetch(`${API_BASE_URL}/api/docs/download/${file.id}`, { headers: { 'x-company': selectedCompany }});
        if (res.ok) {
          const text = await res.text();
          setRawTextContent(text);
        } else {
          setRawTextContent(null);
        }
      } catch (e) {
        setRawTextContent(null);
      } finally {
        setIsLoadingRawText(false);
      }
    }
  };

  const renderHighlightedText = (text: string, terms: string[]) => {
    if (!terms.length) return <span className="whitespace-pre-wrap">{text}</span>;
    const regex = new RegExp(`(${terms.join('|')})`, 'gi');
    const parts = text.split(regex);
    return (
      <span className="whitespace-pre-wrap text-slate-700 leading-relaxed text-sm">
        {parts.map((part, i) => regex.test(part) ? <mark key={i} className="bg-yellow-300 text-slate-900 font-bold px-0.5 rounded shadow-sm">{part}</mark> : <span key={i}>{part}</span>)}
      </span>
    );
  };

  const renderFormattedAiText = (text: string) => {
    const lines = text.split('\n');
    return lines.map((line, lineIndex) => {
      const parts: React.ReactNode[] = [];
      let lastIndex = 0;
      const regex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*/g;
      let match: RegExpExecArray | null;

      while ((match = regex.exec(line)) !== null) {
        if (match.index > lastIndex) parts.push(line.substring(lastIndex, match.index));
        
        if (match[1] && match[2]) {
          const linkText = match[1];
          const linkUrl = match[2];
          const driveIdMatch = linkUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);

          if (driveIdMatch && driveIdMatch[1]) {
            const fileId = driveIdMatch[1];
            const matchedFile = files.find(f => f.id === fileId) || { id: fileId, name: linkText, webViewLink: linkUrl, mimeType: 'unknown' };

            parts.push(
              <button key={`${lineIndex}-${match.index}`} onClick={() => openSmartViewer(matchedFile, true)} className="inline-flex items-center gap-1.5 font-bold text-indigo-600 hover:text-indigo-800 underline decoration-indigo-300 hover:decoration-indigo-600 transition-colors break-all bg-indigo-50/80 px-2 py-0.5 rounded text-left shadow-sm">
                <span>{linkText}</span>
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
              </button>
            );
          } else {
            parts.push(
              <a key={`${lineIndex}-${match.index}`} href={linkUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-bold text-sky-600 hover:text-sky-800 underline decoration-sky-300 hover:decoration-sky-600 transition-colors break-all bg-sky-50/60 px-1.5 py-0.5 rounded">
                <span>{linkText}</span>
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
              </a>
            );
          }
        } else if (match[3]) {
          parts.push(<strong key={`${lineIndex}-${match.index}`} className="font-bold text-slate-900">{match[3]}</strong>);
        }
        lastIndex = regex.lastIndex;
      }
      if (lastIndex < line.length) parts.push(line.substring(lastIndex));
      return <span key={lineIndex} className="block min-h-[1.35rem] leading-relaxed">{parts.length > 0 ? parts : ' '}</span>;
    });
  };

  // Separate root items from nested items
  const rootFolders = folders.filter(f => !folders.some(parent => f.parents?.includes(parent.id)));
  const rootFiles = files.filter(f => !folders.some(folder => f.parents?.includes(folder.id)));

  // Determine what to display based on current location
  const displayFolders = currentFolder && currentFolder.id !== 'root' ? folders.filter(f => f.parents?.includes(currentFolder.id)) : rootFolders;
  const displayFiles = currentFolder && currentFolder.id !== 'root' ? files.filter(f => f.parents?.includes(currentFolder.id)) : rootFiles;

  const totalSelectable = displayFolders.length + displayFiles.length + (!currentFolder ? 1 : 0);

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) setSelectedItemIds([...displayFolders.map(f => f.id), ...displayFiles.map(f => f.id)]);
    else setSelectedItemIds([]);
  };

  const handleToggleSelect = (id: string) => setSelectedItemIds(prev => prev.includes(id) ? prev.filter(itemId => itemId !== id) : [...prev, id]);

  const handleDeleteSelected = async () => {
    if (selectedItemIds.length === 0) return;
    if (!window.confirm(`Permanently delete ${selectedItemIds.length} items from Drive and Database?`)) return;
    setIsDeleting(true);
    try {
      await Promise.all(selectedItemIds.map(id => fetch(`${API_BASE_URL}/api/docs/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } })));
      setSelectedItemIds([]); fetchDirectory(); 
    } catch (error) { alert("Failed to delete some items."); } finally { setIsDeleting(false); }
  };

  return (
    <div className="min-h-screen bg-white text-slate-900 font-sans flex flex-col">
      <header className="border-b border-slate-100 px-6 sm:px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg></button>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">{selectedCompany} Workspace</h1>
            <p className="text-xs text-slate-400 font-medium tracking-wide">Google Drive & Gemini Index</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setIsNewFolderModalOpen(true)} className="px-4 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">+ New Folder</button>
          <button onClick={() => setIsUploadModalOpen(true)} className="px-5 sm:px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-bold tracking-wide transition-colors shadow-sm">Upload Document</button>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-8 py-8 flex flex-col items-center">
        <form onSubmit={handleSearchSubmit} className="w-full max-w-3xl mb-10">
          <div className="relative flex items-center w-full bg-white border-2 border-slate-300 focus-within:border-indigo-600 focus-within:ring-4 focus-within:ring-indigo-50 rounded-full shadow-sm transition-all p-1.5 pl-4 sm:pl-5">
            <div className="text-slate-400 shrink-0 mr-2 sm:mr-3"><svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg></div>
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={`Search ${selectedCompany} documents with Gemini...`} className="w-full py-2.5 sm:py-3 bg-transparent text-sm sm:text-base font-medium outline-none placeholder:text-slate-400 min-w-0 pr-2" />
            <button type="submit" disabled={isSearching || !searchQuery.trim()} className="shrink-0 px-5 sm:px-7 py-2.5 sm:py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full text-xs font-black uppercase tracking-wider transition-colors disabled:opacity-50 whitespace-nowrap shadow-sm">
              {isSearching ? 'Scanning...' : 'Search'}
            </button>
          </div>
          <div className="flex items-center justify-center gap-2 sm:gap-3 mt-4 flex-wrap">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">AI Engine:</span>
            <button type="button" onClick={() => setSelectedModel('gemini-3.6-flash')} className={`px-4 py-1.5 rounded-full text-[10px] font-bold transition-all shadow-sm ${selectedModel === 'gemini-3.6-flash' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200 ring-2 ring-indigo-100' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'}`}>⚡ 3.6 Flash (Fast)</button>
            <button type="button" onClick={() => setSelectedModel('gemini-3.5-flash-lite')} className={`px-4 py-1.5 rounded-full text-[10px] font-bold transition-all shadow-sm ${selectedModel === 'gemini-3.5-flash-lite' ? 'bg-emerald-50 text-emerald-700 border border-emerald-300 ring-2 ring-emerald-100' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'}`}>🪙 3.5 Flash-Lite (Credit Saver)</button>
          </div>
          {isSearching && <div className="w-full h-1 mt-6 bg-indigo-50 rounded-full overflow-hidden flex"><div className="w-1/3 h-full bg-indigo-500 rounded-full animate-[ping_1.5s_cubic-bezier(0,0,0.2,1)_infinite]"></div></div>}
        </form>

        {aiAnswer && (
          <div className="w-full max-w-3xl mb-10 p-6 bg-slate-50 border border-indigo-100 rounded-2xl shadow-sm animate-in fade-in">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-200">
              <span className="text-xs font-black tracking-widest text-indigo-700 uppercase flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse"></span>Gemini AI Answer</span>
              <button onClick={() => setAiAnswer(null)} className="text-xs font-bold text-slate-400 hover:text-slate-600">Close</button>
            </div>
            <div className="text-sm text-slate-700 font-medium space-y-1">{renderFormattedAiText(aiAnswer)}</div>
          </div>
        )}

        <div className="w-full">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 text-sm">
              <button onClick={() => setCurrentFolder(null)} className={`font-bold transition-colors ${currentFolder ? 'text-indigo-600 hover:underline' : 'text-slate-800 uppercase tracking-widest text-sm'}`}>Drive Directory</button>
              {currentFolder && <><span className="text-slate-400 font-bold">/</span><span className="font-extrabold text-slate-800 flex items-center gap-1.5 bg-amber-100 text-amber-900 px-3 py-1 rounded-md text-xs">📁 {currentFolder.name}</span></>}
            </div>
            {currentFolder && <button onClick={() => setCurrentFolder(null)} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-lg transition-colors">← Back</button>}
          </div>

          <div className="flex justify-between items-center bg-slate-50 border border-slate-200 p-3 rounded-xl mb-6">
            <label className="flex items-center gap-3 cursor-pointer text-xs font-bold text-slate-600 uppercase tracking-widest select-none">
              <input type="checkbox" onChange={handleSelectAll} checked={selectedItemIds.length > 0 && selectedItemIds.length === totalSelectable} className="w-5 h-5 rounded text-indigo-600 border-slate-300 cursor-pointer" /> Select All
            </label>
            <button onClick={handleDeleteSelected} disabled={selectedItemIds.length === 0 || isDeleting} className="px-5 py-2.5 bg-rose-100 text-rose-700 hover:bg-rose-200 disabled:opacity-50 text-[10px] font-black uppercase tracking-widest rounded-xl transition-colors shadow-sm">{isDeleting ? 'Deleting...' : `Delete Selected (${selectedItemIds.length})`}</button>
          </div>

          {loading ? (
            <div className="text-center py-20 text-slate-400 font-medium">Loading Drive workspace...</div>
          ) : (
            <div className="space-y-8">
              <div className="space-y-6">
                
                {/* 1. FOLDERS GRID */}
                {(displayFolders.length > 0 || !currentFolder) && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    
                    {/* Master Root Card (Only visible at the very top) */}
                    {!currentFolder && (
                      <div className="group relative flex flex-col items-center justify-center p-4 bg-white/60 border border-slate-200 rounded-2xl transition-all duration-200 shadow-sm text-center w-full">
                        <input type="checkbox" disabled title="Cannot delete root folder" className="absolute top-3 left-3 w-5 h-5 rounded text-rose-600 border-slate-300 disabled:opacity-30 disabled:cursor-not-allowed" />
                        <button onClick={() => setCurrentFolder({ id: 'root', name: `${selectedCompany} Root` })} className="w-full flex flex-col items-center">
                          <div className="text-4xl mb-2">📁</div><span className="font-bold text-sm text-slate-800">{selectedCompany} Root</span><span className="text-[11px] font-semibold text-slate-400 mt-0.5">{rootFiles.length} files</span>
                        </button>
                      </div>
                    )}

                    {/* Render Subfolders */}
                    {displayFolders.map((folder) => (
                      <div key={folder.id} className="group relative flex flex-col items-center justify-center p-4 bg-white/60 hover:bg-amber-50/40 border border-slate-200 hover:border-amber-300 rounded-2xl transition-all duration-200 shadow-sm text-center w-full">
                        <input type="checkbox" checked={selectedItemIds.includes(folder.id)} onChange={() => handleToggleSelect(folder.id)} className="absolute top-3 left-3 w-5 h-5 rounded text-indigo-600 border-slate-300 cursor-pointer z-10" />
                        
                        {/* Rename Button */}
                        <button onClick={(e) => handleRenameFolder(e, folder.id, folder.name)} className="absolute top-3 right-3 text-slate-400 hover:text-indigo-600 z-10 bg-white/80 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity shadow-sm border border-slate-200" title="Rename Folder">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                        </button>

                        <button onClick={() => setCurrentFolder({ id: folder.id, name: folder.name })} className="w-full flex flex-col items-center mt-2">
                          <div className="text-4xl mb-2">📁</div>
                          <span className="font-bold text-sm text-slate-800 truncate max-w-full px-2">{folder.name}</span>
                          <span className="text-[11px] font-semibold text-slate-400 mt-0.5">{files.filter(f => f.parents?.includes(folder.id)).length} files</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* 2. FILES LIST */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {displayFolders.length === 0 && displayFiles.length === 0 && currentFolder && <div className="col-span-full text-center py-10 text-slate-400 font-medium">Empty folder</div>}
                  {displayFiles.map(file => (
                    <div key={file.id} className="flex items-center justify-between p-3.5 bg-white hover:bg-slate-50/80 rounded-xl border border-slate-200 shadow-sm transition-all group">
                      <div className="flex items-center gap-3 truncate flex-1">
                        <input type="checkbox" checked={selectedItemIds.includes(file.id)} onChange={() => handleToggleSelect(file.id)} className="w-5 h-5 rounded text-indigo-600 border-slate-300 cursor-pointer shrink-0" />
                        <span className="text-2xl shrink-0 group-hover:scale-110 transition-transform">{file.mimeType?.includes('image') ? '🖼️' : file.mimeType?.includes('pdf') ? '📕' : file.mimeType?.includes('spreadsheet') || file.mimeType?.includes('csv') ? '📊' : '📄'}</span>
                        <span className="text-xs font-bold text-slate-700 truncate">{file.name}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <button onClick={() => openSmartViewer(file, false)} className="text-slate-400 hover:text-indigo-600 p-1.5 rounded-lg hover:bg-indigo-50 transition-colors" title="Preview Document"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg></button>
                        {file.webViewLink && <a href={file.webViewLink} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-sky-600 p-1.5 rounded-lg hover:bg-sky-50 transition-colors" title="Open in new Google Drive tab"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg></a>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* SMART DOCUMENT VIEWER MODAL */}
      {previewItem && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-[200] flex justify-center items-center p-3 sm:p-6 animate-in zoom-in-95 duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-[92vh] flex flex-col overflow-hidden border border-slate-700">
            
            <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50 shrink-0 shadow-sm relative z-10">
              <div className="flex items-center gap-3 truncate">
                <span className="text-3xl shrink-0">{previewItem.mimeType?.includes('image') ? '🖼️' : previewItem.mimeType?.includes('pdf') ? '📕' : previewItem.mimeType?.includes('spreadsheet') || previewItem.mimeType?.includes('csv') ? '📊' : '📄'}</span>
                <div className="truncate">
                  <h3 className="font-black text-slate-900 text-lg truncate tracking-tight">{previewItem.name}</h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded uppercase tracking-widest font-black">Smart Viewer Engine</span>
                    {previewHighlightTerms.length > 0 && rawTextContent !== null && (
                      <span className="text-[10px] text-amber-700 bg-amber-100 px-2 py-0.5 rounded font-bold">Target: {previewHighlightTerms.join(', ')}</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {previewItem.webViewLink && (
                  <a href={previewItem.webViewLink} target="_blank" rel="noopener noreferrer" className="px-4 py-2 bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 shadow-sm">
                    <span>Drive Native</span><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                  </a>
                )}
                <button onClick={() => { setPreviewItem(null); setRawTextContent(null); }} className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl font-black transition-colors"><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg></button>
              </div>
            </div>

            <div className="flex-1 bg-[#E2E8F0] relative overflow-hidden flex">
              {rawTextContent !== null ? (
                <div className="w-full h-full p-8 overflow-y-auto bg-white mx-auto max-w-4xl shadow-inner text-left font-mono">
                  {renderHighlightedText(rawTextContent, previewHighlightTerms)}
                </div>
              ) : isLoadingRawText ? (
                <div className="w-full h-full flex flex-col items-center justify-center bg-white text-slate-400">
                  <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4"></div>
                  <span className="font-bold text-sm tracking-widest uppercase">Extracting Text...</span>
                </div>
              ) : (
                <div className="w-full h-full relative">
                  <iframe src={`https://drive.google.com/file/d/${previewItem.id}/preview`} className="w-full h-full border-0 bg-white relative z-0" allow="autoplay" title={previewItem.name} />
                </div>
              )}
            </div>

          </div>
        </div>
      )}

      {/* UPLOAD MODAL */}
      {isUploadModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-8 max-w-lg w-full shadow-2xl border border-slate-100">
            <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight mb-2">Upload Document</h3>
            <p className="text-xs font-bold text-slate-500 mb-2">Gemini Supports: PDF, TXT, CSV, MD, PNG, JPEG, WEBP.</p>
            <form onSubmit={handleUploadSubmit} className="space-y-6 mt-4">
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 hover:border-slate-400 p-6 rounded-2xl cursor-pointer">
                <span className="text-xs font-bold text-slate-600 text-center">{selectedFile ? selectedFile.name : 'Click to select Document or Image'}</span>
                <input type="file" accept=".pdf, .txt, .csv, .md, image/jpeg, image/png, image/webp" className="hidden" onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} />
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
                    {displayFolders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
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

      {/* NEW FOLDER MODAL */}
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