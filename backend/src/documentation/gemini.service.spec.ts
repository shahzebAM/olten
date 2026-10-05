import { GoogleGenAI } from '@google/genai';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';
import { GeminiService } from './gemini.service';

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn(),
  Type: { OBJECT: 'OBJECT', STRING: 'STRING', INTEGER: 'INTEGER', NUMBER: 'NUMBER' },
}));
jest.mock('node:fs/promises', () => ({ readFile: jest.fn() }));

function expiryResponse(overrides: Record<string, unknown> = {}) {
  return { text: JSON.stringify({
    documentType: 'Permit', documentNumber: 'P-123', issueDate: '2026-01-01',
    expiryDate: '2026-10-06', renewalDate: '2026-09-06', renewalDaysBeforeExpiry: 30,
    expiryDateText: 'Expiry Date: 6 October 2026', confidence: 0.98,
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

  beforeEach(() => {
    client = {
      models: { generateContent: jest.fn().mockResolvedValue(expiryResponse()) },
      files: { upload: jest.fn(), get: jest.fn(), delete: jest.fn().mockResolvedValue({}) },
    };
    jest.mocked(GoogleGenAI).mockImplementation(() => client as unknown as GoogleGenAI);
    process.env.GEMINI_EXPIRY_MODEL = 'configured-expiry-model';
    service = new GeminiService();
  });

  afterEach(() => {
    jest.useRealTimers();
    if (previousExpiryModel === undefined) delete process.env.GEMINI_EXPIRY_MODEL;
    else process.env.GEMINI_EXPIRY_MODEL = previousExpiryModel;
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

  it('keeps issue-only documents distinct from extraction failures', async () => {
    client.models.generateContent.mockResolvedValue(expiryResponse({ expiryDate: null, expiryDateText: '' }));
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
    client.models.generateContent.mockResolvedValue(expiryResponse({ renewalDaysBeforeExpiry: 0 }));
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

  it('requires manual review when Word conversion discards unsupported source content', async () => {
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
});
