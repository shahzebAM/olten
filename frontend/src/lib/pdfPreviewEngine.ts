import { getDocument, GlobalWorkerOptions, PDFDataRangeTransport } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

export function loadPdf(total: number, first: Uint8Array, chunkSize: number,
  fetchRange: (begin: number, end: number) => Promise<Uint8Array>, fail: (error: Error) => void) {
  class AuthenticatedRanges extends PDFDataRangeTransport {
    requestDataRange(begin: number, end: number) {
      void fetchRange(begin, end).then(bytes => this.onDataRange(begin, bytes)).catch(error => fail(error instanceof Error ? error : new Error('A document page could not be loaded.')));
    }
  }
  const assets = `${import.meta.env.BASE_URL}pdfjs/`;
  const ranges = new AuthenticatedRanges(total, first, true);
  return getDocument({
    ...(first.length === total ? { data: first } : { range: ranges, length: total }),
    rangeChunkSize: chunkSize, disableAutoFetch: true, disableStream: true,
    isEvalSupported: false, enableXfa: false, maxImageSize: 64 * 1024 * 1024,
    canvasMaxAreaInBytes: 64 * 1024 * 1024,
    cMapUrl: `${assets}cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${assets}standard_fonts/`, wasmUrl: `${assets}wasm/`,
  });
}
