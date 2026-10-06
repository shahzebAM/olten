import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { acquireDocumentPreview, PreviewError } from '../lib/previewSource';
import type { PreviewResource } from '../lib/previewSource';
import { safeDocumentLink } from '../lib/documentLinks';

interface DocumentPreviewProps {
  apiBaseUrl: string; company: string; username?: string;
  documentId?: number; driveFileId?: string; sourceName: string;
  sourceVersion?: string; externalUrl?: string; className?: string;
}
type PreviewState = { key: string; status: 'loading' | 'ready' | 'unsupported' | 'error'; resource?: PreviewResource; message?: string };

function PdfPages({ pdf, name }: { pdf: PDFDocumentProxy; name: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(600);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState('');
  const [pageAttempt, setPageAttempt] = useState(0);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => setWidth(Math.max(160, container.clientWidth - 32)));
    observer.observe(container);
    setWidth(Math.max(160, container.clientWidth - 32));
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let active = true;
    let task: RenderTask | undefined;
    const canvas = canvasRef.current;
    setRendering(true);
    setError('');
    if (canvas) canvas.dataset.rendered = 'false';
    const render = async () => {
      try {
        const pdfPage = await pdf.getPage(page);
        if (!active || !canvas) return;
        const natural = pdfPage.getViewport({ scale: 1 });
        const viewport = pdfPage.getViewport({ scale: Math.min(width, 1800) / natural.width * zoom });
        const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(16_000_000 / (viewport.width * viewport.height)));
        canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
        canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        canvas.dataset.rendered = 'false';
        task = pdfPage.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0], background: '#ffffff' });
        await task.promise;
        if (active) { canvas.dataset.rendered = 'true'; setRendering(false); }
      } catch (failure) {
        if (active && !(failure instanceof Error && failure.name === 'RenderingCancelledException')) {
          setRendering(false);
          setError('This page could not be displayed. Retry this page or open the original PDF.');
        }
      }
    };
    void render();
    return () => { active = false; task?.cancel(); };
  }, [pdf, page, zoom, width, pageAttempt]);
  const buttonClass = 'rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-40';
  return <>
    <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-b border-slate-200 bg-white px-3 py-2" aria-label="PDF controls">
      <button type="button" aria-label="Previous page" disabled={page === 1} onClick={() => setPage(value => value - 1)} className={buttonClass}>‹</button>
      <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">Page
        <input aria-label="Page number" type="number" min="1" max={pdf.numPages} value={page} onChange={event => {
          const value = Number(event.target.value);
          if (Number.isInteger(value) && value >= 1 && value <= pdf.numPages) setPage(value);
        }} className="w-14 rounded border border-slate-300 px-2 py-1 text-center" />of {pdf.numPages}
      </label>
      <button type="button" aria-label="Next page" disabled={page === pdf.numPages} onClick={() => setPage(value => value + 1)} className={buttonClass}>›</button>
      <button type="button" aria-label="Zoom out" disabled={zoom <= 0.5} onClick={() => setZoom(value => Math.max(0.5, value - 0.25))} className={buttonClass}>−</button>
      <button type="button" aria-label="Fit page width" title="Fit page width" onClick={() => setZoom(1)} className={buttonClass}>{Math.round(zoom * 100)}%</button>
      <button type="button" aria-label="Zoom in" disabled={zoom >= 3} onClick={() => setZoom(value => Math.min(3, value + 0.25))} className={buttonClass}>+</button>
    </div>
    <div ref={containerRef} className="min-h-0 flex-1 overflow-auto bg-slate-200 p-4">
      {rendering && <p role="status" className="mb-3 text-center text-sm font-semibold text-slate-600">Loading page {page}…</p>}
      {error && <div role="alert" className="mb-3 text-center text-sm font-semibold text-rose-700">
        <p>{error}</p>
        <button type="button" onClick={() => setPageAttempt(value => value + 1)} className={`${buttonClass} mt-2`}>Retry page</button>
      </div>}
      <canvas ref={canvasRef} role="img" aria-hidden={rendering || !!error} aria-label={`${name}, page ${page} of ${pdf.numPages}`} className="mx-auto block bg-white shadow-sm" />
    </div>
  </>;
}

