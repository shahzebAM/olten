import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Headers,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { DocumentService } from './documentation/document.service';
import {
  FulfillmentAuthGuard,
  type FulfillmentRequest,
} from './fulfillment/fulfillment-auth.guard';
import {
  FulfillmentService,
  samePodReceipt,
} from './fulfillment/fulfillment.service';
import * as v from './importation/importation.validation';

@Controller('fulfillment/deliveries')
@UseGuards(FulfillmentAuthGuard)
export class FulfillmentPodController {
  constructor(
    private readonly fulfillment: FulfillmentService,
    private readonly documents: DocumentService,
  ) {}

  @Post(':id/pod-upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    }),
  )
  async upload(
    @Param('id') id: string,
    @Headers('x-company') company: string,
    @Req() request: FulfillmentRequest,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body()
    body: {
      recipient?: string;
      receivedAt?: string;
      notes?: string;
      items?: string;
    },
  ) {
    if (
      !file?.buffer?.length ||
      !['application/pdf', 'image/jpeg', 'image/png'].includes(file.mimetype)
    ) {
      throw new BadRequestException(
        'Attach a signed PDF, JPEG or PNG receipt (maximum 10 MB).',
      );
    }
    if (file.buffer.length > 10 * 1024 * 1024)
      throw new BadRequestException('The signed receipt exceeds 10 MB.');
    // Validate the company, delivery state and quantities before creating an external document.
    const delivery = await this.fulfillment.getDelivery(company, id);
    const recipient = v.text(body.recipient, 'Recipient', true, 150)!;
    const receivedAt = v.date(body.receivedAt, 'Received at');
    const notes = v.text(body.notes, 'Notes', false);
    if (
      !receivedAt ||
      receivedAt > new Date(Date.now() + 300000) ||
      (delivery.dispatchedAt && receivedAt < delivery.dispatchedAt)
    ) {
      throw new BadRequestException(
        'Receipt time must follow dispatch and cannot be in the future.',
      );
    }
    let items: unknown;
    try {
      items = JSON.parse(body.items ?? '');
    } catch {
      throw new BadRequestException('Receipt quantities must be valid JSON.');
    }
    items = v.rows(items);
    if (
      delivery.pods.some((receipt) =>
        samePodReceipt(receipt, { recipient, receivedAt, items }),
      )
    )
      return delivery;
    if (!['Dispatched', 'PartiallyDelivered'].includes(delivery.status))
      throw new ConflictException(
        'Confirm dispatch before attaching proof of delivery.',
      );
    const ids = new Set<string>();
    for (const input of items as unknown[]) {
      if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new BadRequestException('Invalid receipt line.');
      const line = input as Record<string, unknown>;
      const item = delivery.items.find(
        (item) => item.id === line.deliveryItemId,
      );
      if (
        typeof line.deliveryItemId !== 'string' ||
        ids.has(line.deliveryItemId) ||
        !item ||
        typeof line.quantity !== 'number' ||
        !Number.isSafeInteger(line.quantity) ||
        line.quantity < 1 ||
        line.quantity > item.quantity - item.deliveredQty
      ) {
        throw new BadRequestException(
          'Receipt quantities must match the remaining dispatched lines.',
        );
      }
      ids.add(line.deliveryItemId);
    }
    const document = (await this.documents.processNewDocument(
      file,
      company,
      request.user.username,
      undefined,
      { reminderSetup: 'after-upload' },
    )) as { id: number };
    try {
      return await this.fulfillment.pod(company, request.user.username, id, {
        recipient,
        receivedAt: body.receivedAt,
        notes,
        items,
        documentId: document.id,
      });
    } catch {
      throw new ConflictException({
        message: `The receipt was saved as Document #${document.id}, but the delivery changed during upload. Refresh and attach this document to the remaining quantities.`,
        documentId: document.id,
      });
    }
  }
}
