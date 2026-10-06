import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { expireApiSession, getApiAuthHeaders } from './apiSession';

const MAX_BYTES = 100 * 1024 * 1024;
const CHUNK_BYTES = 256 * 1024;
const IMAGE_PREFIX_BYTES = 1024 * 1024;
const MAX_IDLE_BYTES = 64 * 1024 * 1024;
const sources = new Map<string, PreviewLease>();
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/avif']);

export class PreviewError extends Error {
  readonly unsupported: boolean;
  constructor(message: string, unsupported = false) { super(message); this.unsupported = unsupported; }
}

export type PreviewResource = { mimeType: string; size: number; pdf?: PDFDocumentProxy; objectUrl?: string };
type SourceOptions = { apiBaseUrl: string; company: string; username: string; id: string; source: 'document' | 'drive'; version?: string; mimeType?: string };
type PreviewLease = {
  key: string; scope: string; options: SourceOptions; refs: number; viewers: number; size: number;
  promise: Promise<PreviewResource>; resource?: PreviewResource; task?: PDFDocumentLoadingTask;
  controller: AbortController; timer?: ReturnType<typeof setTimeout>; downloadUrl?: string; downloadPromise?: Promise<string>;
  error?: Error; listeners: Set<(error: Error) => void>; disposed: boolean;
};
type PdfEngine = typeof import('./pdfPreviewEngine');
let enginePromise: Promise<PdfEngine> | undefined;
let readyEngine: PdfEngine | undefined;
let warmGeneration = 0;
let intent: { options: SourceOptions; timer?: ReturnType<typeof setTimeout>; deadline?: ReturnType<typeof setTimeout>; release?: () => void; cancelled: boolean } | undefined;

function preparePdfEngine() {
  const generation = warmGeneration;
  if (!enginePromise) enginePromise = import('./pdfPreviewEngine').then(engine => {
    readyEngine = engine;
    return engine;
  }).catch(error => { enginePromise = undefined; throw error; });
  // Import and start the worker while the protected first range is in flight.
  // No document bytes are sent to the worker until MIME/signature validation.
  void enginePromise.then(engine => { if (generation === warmGeneration) return engine.preparePdfWorker(); }).catch(() => {});
  return enginePromise;
}

function cancelIntent() {
  const previous = intent;
  intent = undefined;
  if (!previous) return;
  previous.cancelled = true;
  clearTimeout(previous.timer);
  clearTimeout(previous.deadline);
  previous.release?.();
}

function dispose(entry: PreviewLease) {
  if (entry.disposed) return;
  entry.disposed = true;
  clearTimeout(entry.timer);
  entry.controller.abort();
  void entry.task?.destroy().catch(() => {});
  if (entry.resource?.objectUrl) URL.revokeObjectURL(entry.resource.objectUrl);
  if (entry.downloadUrl) URL.revokeObjectURL(entry.downloadUrl);
  if (sources.get(entry.key) === entry) sources.delete(entry.key);
}

export function clearDocumentPreviews() {
  cancelIntent();
  warmGeneration += 1;
  readyEngine?.discardPreparedPdfWorker();
  for (const entry of sources.values()) dispose(entry);
}
if (typeof window !== 'undefined') window.addEventListener('olten-session-expired', clearDocumentPreviews);

export function invalidateDocumentPreviews(company: string, documentIds: Set<number>, driveIds: Set<string>) {
  if (intent?.options.company === company && (intent.options.source === 'document'
    ? documentIds.has(Number(intent.options.id)) : driveIds.has(intent.options.id))) cancelIntent();
  for (const entry of sources.values()) {
    if (entry.options.company === company && (entry.options.source === 'document'
      ? documentIds.has(Number(entry.options.id)) : driveIds.has(entry.options.id))) dispose(entry);
  }
}

