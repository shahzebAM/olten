import { GoogleGenAI } from '@google/genai';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';
import { GeminiService } from './gemini.service';
import { readPdfExpiryText } from './pdf-expiry-text';

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn(),
  Type: { OBJECT: 'OBJECT', STRING: 'STRING', INTEGER: 'INTEGER', NUMBER: 'NUMBER', BOOLEAN: 'BOOLEAN' },
  MediaResolution: { MEDIA_RESOLUTION_HIGH: 'MEDIA_RESOLUTION_HIGH', MEDIA_RESOLUTION_MEDIUM: 'MEDIA_RESOLUTION_MEDIUM' },
  ThinkingLevel: { MINIMAL: 'MINIMAL', LOW: 'LOW' },
}));
jest.mock('node:fs/promises', () => ({ readFile: jest.fn() }));
jest.mock('./pdf-expiry-text', () => ({ readPdfExpiryText: jest.fn() }));

function verificationResponse(overrides: Record<string, unknown> = {}) {
  return { text: JSON.stringify({ hasPrimaryExpiry: true, uncertain: false,
    documentType: 'Permit', documentNumber: 'P-123', expiryDateText: 'Expiry Date: 6 October 2026',
    confidence: 0.98, reason: 'The primary document explicitly states its expiry.', ...overrides,
  }) };
}

function expiryResponse(overrides: Record<string, unknown> = {}) {
  return { text: JSON.stringify({
    documentType: 'Permit', documentNumber: 'P-123', issueDate: '2026-01-01',
    expiryDate: '2026-10-06', renewalDate: '2026-09-06', renewalDaysBeforeExpiry: 30,
    expiryDateText: 'Expiry Date: 6 October 2026', confidence: 0.98, uncertain: false,
    reason: 'Explicit expiry label on page 1.', ...overrides,
  }) };
}

