import { useEffect, useState } from 'react';
import { expireApiSession, getApiAuthHeaders } from '../lib/apiSession';

interface DocumentPreviewProps {
  apiBaseUrl: string;
  company: string;
  username?: string;
  documentId?: number;
  driveFileId?: string;
  sourceName: string;
  externalUrl?: string;
  className?: string;
}

type PreviewState = {
  key: string;
  status: 'loading' | 'ready' | 'unsupported' | 'error';
  objectUrl?: string;
  mimeType?: string;
  message?: string;
};

const PREVIEW_MIME_TYPES = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'image/gif',
  'image/webp', 'image/bmp', 'image/avif',
]);
const MAX_PREVIEW_BYTES = 100 * 1024 * 1024;
class PreviewTooLargeError extends Error {}

const safeDriveUrl = (externalUrl?: string) => {
  try {
    const url = new URL(externalUrl || '');
    return url.protocol === 'https:' && ['drive.google.com', 'docs.google.com'].includes(url.hostname)
      && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
};

const matchesFileSignature = async (blob: Blob, mimeType: string) => {
  const bytes = new Uint8Array(await blob.slice(0, 1024).arrayBuffer());
  const text = new TextDecoder('latin1').decode(bytes);
  if (mimeType === 'application/pdf') return text.includes('%PDF-');
  if (mimeType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === 'image/png') return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
  if (mimeType === 'image/gif') return text.startsWith('GIF87a') || text.startsWith('GIF89a');
  if (mimeType === 'image/webp') return text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP';
  if (mimeType === 'image/bmp') return text.startsWith('BM');
  if (mimeType === 'image/avif') return text.slice(4, 8) === 'ftyp' && /avif|avis/.test(text.slice(8, 32));
  return false;
};

const readPreviewBlob = async (response: Response, mimeType: string) => {
  // Bound memory even if an upstream source omits or changes Content-Length.
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The document could not be read.');
  const chunks: BlobPart[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PREVIEW_BYTES) {
        await reader.cancel();
        throw new PreviewTooLargeError();
      }
      chunks.push(value);
    }
    return new Blob(chunks, { type: mimeType });
  } finally { reader.releaseLock(); }
};

export default function DocumentPreview({ apiBaseUrl, company, username = '', documentId,
  driveFileId, sourceName, externalUrl, className = '' }: DocumentPreviewProps) {
  const [attempt, setAttempt] = useState(0);
  const sourceId = documentId !== undefined ? String(documentId) : driveFileId;
  const sourceType = documentId !== undefined ? 'document' : 'drive';
  // Scope every result to its exact workspace/source so late requests cannot
  // display a previous company's document after a workspace change.
  const requestKey = JSON.stringify([apiBaseUrl, company, username, sourceType, sourceId, attempt]);
  const [preview, setPreview] = useState<PreviewState>({ key: '', status: 'loading' });
  const visible = preview.key === requestKey ? preview : { key: requestKey, status: 'loading' as const };
  const driveUrl = safeDriveUrl(externalUrl);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    let active = true;
    setPreview({ key: requestKey, status: 'loading' });

    const load = async () => {
      if (!company || !sourceId || !/^[A-Za-z0-9_-]+$/.test(sourceId)) {
        setPreview({ key: requestKey, status: 'error', message: 'This document source is unavailable.' });
        return;
      }
      try {
        const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/api/docs/${encodeURIComponent(sourceId)}/content?source=${sourceType}`, {
          headers: { ...getApiAuthHeaders(), 'x-company': company, 'x-username': username },
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) {
          if (response.status === 401 && active && !controller.signal.aborted) expireApiSession();
          const message = response.status === 401 ? 'Please sign in again to view this document.'
            : response.status === 403 ? 'You do not have access to this document.'
              : response.status === 404 ? 'This document was deleted or is no longer available.'
                : response.status === 413 ? 'This file is too large for an inline preview. Open it in Drive.'
                  : response.status === 415 ? 'Open this file in Drive to view its original format.'
                  : 'The document could not be loaded. Check your connection and retry.';
          if (active) setPreview({ key: requestKey, status: [413, 415].includes(response.status) ? 'unsupported' : 'error', message });
          return;
        }
        const mimeType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (!PREVIEW_MIME_TYPES.has(mimeType)) {
          await response.body?.cancel();
          if (active) setPreview({ key: requestKey, status: 'unsupported', message: 'Open this file in Drive to view its original format.' });
          return;
        }
        const declaredSize = Number(response.headers.get('content-length'));
        if (declaredSize > MAX_PREVIEW_BYTES) {
          await response.body?.cancel();
          if (active) setPreview({ key: requestKey, status: 'unsupported', message: 'This file is too large for an inline preview. Open it in Drive.' });
          return;
        }
        const blob = await readPreviewBlob(response, mimeType);
        if (!blob.size || !await matchesFileSignature(blob, mimeType)) {
          if (active) setPreview({ key: requestKey, status: 'error', message: 'The file does not match its document format. Open the original in Drive.' });
          return;
        }
        if (!active || controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setPreview({ key: requestKey, status: 'ready', objectUrl, mimeType });
      } catch (error) {
        if (active && !controller.signal.aborted) {
          setPreview(error instanceof PreviewTooLargeError
            ? { key: requestKey, status: 'unsupported', message: 'This file is too large for an inline preview. Open it in Drive.' }
            : { key: requestKey, status: 'error', message: 'The document could not be loaded. Check your connection and retry.' });
        }
      }
    };
    void load();
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [apiBaseUrl, company, username, sourceId, sourceType, requestKey]);

  return (
    <div className={`flex min-h-0 w-full flex-1 flex-col bg-slate-100 ${className}`}>
      {visible.status === 'loading' && (
        <div role="status" className="flex flex-1 items-center justify-center p-8 text-sm font-semibold text-slate-600">Loading document…</div>
      )}
      {(visible.status === 'error' || visible.status === 'unsupported') && (
        <div role="status" className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="max-w-md text-sm font-semibold leading-6 text-slate-700">{visible.message}</p>
          <div className="flex flex-wrap justify-center gap-3">
            {visible.status === 'error' && <button type="button" onClick={() => setAttempt(value => value + 1)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Retry preview</button>}
            {driveUrl && <a href={driveUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700">Open in Drive</a>}
          </div>
        </div>
      )}
      {visible.status === 'ready' && visible.objectUrl && (
        <>
          {visible.mimeType === 'application/pdf' ? (
            // Browser PDF renderers cannot run HTML/SVG. Sandboxing this element
            // blocks the native PDF plugin in Chromium, so validate MIME/signature
            // above and never embed arbitrary third-party viewer pages instead.
            <object data={visible.objectUrl} type="application/pdf" aria-label={`Original document: ${sourceName}`} className="min-h-0 w-full flex-1">
              <p className="p-6 text-center text-sm font-semibold text-slate-700">Your browser cannot show this PDF. Use Open PDF below.</p>
            </object>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto p-4"><img src={visible.objectUrl} alt={`Original document: ${sourceName}`} onError={() => setPreview(previous => previous.key === requestKey ? { ...previous, status: 'unsupported', message: 'Your browser cannot show this image. Open the original in Drive.' } : previous)} className="mx-auto h-full max-h-full max-w-full object-contain" /></div>
          )}
          <div className="flex shrink-0 items-center justify-end border-t border-slate-200 bg-white px-4 py-2">
            <a href={visible.objectUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-indigo-700 hover:underline">Open {visible.mimeType === 'application/pdf' ? 'PDF' : 'image'}</a>
          </div>
        </>
      )}
    </div>
  );
}
