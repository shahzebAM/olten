import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DocumentService } from './documentation/document.service';
import type { FulfillmentRequest } from './fulfillment/fulfillment-auth.guard';
import { FulfillmentService } from './fulfillment/fulfillment.service';
import { FulfillmentPodController } from './fulfillment-pod.controller';

describe('signed POD upload', () => {
  const fulfillment = { getDelivery: jest.fn(), pod: jest.fn() };
  const documents = { processNewDocument: jest.fn() };
  const controller = new FulfillmentPodController(
    fulfillment as unknown as FulfillmentService,
    documents as unknown as DocumentService,
  );
  const request = { user: { username: 'verified-user' } } as FulfillmentRequest;
  const file = {
    buffer: Buffer.from('%PDF-1.7 test fixture'),
    mimetype: 'application/pdf',
    originalname: 'signed-receipt.pdf',
  } as Express.Multer.File;
  const body = {
    recipient: 'Hospital receiver',
    receivedAt: '2026-10-16T09:00:00+08:00',
    items: JSON.stringify([{ deliveryItemId: 'item-1', quantity: 2 }]),
  };
  beforeEach(() => {
    jest.resetAllMocks();
    fulfillment.getDelivery.mockResolvedValue({
      status: 'Dispatched',
      pods: [],
      items: [{ id: 'item-1', quantity: 3, deliveredQty: 1 }],
    });
    documents.processNewDocument.mockResolvedValue({ id: 42 });
    fulfillment.pod.mockResolvedValue({ status: 'Delivered' });
  });

  it('uses the verified actor, company-scoped delivery and existing document service', async () => {
    await expect(
      controller.upload('delivery-1', 'Surgicom', request, file, body),
    ).resolves.toEqual({ status: 'Delivered' });
    expect(fulfillment.getDelivery).toHaveBeenCalledWith(
      'Surgicom',
      'delivery-1',
    );
    expect(documents.processNewDocument).toHaveBeenCalledWith(
      file,
      'Surgicom',
      'verified-user',
      undefined,
      { reminderSetup: 'after-upload' },
    );
    expect(fulfillment.pod).toHaveBeenCalledWith(
      'Surgicom',
      'verified-user',
      'delivery-1',
      expect.objectContaining({
        documentId: 42,
        items: [{ deliveryItemId: 'item-1', quantity: 2 }],
      }),
    );
  });

  it('does not upload a document for a foreign company or an undispatched delivery', async () => {
    fulfillment.getDelivery.mockRejectedValueOnce(new NotFoundException());
    await expect(
      controller.upload('foreign', 'Surgicom', request, file, body),
    ).rejects.toBeInstanceOf(NotFoundException);
    fulfillment.getDelivery.mockResolvedValueOnce({
      status: 'Draft',
      pods: [],
    });
    await expect(
      controller.upload('delivery-1', 'Surgicom', request, file, body),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(documents.processNewDocument).not.toHaveBeenCalled();
  });

  it.each([
    'broken',
    '[]',
    '[{"deliveryItemId":"item-1","quantity":3}]',
    '[{"deliveryItemId":"foreign","quantity":1}]',
    '[{"deliveryItemId":"item-1","quantity":1},{"deliveryItemId":"item-1","quantity":1}]',
    '[{"deliveryItemId":"item-1","quantity":1.5}]',
  ])('validates receipt line quantities before upload (%s)', async (items) => {
    await expect(
      controller.upload('delivery-1', 'Surgicom', request, file, {
        ...body,
        items,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(documents.processNewDocument).not.toHaveBeenCalled();
  });

  it('rejects invalid recipient/date and unsupported files without writing documents', async () => {
    await expect(
      controller.upload('delivery-1', 'Surgicom', request, file, {
        ...body,
        recipient: ' ',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.upload('delivery-1', 'Surgicom', request, file, {
        ...body,
        receivedAt: 'invalid',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.upload(
        'delivery-1',
        'Surgicom',
        request,
        { ...file, mimetype: 'text/html' },
        body,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(documents.processNewDocument).not.toHaveBeenCalled();
  });

  it('returns the saved document ID if a concurrent delivery change prevents attaching it', async () => {
    fulfillment.pod.mockRejectedValueOnce(new ConflictException());
    try {
      await controller.upload('delivery-1', 'Surgicom', request, file, body);
      throw new Error('Expected a conflict.');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toEqual(
        expect.objectContaining({ documentId: 42 }),
      );
    }
    expect(documents.processNewDocument).toHaveBeenCalledTimes(1);
  });

  it.each(['PartiallyDelivered', 'Delivered'])(
    'returns an existing %s receipt on retry without uploading it twice',
    async (status) => {
      const existing = {
        status,
        pods: [
          {
            recipient: body.recipient,
            receivedAt: new Date(body.receivedAt),
            items: JSON.parse(body.items) as unknown,
          },
        ],
        items: [{ id: 'item-1', quantity: 3, deliveredQty: 3 }],
      };
      fulfillment.getDelivery.mockResolvedValueOnce(existing);
      await expect(
        controller.upload('delivery-1', 'Surgicom', request, file, body),
      ).resolves.toEqual(existing);
      expect(documents.processNewDocument).not.toHaveBeenCalled();
      expect(fulfillment.pod).not.toHaveBeenCalled();
    },
  );
});
