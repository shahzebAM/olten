jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn() }));
jest.mock('./gemini.service', () => ({ GeminiService: jest.fn() }));
jest.mock('./drive.service', () => ({ DriveService: jest.fn() }));

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { DocumentService } from './document.service';
import { GeminiService } from './gemini.service';
import { DriveService } from './drive.service';
import { ExpiryExtractorService } from './expiry-extractor.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
type Links = {
  importFileId: string | null;
  shipmentId: string | null;
  productId: number | null;
  regulatoryStatus: string;
  documentType?: string | null;
};
const database = {
  document: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  shipment: { findFirst: jest.fn() },
  importFile: { findFirst: jest.fn() },
  product: { findFirst: jest.fn() },
  $transaction: jest.fn(),
};
Object.assign(
  (PrismaClient as unknown as jest.Mock).mock.instances[0] as object,
  database,
);

describe('document import and regulatory links', () => {
  let service: DocumentService;
  let doc: Links & {
    id: number;
    company: string;
    status: string;
    expiryDate: Date | null;
  };
  const update = (body: Parameters<DocumentService['updateImportLinks']>[2]) =>
    service.updateImportLinks('42', 'Surgicom', body);
  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-14T17:00:00Z'));
    doc = {
      id: 42,
      company: 'Surgicom',
      status: 'ACTIVE',
      expiryDate: day('2026-10-15'),
      importFileId: null,
      shipmentId: null,
      productId: null,
      regulatoryStatus: 'RECEIVED',
    };
    database.document.findFirst.mockImplementation(
      ({ where }: { where: { id: number; company: string; status: string } }) =>
        Promise.resolve(
          where.id === doc.id &&
            where.company === doc.company &&
            where.status === doc.status
            ? { ...doc }
            : null,
        ),
    );
    database.document.update.mockImplementation(
      ({ data }: { data: Partial<Links> }) => {
        Object.assign(doc, data);
        return Promise.resolve({ ...doc });
      },
    );
    database.document.findMany.mockResolvedValue([]);
    database.shipment.findFirst.mockImplementation(
      ({ where }: { where: { id: string; company: string } }) =>
        Promise.resolve(
          where.id === 'shipment-1' && where.company === 'Surgicom'
            ? { id: 'shipment-1', importFileId: 'import-1' }
            : null,
        ),
    );
    database.importFile.findFirst.mockImplementation(
      ({ where }: { where: { id: string; company: string } }) =>
        Promise.resolve(
          ['import-1', 'import-2'].includes(where.id) &&
            where.company === 'Surgicom'
            ? { id: where.id }
            : null,
        ),
    );
    database.product.findFirst.mockImplementation(
      ({ where }: { where: { id: number; company: string } }) =>
        Promise.resolve(
          where.id === 1 && where.company === 'Surgicom' ? { id: 1 } : null,
        ),
    );
    database.$transaction.mockImplementation(
      async (callback: (client: typeof database) => Promise<unknown>) =>
        callback(database),
    );
    service = new DocumentService(
      {} as GeminiService,
      {} as DriveService,
      new ExpiryExtractorService(),
    );
  });
  afterEach(() => jest.useRealTimers());

  it('derives the import file from its same-company shipment and preserves expiry tracking', async () => {
    await expect(
      update({
        shipmentId: 'shipment-1',
        productId: 1,
        regulatoryStatus: 'ACCEPTED',
        documentType: ' FDA Permit ',
      }),
    ).resolves.toMatchObject({
      id: 42,
      importFileId: 'import-1',
      shipmentId: 'shipment-1',
      productId: 1,
      regulatoryStatus: 'ACCEPTED',
      documentType: 'FDA Permit',
      expiryDate: day('2026-10-15'),
    });
    expect(database.shipment.findFirst).toHaveBeenCalledWith({
      where: { id: 'shipment-1', company: 'Surgicom' },
    });
    expect(database.product.findFirst).toHaveBeenCalledWith({
      where: { id: 1, company: 'Surgicom' },
    });
    expect(database.document.update).toHaveBeenCalledWith({
      where: { id: 42, company: 'Surgicom' },
      data: {
        importFileId: 'import-1',
        shipmentId: 'shipment-1',
        productId: 1,
        regulatoryStatus: 'ACCEPTED',
        documentType: 'FDA Permit',
      },
    });
  });

  it('rejects a shipment/import file mismatch without writing the document', async () => {
    await expect(
      update({ shipmentId: 'shipment-1', importFileId: 'import-2' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(database.document.update).not.toHaveBeenCalled();
  });

  it.each([
    { shipmentId: 'other-shipment' },
    { importFileId: 'other-import' },
    { productId: 2 },
  ])(
    'rejects links missing from the authenticated workspace: %o',
    async (body) => {
      await expect(update(body)).rejects.toBeInstanceOf(BadRequestException);
      expect(database.document.update).not.toHaveBeenCalled();
    },
  );

  it('rejects another company document and inactive records', async () => {
    await expect(
      service.updateImportLinks('42', 'Other', {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    doc.status = 'PROCESSING';
    await expect(update({})).rejects.toBeInstanceOf(NotFoundException);
    expect(database.document.update).not.toHaveBeenCalled();
  });

  it.each(['abc', '-1', '1.5', '9007199254740992'])(
    'rejects malformed document id %s',
    async (id) => {
      await expect(
        service.updateImportLinks(id, 'Surgicom', {}),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(database.$transaction).not.toHaveBeenCalled();
    },
  );

  it.each([
    { productId: 0 },
    { productId: 1.5 },
    { regulatoryStatus: 'invalid' },
    { importFileId: '' },
    { shipmentId: ' '.repeat(2) },
    { documentType: 'x'.repeat(151) },
  ])('rejects invalid link values: %o', async (body) => {
    await expect(update(body)).rejects.toBeInstanceOf(BadRequestException);
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it('rejects accepting an expired permit at Manila day boundaries and allows expiry today', async () => {
    doc.expiryDate = day('2026-10-14');
    await expect(
      update({ regulatoryStatus: 'ACCEPTED' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(database.document.update).not.toHaveBeenCalled();
    doc.expiryDate = day('2026-10-15');
    await expect(
      update({ regulatoryStatus: 'ACCEPTED' }),
    ).resolves.toMatchObject({ regulatoryStatus: 'ACCEPTED' });
  });

  it('clears optional links explicitly while retaining omitted status and expiry metadata', async () => {
    Object.assign(doc, {
      importFileId: 'import-1',
      shipmentId: 'shipment-1',
      productId: 1,
    });
    await expect(
      update({ importFileId: null, shipmentId: null, productId: null }),
    ).resolves.toMatchObject({
      importFileId: null,
      shipmentId: null,
      productId: null,
      regulatoryStatus: 'RECEIVED',
      expiryDate: day('2026-10-15'),
    });
  });

  it('requires clearing an existing shipment before assigning a different import file', async () => {
    Object.assign(doc, { importFileId: 'import-1', shipmentId: 'shipment-1' });
    await expect(update({ importFileId: 'import-2' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      update({ importFileId: 'import-2', shipmentId: null }),
    ).resolves.toMatchObject({ importFileId: 'import-2', shipmentId: null });
  });

  it('marks past expiries as expired without changing the stored AI document status', async () => {
    database.document.findMany.mockResolvedValue([
      { ...doc, expiryDate: day('2026-10-14'), regulatoryStatus: 'ACCEPTED' },
      {
        ...doc,
        id: 43,
        expiryDate: day('2026-10-15'),
        regulatoryStatus: 'ACCEPTED',
      },
    ]);
    const result = await service.getImportLinks('Surgicom');
    expect(result.map((item) => item.regulatoryStatus)).toEqual([
      'EXPIRED',
      'ACCEPTED',
    ]);
    expect(database.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { company: 'Surgicom', status: 'ACTIVE' },
      }),
    );
    expect(database.document.update).not.toHaveBeenCalled();
  });

  it('participates in the workspace deletion write barrier', async () => {
    const deletions = Reflect.get(service, 'companyDeletions') as Map<
      string,
      Promise<unknown>
    >;
    deletions.set('Surgicom', Promise.resolve());
    await expect(
      update({ regulatoryStatus: 'REQUESTED' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(database.$transaction).not.toHaveBeenCalled();
  });
});
