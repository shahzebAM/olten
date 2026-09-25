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
  
  // --- SUBMISSION LOCKS ---
  const [isUploading, setIsUploading] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  // --- RESPONSIVE STATES ---
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  // --- DATA STATES ---
  const [rootFolderId, setRootFolderId] = useState<string | null>(null);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [files, setFiles] = useState<DriveFile[]>([]);
  
  // --- NEW: STORAGE STATE ---
  const [storageData, setStorageData] = useState<{ usage: string, limit: string } | null>(null);
  
  // --- WORKSPACE & TREE STATES ---
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<DriveFile | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  
  // --- MULTI-SELECT STATE ---
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  // --- SEARCH & AI STATES ---
  const [aiQuery, setAiQuery] = useState('');
  const [localQuery, setLocalQuery] = useState('');
  const [selectedModel, setSelectedModel] = useState('gemini-3.5-flash-lite');
  const [isSearchingAi, setIsSearchingAi] = useState(false);
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);

  // --- RESIZER STATES ---
  const [aiPanelHeight, setAiPanelHeight] = useState(300);
  const [isDraggingResizer, setIsDraggingResizer] = useState(false);
  const rightPaneRef = useRef<HTMLElement>(null);

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

  // --- RESIZER LOGIC ---
  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingResizer(true);
  }, []);

  const stopResizing = useCallback(() => {
    setIsDraggingResizer(false);
  }, []);

  const resize = useCallback((e: MouseEvent) => {
    if (isDraggingResizer && rightPaneRef.current) {
      const paneRect = rightPaneRef.current.getBoundingClientRect();
      let newHeight = e.clientY - paneRect.top;
      
      if (newHeight < 150) newHeight = 150;
      if (newHeight > paneRect.height - 200) newHeight = paneRect.height - 200;
      
      setAiPanelHeight(newHeight);
    }
  }, [isDraggingResizer]);

  useEffect(() => {
    if (isDraggingResizer) {
      window.addEventListener('mousemove', resize);
      window.addEventListener('mouseup', stopResizing);
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    } else {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDraggingResizer, resize, stopResizing]);

  // --- API: FETCH DIRECTORY ---
  const fetchDirectory = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/docs/directory`, {
        headers: { 'x-company': selectedCompany, 'x-username': loginUsername }
      });
      if (!res.ok) throw new Error('Failed to load directory');
      const data = await res.json();
      
      setRootFolderId(data.companyFolderId);
      setFolders(data.folders || []);
      setFiles(data.files || []);
      
      // Save the exact storage quota from backend
      if (data.storageQuota) {
        setStorageData(data.storageQuota);
      }
      
      if (!activeFolderId) {
        setActiveFolderId(data.companyFolderId);
        setExpandedFolders(prev => new Set(prev).add(data.companyFolderId));
      }
    } catch (err: any) {
      if (!isSilent) showToast(err.message || 'Error loading workspace', 'error');
    } finally {
      if (!isSilent) setIsLoading(false);
    }
  }, [API_BASE_URL, selectedCompany, loginUsername, activeFolderId]);

  useEffect(() => {
    fetchDirectory();
  }, [fetchDirectory]);

  // --- HELPER: FORMAT BYTES ---
  const formatBytes = (bytes: string | number) => {
    const b = Number(bytes);
    if (b === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // --- API: GEMINI SEARCH ---
  const handleGeminiSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiQuery.trim()) return;
    setIsSearchingAi(true);
    setAiAnswer(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/docs/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-company': selectedCompany, 'x-username': loginUsername },
        body: JSON.stringify({ query: aiQuery, model: selectedModel })
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
      
      if (activeFolderId) setExpandedFolders(prev => new Set(prev).add(activeFolderId));
      fetchDirectory(true);
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
    if (!newFolderName.trim() || isCreatingFolder) return;
    
    setIsCreatingFolder(true);
    try {
      const targetId = activeFolderId && activeFolderId !== rootFolderId ? activeFolderId : undefined;
      
      const payload = {
        folderName: newFolderName.trim(),
        targetFolderId: targetId,
        parentFolderId: targetId
      };

      const res = await fetch(`${API_BASE_URL}/api/docs/folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-company': selectedCompany },
        body: JSON.stringify(payload)
      });
      
      if (!res.ok) throw new Error();
      
      setNewFolderName('');
      setIsNewFolderModalOpen(false);
      showToast('Folder created', 'success');
      
      if (targetId) setExpandedFolders(prev => new Set(prev).add(targetId));
      
      fetchDirectory(true);
    } catch {
      showToast('Could not create folder', 'error');
    } finally {
      setIsCreatingFolder(false);
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
      fetchDirectory(true);
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

  // --- SEARCH FILTERING (LOCAL ONLY) ---
  const activeFiles = useMemo(() => {
    if (!localQuery.trim()) return files;
    const q = localQuery.toLowerCase();
    return files.filter(f => f.name.toLowerCase().includes(q));
  }, [files, localQuery]);


  // --- RECURSIVE SELECTION LOGIC ---
  const getAllDescendants = useCallback((parentId: string, currentDescendants = new Set<string>()) => {
    const childFolders = folders.filter(f => f.parents?.includes(parentId));
    const childFiles = files.filter(f => f.parents?.includes(parentId));

    childFolders.forEach(f => {
      currentDescendants.add(f.id);
      getAllDescendants(f.id, currentDescendants);
    });

    childFiles.forEach(f => {
      currentDescendants.add(f.id);
    });

    return currentDescendants;
  }, [folders, files]);

  const toggleSelection = (id: string, e: React.MouseEvent, isFolder: boolean = false) => {
    e.stopPropagation();
    const newSet = new Set(selectedItems);
    const isSelected = newSet.has(id);

    if (isSelected) {
      newSet.delete(id);
      if (isFolder) {
        const descendants = getAllDescendants(id);
        descendants.forEach(descId => newSet.delete(descId));
      }
    } else {
      newSet.add(id);
      if (isFolder) {
        const descendants = getAllDescendants(id);
        descendants.forEach(descId => newSet.add(descId));
      }
    }
    setSelectedItems(newSet);
  };

  const totalSelectableItems = folders.length + files.length;
  const isAllSelected = totalSelectableItems > 0 && selectedItems.size === totalSelectableItems;

  const handleSelectAllToggle = () => {
    if (isAllSelected) {
      setSelectedItems(new Set());
    } else {
      const allIds = new Set([
        ...folders.map(f => f.id),
        ...files.map(f => f.id)
      ]);
      setSelectedItems(allIds);
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

  const getFileIcon = (mimeType: string) => {
    if (mimeType.includes('document') || mimeType.includes('word')) return <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 20V4h5v7h7v9H6z"/></svg>;
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return <svg className="w-4 h-4 text-emerald-500" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 20V4h5v7h7v9H6z"/></svg>;
    if (mimeType.includes('pdf')) return <svg className="w-4 h-4 text-rose-500" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 20V4h5v7h7v9H6z"/></svg>;
    return <svg className="w-4 h-4 text-slate-400" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 20V4h5v7h7v9H6z"/></svg>;
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Unknown Date';
    return new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // --- AI TEXT PARSER ---
  const renderFormattedText = (text: string) => {
    const parts = text.split(/(\[[^\]]+\]\([^)]+\))/g);
    
    return parts.map((part, i) => {
      const match = part.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (match) {
        const linkText = match[1];
        const linkUrl = match[2];
        
        return (
          <a 
            key={i} 
            href={linkUrl} 
            target="_blank" 
            rel="noopener noreferrer" 
            onClick={(e) => {
              const idMatch = linkUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
              if (idMatch) {
                 const fileId = idMatch[1];
                 const foundFile = files.find(f => f.id === fileId);
                 if (foundFile) {
                     e.preventDefault();
                     setSelectedFile(foundFile);
                 }
              }
            }}
            className="inline-flex items-center gap-1.5 px-2 py-0.5 mx-1 mb-1 bg-indigo-50 border border-indigo-200 rounded text-indigo-700 font-bold text-xs hover:bg-indigo-100 transition-colors no-underline"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
            {linkText}
          </a>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  // --- RECURSIVE TREE RENDERER ---
  const renderTree = useCallback((parentId: string, depth: number = 0) => {
    const childFolders = folders.filter(f => f.parents?.includes(parentId));
    const childFiles = files.filter(f => f.parents?.includes(parentId));

    return (
      <div className="flex flex-col w-full" key={`group-${parentId}`}>
        {childFolders.map(folder => (
          <React.Fragment key={folder.id}>
            <div 
              onClick={() => { setActiveFolderId(folder.id); toggleFolderExpand(folder.id); }}
              className={`group flex items-center w-full px-2 py-1.5 cursor-pointer text-sm transition-colors border-l-2 ${activeFolderId === folder.id ? 'bg-indigo-50/50 border-indigo-500' : 'border-transparent hover:bg-slate-100'}`}
              style={{ paddingLeft: `${depth * 16 + 8}px` }}
            >
              <div onClick={(e) => toggleSelection(folder.id, e, true)} className={`w-4 h-4 mr-2 border rounded flex items-center justify-center shrink-0 transition-colors ${selectedItems.has(folder.id) ? 'bg-indigo-500 border-indigo-500' : 'border-slate-300 bg-white group-hover:border-slate-400'}`}>
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
            onClick={() => { setSelectedFile(file); setActiveFolderId(parentId); if (window.innerWidth < 1024) setIsMobileNavOpen(false); }}
            className={`group flex items-center w-full px-2 py-1.5 cursor-pointer text-sm transition-colors border-l-2 ${selectedFile?.id === file.id ? 'bg-indigo-50/50 border-indigo-500' : 'border-transparent hover:bg-slate-100'}`}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
          >
            <div onClick={(e) => toggleSelection(file.id, e, false)} className={`w-4 h-4 mr-2 border rounded flex items-center justify-center shrink-0 transition-colors ${selectedItems.has(file.id) ? 'bg-indigo-500 border-indigo-500' : 'border-slate-300 bg-white group-hover:border-slate-400'}`}>
              {selectedItems.has(file.id) && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"/></svg>}
            </div>
            <div className="w-4 shrink-0 mr-1"></div>
            <div className="mr-2 shrink-0">{getFileIcon(file.mimeType)}</div>
            <span className={`truncate flex-1 ${selectedFile?.id === file.id ? 'font-bold text-indigo-900' : 'font-medium text-slate-600'}`}>{file.name}</span>
            
            <div className="opacity-0 group-hover:opacity-100 flex items-center shrink-0 pl-2">
              <button onClick={(e) => { e.stopPropagation(); setRenameTarget({ id: file.id, name: file.name }); setNewRenameValue(file.name); }} className="p-1 text-slate-400 hover:text-indigo-600 rounded" title="Rename"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg></button>
            </div>
          </div>
        ))}
      </div>
    );
  }, [folders, files, activeFolderId, expandedFolders, selectedItems, selectedFile, toggleSelection]);

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
          
          <div className="hidden lg:flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500 text-white flex items-center justify-center shadow-md shrink-0">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 20V4h5v7h7v9H6z"/></svg>
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-black text-slate-900 leading-tight truncate">{selectedCompany}</h2>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Workspace Directory</p>
            </div>
          </div>
        </div>

        {/* GEMINI AI SEARCH BAR */}
        <div className="flex-1 flex justify-center max-w-3xl">
          <form onSubmit={handleGeminiSearch} className="relative w-full flex bg-[#F4F5F7] rounded-lg border border-transparent focus-within:border-indigo-300 focus-within:bg-white transition-all overflow-hidden shadow-sm">
            <div className="pl-4 flex items-center shrink-0">
              {isSearchingAi ? (
                <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <svg className="w-4 h-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              )}
            </div>
            <input 
              type="text" 
              placeholder="Ask AI to analyze across all folders..." 
              value={aiQuery}
              onChange={e => setAiQuery(e.target.value)}
              className="w-full bg-transparent text-sm px-3 py-2.5 outline-none placeholder:text-slate-400 font-medium"
            />
            {/* DESKTOP MODEL SELECTOR */}
            <select 
              value={selectedModel} 
              onChange={(e) => setSelectedModel(e.target.value)}
              className="hidden md:block bg-slate-200/50 hover:bg-slate-200 text-[10px] font-bold text-slate-600 border-l border-slate-300 outline-none px-3 cursor-pointer transition-colors"
            >
              <option value="gemini-3.6-flash">⚡ 3.6 Flash (Fast)</option>
              <option value="gemini-3.5-flash-lite">🪙 3.5 Flash-Lite</option>
            </select>
          </form>
        </div>

        <div className="w-1/4 flex justify-end items-center gap-4">
          <button onClick={onBack} className="flex items-center gap-2 px-4 lg:px-5 py-2 lg:py-2.5 bg-slate-900 text-white rounded-xl text-[10px] lg:text-xs font-bold uppercase tracking-widest shadow-sm hover:bg-slate-800 transition-all">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
            <span className="hidden sm:inline">Gateway</span>
          </button>
        </div>
      </header>

      {/* MOBILE MODEL SELECTOR */}
      <div className="md:hidden bg-white border-b border-slate-200 p-2 flex justify-center z-20 relative shadow-sm">
         <select 
           value={selectedModel} 
           onChange={(e) => setSelectedModel(e.target.value)}
           className="w-full max-w-sm bg-slate-50 border border-slate-200 text-xs font-bold text-slate-700 outline-none p-2 rounded-lg"
         >
           <option value="gemini-3.6-flash">⚡ Gemini 3.6 Flash (Fast)</option>
           <option value="gemini-3.5-flash-lite">🪙 Gemini 3.5 Flash-Lite (Saver)</option>
         </select>
      </div>

      {/* MAIN 2-PANE WORKSPACE */}
      <main className="flex flex-1 overflow-hidden relative">
        
        {/* PANE 1: UNIFIED LEFT SIDEBAR */}
        <aside className={`h-full w-full lg:w-[320px] bg-[#FBFBFC] border-r border-slate-200 flex-col shrink-0 z-40 ${selectedFile || aiAnswer ? 'hidden lg:flex' : 'flex'}`}>  
          {/* Action Tools */}
          <div className="px-4 py-4 border-b border-slate-100 flex flex-col gap-3 shrink-0 bg-white">
            <div className="flex items-center justify-between flex-wrap gap-2">
               <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Workspace Actions</span>
               <div className="flex gap-2">
                 <button onClick={handleSelectAllToggle} className="text-[10px] font-bold text-slate-600 hover:text-slate-900 uppercase tracking-widest bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded transition-colors">
                   {isAllSelected ? 'Deselect All' : 'Select All'}
                 </button>
                 <button onClick={() => { setActiveFolderId(rootFolderId); setSelectedFile(null); setSelectedItems(new Set()); }} className="text-[10px] font-bold text-indigo-600 hover:text-indigo-700 uppercase tracking-widest bg-indigo-50 hover:bg-indigo-100 px-2 py-1 rounded transition-colors">
                   Root Dir
                 </button>
               </div>
            </div>

            {/* MINI PROGRESS BAR FOR UPLOADS */}
            {isUploading && (
              <div className="flex flex-col gap-1.5 mt-1 mb-1">
                <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest text-center animate-pulse">Uploading file...</span>
                <div className="w-full h-1.5 bg-indigo-100 rounded-full overflow-hidden">
                  <div className="w-full h-full bg-indigo-500 origin-left animate-pulse"></div>
                </div>
              </div>
            )}
            
            {selectedItems.size > 0 ? (
              <button onClick={handleBulkDelete} disabled={isLoading} className="text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 px-3 py-2 rounded-lg transition-colors flex items-center gap-1 shadow-sm w-full justify-center">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg> Delete Selected ({selectedItems.size})
              </button>
            ) : (
              <div className="flex gap-2 w-full">
                <button onClick={() => setIsNewFolderModalOpen(true)} className="flex-1 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 py-2 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5 shadow-sm">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg> Folder
                </button>
                <button onClick={() => fileInputRef.current?.click()} className="flex-1 bg-indigo-600 text-white hover:bg-indigo-700 py-2 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5 shadow-sm">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg> Upload
                </button>
              </div>
            )}

            {/* NEW LOCAL SEARCH BAR */}
            <div className="relative w-full flex bg-slate-100 rounded-lg overflow-hidden border border-transparent focus-within:border-indigo-300 focus-within:bg-white transition-all shadow-inner mt-2">
              <div className="pl-3 flex items-center shrink-0">
                <svg className="w-3.5 h-3.5 text-slate-400 group-focus-within:text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              </div>
              <input 
                value={localQuery} 
                onChange={e => setLocalQuery(e.target.value)} 
                placeholder="Filter files locally..." 
                className="w-full bg-transparent text-xs px-2 py-2 outline-none placeholder:text-slate-400 font-bold text-slate-700" 
              />
            </div>
          </div>

          {/* Optimized Tree View / Local Search List */}
          <div className="flex-1 overflow-y-auto py-2">
            {isLoading ? (
              <div className="flex justify-center py-10"><div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div></div>
            ) : localQuery.trim() ? (
              // Fast Flat List for Local Searching
              <div className="px-2 space-y-1">
                {activeFiles.length === 0 ? (
                  <p className="text-center text-xs font-bold text-slate-400 py-10">No matching files locally.</p>
                ) : (
                  activeFiles.map(file => (
                    <div 
                      key={file.id}
                      onClick={() => { setSelectedFile(file); if (window.innerWidth < 1024) setIsMobileNavOpen(false); }}
                      className={`flex items-center w-full px-2 py-1.5 cursor-pointer text-sm rounded-lg transition-colors border-l-2 ${selectedFile?.id === file.id ? 'bg-indigo-50 border-indigo-500 shadow-sm' : 'border-transparent hover:bg-slate-100'}`}
                    >
                      <div onClick={(e) => toggleSelection(file.id, e, false)} className={`w-4 h-4 mr-3 border rounded flex items-center justify-center shrink-0 transition-colors ${selectedItems.has(file.id) ? 'bg-indigo-500 border-indigo-500' : 'border-slate-300 bg-white'}`}>
                        {selectedItems.has(file.id) && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"/></svg>}
                      </div>
                      <div className="mr-3 shrink-0">{getFileIcon(file.mimeType)}</div>
                      <span className={`truncate flex-1 ${selectedFile?.id === file.id ? 'font-bold text-indigo-900' : 'font-medium text-slate-600'}`}>{file.name}</span>
                    </div>
                  ))
                )}
              </div>
            ) : (
              // Full Recursive Tree
              <div className="px-2">
                {rootFolderId && renderTree(rootFolderId, 0)}
              </div>
            )}
          </div>

          {/* DYNAMIC STORAGE METER */}
          <div className="p-5 shrink-0 border-t border-slate-200/60 bg-white">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"/></svg>
              <div className="flex-1">
                <div className="flex justify-between items-end mb-1">
                  <p className="text-[11px] font-black text-slate-700">Storage Sync</p>
                  <p className="text-[10px] font-bold text-slate-500">
                    {storageData && Number(storageData.limit) > 0 
                      ? `${formatBytes(storageData.usage)} / ${formatBytes(storageData.limit)}` 
                      : storageData ? `${formatBytes(storageData.usage)} Used` : 'Syncing...'}
                  </p>
                </div>
                <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden shadow-inner">
                  <div 
                    className="bg-indigo-500 h-full rounded-full transition-all duration-700 ease-out" 
                    style={{ 
                      width: storageData && Number(storageData.limit) > 0 
                        ? `${Math.min((Number(storageData.usage) / Number(storageData.limit)) * 100, 100)}%` 
                        : '100%' 
                    }}
                  ></div>
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* PANE 2: DOCUMENT PREVIEW (RIGHT MAIN AREA WITH RESIZER) */}
        <section 
  ref={rightPaneRef} 
  className={`w-full lg:w-auto h-full flex-1 bg-white lg:rounded-tl-[32px] lg:border-t lg:border-l border-slate-200 lg:shadow-[-4px_4px_24px_rgba(0,0,0,0.02)] flex-col z-20 lg:z-auto ${selectedFile || aiAnswer ? 'flex' : 'hidden lg:flex'}`}
>
 {/* MOBILE BACK BUTTON */}
  <div className="lg:hidden p-4 bg-white border-b border-slate-200 flex items-center shrink-0">
    <button onClick={() => { setSelectedFile(null); setAiAnswer(null); }} className="flex items-center gap-2 text-sm font-bold text-slate-700 hover:text-indigo-600">
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
      Back to Directory
    </button>
  </div>         
          {/* AI ANSWER PANEL (Top Section) */}
          {aiAnswer && (
            <div 
              style={selectedFile ? { height: `${aiPanelHeight}px` } : {}}
              className={`shrink-0 flex flex-col ${selectedFile ? 'bg-slate-50/40' : ''}`}
            >
              <div className={`flex-1 overflow-y-auto ${selectedFile ? 'p-4 lg:p-6' : 'm-4 lg:m-8'}`}>
                <div className={`bg-white border border-indigo-100 rounded-2xl shadow-sm relative animate-in fade-in slide-in-from-top-4 ${selectedFile ? 'p-5 min-h-full' : 'p-6'}`}>
                  <button onClick={() => setAiAnswer(null)} className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-slate-700 bg-white border border-slate-200 rounded-md shadow-sm transition-colors"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg></button>
                  
                  <div className="flex items-center gap-2 mb-4">
                    <span className="w-2.5 h-2.5 bg-indigo-600 rounded-full"></span>
                    <span className="text-[11px] font-black uppercase tracking-widest text-indigo-700">
                      GEMINI {selectedModel.includes('3.6') ? '3.6 FLASH' : '3.5 FLASH-LITE'} ANSWER
                    </span>
                  </div>
                  
                  <div className="text-sm font-medium text-slate-800 leading-relaxed whitespace-pre-wrap">
                    {renderFormattedText(aiAnswer)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* DRAGGABLE HORIZONTAL SEPARATOR */}
          {aiAnswer && selectedFile && (
            <div 
              onMouseDown={startResizing}
              className="h-3 w-full bg-slate-100 hover:bg-indigo-100 border-y border-slate-200 cursor-row-resize flex items-center justify-center shrink-0 z-30 transition-colors group"
              title="Drag to resize panels"
            >
              <div className="w-12 h-1 bg-slate-300 group-hover:bg-indigo-400 rounded-full pointer-events-none transition-colors"></div>
            </div>
          )}

          {/* DOCUMENT PREVIEW PANEL (Bottom Section) */}
          {selectedFile ? (
            <div className="flex-1 flex flex-col min-h-0 relative bg-white">
              {/* <div className="h-20 lg:h-24 border-b border-slate-100 flex flex-wrap justify-between items-center px-6 lg:px-12 shrink-0 bg-white"> */}
                {/* <div className="flex items-center gap-4 truncate max-w-[80%]"> */}
                  {/* <button onClick={() => setSelectedFile(null)} className="lg:hidden p-2 -ml-2 text-slate-400 hover:text-slate-800 rounded-lg bg-slate-50">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
                  </button> */}
                  {/* <div className="w-10 h-10 rounded-lg bg-blue-50 hidden lg:flex items-center justify-center shrink-0">
                    {getFileIcon(selectedFile.mimeType)}
                  </div> */}
                  {/* <div className="truncate">
                    <h3 className="text-base lg:text-lg font-black text-slate-900 truncate tracking-tight">{selectedFile.name.replace(/\.[^/.]+$/, "")}</h3>
                    <p className="text-[11px] font-medium text-slate-400 mt-0.5">{formatDate(selectedFile.createdTime)} • {(parseInt(selectedFile.size || '0') / 1024).toFixed(0)} KB • Edited via Drive</p>
                  </div> */}
                {/* </div> */}
              {/* </div> */}

              {/* Document Canvas Area */}
              <div className="flex-1 bg-white flex flex-col w-full h-full">
                <div className="flex-1 w-full flex flex-col h-full">
                  <div className="flex-1 bg-white rounded-lg overflow-hidden flex flex-col shadow-sm border border-slate-200/60 min-h-[400px]">
                    {selectedFile.webViewLink ? (
                      <iframe 
                        src={selectedFile.webViewLink.replace('/view', '/preview')} 
                        className="w-full h-full border-0"
                        title={selectedFile.name}
                        sandbox="allow-scripts allow-same-origin allow-popups"
                      />
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center p-10 text-center bg-slate-50">
                        <div className="w-16 h-16 bg-white rounded-full shadow-sm flex items-center justify-center mb-4">{getFileIcon(selectedFile.mimeType)}</div>
                        <h3 className="text-lg font-black text-slate-800">Preview not available</h3>
                        <p className="text-sm font-medium text-slate-500 mt-2 max-w-sm">Google Drive cannot render this file type in a native iframe window.</p>
                        <button onClick={() => window.open(selectedFile.webViewLink, '_blank')} className="mt-6 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-lg transition-colors shadow-sm">Open externally</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : !aiAnswer ? (
            /* EMPTY STATE */
            <div className="flex-1 flex flex-col items-center justify-center px-4 bg-white">
              <div className="w-24 h-24 mb-6 bg-slate-50 rounded-3xl border border-slate-100 flex items-center justify-center shadow-inner">
                <svg className="w-12 h-12 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              </div>
              <h3 className="text-xl font-black text-slate-800 tracking-tight">Select a document</h3>
              <p className="text-sm font-medium text-slate-400 mt-2 text-center max-w-xs">Choose a file from the directory tree to preview it securely.</p>
            </div>
          ) : null}
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
                <button type="button" onClick={() => setIsNewFolderModalOpen(false)} className="px-4 py-2 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-50" disabled={isCreatingFolder}>Cancel</button>
                <button type="submit" disabled={isCreatingFolder || !newFolderName.trim()} className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400 text-white text-sm font-bold shadow-sm">
                  {isCreatingFolder ? 'Creating...' : 'Create'}
                </button>
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