import { useState, useEffect, useCallback } from 'react';
import { getApiAuthHeaders } from '../lib/apiSession';

// ---- INTERFACES ----
interface ImportFile { id: string; impNumber: string; company: string; title?: string; supplierName?: string; origin?: string; status: string; createdBy: string; createdAt: string; updatedAt: string; shipments: Shipment[]; }
interface Shipment { id: string; shpNumber: string; importFileId: string; company: string; forwarder?: string; carrier?: string; shippingMode?: string; blAwbNumber?: string; containerRef?: string; portOfOrigin?: string; portOfDestination?: string; etd?: string; eta?: string; revisedEta?: string; actualArrival?: string; status: string; delayReason?: string; notes?: string; createdBy: string; createdAt: string; poLinks: ShipmentPO[]; customsEntries: any[]; goodsReceipts: any[]; }
interface ShipmentPO { id: string; shipmentId: string; poId: string; po: { id: string; poNumber: string; status: string; grandTotal: number; supplierName?: string; }; }
interface PO { id: string; poNumber: string; status: string; grandTotal: number; supplierName?: string; }
interface Props { selectedCompany: string; loginUsername: string; API_BASE_URL: string; onBack: () => void; onOpenGRN?: (shipment: Shipment) => void; onOpenCustoms?: (shipment: Shipment) => void; }

const FILE_STATUS: Record<string, string> = { Open: 'bg-gray-100 text-gray-700', 'In Transit': 'bg-blue-100 text-blue-800', Arrived: 'bg-teal-100 text-teal-800', Cleared: 'bg-green-100 text-green-700', Closed: 'bg-gray-200 text-gray-500', Cancelled: 'bg-red-100 text-red-700' };
const SHP_STATUS: Record<string, string> = { Pending: 'bg-gray-100 text-gray-600', 'In Transit': 'bg-blue-100 text-blue-800', Arrived: 'bg-teal-100 text-teal-800', 'Under Clearance': 'bg-amber-100 text-amber-800', Released: 'bg-green-100 text-green-700', Delivered: 'bg-green-200 text-green-900', Delayed: 'bg-red-100 text-red-700', Cancelled: 'bg-gray-200 text-gray-500' };

function isDelayed(shp: Shipment): boolean {
  const ref = shp.revisedEta ?? shp.eta;
  if (!ref || shp.actualArrival) return false;
  return new Date(ref) < new Date();
}