async function docxBuffer(withImage = false, unsupportedContent = false) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>`);
  zip.file('_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Issue Date: 2026-01-01</w:t></w:r></w:p>${unsupportedContent ? '<w:altChunk/>' : ''}<w:sectPr/></w:body></w:document>`);
  zip.file('word/header1.xml', `<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:p><w:r><w:t>Expiry Date: 2026-10-06</w:t></w:r>${withImage ? '<w:r><a:blip r:embed="rIdImage"/></w:r>' : ''}</w:p></w:hdr>`);
  if (withImage) {
    zip.file('word/_rels/header1.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/scan.png"/></Relationships>');
    zip.file('word/media/scan.png', Buffer.from('embedded scan'));
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('GeminiService expiry analysis', () => {
  let service: GeminiService;
  let client: {
    models: { generateContent: jest.Mock };
    files: { upload: jest.Mock; get: jest.Mock; delete: jest.Mock };
  };
  const previousExpiryModel = process.env.GEMINI_EXPIRY_MODEL;
  const previousExpiryLimit = process.env.GEMINI_EXPIRY_MAX_OUTPUT_TOKENS;

  beforeEach(() => {
    client = {
      models: { generateContent: jest.fn().mockImplementation(request => Promise.resolve(
        request.config.responseSchema.properties.hasPrimaryExpiry ? verificationResponse() : expiryResponse(),
      )) },
      files: { upload: jest.fn(), get: jest.fn(), delete: jest.fn().mockResolvedValue({}) },
    };
    jest.mocked(GoogleGenAI).mockImplementation(() => client as unknown as GoogleGenAI);
    process.env.GEMINI_EXPIRY_MODEL = 'configured-expiry-model';
    delete process.env.GEMINI_EXPIRY_MAX_OUTPUT_TOKENS;
    service = new GeminiService();
    jest.mocked(readPdfExpiryText).mockReset().mockResolvedValue('');
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    if (previousExpiryModel === undefined) delete process.env.GEMINI_EXPIRY_MODEL;
    else process.env.GEMINI_EXPIRY_MODEL = previousExpiryModel;
    if (previousExpiryLimit === undefined) delete process.env.GEMINI_EXPIRY_MAX_OUTPUT_TOKENS;
    else process.env.GEMINI_EXPIRY_MAX_OUTPUT_TOKENS = previousExpiryLimit;
  });

  it('uses one configured structured analysis with source evidence and safe date parsing', async () => {
    const result = await service.extractStructuredExpiry(Buffer.from('PDF contents'), 'application/octet-stream', 'permit.PDF');
    expect(result?.expiryDate?.toISOString()).toBe('2026-10-06T00:00:00.000Z');
    const request = client.models.generateContent.mock.calls[0][0];
    expect(request.model).toBe('configured-expiry-model');
    expect(request.contents[0].parts[0].inlineData.mimeType).toBe('application/pdf');
    expect(request.config.responseSchema.required).toContain('expiryDate');
    expect(request.config.systemInstruction).toContain('untrusted source data');
    expect(request.config.systemInstruction).toContain('birth date');
  });

  it('corrects an expired personnel ID to the primary license validity from the real incident', async () => {
    jest.mocked(readPdfExpiryText).mockResolvedValue('[Document page 1]\nLicense Number CDRRHR-RVII-MDI/W-207349\nValidity of License:\n06October2026\n[Document page 2]\nQualified Personnel\nProfessional Regulation Commission ID0083800\nExpiry Date16June2025');
    client.models.generateContent.mockResolvedValueOnce(expiryResponse({ issueDate: '2024-01-01', expiryDate: '2025-06-16', expiryDateText: '16June2025', confidence: 0.95 }))
      .mockResolvedValueOnce(verificationResponse({ documentType: 'License', documentNumber: 'CDRRHR-RVII-MDI/W-207349', expiryDateText: 'Validity of License:06October2026', confidence: 0.99 }));
    const result = await service.extractStructuredExpiry(Buffer.from('license PDF'), 'application/pdf', 'dream.pdf');
    expect(result?.expiryDate?.toISOString().slice(0, 10)).toBe('2026-10-06');
    expect(result?.expiryDateText).toBe('Validity of License:06October2026');
    expect(result?.documentNumber).toBe('CDRRHR-RVII-MDI/W-207349');
    expect(client.models.generateContent).toHaveBeenCalledTimes(2);
    const recheck = client.models.generateContent.mock.calls[1][0];
    expect(recheck.contents[0].parts.at(-1).text).toContain('primary document');
    expect(recheck.contents[0].parts.at(-1).text).not.toContain('2025-06-16');
  });

  it('checks that the parsed ISO date agrees with the exact primary validity quote', async () => {
    jest.mocked(readPdfExpiryText).mockResolvedValue('Validity of License:06October2026');
    client.models.generateContent.mockResolvedValueOnce(expiryResponse({ issueDate: '2024-01-01', expiryDate: '2025-06-16', expiryDateText: 'Validity of License:06October2026' }))
      .mockResolvedValueOnce(verificationResponse({ expiryDateText: 'Validity of License:06October2026' }));
    await expect(service.extractStructuredExpiry(Buffer.from('license PDF'), 'application/pdf', 'dream.pdf')).resolves.toEqual(expect.objectContaining({ expiryDate: new Date('2026-10-06T00:00:00Z') }));
  });

  it('accepts a primary date corroborated by its source label without an unnecessary second call', async () => {
    jest.mocked(readPdfExpiryText).mockResolvedValue('Validity of License:06October2026\nQualified Personnel\nExpiry Date16June2025');
    client.models.generateContent.mockResolvedValueOnce(expiryResponse({ expiryDateText: 'Validity of License:06October2026' }));
    expect((await service.extractStructuredExpiry(Buffer.from('license PDF'), 'application/pdf', 'dream.pdf'))?.expiryDate?.toISOString().slice(0, 10)).toBe('2026-10-06');
    expect(client.models.generateContent).toHaveBeenCalledTimes(1);
  });

  it('requires review if independent evidence still conflicts with the primary validity label', async () => {
    jest.mocked(readPdfExpiryText).mockResolvedValue('Validity of License:06October2026\nQualified Personnel\nExpiry Date16June2025');
    client.models.generateContent.mockResolvedValueOnce(expiryResponse({ issueDate: '2024-01-01', expiryDate: '2025-06-16', expiryDateText: '16June2025', confidence: 0.99 }))
      .mockResolvedValueOnce(verificationResponse({ expiryDateText: 'Expiry Date16June2025', confidence: 0.99 }));
    await expect(service.extractStructuredExpiry(Buffer.from('license PDF'), 'application/pdf', 'dream.pdf')).rejects.toThrow('primary validity label conflicts');
  });

  it.each(['Date of Issue:16June2025', 'Renewal Deadline:16June2025', 'Expiry Date:06/10/2026', '16June2025'])('does not accept unverified or ambiguous primary evidence %s', async evidence => {
    client.models.generateContent.mockResolvedValueOnce(expiryResponse({ issueDate: '2024-01-01', expiryDate: '2025-06-16', expiryDateText: '16June2025' }))
      .mockResolvedValueOnce(verificationResponse({ expiryDateText: evidence, confidence: 0.99 }));
    await expect(service.extractStructuredExpiry(Buffer.from('scan'), 'image/png', 'permit.png')).rejects.toThrow('quoted primary expiry label/date');
  });

  it('keeps issue-only documents distinct from extraction failures', async () => {
    client.models.generateContent.mockResolvedValueOnce(expiryResponse({ expiryDate: null, expiryDateText: '' }));
    await expect(service.extractStructuredExpiry(Buffer.from('issue only'), 'image/jpeg', 'permit.jpg')).resolves.toBeNull();
    client.models.generateContent.mockRejectedValue(new Error('API quota unavailable'));
    await expect(service.extractExpiryFromBuffer(Buffer.from('image'), 'image/jpeg', 'permit.jpg')).rejects.toThrow('API quota unavailable');
  });

  it.each([
    { expiryDate: '2026-02-30' }, { expiryDate: '10/06/2026' }, { expiryDate: '2026-10-06T00:00:00Z' },
    { issueDate: '2027-01-01' }, { expiryDateText: '' }, { confidence: 3 },
    { renewalDaysBeforeExpiry: -1 }, { renewalDate: '2026-09-31' },
  ])('rejects malformed or contradictory date metadata %j', async overrides => {
    client.models.generateContent.mockResolvedValue(expiryResponse(overrides));
    await expect(service.extractStructuredExpiry(Buffer.from('document'), 'application/pdf', 'doc.pdf')).rejects.toThrow();
  });

  it.each([{ text: '' }, { text: '{}' }, { text: 'not JSON' }, { text: 'null' }])('does not treat invalid analysis %j as no expiry', async response => {
    client.models.generateContent.mockResolvedValue(response);
    await expect(service.extractStructuredExpiry(Buffer.from('document'), 'application/pdf', 'doc.pdf')).rejects.toThrow();
  });

  it('preserves an explicit zero-day notice and shares validation with legacy URI calls', async () => {
    client.models.generateContent.mockImplementation(request => Promise.resolve(
      request.config.responseSchema.properties.hasPrimaryExpiry ? verificationResponse() : expiryResponse({ renewalDaysBeforeExpiry: 0 }),
    ));
    const result = await service.extractStructuredExpiryFromUri('files/permit', 'application/pdf');
    expect(result?.renewalDaysBeforeExpiry).toBe(0);
    await expect(service.extractExpiryDate('files/permit', 'application/pdf')).resolves.toBe('2026-10-06');
    expect(client.models.generateContent.mock.calls[0][0].contents[0].parts[0].fileData).toEqual({ fileUri: 'files/permit', mimeType: 'application/pdf' });
  });

  it('accepts supported text files from legacy Gemini URI references', async () => {
    await service.extractStructuredExpiryFromUri('uri/text', 'text/plain');
    expect(client.models.generateContent.mock.calls[0][0].contents[0].parts[0].fileData).toEqual({ fileUri: 'uri/text', mimeType: 'text/plain' });
  });

  it('analyzes text as text and rejects Office binary files with a useful warning', async () => {
    client.models.generateContent.mockResolvedValueOnce(expiryResponse({ expiryDateText: 'Expiry Date: 2026-10-06' }));
    await service.extractStructuredExpiry(Buffer.from('Expiry Date: 2026-10-06'), 'text/plain', 'permit.txt');
    expect(client.models.generateContent.mock.calls[0][0].contents[0].parts[0].text).toContain('Expiry Date: 2026-10-06');
    await expect(service.extractStructuredExpiry(Buffer.from('legacy Office binary'), 'application/msword', 'permit.doc')).rejects.toThrow('Export this file as PDF');
    expect(client.models.generateContent).toHaveBeenCalledTimes(1);
  });

  it('reads real DOCX body/header text and sends embedded scans as image parts', async () => {
    await service.extractStructuredExpiry(await docxBuffer(true), 'application/octet-stream', 'permit.docx');
    const parts = client.models.generateContent.mock.calls[0][0].contents[0].parts;
    expect(parts[0].text).toContain('Issue Date: 2026-01-01');
    expect(parts[0].text).toContain('Expiry Date: 2026-10-06');
    expect(parts[1].inlineData).toEqual({ data: Buffer.from('embedded scan').toString('base64'), mimeType: 'image/png' });
  });

  it('requires a clearer upload when Word conversion discards unsupported source content', async () => {
    await expect(service.extractStructuredExpiry(await docxBuffer(false, true), 'application/octet-stream', 'permit.docx')).rejects.toThrow('contents could not be read');
    expect(client.models.generateContent).not.toHaveBeenCalled();
  });

  it('does not silently skip an unreadable image in a Word header', async () => {
    const zip = await JSZip.loadAsync(await docxBuffer(true));
    zip.remove('word/_rels/header1.xml.rels');
    await expect(service.extractStructuredExpiry(await zip.generateAsync({ type: 'nodebuffer' }), 'application/octet-stream', 'permit.docx')).rejects.toThrow('image in this Word document could not be read');
    expect(client.models.generateContent).not.toHaveBeenCalled();
  });

  it('indexes DOCX as readable text while keeping a usable MIME type for document search', async () => {
    jest.mocked(readFile).mockResolvedValue(Buffer.from(await docxBuffer()));
    client.files.upload.mockResolvedValue({ name: 'files/word', uri: 'uri/word', state: 'ACTIVE' });
    const result = await service.uploadFileToGemini('permit.docx', 'application/octet-stream', 'permit.docx');
    const request = client.files.upload.mock.calls[0][0];
    expect(request.config.mimeType).toBe('text/plain');
    expect(await request.file.text()).toContain('Expiry Date: 2026-10-06');
    expect(result.mimeType).toBe('text/plain');
  });

  it('waits until indexed files become ACTIVE before returning their reference', async () => {
    jest.useFakeTimers();
    client.files.upload.mockResolvedValue({ name: 'files/permit', uri: 'uri/permit', state: 'PROCESSING' });
    client.files.get.mockResolvedValueOnce({ state: 'PROCESSING' }).mockResolvedValueOnce({ state: 'ACTIVE' });
    const pending = service.uploadFileToGemini('permit.pdf', 'application/pdf', 'permit.pdf');
    await jest.advanceTimersByTimeAsync(4_000);
    await expect(pending).resolves.toEqual({ fileId: 'files/permit', fileUri: 'uri/permit', mimeType: 'application/pdf' });
    expect(client.files.get).toHaveBeenCalledTimes(2);
  });

  it('fails and cleans up files whose processing fails', async () => {
    client.files.upload.mockResolvedValue({ name: 'files/permit', uri: 'uri/permit', state: 'FAILED' });
    await expect(service.uploadFileToGemini('permit.pdf', 'application/pdf', 'permit.pdf')).rejects.toThrow('could not process');
    expect(client.files.delete).toHaveBeenCalledWith(expect.objectContaining({ name: 'files/permit' }));
  });

  it('bounds repeated PROCESSING states instead of hanging indefinitely', async () => {
    jest.useFakeTimers();
    client.files.upload.mockResolvedValue({ name: 'files/permit', uri: 'uri/permit', state: 'PROCESSING' });
    client.files.get.mockResolvedValue({ state: 'PROCESSING' });
    const pending = service.uploadFileToGemini('permit.pdf', 'application/pdf', 'permit.pdf');
    const rejection = expect(pending).rejects.toThrow('timed out');
    await jest.advanceTimersByTimeAsync(62_000);
    await rejection;
    expect(client.files.get.mock.calls.length).toBeLessThanOrEqual(30);
  });

  it('uses and cleans up a temporary Files API reference for larger attachments', async () => {
    client.files.upload.mockResolvedValue({ name: 'files/temp', uri: 'uri/temp', state: 'ACTIVE' });
    await service.extractStructuredExpiry(Buffer.alloc(10 * 1024 * 1024 + 1), 'application/pdf', 'large.pdf');
    const request = client.models.generateContent.mock.calls[0][0];
    expect(request.contents[0].parts[0].fileData).toEqual({ fileUri: 'uri/temp', mimeType: 'application/pdf' });
    expect(client.files.delete).toHaveBeenCalledWith(expect.objectContaining({ name: 'files/temp' }));
  });

  it('shares one ACTIVE indexing upload with large-file expiry analysis and keeps it for search', async () => {
    client.files.upload.mockResolvedValue({ name: 'files/index', uri: 'uri/index', state: 'ACTIVE' });
    const indexing = service.uploadFileToGemini('large.pdf', 'application/pdf', 'large.pdf');
    const result = await service.extractStructuredExpiry(Buffer.alloc(10 * 1024 * 1024 + 1), 'application/pdf', 'large.pdf', indexing);
    expect(result?.expiryDate?.toISOString().slice(0, 10)).toBe('2026-10-06');
    expect(client.files.upload).toHaveBeenCalledTimes(1);
    expect(client.models.generateContent.mock.calls[0][0].contents[0].parts[0].fileData).toEqual({ fileUri: 'uri/index', mimeType: 'application/pdf' });
    expect(client.files.delete).not.toHaveBeenCalled();
  });

  it('does not delete the indexed file when expiry analysis fails', async () => {
    client.models.generateContent.mockRejectedValue(new Error('Analysis unavailable'));
    const indexing = Promise.resolve({ fileId: 'files/index', fileUri: 'uri/index', mimeType: 'application/pdf' });
    await expect(service.extractStructuredExpiry(Buffer.alloc(10 * 1024 * 1024 + 1), 'application/pdf', 'large.pdf', indexing)).rejects.toThrow('Analysis unavailable');
    expect(client.files.upload).not.toHaveBeenCalled();
    expect(client.files.delete).not.toHaveBeenCalled();
  });

  it('falls back to a temporary expiry upload when indexing fails', async () => {
    client.files.upload.mockRejectedValueOnce(new Error('Index upload failed'))
      .mockResolvedValueOnce({ name: 'files/temp', uri: 'uri/temp', state: 'ACTIVE' });
    const indexing = service.uploadFileToGemini('large.pdf', 'application/pdf', 'large.pdf');
    const result = await service.extractStructuredExpiry(Buffer.alloc(10 * 1024 * 1024 + 1), 'application/pdf', 'large.pdf', indexing);
    expect(result?.expiryDate?.toISOString().slice(0, 10)).toBe('2026-10-06');
    expect(client.files.upload).toHaveBeenCalledTimes(2);
    expect(client.models.generateContent.mock.calls[0][0].contents[0].parts[0].fileData.fileUri).toBe('uri/temp');
    expect(client.files.delete).toHaveBeenCalledTimes(1);
    expect(client.files.delete).toHaveBeenCalledWith(expect.objectContaining({ name: 'files/temp' }));
  });

  it('uses the temporary path for an incompatible indexed MIME type', async () => {
    client.files.upload.mockResolvedValue({ name: 'files/temp', uri: 'uri/temp', state: 'ACTIVE' });
    const indexing = Promise.resolve({ fileId: 'files/index', fileUri: 'uri/index', mimeType: 'text/plain' });
    await service.extractStructuredExpiry(Buffer.alloc(10 * 1024 * 1024 + 1), 'application/pdf', 'large.pdf', indexing);
    expect(client.models.generateContent.mock.calls[0][0].contents[0].parts[0].fileData.fileUri).toBe('uri/temp');
    expect(client.files.delete).toHaveBeenCalledWith(expect.objectContaining({ name: 'files/temp' }));
    expect(client.files.delete).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'files/index' }));
  });

  it('falls back when indexing returns an unusable file reference', async () => {
    client.files.upload.mockResolvedValue({ name: 'files/temp', uri: 'uri/temp', state: 'ACTIVE' });
    const indexing = Promise.resolve({ fileId: 'files/index', fileUri: '', mimeType: 'application/pdf' });
    await service.extractStructuredExpiry(Buffer.alloc(10 * 1024 * 1024 + 1), 'application/pdf', 'large.pdf', indexing);
    expect(client.models.generateContent.mock.calls[0][0].contents[0].parts[0].fileData.fileUri).toBe('uri/temp');
    expect(client.files.upload).toHaveBeenCalledTimes(1);
    expect(client.files.delete).toHaveBeenCalledWith(expect.objectContaining({ name: 'files/temp' }));
  });

  it('keeps small files inline without waiting for a pending indexing upload', async () => {
    const indexing = new Promise<{ fileId: string; fileUri: string }>(() => undefined);
    const result = await service.extractStructuredExpiry(Buffer.from('small PDF'), 'application/pdf', 'small.pdf', indexing);
    expect(result?.expiryDate?.toISOString().slice(0, 10)).toBe('2026-10-06');
    expect(client.models.generateContent.mock.calls[0][0].contents[0].parts[0].inlineData.mimeType).toBe('application/pdf');
    expect(client.files.upload).not.toHaveBeenCalled();
  });

  it('overlaps PDF label parsing with the model request and still validates those labels', async () => {
    let resolveText!: (text: string) => void;
    jest.mocked(readPdfExpiryText).mockReturnValue(new Promise(resolve => { resolveText = resolve; }));
    client.models.generateContent.mockResolvedValueOnce(expiryResponse({ expiryDateText: 'Validity of License:06October2026' }));
    const extraction = service.extractStructuredExpiry(Buffer.from('small PDF'), 'application/pdf', 'small.pdf');
    expect(client.models.generateContent).toHaveBeenCalledTimes(1);
    resolveText('Validity of License:06October2026\nQualified Personnel\nExpiry Date16June2025');
    expect((await extraction)?.expiryDate?.toISOString().slice(0, 10)).toBe('2026-10-06');
    expect(client.models.generateContent).toHaveBeenCalledTimes(1);
  });

  it('uses a shared indexed native image without invoking PDF text parsing', async () => {
    const indexing = Promise.resolve({ fileId: 'files/image', fileUri: 'uri/image', mimeType: 'image/jpeg' });
    await service.extractStructuredExpiry(Buffer.alloc(10 * 1024 * 1024 + 1), 'image/jpeg', 'large.jpg', indexing);
    expect(client.models.generateContent.mock.calls[0][0].contents[0].parts[0].fileData).toEqual({ fileUri: 'uri/image', mimeType: 'image/jpeg' });
    expect(readPdfExpiryText).not.toHaveBeenCalled();
    expect(client.files.upload).not.toHaveBeenCalled();
    expect(client.files.delete).not.toHaveBeenCalled();
  });

  it('checks the first processing status immediately so already-ready uploads avoid the polling delay', async () => {
    jest.useFakeTimers();
    client.files.upload.mockResolvedValue({ name: 'files/index', uri: 'uri/index', state: 'PROCESSING' });
    client.files.get.mockResolvedValue({ state: 'ACTIVE' });
    await expect(service.uploadFileToGemini('large.pdf', 'application/pdf', 'large.pdf')).resolves.toEqual({ fileId: 'files/index', fileUri: 'uri/index', mimeType: 'application/pdf' });
    expect(client.files.get).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each([
    ['gemini-3.6-flash', 2048, { thinkingLevel: 'MINIMAL' }],
    ['gemini-3.7-flash', 2048, { thinkingLevel: 'LOW' }],
    ['models/gemini-3.1-pro-preview', 4096, { thinkingLevel: 'LOW' }],
    ['gemini-2.5-flash', 2048, { thinkingBudget: 0 }],
    ['custom-expiry-model', 2048, undefined],
  ])('bounds output and supported thinking for %s', async (model, limit, thinkingConfig) => {
    process.env.GEMINI_EXPIRY_MODEL = String(model);
    service = new GeminiService();
    client.models.generateContent.mockResolvedValue(expiryResponse({ expiryDateText: 'Validity of License: 6 October 2026' }));
    await service.extractStructuredExpiry(Buffer.from('scan'), 'image/png', 'permit.png');
    expect(client.models.generateContent).toHaveBeenCalledTimes(1);
    expect(client.models.generateContent.mock.calls[0][0].config).toEqual(expect.objectContaining({ maxOutputTokens: limit }));
    expect(client.models.generateContent.mock.calls[0][0].config.thinkingConfig).toEqual(thinkingConfig);
  });

  it('accepts an explicit response limit while rejecting invalid limits', async () => {
    process.env.GEMINI_EXPIRY_MAX_OUTPUT_TOKENS = '3072';
    client.models.generateContent.mockResolvedValue(expiryResponse({ expiryDateText: 'Validity of License: 6 October 2026' }));
    await service.extractStructuredExpiry(Buffer.from('scan'), 'image/png', 'permit.png');
    expect(client.models.generateContent.mock.calls[0][0].config.maxOutputTokens).toBe(3072);
    process.env.GEMINI_EXPIRY_MAX_OUTPUT_TOKENS = '10';
    await service.extractStructuredExpiry(Buffer.from('scan'), 'image/png', 'permit.png');
    expect(client.models.generateContent.mock.calls[1][0].config.maxOutputTokens).toBe(2048);
  });

  it('uses medium native PDF resolution first and high resolution for ambiguous verification', async () => {
    await service.extractStructuredExpiry(Buffer.from('PDF contents'), 'application/pdf', 'permit.pdf');
    expect(client.models.generateContent).toHaveBeenCalledTimes(2);
    const [analysis, verification] = client.models.generateContent.mock.calls.map(([request]) => request);
    expect(analysis.config.mediaResolution).toBe('MEDIA_RESOLUTION_MEDIUM');
    expect(verification.config.mediaResolution).toBe('MEDIA_RESOLUTION_HIGH');
    expect(analysis.contents[0].parts[0].inlineData.mimeType).toBe('application/pdf');
    expect(verification.contents[0].parts[0].inlineData.data).toBe(analysis.contents[0].parts[0].inlineData.data);
  });

  it.each(['image/png', 'image/jpeg'])('keeps readable image resolution high for %s', async mimeType => {
    client.models.generateContent.mockResolvedValue(expiryResponse({ expiryDateText: 'Validity of License: 6 October 2026' }));
    await service.extractStructuredExpiry(Buffer.from('scan'), mimeType, 'permit');
    expect(client.models.generateContent.mock.calls[0][0].config.mediaResolution).toBe('MEDIA_RESOLUTION_HIGH');
  });

  it('accepts a confident primary license quote in a scan without a duplicate model reading', async () => {
    client.models.generateContent.mockResolvedValue(expiryResponse({ expiryDateText: 'Validity of License: 6 October 2026' }));
    const result = await service.extractStructuredExpiry(Buffer.from('scanned license'), 'image/png', 'permit.png');
    expect(result?.expiryDate?.toISOString().slice(0, 10)).toBe('2026-10-06');
    expect(client.models.generateContent).toHaveBeenCalledTimes(1);
  });

  it.each([
    { confidence: 0.94 },
    { uncertain: true },
    { expiryDateText: 'Expiry Date: 6 October 2026' },
    { expiryDateText: 'License Expiry: 6 October 2026' },
  ])('still independently verifies insufficient primary evidence %j', async overrides => {
    client.models.generateContent.mockResolvedValueOnce(expiryResponse({ expiryDateText: 'Validity of License: 6 October 2026', ...overrides }))
      .mockResolvedValueOnce(verificationResponse({ expiryDateText: 'Validity of License: 6 October 2026' }));
    await service.extractStructuredExpiry(Buffer.from('scan'), 'image/png', 'permit.png');
    expect(client.models.generateContent).toHaveBeenCalledTimes(2);
  });

  it('checks a scanned multi-page PDF again even when its model quote names a primary license', async () => {
    jest.mocked(readPdfExpiryText).mockResolvedValue('[Document page 1]\n\n[Document page 2]\n');
    client.models.generateContent.mockResolvedValueOnce(expiryResponse({ expiryDateText: 'Validity of License: 6 October 2026' }))
      .mockResolvedValueOnce(verificationResponse({ expiryDateText: 'Validity of License: 6 October 2026' }));
    await service.extractStructuredExpiry(Buffer.from('scanned PDF'), 'application/pdf', 'permit.pdf');
    expect(client.models.generateContent).toHaveBeenCalledTimes(2);
  });

  it.each([
    'Validity of License: 6 October 2026\nValidity of License: 7 October 2026',
    'Validity of License: 6 October 2026\nPermit Expiry: 06/10/2026',
    'Validity of License: unclear\nExpiry Date: 6 October 2026',
  ])('verifies conflicting or unreadable primary source labels rather than treating them as absent', async sourceText => {
    jest.mocked(readPdfExpiryText).mockResolvedValue(sourceText);
    client.models.generateContent.mockResolvedValueOnce(expiryResponse({ expiryDateText: 'Validity of License: 6 October 2026' }))
      .mockResolvedValueOnce(verificationResponse({ expiryDateText: 'Validity of License: 6 October 2026' }));
    await service.extractStructuredExpiry(Buffer.from('PDF contents'), 'application/pdf', 'permit.pdf');
    expect(client.models.generateContent).toHaveBeenCalledTimes(2);
  });

  it('accepts literal complete text evidence without another model call', async () => {
    client.models.generateContent.mockResolvedValue(expiryResponse({ expiryDateText: 'Expiry Date: 2026-10-06' }));
    const result = await service.extractStructuredExpiry(Buffer.from('Permit P-123\nExpiry Date: 2026-10-06'), 'text/plain', 'permit.txt');
    expect(result?.expiryDate?.toISOString().slice(0, 10)).toBe('2026-10-06');
    expect(client.models.generateContent).toHaveBeenCalledTimes(1);
  });

  it('requires verification for a text quote invented outside the actual source', async () => {
    client.models.generateContent.mockResolvedValueOnce(expiryResponse({ expiryDateText: 'Expiry Date: 2026-10-06' }))
      .mockResolvedValueOnce(verificationResponse({ expiryDateText: 'Expiry Date: 7 October 2026' }));
    const result = await service.extractStructuredExpiry(Buffer.from('Expiry Date: 7 October 2026'), 'text/plain', 'permit.txt');
    expect(result?.expiryDate?.toISOString().slice(0, 10)).toBe('2026-10-07');
    expect(client.models.generateContent).toHaveBeenCalledTimes(2);
  });

  it('reads complete Word body and header text once when its literal date matches', async () => {
    client.models.generateContent.mockResolvedValue(expiryResponse({ expiryDateText: 'Expiry Date: 2026-10-06' }));
    const result = await service.extractStructuredExpiry(await docxBuffer(), 'application/octet-stream', 'permit.docx');
    expect(result?.expiryDate?.toISOString().slice(0, 10)).toBe('2026-10-06');
    expect(client.models.generateContent).toHaveBeenCalledTimes(1);
  });

  it('does not treat Word text as the complete source when it also contains an embedded scan', async () => {
    client.models.generateContent.mockResolvedValueOnce(expiryResponse({ expiryDateText: 'Expiry Date: 2026-10-06' }))
      .mockResolvedValueOnce(verificationResponse());
    await service.extractStructuredExpiry(await docxBuffer(true), 'application/octet-stream', 'permit.docx');
    expect(client.models.generateContent).toHaveBeenCalledTimes(2);
  });

  it('allows a confident no-expiry result in one reading when there is no contradictory label', async () => {
    client.models.generateContent.mockResolvedValue(expiryResponse({ expiryDate: null, expiryDateText: '' }));
    await expect(service.extractStructuredExpiry(Buffer.from('issue-only scan'), 'image/png', 'permit.png')).resolves.toBeNull();
    expect(client.models.generateContent).toHaveBeenCalledTimes(1);
  });

  it.each(['Expiry Date: 6 October 2026', 'Validity of License: 6 October 2026', 'Expires: 06/10/2026'])('verifies a claimed absence against contradictory source label %s', async sourceText => {
    jest.mocked(readPdfExpiryText).mockResolvedValue(sourceText);
    client.models.generateContent.mockResolvedValueOnce(expiryResponse({ expiryDate: null, expiryDateText: '' }))
      .mockResolvedValueOnce(verificationResponse({ expiryDateText: 'Validity of License: 6 October 2026' }));
    const result = await service.extractStructuredExpiry(Buffer.from('PDF contents'), 'application/pdf', 'permit.pdf');
    expect(result?.expiryDate?.toISOString().slice(0, 10)).toBe('2026-10-06');
    expect(client.models.generateContent).toHaveBeenCalledTimes(2);
  });

  it('rejects a token-truncated first response even if its partial result is valid JSON', async () => {
    client.models.generateContent.mockResolvedValue({ ...expiryResponse({ expiryDateText: 'Validity of License: 6 October 2026' }), candidates: [{ finishReason: 'MAX_TOKENS' }] });
    await expect(service.extractStructuredExpiry(Buffer.from('scan'), 'image/png', 'permit.png')).rejects.toThrow('response token limit');
    expect(client.models.generateContent).toHaveBeenCalledTimes(1);
  });

  it('rejects token-truncated verification rather than accepting an unreliable date', async () => {
    client.models.generateContent.mockResolvedValueOnce(expiryResponse())
      .mockResolvedValueOnce({ ...verificationResponse(), candidates: [{ finishReason: 'MAX_TOKENS' }] });
    await expect(service.extractStructuredExpiry(Buffer.from('scan'), 'image/png', 'permit.png')).rejects.toThrow('response token limit');
    expect(client.models.generateContent).toHaveBeenCalledTimes(2);
  });

  it('reuses identical upload analysis across normalized MIME and renamed files while copying mutable dates', async () => {
    client.models.generateContent.mockResolvedValue(expiryResponse({ expiryDateText: 'Validity of License: 6 October 2026' }));
    const bytes = Buffer.from('scanned license');
    const indexing = Promise.resolve({ fileId: 'files/index', fileUri: 'uri/index', mimeType: 'image/png' });
    const first = await service.extractStructuredExpiry(bytes, 'image/png', 'first.png', indexing);
    first!.expiryDate!.setUTCFullYear(2000);
    first!.issueDate!.setUTCFullYear(2000);
    first!.renewalDate!.setUTCFullYear(2000);
    const second = await service.extractStructuredExpiry(bytes, 'application/octet-stream', 'renamed.PNG', indexing);
    expect(client.models.generateContent).toHaveBeenCalledTimes(1);
    expect(second?.expiryDate?.toISOString().slice(0, 10)).toBe('2026-10-06');
    expect(second?.issueDate?.toISOString().slice(0, 10)).toBe('2026-01-01');
    expect(second?.renewalDate?.toISOString().slice(0, 10)).toBe('2026-09-06');
  });

  it('shares simultaneous identical upload requests instead of spending twice', async () => {
    let resolveAnalysis!: (value: ReturnType<typeof expiryResponse>) => void;
    client.models.generateContent.mockImplementation(() => new Promise(resolve => { resolveAnalysis = resolve; }));
    const bytes = Buffer.from('scanned license');
    const indexing = Promise.resolve({ fileId: 'files/index', fileUri: 'uri/index', mimeType: 'image/png' });
    const first = service.extractStructuredExpiry(bytes, 'image/png', 'first.png', indexing);
    const second = service.extractStructuredExpiry(bytes, 'image/png', 'copy.png', indexing);
    expect(client.models.generateContent).toHaveBeenCalledTimes(1);
    resolveAnalysis(expiryResponse({ expiryDateText: 'Validity of License: 6 October 2026' }));
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toEqual(secondResult);
    expect(firstResult?.expiryDate).not.toBe(secondResult?.expiryDate);
  });

  it('does not reuse analysis for changed source bytes or a different native MIME', async () => {
    client.models.generateContent.mockResolvedValue(expiryResponse({ expiryDateText: 'Validity of License: 6 October 2026' }));
    const indexing = Promise.resolve({ fileId: 'files/index', fileUri: 'uri/index' });
    await service.extractStructuredExpiry(Buffer.from('first scan'), 'image/png', 'permit.png', indexing);
    await service.extractStructuredExpiry(Buffer.from('changed scan'), 'image/png', 'permit.png', indexing);
    await service.extractStructuredExpiry(Buffer.from('first scan'), 'image/jpeg', 'permit.jpg', indexing);
    expect(client.models.generateContent).toHaveBeenCalledTimes(3);
  });

  it('keeps explicit reanalysis fresh even when an upload result was recently cached', async () => {
    client.models.generateContent.mockResolvedValue(expiryResponse({ expiryDateText: 'Validity of License: 6 October 2026' }));
    const bytes = Buffer.from('scanned license');
    const indexing = Promise.resolve({ fileId: 'files/index', fileUri: 'uri/index' });
    await service.extractStructuredExpiry(bytes, 'image/png', 'permit.png', indexing);
    await service.extractStructuredExpiry(bytes, 'image/png', 'permit.png');
    await service.extractStructuredExpiry(bytes, 'image/png', 'permit.png');
    expect(client.models.generateContent).toHaveBeenCalledTimes(3);
  });

  it('expires duplicate-upload results after ten minutes', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(10_000);
    client.models.generateContent.mockResolvedValue(expiryResponse({ expiryDateText: 'Validity of License: 6 October 2026' }));
    const bytes = Buffer.from('scanned license');
    const indexing = Promise.resolve({ fileId: 'files/index', fileUri: 'uri/index' });
    await service.extractStructuredExpiry(bytes, 'image/png', 'permit.png', indexing);
    now.mockReturnValue(10_000 + 599_999);
    await service.extractStructuredExpiry(bytes, 'image/png', 'permit.png', indexing);
    expect(client.models.generateContent).toHaveBeenCalledTimes(1);
    now.mockReturnValue(10_000 + 600_000);
    await service.extractStructuredExpiry(bytes, 'image/png', 'permit.png', indexing);
    expect(client.models.generateContent).toHaveBeenCalledTimes(2);
  });

  it('retries failed duplicate uploads rather than caching analysis errors', async () => {
    client.models.generateContent.mockRejectedValueOnce(new Error('Temporary quota failure'))
      .mockResolvedValue(expiryResponse({ expiryDateText: 'Validity of License: 6 October 2026' }));
    const bytes = Buffer.from('scanned license');
    const indexing = Promise.resolve({ fileId: 'files/index', fileUri: 'uri/index' });
    await expect(service.extractStructuredExpiry(bytes, 'image/png', 'permit.png', indexing)).rejects.toThrow('Temporary quota failure');
    await expect(service.extractStructuredExpiry(bytes, 'image/png', 'permit.png', indexing)).resolves.toEqual(expect.objectContaining({ expiryDate: new Date('2026-10-06T00:00:00Z') }));
    expect(client.models.generateContent).toHaveBeenCalledTimes(2);
  });

  it('bounds successful duplicate-upload entries and evicts the oldest result', async () => {
    client.models.generateContent.mockResolvedValue(expiryResponse({ expiryDateText: 'Validity of License: 6 October 2026' }));
    const indexing = Promise.resolve({ fileId: 'files/index', fileUri: 'uri/index' });
    for (let index = 0; index < 129; index += 1) {
      await service.extractStructuredExpiry(Buffer.from(`scan ${index}`), 'image/png', 'permit.png', indexing);
    }
    await service.extractStructuredExpiry(Buffer.from('scan 128'), 'image/png', 'permit.png', indexing);
    expect(client.models.generateContent).toHaveBeenCalledTimes(129);
    await service.extractStructuredExpiry(Buffer.from('scan 0'), 'image/png', 'permit.png', indexing);
    expect(client.models.generateContent).toHaveBeenCalledTimes(130);
  });
});
