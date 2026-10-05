import { dirname, join } from 'node:path';

// Read text solely as labelled supporting evidence. Gemini still sees every
// original PDF page, including scans. Missing text never means no expiry.
export async function readPdfExpiryText(buffer: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const packageDirectory = dirname(require.resolve('pdfjs-dist/package.json'));
  const source = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    cMapUrl: join(packageDirectory, 'cmaps') + '/',
    cMapPacked: true,
    standardFontDataUrl: join(packageDirectory, 'standard_fonts') + '/',
    isEvalSupported: false,
    verbosity: 0,
  });
  try {
    const document = await source.promise;
    if (document.numPages > 1000) throw new Error('Too many PDF pages for expiry evidence.');
    const text: string[] = [];
    let totalBytes = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('');
      totalBytes += Buffer.byteLength(pageText);
      if (totalBytes > 10 * 1024 * 1024) throw new Error('PDF expiry evidence is too large.');
      text.push(`[Document page ${pageNumber}]\n${pageText}`);
      page.cleanup();
    }
    return text.join('\n');
  } finally {
    await source.destroy();
  }
}
