import React, { useState, useEffect } from 'react';

interface AiDocsProps {
  selectedCompany: string;
  loginUsername: string;
  onBack: () => void;
}

const API_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

interface DriveItem {
  id: string;
  name: string;
  mimeType?: string;
  webViewLink?: string;
}

export default function AiDocsModule({ selectedCompany, loginUsername, onBack }: AiDocsProps) {
  const [folders, setFolders] = useState<DriveItem[]>([]);
  const [files, setFiles] = useState<DriveItem[]>([]);
  const [companyFolderId, setCompanyFolderId] = useState<string>('');
  const [loading, setLoading] = useState(true);

  // Upload Modal State
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [destinationChoice, setDestinationChoice] = useState<'root' | 'subfolder'>('root');
  const [selectedSubfolderId, setSelectedSubfolderId] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);

  // New Folder Modal
  const [isNewFolderModalOpen, setIsNewFolderModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // AI Search & Chat State
  const [searchQuery, setSearchQuery] = useState('');
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [aiModel, setAiModel] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  // Fetch Directory on Mount
  const fetchDirectory = async () => {
    try {
      setLoading(true);
      const res = await fetch(\${API_URL}/api/docs/directory``, {
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
  };

  useEffect(() => {
    fetchDirectory();
  }, [selectedCompany]);

  // Handle Document Upload
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', selectedFile);

    const targetFolder = destinationChoice === 'subfolder' ? selectedSubfolderId : companyFolderId;
    if (targetFolder) {
      formData.append('targetFolderId', targetFolder);
    }

    try {
      const res = await fetch(\${API_URL}/api/docs/upload``, {
        method: 'POST',
        headers: {
          'x-company': selectedCompany,
          'x-username': loginUsername,
        },
        body: formData,
      });

      if (!res.ok) throw new Error('Upload failed');

      alert(`Document uploaded to ${destinationChoice === 'root' ? selectedCompany + ' root directory' : 'selected subfolder'}!`);
      setSelectedFile(null);
      setIsUploadModalOpen(false);
      fetchDirectory();
    } catch (err) {
      alert('Failed to upload document.');
    } finally {
      setIsUploading(false);
    }
  };

  // Handle New Folder Creation
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;

    try {
      const res = await fetch('http://localhost:3000/api/docs/folder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-company': selectedCompany,
        },
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
      const res = await fetch(\${API_URL}/api/docs/search``, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-company': selectedCompany,
          'x-username': loginUsername,
        },
        body: JSON.stringify({ query: searchQuery }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Search failed');

      setAiAnswer(data.answer);
      setAiModel(data.model);
    } catch (err: any) {
      setAiAnswer(`Error: ${err.message}`);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-slate-900 font-sans flex flex-col">
      {/* Top Navigation */}
      <header className="border-b border-slate-100 px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">{selectedCompany} Workspace</h1>
            <p className="text-xs text-slate-400 font-medium tracking-wide">Google Drive & Gemini Index</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsNewFolderModalOpen(true)}
            className="px-4 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
            New Folder
          </button>
          <button
            onClick={() => setIsUploadModalOpen(true)}
            className="px-6 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-sm font-bold tracking-wide transition-colors shadow-sm"
          >
            Upload Document
          </button>
        </div>
      </header>

      {/* Main Content Area (Figma Grid Layout) */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-8 py-10 flex flex-col items-center">
        {/* Search Bar matching Figma */}
        {/* Search Bar matching Figma */}
        <form onSubmit={handleSearchSubmit} className="w-full max-w-2xl mb-12">
          <div className="relative flex items-center">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search ${selectedCompany} documents with Gemini...`}
              className="w-full pl-14 pr-24 py-4 bg-white border-2 border-slate-300 focus:border-indigo-600 rounded-full text-base font-medium shadow-sm outline-none transition-all placeholder:text-slate-400"
            />
            <div className="absolute left-5 text-slate-400">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <button
              type="submit"
              disabled={isSearching}
              className="absolute right-3 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
            >
              {isSearching ? 'Scanning...' : 'Search'}
            </button>
          </div>

          {/* NEW: Elegant Animated Progress Bar */}
          {isSearching && (
            <div className="w-full h-1 mt-4 bg-indigo-50 rounded-full overflow-hidden flex">
              <div className="w-1/3 h-full bg-indigo-500 rounded-full animate-[ping_1.5s_cubic-bezier(0,0,0.2,1)_infinite]"></div>
              <div className="w-full h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-500 animate-pulse rounded-full"></div>
            </div>
          )}
        </form>

        {/* AI Answer Box (Appears when search is executed) */}
        {aiAnswer && (
          <div className="w-full max-w-3xl mb-10 p-6 bg-slate-50 border border-indigo-100 rounded-2xl shadow-sm">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-200">
              <span className="text-xs font-black tracking-widest text-indigo-700 uppercase">Gemini AI Answer ({aiModel})</span>
              <button onClick={() => setAiAnswer(null)} className="text-xs font-bold text-slate-400 hover:text-slate-600">Close</button>
            </div>
            <p className="text-sm leading-relaxed text-slate-700 font-medium whitespace-pre-wrap">{aiAnswer}</p>
          </div>
        )}

        {/* Folder Explorer Grid (Exact Figma Style) */}
        <div className="w-full">
          <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-6">Drive Directory</h2>

          {loading ? (
            <div className="text-center py-20 text-slate-400 font-medium">Loading folders from Google Drive...</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-8">
              {/* Default Root Company Folder Card */}
              <div className="flex items-center gap-4 p-4 rounded-2xl border border-slate-200 hover:border-amber-400 bg-white hover:shadow-md transition-all cursor-pointer group">
                <div className="text-amber-500">
                  <svg className="w-12 h-12 stroke-current fill-amber-50" viewBox="0 0 24 24" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                  </svg>
                </div>
                <div>
                  <span className="font-semibold text-slate-800 text-sm block group-hover:text-amber-600 transition-colors">Company Root</span>
                  <span className="text-[11px] text-slate-400">/{selectedCompany}</span>
                </div>
              </div>

              {/* Dynamic Google Drive Subfolders */}
              {folders.map((folder) => (
                <div key={folder.id} className="flex items-center gap-4 p-4 rounded-2xl border border-slate-200 hover:border-amber-400 bg-white hover:shadow-md transition-all cursor-pointer group">
                  <div className="text-amber-500">
                    <svg className="w-12 h-12 stroke-current fill-amber-50" viewBox="0 0 24 24" strokeWidth="1.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                    </svg>
                  </div>
                  <div>
                    <span className="font-semibold text-slate-800 text-sm block truncate max-w-[120px] group-hover:text-amber-600 transition-colors">{folder.name}</span>
                    <span className="text-[11px] text-slate-400">Folder</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Files List Section */}
          {files.length > 0 && (
            <div className="mt-14">
              <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-4">Files in {selectedCompany}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {files.map((file) => (
                  <a
                    key={file.id}
                    href={file.webViewLink}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between p-4 bg-slate-50 hover:bg-slate-100 rounded-xl border border-slate-200 transition-colors"
                  >
                    <div className="flex items-center gap-3 truncate">
                      <svg className="w-6 h-6 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                      <span className="text-xs font-semibold text-slate-700 truncate">{file.name}</span>
                    </div>
                    <span className="text-[10px] text-indigo-600 font-bold shrink-0">Open ↗</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* --- UPLOAD MODAL WITH FOLDER CHOICE --- */}
      {isUploadModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-8 max-w-lg w-full shadow-2xl border border-slate-100">
            <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight mb-2">Upload Document</h3>
            <p className="text-xs text-slate-500 mb-6 font-medium">Select a PDF file and designate which Google Drive folder it should be stored in.</p>

            <form onSubmit={handleUploadSubmit} className="space-y-6">
              {/* File Input */}
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 hover:border-slate-400 p-6 rounded-2xl cursor-pointer">
                <svg className="w-8 h-8 text-slate-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                <span className="text-xs font-bold text-slate-600">{selectedFile ? selectedFile.name : 'Click to select PDF document'}</span>
                <input type="file" accept="application/pdf" className="hidden" onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} />
              </label>

              {/* Destination Radio Prompt */}
              <div className="space-y-3">
                <label className="text-xs font-bold text-slate-600 uppercase tracking-wider block">Target Location in Drive</label>
                
                <div className="flex items-center gap-3">
                  <input
                    type="radio"
                    id="destRoot"
                    name="destChoice"
                    checked={destinationChoice === 'root'}
                    onChange={() => setDestinationChoice('root')}
                    className="text-indigo-600 focus:ring-indigo-500"
                  />
                  <label htmlFor="destRoot" className="text-sm font-semibold text-slate-700">
                    Upload to Root Company Folder (<span className="text-indigo-600">/{selectedCompany}</span>)
                  </label>
                </div>

                <div className="flex items-center gap-3">
                  <input
                    type="radio"
                    id="destSub"
                    name="destChoice"
                    checked={destinationChoice === 'subfolder'}
                    onChange={() => setDestinationChoice('subfolder')}
                    className="text-indigo-600 focus:ring-indigo-500"
                  />
                  <label htmlFor="destSub" className="text-sm font-semibold text-slate-700">
                    Upload into a specific subfolder
                  </label>
                </div>

                {/* Subfolder Dropdown */}
                {destinationChoice === 'subfolder' && (
                  <select
                    value={selectedSubfolderId}
                    onChange={(e) => setSelectedSubfolderId(e.target.value)}
                    className="w-full mt-2 p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 outline-none focus:border-indigo-600"
                    required
                  >
                    <option value="">-- Choose Subfolder --</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsUploadModalOpen(false)}
                  className="px-5 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-500 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!selectedFile || isUploading}
                  className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold shadow-md transition-colors disabled:opacity-50"
                >
                  {isUploading ? 'Uploading & Indexing...' : 'Confirm Upload'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- CREATE SUBFOLDER MODAL --- */}
      {isNewFolderModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl border border-slate-100">
            <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight mb-2">New Folder</h3>
            <p className="text-xs text-slate-500 mb-4 font-medium">Create a new subfolder inside the {selectedCompany} Drive vault.</p>

            <form onSubmit={handleCreateFolder} className="space-y-4">
              <input
                type="text"
                placeholder="e.g. Invoices, Contracts, HR"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 outline-none focus:border-indigo-600"
                required
              />
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsNewFolderModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-black text-white text-sm font-bold"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}