export default function DocumentPreview({ apiBaseUrl, company, username = '', documentId,
  driveFileId, sourceName, sourceVersion, externalUrl, className = '' }: DocumentPreviewProps) {
  const [attempt, setAttempt] = useState(0);
  const [opening, setOpening] = useState(false);
  const leaseRef = useRef<ReturnType<typeof acquireDocumentPreview> | null>(null);
  const sourceId = documentId !== undefined ? String(documentId) : driveFileId;
  const sourceType = documentId !== undefined ? 'document' : 'drive';
  const requestKey = JSON.stringify([apiBaseUrl, company, username, sourceType, sourceId, sourceVersion, attempt]);
  const [preview, setPreview] = useState<PreviewState>({ key: '', status: 'loading' });
  const visible = preview.key === requestKey ? preview : { key: requestKey, status: 'loading' as const };
  const driveUrl = safeDocumentLink(externalUrl)?.href;
  useEffect(() => {
    let active = true;
    setOpening(false);
    setPreview({ key: requestKey, status: 'loading' });
    const showFailure = (failure: Error) => {
      if (!active) return;
      setPreview({ key: requestKey, status: failure instanceof PreviewError && failure.unsupported ? 'unsupported' : 'error',
        message: failure instanceof PreviewError ? failure.message : failure.name === 'PasswordException'
          ? 'This PDF is password protected. Open the original in Drive.'
          : 'The document could not be loaded. Check your connection and retry.' });
    };
    if (!company || !sourceId || !/^[A-Za-z0-9_-]+$/.test(sourceId)) {
      showFailure(new PreviewError('This document source is unavailable.'));
      return;
    }
    const lease = acquireDocumentPreview({ apiBaseUrl, company, username, id: sourceId, source: sourceType, version: sourceVersion,
      mimeType: /\.pdf$/i.test(sourceName) ? 'application/pdf' : 'unknown' }, showFailure);
    leaseRef.current = lease;
    void lease.promise.then(resource => { if (active) setPreview({ key: requestKey, status: 'ready', resource }); }).catch(showFailure);
    return () => { active = false; lease.release(); if (leaseRef.current === lease) leaseRef.current = null; };
  }, [apiBaseUrl, company, username, sourceId, sourceType, sourceVersion, sourceName, requestKey]);
  const openOriginal = async () => {
    const lease = leaseRef.current;
    if (!lease || opening) return;
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    setOpening(true);
    try {
      const url = await lease.openOriginal();
      if (leaseRef.current !== lease) { popup?.close(); return; }
      if (popup) popup.location.replace(url);
      else setPreview(previous => ({ ...previous, message: 'Allow popups to open the original, or use Open in Drive.' }));
    } catch {
      popup?.close();
      if (leaseRef.current === lease) setPreview(previous => ({ ...previous, message: 'The original could not be opened. Check your connection and try again.' }));
    } finally { if (leaseRef.current === lease) setOpening(false); }
  };
  return <div className={`flex min-h-0 w-full flex-1 flex-col bg-slate-100 ${className}`}>
    {visible.status === 'loading' && <div role="status" aria-label="Opening document preview" className="flex min-h-0 flex-1 flex-col items-center overflow-hidden p-4">
      <p className="mb-3 shrink-0 text-sm font-semibold text-slate-700">Opening {/\.pdf$/i.test(sourceName) ? 'PDF' : 'document'} preview…</p>
      <div aria-hidden="true" className="min-h-64 w-full max-w-2xl flex-1 border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-8 h-5 w-2/3 rounded bg-slate-200 motion-safe:animate-pulse" />
        {[75, 95, 85, 90, 70, 95].map((width, index) => <div key={index} style={{ width: `${width}%` }} className="mb-4 h-3 rounded bg-slate-100 motion-safe:animate-pulse" />)}
      </div>
    </div>}
    {(visible.status === 'error' || visible.status === 'unsupported') && <div role="status" className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="max-w-md text-sm font-semibold leading-6 text-slate-700">{visible.message}</p>
      <div className="flex flex-wrap justify-center gap-3">
        {visible.status === 'error' && <button type="button" onClick={() => setAttempt(value => value + 1)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Retry preview</button>}
        {driveUrl && <a href={driveUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700">Open in Drive</a>}
      </div>
    </div>}
    {visible.status === 'ready' && visible.resource && <>
      {visible.resource.pdf ? <PdfPages key={requestKey} pdf={visible.resource.pdf} name={sourceName} />
        : <div className="min-h-0 flex-1 overflow-auto p-4"><img src={visible.resource.objectUrl} alt={`Original document: ${sourceName}`} onError={() => setPreview(previous => previous.key === requestKey ? { ...previous, status: 'unsupported', message: 'Your browser cannot show this image. Open the original in Drive.' } : previous)} className="mx-auto h-full max-h-full max-w-full object-contain" /></div>}
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-4 border-t border-slate-200 bg-white px-4 py-2">
        {visible.message && <span role="status" className="text-xs text-rose-700">{visible.message}</span>}
        <button type="button" disabled={opening} onClick={openOriginal} className="text-sm font-bold text-indigo-700 hover:underline disabled:opacity-50">{opening ? 'Opening original…' : `Open ${visible.resource.pdf ? 'PDF' : 'image'}`}</button>
        {driveUrl && <a href={driveUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-indigo-700 hover:underline">Open in Drive</a>}
      </div>
    </>}
  </div>;
}
