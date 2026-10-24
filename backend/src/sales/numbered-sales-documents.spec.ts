jest.mock('@prisma/client', () => ({
  ...jest.requireActual<typeof import('@prisma/client')>('@prisma/client'),
  PrismaClient: jest.fn(),
}));

jest.mock('./document-numbering', () => ({
  createNumberedDocument: jest.fn(),
  nextDocumentNumber: jest.fn(),
}));

import { BadRequestException } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import { FulfillmentService } from '../fulfillment/fulfillment.service';
import { type FulfillmentRequest } from '../fulfillment/fulfillment-auth.guard';
import {
  createNumberedDocument,
  nextDocumentNumber,
} from './document-numbering';
import { PackingListsController } from './packing-lists.controller';
import { QuotationsController } from './quotations.controller';

describe('quotation and packing list number allocation', () => {
  const request = {
    headers: { 'x-company': 'Surgicom' },
    user: { username: 'verified-operator' },
  } as unknown as FulfillmentRequest;
  const items = [
    {
      productId: 7,
      sku: 'MED-7',
      productName: 'Medical item',
      requestedQty: 2,
      unitPrice: 12.5,
      lineTotal: 25,
    },
  ];
  const payload = {
    company: 'Surgicom',
    customerId: 'SU-01',
    items,
    isVatApplied: true,
    subtotal: 25,
    vatAmount: 3,
    grandTotal: 28,
    user: 'operator',
  };
  const tx = {
    customer: { findFirst: jest.fn() },
    product: { findMany: jest.fn() },
    quotation: { create: jest.fn() },
    packingList: { create: jest.fn() },
  };
  const fulfillment = { ensureDocumentDelivery: jest.fn() };
  let quotation: QuotationsController;
  let packing: PackingListsController;

  beforeEach(() => {
    jest.clearAllMocks();
    tx.customer.findFirst.mockResolvedValue({ id: 'SU-01' });
    tx.product.findMany.mockResolvedValue([{ id: 7 }]);
    tx.quotation.create.mockImplementation(({ data }: { data: object }) =>
      Promise.resolve({ id: 'qt-1', ...data }),
    );
    tx.packingList.create.mockImplementation(({ data }: { data: object }) =>
      Promise.resolve({ id: 'pl-1', ...data }),
    );
    jest
      .mocked(createNumberedDocument)
      .mockImplementation((_prisma, kind, _company, _requested, work) =>
        work(tx as unknown as Prisma.TransactionClient, `${kind}-000002`),
      );
    jest.mocked(nextDocumentNumber).mockResolvedValue('QT-000003');
    quotation = new QuotationsController();
    packing = new PackingListsController(
      fulfillment as unknown as FulfillmentService,
    );
  });

  it('creates a quotation with the allocator result while retaining its totals', async () => {
    await expect(
      quotation.createQuotation({ ...payload, qtNumber: 'QT-000001' }),
    ).resolves.toMatchObject({
      qtNumber: 'QT-000002',
      subtotal: 25,
      vatAmount: 3,
      grandTotal: 28,
    });
    expect(createNumberedDocument).toHaveBeenCalledWith(
      expect.anything(),
      'QT',
      'Surgicom',
      'QT-000001',
      expect.any(Function),
    );
  });

  it('allows quotation numbers to be assigned automatically', async () => {
    await expect(quotation.createQuotation(payload)).resolves.toMatchObject({
      qtNumber: 'QT-000002',
    });
    expect(createNumberedDocument).toHaveBeenCalledWith(
      expect.anything(),
      'QT',
      'Surgicom',
      undefined,
      expect.any(Function),
    );
  });

  it('returns a quotation preview without creating a record', async () => {
    await expect(quotation.getNextNumber('Surgicom')).resolves.toEqual({
      qtNumber: 'QT-000003',
    });
    expect(nextDocumentNumber).toHaveBeenCalledWith(
      expect.anything(),
      'QT',
      'Surgicom',
    );
    expect(tx.quotation.create).not.toHaveBeenCalled();
  });

  it('uses the actual allocated packing list number for its delivery link', async () => {
    await expect(
      packing.createPackingList(
        { ...payload, plNumber: 'PL-000001', referenceOs: 'OS-000001' },
        request,
      ),
    ).resolves.toMatchObject({ plNumber: 'PL-000002' });
    expect(fulfillment.ensureDocumentDelivery).toHaveBeenCalledWith(
      tx,
      'Surgicom',
      'verified-operator',
      expect.objectContaining({
        sourceType: 'PL',
        sourceId: 'pl-1',
        documentNumber: 'PL-000002',
        referenceOs: 'OS-000001',
      }),
    );
  });

  it('allows omitted packing list numbers and retains the verified company', async () => {
    const forgedPayload = { ...payload, company: 'Other company' };
    await expect(
      packing.createPackingList(forgedPayload, request),
    ).resolves.toMatchObject({
      plNumber: 'PL-000002',
      company: 'Surgicom',
      createdBy: 'verified-operator',
    });
    expect(createNumberedDocument).toHaveBeenCalledWith(
      expect.anything(),
      'PL',
      'Surgicom',
      undefined,
      expect.any(Function),
    );
  });

  it.each(['FO-000001', '', '123'])(
    'rejects an invalid supplied packing list number %s',
    async (plNumber) => {
      await expect(
        packing.createPackingList({ ...payload, plNumber }, request),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(createNumberedDocument).not.toHaveBeenCalled();
    },
  );

  it('returns a packing list preview without allocating stock or a document', async () => {
    jest.mocked(nextDocumentNumber).mockResolvedValue('PL-000003');
    await expect(packing.getNextNumber('Surgicom')).resolves.toEqual({
      plNumber: 'PL-000003',
    });
    expect(nextDocumentNumber).toHaveBeenCalledWith(
      expect.anything(),
      'PL',
      'Surgicom',
    );
    expect(fulfillment.ensureDocumentDelivery).not.toHaveBeenCalled();
    expect(tx.packingList.create).not.toHaveBeenCalled();
  });

  it('requires a company for both number previews', async () => {
    await expect(quotation.getNextNumber('')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(packing.getNextNumber('')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(nextDocumentNumber).not.toHaveBeenCalled();
  });
});