export default function ImportTrackerModule({ selectedCompany, loginUsername, API_BASE_URL, onBack, onOpenGRN, onOpenCustoms }: Props) {
  const [view, setView] = useState<'files' | 'shipments'>('files');
  const [importFiles, setImportFiles] = useState<ImportFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<ImportFile | null>(null);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [allPos, setAllPos] = useState<PO[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // Form states
  const [showFileModal, setShowFileModal] = useState(false);
  const [fileForm, setFileForm] = useState({ title: '', supplierName: '', origin: '', notes: '' });
  const [nextImpNumber, setNextImpNumber] = useState('IMP-...');

  const [showShpModal, setShowShpModal] = useState(false);
  const [shpForm, setShpForm] = useState({ importFileId: '', forwarder: '', carrier: '', shippingMode: 'Sea', blAwbNumber: '', containerRef: '', portOfOrigin: '', portOfDestination: '', etd: '', eta: '', notes: '' });
  const [nextShpNumber, setNextShpNumber] = useState('SHP-...');
  const [shpLinkPos, setShpLinkPos] = useState<string[]>([]);

  const [editShp, setEditShp] = useState<Shipment | null>(null);
  const [editShpForm, setEditShpForm] = useState<Partial<Shipment>>({});

  const toast$ = (msg: string, type: 'success' | 'error' = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3500); };
  const h = () => ({ 'Content-Type': 'application/json', ...getApiAuthHeaders() });

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/importation/import-files?company=${encodeURIComponent(selectedCompany)}`, { headers: getApiAuthHeaders() });
      if (res.ok) setImportFiles(await res.json());
    } catch { toast$('Failed to load import files', 'error'); }
    finally { setLoading(false); }
  }, [selectedCompany, API_BASE_URL]);

  const fetchShipments = useCallback(async (importFileId?: string) => {
    setLoading(true);
    try {
      const q = importFileId ? `importFileId=${importFileId}` : `company=${encodeURIComponent(selectedCompany)}`;
      const res = await fetch(`${API_BASE_URL}/importation/shipments?${q}`, { headers: getApiAuthHeaders() });
      if (res.ok) setShipments(await res.json());
    } catch { toast$('Failed to load shipments', 'error'); }
    finally { setLoading(false); }
  }, [selectedCompany, API_BASE_URL]);

  const fetchPos = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/procurement/purchase-orders?company=${encodeURIComponent(selectedCompany)}`, { headers: getApiAuthHeaders() });
      if (res.ok) setAllPos(await res.json());
    } catch { /* silent */ }
  }, [selectedCompany, API_BASE_URL]);

  const fetchNextImp = useCallback(async () => {
    try { const r = await fetch(`${API_BASE_URL}/importation/import-files/next-number?company=${encodeURIComponent(selectedCompany)}`, { headers: getApiAuthHeaders() }); if (r.ok) { const d = await r.json(); setNextImpNumber(d.impNumber); } } catch { setNextImpNumber('IMP-ERROR'); }
  }, [selectedCompany, API_BASE_URL]);

  const fetchNextShp = useCallback(async () => {
    try { const r = await fetch(`${API_BASE_URL}/importation/shipments/next-number?company=${encodeURIComponent(selectedCompany)}`, { headers: getApiAuthHeaders() }); if (r.ok) { const d = await r.json(); setNextShpNumber(d.shpNumber); } } catch { setNextShpNumber('SHP-ERROR'); }
  }, [selectedCompany, API_BASE_URL]);

  useEffect(() => { fetchFiles(); fetchShipments(); fetchPos(); }, [fetchFiles, fetchShipments, fetchPos]);

  const createFile = async () => {
    if (!fileForm.title?.trim() && !fileForm.supplierName?.trim()) { toast$('Provide a title or supplier name', 'error'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/importation/import-files`, { method: 'POST', headers: h(), body: JSON.stringify({ company: selectedCompany, createdBy: loginUsername, ...fileForm }) });
      if (!res.ok) throw new Error((await res.json()).message);
      toast$('Import file created!');
      setShowFileModal(false);
      fetchFiles();
    } catch (e: any) { toast$(e.message, 'error'); }
    finally { setLoading(false); }
  };

  const createShipment = async () => {
    if (!shpForm.importFileId) { toast$('Select an Import File', 'error'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/importation/shipments`, { method: 'POST', headers: h(), body: JSON.stringify({ company: selectedCompany, createdBy: loginUsername, ...shpForm, etd: shpForm.etd || null, eta: shpForm.eta || null, poIds: shpLinkPos }) });
      if (!res.ok) throw new Error((await res.json()).message);
      toast$('Shipment created!');
      setShowShpModal(false);
      fetchShipments();
      fetchFiles();
    } catch (e: any) { toast$(e.message, 'error'); }
    finally { setLoading(false); }
  };

  const updateShipment = async () => {
    if (!editShp) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/importation/shipments/${editShp.id}`, { method: 'PATCH', headers: h(), body: JSON.stringify(editShpForm) });
      if (!res.ok) throw new Error((await res.json()).message);
      toast$('Shipment updated!');
      setEditShp(null);
      fetchShipments(selectedFile?.id);
      fetchFiles();
    } catch (e: any) { toast$(e.message, 'error'); }
    finally { setLoading(false); }
  };

  const updateFileStatus = async (id: string, status: string) => {
    try {
      await fetch(`${API_BASE_URL}/importation/import-files/${id}`, { method: 'PATCH', headers: h(), body: JSON.stringify({ status }) });
      fetchFiles();
    } catch { toast$('Failed to update status', 'error'); }
  };

  const openShpModal = (importFileId?: string) => {
    fetchNextShp(); setShpLinkPos([]);
    setShpForm({ importFileId: importFileId ?? (importFiles[0]?.id ?? ''), forwarder: '', carrier: '', shippingMode: 'Sea', blAwbNumber: '', containerRef: '', portOfOrigin: '', portOfDestination: '', etd: '', eta: '', notes: '' });
    setShowShpModal(true);
  };

  const fmtDate = (d?: string) => d ? new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  const fmtDaysLeft = (d?: string) => { if (!d) return null; const diff = Math.ceil((new Date(d).getTime() - Date.now()) / 86400000); return diff; };

  // ---- RENDER ----
  return (
    <div className="min-h-screen bg-gray-50">
      {toast && <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-medium ${toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>{toast.msg}</div>}

      {/* HEADER */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center gap-4">
          <button onClick={onBack} className="text-gray-400 hover:text-gray-900"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg></button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-gray-900">Import File & Shipment Tracker</h1>
            <p className="text-xs text-gray-500">{selectedCompany} · IMP / SHP tracking with delay alerts</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setView('files')} className={`px-4 py-2 text-sm rounded-lg font-medium transition-colors ${view === 'files' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>Import Files</button>
            <button onClick={() => setView('shipments')} className={`px-4 py-2 text-sm rounded-lg font-medium transition-colors ${view === 'shipments' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>All Shipments</button>
          </div>
          <button onClick={() => { if (view === 'files') { fetchNextImp(); setFileForm({ title: '', supplierName: '', origin: '', notes: '' }); setShowFileModal(true); } else openShpModal(); }} className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700">
            {view === 'files' ? '+ New Import File' : '+ New Shipment'}
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* ===== IMPORT FILES VIEW ===== */}
        {view === 'files' && (
          <div className="space-y-4">
            {loading && <p className="text-center text-gray-400 py-10">Loading...</p>}
            {!loading && importFiles.length === 0 && <div className="text-center py-20 text-gray-400"><p className="text-lg font-medium">No Import Files yet</p><p className="text-sm">Create one to group your Purchase Orders into a shipment umbrella</p></div>}
            {importFiles.map(imp => (
              <div key={imp.id} className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 flex flex-wrap items-center justify-between gap-3 border-b border-gray-100">
                  <div>
                    <span className="font-mono font-bold text-indigo-700 text-lg">{imp.impNumber}</span>
                    {imp.title && <span className="ml-2 text-gray-700 font-medium">{imp.title}</span>}
                    <div className="text-xs text-gray-400 mt-0.5">
                      {imp.supplierName && <span>Supplier: {imp.supplierName} · </span>}
                      {imp.origin && <span>Origin: {imp.origin} · </span>}
                      <span>Created {fmtDate(imp.createdAt)} by {imp.createdBy}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <select value={imp.status} onChange={e => updateFileStatus(imp.id, e.target.value)} className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 bg-white">
                      {Object.keys(FILE_STATUS).map(s => <option key={s}>{s}</option>)}
                    </select>
                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${FILE_STATUS[imp.status] ?? 'bg-gray-100 text-gray-600'}`}>{imp.status}</span>
                    <button onClick={() => { setSelectedFile(imp); fetchShipments(imp.id); setView('shipments'); }} className="px-3 py-1.5 text-xs text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50">View Shipments</button>
                    <button onClick={() => { setSelectedFile(imp); openShpModal(imp.id); }} className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">+ Shipment</button>
                  </div>
                </div>
                {imp.shipments.length > 0 && (
                  <div className="px-6 py-3 bg-gray-50">
                    <div className="flex flex-wrap gap-2">
                      {imp.shipments.map(shp => (
                        <div key={shp.id} className={`px-3 py-1.5 rounded-lg border text-xs flex items-center gap-2 ${isDelayed(shp) ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white'}`}>
                          <span className="font-mono font-semibold text-gray-700">{shp.shpNumber}</span>
                          {shp.shippingMode && <span className="text-gray-400">{shp.shippingMode}</span>}
                          {shp.eta && <span>ETA: {fmtDate(shp.eta)}</span>}
                          {isDelayed(shp) && <span className="text-red-600 font-bold">⚠ DELAYED</span>}
                          <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${SHP_STATUS[shp.status] ?? 'bg-gray-100 text-gray-600'}`}>{shp.status}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ===== SHIPMENTS VIEW ===== */}
        {view === 'shipments' && (
          <div>
            {selectedFile && (
              <div className="mb-4 flex items-center gap-3">
                <button onClick={() => { setSelectedFile(null); setView('files'); fetchShipments(); }} className="text-xs text-gray-500 hover:text-gray-800 flex items-center gap-1">← All Import Files</button>
                <span className="text-sm font-semibold text-gray-700">Shipments for <span className="text-indigo-700 font-mono">{selectedFile.impNumber}</span></span>
              </div>
            )}
            {loading && <p className="text-center text-gray-400 py-10">Loading...</p>}
            {!loading && shipments.length === 0 && <div className="text-center py-16 text-gray-400 text-sm">No shipments found</div>}
            <div className="space-y-4">
              {shipments.map(shp => {
                const delayed = isDelayed(shp);
                const daysLeft = fmtDaysLeft(shp.revisedEta ?? shp.eta);
                return (
                  <div key={shp.id} className={`bg-white rounded-2xl shadow-sm border overflow-hidden ${delayed ? 'border-red-300' : 'border-gray-200'}`}>
                    <div className={`px-6 py-4 flex flex-wrap items-center justify-between gap-3 border-b ${delayed ? 'bg-red-50 border-red-100' : 'border-gray-100'}`}>
                      <div>
                        <span className="font-mono font-bold text-indigo-700 text-lg">{shp.shpNumber}</span>
                        {delayed && <span className="ml-2 px-2 py-0.5 bg-red-600 text-white text-xs font-bold rounded-full">⚠ DELAYED</span>}
                        <div className="text-xs text-gray-400 mt-0.5">
                          {shp.carrier && <span>{shp.carrier} · </span>}
                          {shp.shippingMode && <span>{shp.shippingMode} · </span>}
                          {shp.blAwbNumber && <span>BL/AWB: <strong className="text-gray-600">{shp.blAwbNumber}</strong> · </span>}
                          {shp.containerRef && <span>Container: {shp.containerRef}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${SHP_STATUS[shp.status] ?? 'bg-gray-100 text-gray-600'}`}>{shp.status}</span>
                        <button onClick={() => { setEditShp(shp); setEditShpForm({ forwarder: shp.forwarder, carrier: shp.carrier, shippingMode: shp.shippingMode, blAwbNumber: shp.blAwbNumber, containerRef: shp.containerRef, portOfOrigin: shp.portOfOrigin, portOfDestination: shp.portOfDestination, etd: shp.etd?.split('T')[0], eta: shp.eta?.split('T')[0], revisedEta: shp.revisedEta?.split('T')[0], actualArrival: shp.actualArrival?.split('T')[0], status: shp.status, delayReason: shp.delayReason, notes: shp.notes }); }} className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">Edit</button>
                        {onOpenCustoms && <button onClick={() => onOpenCustoms(shp)} className="px-3 py-1.5 text-xs bg-amber-600 text-white rounded-lg hover:bg-amber-700">Customs</button>}
                        {onOpenGRN && <button onClick={() => onOpenGRN(shp)} className="px-3 py-1.5 text-xs bg-teal-600 text-white rounded-lg hover:bg-teal-700">GRN</button>}
                      </div>
                    </div>
                    <div className="px-6 py-3 grid grid-cols-2 md:grid-cols-5 gap-4 text-xs text-gray-600">
                      <div><span className="text-gray-400 block">ETD</span>{fmtDate(shp.etd)}</div>
                      <div><span className="text-gray-400 block">ETA</span>{fmtDate(shp.eta)}</div>
                      <div><span className="text-gray-400 block">Revised ETA</span>{fmtDate(shp.revisedEta)}</div>
                      <div><span className="text-gray-400 block">Actual Arrival</span>{fmtDate(shp.actualArrival)}</div>
                      <div><span className="text-gray-400 block">Days to ETA</span>{daysLeft != null ? (daysLeft < 0 ? <span className="text-red-600 font-bold">{Math.abs(daysLeft)}d overdue</span> : `${daysLeft}d`) : '—'}</div>
                    </div>
                    {shp.poLinks.length > 0 && (
                      <div className="px-6 pb-3">
                        <p className="text-xs text-gray-400 mb-1 font-medium uppercase tracking-wide">Linked POs</p>
                        <div className="flex flex-wrap gap-2">
                          {shp.poLinks.map(link => (
                            <span key={link.id} className="px-2 py-1 bg-indigo-50 text-indigo-700 text-xs rounded-lg font-mono">
                              {link.po.poNumber} {link.po.supplierName && `· ${link.po.supplierName}`}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {shp.delayReason && <div className="px-6 pb-3 text-xs text-red-600"><strong>Delay reason:</strong> {shp.delayReason}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* CREATE IMPORT FILE MODAL */}
      {showFileModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
              <div><h3 className="font-bold text-gray-900">New Import File</h3><p className="text-xs text-gray-400 font-mono">{nextImpNumber}</p></div>
              <button onClick={() => setShowFileModal(false)} className="text-gray-400 hover:text-gray-700 text-2xl">×</button>
            </div>
            <div className="p-6 space-y-3">
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">Title / Reference</label><input value={fileForm.title} onChange={e => setFileForm(p => ({...p, title: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="e.g. Q4 Medical Devices Import" /></div>
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">Supplier Name</label><input value={fileForm.supplierName} onChange={e => setFileForm(p => ({...p, supplierName: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">Country of Origin</label><input value={fileForm.origin} onChange={e => setFileForm(p => ({...p, origin: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="e.g. China, USA, Germany" /></div>
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">Notes</label><textarea value={fileForm.notes} onChange={e => setFileForm(p => ({...p, notes: e.target.value}))} rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none" /></div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={() => setShowFileModal(false)} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={createFile} disabled={loading} className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-60">{loading ? 'Creating...' : 'Create Import File'}</button>
            </div>
          </div>
        </div>
      )}

      {/* CREATE SHIPMENT MODAL */}
      {showShpModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
              <div><h3 className="font-bold text-gray-900">New Shipment</h3><p className="text-xs text-gray-400 font-mono">{nextShpNumber}</p></div>
              <button onClick={() => setShowShpModal(false)} className="text-gray-400 hover:text-gray-700 text-2xl">×</button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              <div className="col-span-2"><label className="block text-xs font-semibold text-gray-600 mb-1">Import File *</label>
                <select value={shpForm.importFileId} onChange={e => setShpForm(p => ({...p, importFileId: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  <option value="">— Select Import File —</option>
                  {importFiles.map(f => <option key={f.id} value={f.id}>{f.impNumber} {f.title ? `· ${f.title}` : ''}</option>)}
                </select>
              </div>
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">Forwarder</label><input value={shpForm.forwarder} onChange={e => setShpForm(p => ({...p, forwarder: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">Carrier / Vessel</label><input value={shpForm.carrier} onChange={e => setShpForm(p => ({...p, carrier: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">Shipping Mode</label>
                <select value={shpForm.shippingMode} onChange={e => setShpForm(p => ({...p, shippingMode: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  {['Sea','Air','Land','Courier'].map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">BL / AWB Number</label><input value={shpForm.blAwbNumber} onChange={e => setShpForm(p => ({...p, blAwbNumber: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">Container Reference</label><input value={shpForm.containerRef} onChange={e => setShpForm(p => ({...p, containerRef: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">Port of Origin</label><input value={shpForm.portOfOrigin} onChange={e => setShpForm(p => ({...p, portOfOrigin: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">Port of Destination</label><input value={shpForm.portOfDestination} onChange={e => setShpForm(p => ({...p, portOfDestination: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">ETD</label><input type="date" value={shpForm.etd} onChange={e => setShpForm(p => ({...p, etd: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">ETA</label><input type="date" value={shpForm.eta} onChange={e => setShpForm(p => ({...p, eta: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-gray-600 mb-1">Link Purchase Orders (optional)</label>
                <div className="max-h-36 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                  {allPos.filter(p => !['Cancelled'].includes(p.status)).map(po => (
                    <label key={po.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm">
                      <input type="checkbox" checked={shpLinkPos.includes(po.id)} onChange={e => setShpLinkPos(prev => e.target.checked ? [...prev, po.id] : prev.filter(x => x !== po.id))} className="accent-indigo-600" />
                      <span className="font-mono text-indigo-700 text-xs">{po.poNumber}</span>
                      {po.supplierName && <span className="text-gray-500 text-xs">{po.supplierName}</span>}
                      <span className="ml-auto text-gray-400 text-xs">₱{po.grandTotal.toLocaleString()}</span>
                    </label>
                  ))}
                  {allPos.length === 0 && <p className="text-center text-gray-400 text-xs py-4">No POs available</p>}
                </div>
              </div>
              <div className="col-span-2"><label className="block text-xs font-semibold text-gray-600 mb-1">Notes</label><textarea value={shpForm.notes} onChange={e => setShpForm(p => ({...p, notes: e.target.value}))} rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none" /></div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={() => setShowShpModal(false)} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg">Cancel</button>
              <button onClick={createShipment} disabled={loading} className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-60">{loading ? 'Creating...' : 'Create Shipment'}</button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT SHIPMENT MODAL */}
      {editShp && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-gray-900">Edit Shipment · <span className="font-mono text-indigo-700">{editShp.shpNumber}</span></h3>
              <button onClick={() => setEditShp(null)} className="text-gray-400 hover:text-gray-700 text-2xl">×</button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              {([['forwarder','Forwarder'],['carrier','Carrier'],['blAwbNumber','BL/AWB Number'],['containerRef','Container Ref'],['portOfOrigin','Port of Origin'],['portOfDestination','Port of Destination']] as [keyof Shipment, string][]).map(([field, label]) => (
                <div key={field}><label className="block text-xs font-semibold text-gray-600 mb-1">{label}</label><input value={(editShpForm as any)[field] ?? ''} onChange={e => setEditShpForm(p => ({...p, [field]: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
              ))}
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">Shipping Mode</label>
                <select value={(editShpForm as any).shippingMode ?? ''} onChange={e => setEditShpForm(p => ({...p, shippingMode: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  {['Sea','Air','Land','Courier'].map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">Status</label>
                <select value={(editShpForm as any).status ?? ''} onChange={e => setEditShpForm(p => ({...p, status: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  {Object.keys(SHP_STATUS).map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              {(['etd','eta','revisedEta','actualArrival'] as const).map(f => (
                <div key={f}><label className="block text-xs font-semibold text-gray-600 mb-1">{f === 'revisedEta' ? 'Revised ETA' : f === 'actualArrival' ? 'Actual Arrival' : f.toUpperCase()}</label><input type="date" value={(editShpForm as any)[f] ?? ''} onChange={e => setEditShpForm(p => ({...p, [f]: e.target.value || null}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
              ))}
              <div className="col-span-2"><label className="block text-xs font-semibold text-gray-600 mb-1">Delay Reason</label><input value={(editShpForm as any).delayReason ?? ''} onChange={e => setEditShpForm(p => ({...p, delayReason: e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
              <div className="col-span-2"><label className="block text-xs font-semibold text-gray-600 mb-1">Notes</label><textarea value={(editShpForm as any).notes ?? ''} onChange={e => setEditShpForm(p => ({...p, notes: e.target.value}))} rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none" /></div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={() => setEditShp(null)} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg">Cancel</button>
              <button onClick={updateShipment} disabled={loading} className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-60">{loading ? 'Saving...' : 'Save Changes'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
