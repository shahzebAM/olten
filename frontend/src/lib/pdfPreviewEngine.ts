import { getDocument, GlobalWorkerOptions, PDFDataRangeTransport, PDFWorker } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;
let preparedWorker: PDFWorker | undefined;
let preparedTimer: ReturnType<typeof setTimeout> | undefined;

export function discardPreparedPdfWorker() {
  clearTimeout(preparedTimer);
  preparedWorker?.destroy();
  preparedWorker = undefined;
}

export function preparePdfWorker() {
  if (!preparedWorker || preparedWorker.destroyed) preparedWorker = PDFWorker.create({});
  const worker = preparedWorker;
  clearTimeout(preparedTimer);
  preparedTimer = setTimeout(discardPreparedPdfWorker, 15_000);
  return worker.promise.catch(error => {
    if (preparedWorker === worker) discardPreparedPdfWorker();
    throw error;
  });
}

export function loadPdf(total: number, first: Uint8Array, chunkSize: number,
  fetchRange: (begin: number, end: number) => Promise<Uint8Array>, fail: (error: Error) => void) {
  class AuthenticatedRanges extends PDFDataRangeTransport {
    requestDataRange(begin: number, end: number) {
      void fetchRange(begin, end).then(bytes => this.onDataRange(begin, bytes)).catch(error => fail(error instanceof Error ? error : new Error('A document page could not be loaded.')));
    }
  }
  const assets = `${import.meta.env.BASE_URL}pdfjs/`;
  const ranges = new AuthenticatedRanges(total, first, true);
  const worker = preparedWorker && !preparedWorker.destroyed ? preparedWorker : PDFWorker.create({});
  preparedWorker = undefined;
  clearTimeout(preparedTimer);
  let task: ReturnType<typeof getDocument>;
  try { task = getDocument({
    ...(first.length === total ? { data: first } : { range: ranges, length: total }),
    worker,
    rangeChunkSize: chunkSize, disableAutoFetch: true, disableStream: true,
    isEvalSupported: false, enableXfa: false, maxImageSize: 64 * 1024 * 1024,
    canvasMaxAreaInBytes: 64 * 1024 * 1024,
    cMapUrl: `${assets}cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${assets}standard_fonts/`, wasmUrl: `${assets}wasm/`,
  }); } catch (error) { worker.destroy(); throw error; }
  // A warmed worker is owned by this reader alone. Supplying it explicitly
  // requires disposing it alongside the loading task (including failed loads).
  const destroy = task.destroy.bind(task);
  let destroying: Promise<void> | undefined;
  task.destroy = () => destroying ??= destroy().finally(() => worker.destroy());
  return task;
}