function signatureMatches(bytes: Uint8Array, mime: string) {
  const text = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  if (mime === 'application/pdf') return text.includes('%PDF-');
  if (mime === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === 'image/png') return [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  if (mime === 'image/gif') return text.startsWith('GIF87a') || text.startsWith('GIF89a');
  if (mime === 'image/webp') return text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP';
  if (mime === 'image/bmp') return text.startsWith('BM');
  return mime === 'image/avif' && text.slice(4, 8) === 'ftyp' && /avif|avis/.test(text.slice(8, 32));
}

async function readBytes(response: Response, controller: AbortController, limit: number, refreshTimeout: () => void) {
  const reader = response.body?.getReader();
  if (!reader) throw new PreviewError('The document could not be read.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      refreshTimeout();
      size += value.byteLength;
      if (controller.signal.aborted) {
        await reader.cancel();
        throw new DOMException('Preview cancelled', 'AbortError');
      }
      if (size > limit) {
        await reader.cancel();
        throw new PreviewError('This file is too large for an inline preview. Open it in Drive.', true);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

async function requestBytes(entry: PreviewLease, auth: Record<string, string>, begin?: number, end?: number) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  entry.controller.signal.addEventListener('abort', abort, { once: true });
  if (entry.controller.signal.aborted) controller.abort();
  let timeout: ReturnType<typeof setTimeout>;
  let stalled = false;
  const refreshTimeout = () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => { stalled = true; controller.abort(); }, 30_000);
  };
  refreshTimeout();
  try {
    const { apiBaseUrl, company, username, id, source } = entry.options;
    const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/api/docs/${encodeURIComponent(id)}/content?source=${source}`, {
      headers: { ...auth, 'x-company': company, 'x-username': username,
        ...(begin !== undefined ? { Range: `bytes=${begin}-${end! - 1}` } : {}) },
      signal: controller.signal, cache: 'no-store',
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 && !entry.disposed && entry.refs > 0) {
        const current = getApiAuthHeaders().Authorization;
        if (!current || current === auth.Authorization) expireApiSession();
      }
      const message = response.status === 401 ? 'Please sign in again to view this document.'
        : response.status === 403 ? 'You do not have access to this document.'
        : response.status === 404 ? 'This document was deleted or is no longer available.'
        : response.status === 413 ? 'This file is too large for an inline preview. Open it in Drive.'
        : response.status === 415 ? 'Open this file in Drive to view its original format.'
        : 'The document could not be loaded. Check your connection and retry.';
      throw new PreviewError(message, response.status === 413 || response.status === 415);
    }
    const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (mime !== 'application/pdf' && !IMAGE_TYPES.has(mime)) {
      await response.body?.cancel();
      throw new PreviewError('Open this file in Drive to view its original format.', true);
    }
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
    const total = response.status === 206 && range ? Number(range[3]) : Number(response.headers.get('content-length'));
    if (!Number.isSafeInteger(total) || total <= 0 || total > MAX_BYTES) {
      await response.body?.cancel();
      throw new PreviewError(total > MAX_BYTES ? 'This file is too large for an inline preview. Open it in Drive.' : 'The document size could not be verified. Please retry.', total > MAX_BYTES);
    }
    if (response.status !== 206 && begin !== undefined && entry.viewers === 0 && total > end! - begin) {
      const error = new PreviewError('Open this document to download its preview.');
      entry.error = error;
      await response.body?.cancel();
      throw error;
    }
    if (response.status === 206 && (!range || Number(range[1]) !== begin || Number(range[2]) !== Math.min(end!, total) - 1)) {
      await response.body?.cancel();
      throw new PreviewError('The document returned an invalid page range. Please retry.');
    }
    const expected = response.status === 206 ? Number(range![2]) - Number(range![1]) + 1 : total;
    const bytes = await readBytes(response, controller, expected, refreshTimeout);
    if (bytes.length !== expected) throw new PreviewError('The document download was interrupted. Please retry.');
    return { bytes, total, mime, partial: response.status === 206, etag: response.headers.get('etag') };
  } catch (error) {
    if (stalled) throw new PreviewError('The document is taking too long to respond. Check your connection and retry.');
    throw error;
  } finally {
    clearTimeout(timeout!);
    entry.controller.signal.removeEventListener('abort', abort);
  }
}

async function load(entry: PreviewLease, auth: Record<string, string>): Promise<PreviewResource> {
  const prepared = !entry.options.mimeType || entry.options.mimeType === 'application/pdf' ? preparePdfEngine() : undefined;
  const first = await requestBytes(entry, auth, 0, entry.options.mimeType === 'application/pdf' ? CHUNK_BYTES : IMAGE_PREFIX_BYTES);
  entry.size = first.total;
  if (!signatureMatches(first.bytes, first.mime)) throw new PreviewError('The file does not match its document format. Open the original in Drive.');
  if (first.mime !== 'application/pdf') {
    let bytes = first.bytes;
    if (first.partial && bytes.length < first.total) {
      const rest = await requestBytes(entry, auth, bytes.length, first.total);
      if (rest.total !== first.total || rest.mime !== first.mime || rest.etag !== first.etag) throw new PreviewError('The document changed while loading. Please retry.');
      if (rest.partial) { const combined = new Uint8Array(first.total); combined.set(bytes); combined.set(rest.bytes, bytes.length); bytes = combined; }
      else bytes = rest.bytes;
    }
    if (entry.disposed) throw new Error('Preview cancelled');
    return { mimeType: first.mime, size: first.total, objectUrl: URL.createObjectURL(new Blob([bytes], { type: first.mime })) };
  }
  const engine = await (prepared || preparePdfEngine());
  if (entry.disposed) throw new Error('Preview cancelled');
  const fail = (error: Error) => {
    if (entry.disposed || entry.error) return;
    entry.error = error;
    for (const listener of entry.listeners) listener(error);
    dispose(entry);
  };
  const task = engine.loadPdf(first.total, first.bytes, CHUNK_BYTES, async (begin, end) => {
    const part = await requestBytes(entry, auth, begin, end);
    if (part.total !== first.total || part.mime !== first.mime || part.etag !== first.etag) throw new PreviewError('The document changed while loading. Please retry.');
    return part.partial ? part.bytes : part.bytes.slice(begin, end);
  }, fail);
  entry.task = task;
  const pdf = await task.promise.catch(error => { throw entry.error || error; });
  if (entry.error) throw entry.error;
  return { mimeType: first.mime, size: first.total, pdf };
}

// Speculate only on a deliberate PDF interaction, never on directory render.
// Leaving before the delay, a new target, logout, deletion, or workspace reset
// cancels the intent. A mounted viewer can reclaim the same authenticated lease.
export function prefetchDocumentPreview(options: SourceOptions, immediate = false): () => void {
  cancelIntent();
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (options.mimeType !== 'application/pdf' || !options.company || !/^[A-Za-z0-9_-]+$/.test(options.id)
    || !getApiAuthHeaders().Authorization || connection?.saveData || /^(slow-2g|2g)$/.test(connection?.effectiveType || '')) return () => {};
  const current: NonNullable<typeof intent> = { options, cancelled: false };
  intent = current;
  const finish = () => { if (intent === current) cancelIntent(); };
  const start = () => {
    if (current.cancelled) return;
    const lease = acquireDocumentPreview(options, () => {}, true);
    current.release = lease.release;
    current.deadline = setTimeout(finish, 10_000);
    void lease.promise.then(async resource => {
      if (!current.cancelled && resource.pdf) {
        const page = await resource.pdf.getPage(1);
        if (!current.cancelled) await page.getOperatorList({ annotationMode: 0 });
      }
    }).catch(() => {}).finally(finish);
  };
  if (immediate) start();
  else current.timer = setTimeout(start, 150);
  return finish;
}

export function acquireDocumentPreview(options: SourceOptions, onError: (error: Error) => void, speculative = false) {
  const auth = getApiAuthHeaders();
  const scope = JSON.stringify([options.apiBaseUrl, options.company, options.username, auth.Authorization || '']);
  const key = JSON.stringify([scope, options.source, options.id, options.version || '']);
  // Private bytes never survive a different login or workspace in this tab.
  for (const previous of sources.values()) if (previous.scope !== scope) dispose(previous);
  let entry = sources.get(key);
  if (!entry || entry.disposed || entry.error) {
    entry = { key, scope, options, refs: 0, viewers: 0, size: 0, controller: new AbortController(),
      promise: undefined!, listeners: new Set(), disposed: false };
    const current = entry;
    sources.set(key, current);
    current.promise = load(current, auth).then(resource => {
      if (current.disposed) { if (resource.objectUrl) URL.revokeObjectURL(resource.objectUrl); throw new Error('Preview cancelled'); }
      current.resource = resource;
      return resource;
    }).catch(error => { dispose(current); throw error; });
    // A component may unmount before registering its await handler.
    void current.promise.catch(() => {});
  }
  const current = entry;
  clearTimeout(current.timer);
  current.refs += 1;
  if (!speculative) current.viewers += 1;
  current.listeners.add(onError);
  let released = false;
  return {
    promise: current.promise,
    openOriginal: async () => {
      const resource = await current.promise;
      if (resource.objectUrl) return resource.objectUrl;
      if (current.disposed) throw new Error('Preview cancelled');
      if (current.downloadUrl) return current.downloadUrl;
      if (!current.downloadPromise) {
        current.downloadPromise = (async () => {
          const complete = await requestBytes(current, auth);
          if (current.disposed) throw new Error('Preview cancelled');
          if (!signatureMatches(complete.bytes, complete.mime)) throw new PreviewError('The source format could not be verified.');
          current.downloadUrl = URL.createObjectURL(new Blob([complete.bytes], { type: complete.mime }));
          return current.downloadUrl;
        })().catch(error => { current.downloadPromise = undefined; throw error; });
      }
      return current.downloadPromise;
    },
    release: () => {
      if (released) return;
      released = true;
      current.listeners.delete(onError);
      current.refs -= 1;
      if (!speculative) current.viewers -= 1;
      if (current.refs || current.disposed) return;
      if (!current.resource || (current.downloadPromise && !current.downloadUrl)) {
        // Cancel unfinished work on removal. A same-tick development remount
        // can reclaim the lease before this runs.
        current.timer = setTimeout(() => dispose(current), 0);
        return;
      }
      // Reopening a recent version reuses fetched pages; active modal/inline
      // viewers share the same reader. Bound both idle lifetime and file sizes.
      const idle = [...sources.values()].filter(item => item.refs === 0);
      let idleBytes = idle.reduce((total, item) => total + item.size, 0);
      while (idle.length > 3 || idleBytes > MAX_IDLE_BYTES) { const oldest = idle.shift()!; idleBytes -= oldest.size; dispose(oldest); }
      if (!current.disposed) current.timer = setTimeout(() => dispose(current), options.version ? 60_000 : 1000);
    },
  };
}
