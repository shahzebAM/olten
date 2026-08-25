import React, { useState } from 'react';

// Props passed down from App.tsx
interface AiDocsProps {
  selectedCompany: string;
  loginUsername: string;
  onBack: () => void;
}

export default function AiDocsModule({ selectedCompany, loginUsername, onBack }: AiDocsProps) {
  const [query, setQuery] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [chatHistory, setChatHistory] = useState<{role: 'user' | 'ai', text: string, model?: string, sources?: number}[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  // Dynamic branding colors based on the active company!
  const themeColor = selectedCompany === 'Surgicom' ? 'emerald' : selectedCompany === 'Ordent' ? 'amber' : 'blue';
  const bgHeader = `bg-${themeColor}-900`;
  const textTheme = `text-${themeColor}-600`;
  const bgTheme = `bg-${themeColor}-600 hover:bg-${themeColor}-700`;
  const ringTheme = `focus:ring-${themeColor}-600`;

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setIsUploading(true);
    
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('http://localhost:3000/api/docs/upload', {
        method: 'POST',
        // SECURITY: We strictly pass the active company in the headers!
        headers: { 
          'x-company': selectedCompany,
          'x-username': loginUsername 
        },
        body: formData
      });
      
      if (!res.ok) throw new Error();
      alert('Document securely uploaded and processing in Gemini!');
      setFile(null); // Clear file after upload
    } catch (err) {
      alert('Failed to upload document.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    // Add user question to UI instantly
    const newHistory = [...chatHistory, { role: 'user' as const, text: query }];
    setChatHistory(newHistory);
    setIsSearching(true);
    setQuery(''); // Clear input

    try {
      const res = await fetch('http://localhost:3000/api/docs/search', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-company': selectedCompany,
          'x-username': loginUsername
        },
        body: JSON.stringify({ query: newHistory[newHistory.length - 1].text })
      });
      
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.message || 'Search failed');

      // Add AI answer to UI
      setChatHistory(prev => [...prev, { 
        role: 'ai', 
        text: data.answer, 
        model: data.model, 
        sources: data.sourcesSearched 
      }]);
    } catch (err: any) {
      setChatHistory(prev => [...prev, { role: 'ai', text: `System Error: ${err.message}` }]);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* TOP HEADER */}
      <header className={`h-20 ${bgHeader} flex items-center justify-between px-8 shadow-md relative z-10 shrink-0`}>
        <div>
          <h2 className="text-2xl font-extrabold text-white tracking-wider uppercase">{selectedCompany} <span className={`text-${themeColor}-400 font-light`}>Knowledge Base</span></h2>
          <p className="text-white/70 text-xs font-bold tracking-widest uppercase mt-0.5">Secure AI Documentation Module</p>
        </div>
        <button onClick={onBack} className="px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-sm font-bold transition-colors flex items-center gap-2 border border-white/20">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
          Return to Gateway
        </button>
      </header>

      <div className="flex-1 max-w-7xl w-full mx-auto p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* LEFT COLUMN: UPLOAD */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white rounded-3xl p-6 sm:p-8 shadow-sm border border-slate-200">
            <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight mb-2">Secure Vault Upload</h3>
            <p className="text-sm text-slate-500 mb-6 font-medium">Upload contracts, invoices, or manuals directly into the {selectedCompany} knowledge base.</p>
            
            <form onSubmit={handleUpload} className="flex flex-col gap-4">
              <label className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-slate-300 rounded-2xl cursor-pointer hover:bg-slate-50 transition-colors ${file ? 'bg-slate-50 border-slate-400' : ''}`}>
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <svg className="w-8 h-8 text-slate-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
                  <p className="text-sm text-slate-500 font-bold">{file ? file.name : 'Click to select PDF file'}</p>
                </div>
                <input type="file" accept="application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              </label>
              <button type="submit" disabled={!file || isUploading} className={`w-full py-3 rounded-xl text-white font-bold tracking-wide shadow-sm transition-colors disabled:opacity-50 ${bgTheme}`}>
                {isUploading ? 'Encrypting & Indexing...' : 'Upload Document'}
              </button>
            </form>
          </div>
        </div>

        {/* RIGHT COLUMN: AI SEARCH CHAT */}
        <div className="lg:col-span-2 bg-white rounded-3xl shadow-sm border border-slate-200 flex flex-col overflow-hidden h-[calc(100vh-10rem)]">
          
          <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/50">
            {chatHistory.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center opacity-60">
                <div className={`w-16 h-16 bg-${themeColor}-100 text-${themeColor}-600 rounded-2xl flex items-center justify-center mb-4`}>
                  <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" /></svg>
                </div>
                <h3 className="text-xl font-bold text-slate-800">Ask the {selectedCompany} Knowledge Base</h3>
                <p className="text-sm text-slate-500 mt-2 max-w-sm">Search across all active contracts, manuals, and invoices belonging to this organization.</p>
              </div>
            ) : (
              chatHistory.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] p-5 rounded-2xl ${msg.role === 'user' ? `${bgTheme} text-white rounded-tr-sm shadow-md` : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm shadow-sm'}`}>
                    {msg.role === 'ai' && msg.model && (
                      <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-100">
                        <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md ${msg.model.includes('pro') ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>{msg.model}</span>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{msg.sources} Documents scanned</span>
                      </div>
                    )}
                    <div className="whitespace-pre-wrap text-sm leading-relaxed font-medium">{msg.text}</div>
                  </div>
                </div>
              ))
            )}
            {isSearching && (
              <div className="flex justify-start">
                <div className="bg-white border border-slate-200 text-slate-500 p-5 rounded-2xl rounded-tl-sm shadow-sm flex items-center gap-3">
                  <div className="w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin"></div>
                  <span className="text-sm font-bold animate-pulse">Gemini is analyzing documents...</span>
                </div>
              </div>
            )}
          </div>

          <div className="p-4 bg-white border-t border-slate-200">
            <form onSubmit={handleSearch} className="flex gap-3 relative">
              <input 
                type="text" 
                value={query} 
                onChange={(e) => setQuery(e.target.value)} 
                placeholder={`Search ${selectedCompany} documents...`} 
                className={`w-full bg-slate-100 border-none px-6 py-4 rounded-2xl text-slate-800 font-medium focus:outline-none focus:ring-2 ${ringTheme} transition-shadow`} 
              />
              <button type="submit" disabled={isSearching || !query.trim()} className={`absolute right-2 top-2 bottom-2 px-6 rounded-xl text-white font-bold shadow-md disabled:opacity-50 transition-colors ${bgTheme}`}>
                Ask
              </button>
            </form>
          </div>

        </div>
      </div>
    </div>
  );
}