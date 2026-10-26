import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaClient, type Prisma } from '@prisma/client';
import { LegacyCompanyRecord, LegacyErpAccess, LegacyErpAuthGuard } from '../auth/legacy-erp-auth.guard';
import { FulfillmentService } from '../fulfillment/fulfillment.service';
import {
  FulfillmentAccess,
  FulfillmentAuthGuard,
  type FulfillmentRequest,
} from '../fulfillment/fulfillment-auth.guard';
import {
  createNumberedDocument,
  nextDocumentNumber,
} from './document-numbering';

@Controller('sales/packing-lists')
@UseGuards(LegacyErpAuthGuard)
@LegacyErpAccess('sales')
@FulfillmentAccess('sales')
export class PackingListsController {
  private readonly prisma = new PrismaClient();

  constructor(private readonly fulfillment: FulfillmentService) {}

  @Post()
  @UseGuards(FulfillmentAuthGuard)
  async createPackingList(
    @Body()
    data: {
      customerId: string;
      items: Prisma.PackingListItemUncheckedCreateWithoutPackingListInput[];
      isVatApplied: boolean;
      vatRate?: number;
      plNumber?: string;
      referenceOs?: string;
      subtotal: number;
      vatAmount: number;
      grandTotal: number;
    },
    @Req() request: FulfillmentRequest,
  ) {
    const company = String(request.headers['x-company']);
    const user = request.user.username;
    const {
      customerId,
      items,
      isVatApplied,
      vatRate = 0.12,
      plNumber,
      referenceOs,
    } = data;
    if (
      !customerId ||
      (plNumber !== undefined &&
        (typeof plNumber !== 'string' || !plNumber.trim().startsWith('PL-'))) ||
      !Array.isArray(items) ||
      !items.length
    ) {
      throw new BadRequestException(
        'A packing list number, customer and items are required.',
      );
    }
    try {
      return await createNumberedDocument(
        this.prisma,
        'PL',
        company,
        plNumber,
        async (tx, number) => {
          if (
            !(await tx.customer.findFirst({
              where: { id: customerId, company },
            }))
          )
            throw new NotFoundException('Customer record not found.');
          const products = await tx.product.findMany({
            where: {
              company,
              id: { in: items.map((item) => Number(item.productId)) },
            },
          });
          for (const item of items) {
            if (
              !Number.isSafeInteger(item.requestedQty) ||
              item.requestedQty <= 0
            )
              throw new BadRequestException(
                'Packing list quantities must be positive whole numbers.',
              );
            if (!products.some((product) => product.id === item.productId))
              throw new NotFoundException('Product record not found.');
          }
          const pl = await tx.packingList.create({
            data: {
              plNumber: number,
              referenceOs,
              company,
              customerId,
              status: 'Generated',
              subtotal: data.subtotal,
              vatApplied: isVatApplied,
              vatRate,
              vatAmount: data.vatAmount,
              grandTotal: data.grandTotal,
              createdBy: user,
              items: { create: items },
            },
            include: { items: true, customer: true },
          });

          await this.fulfillment.ensureDocumentDelivery(tx, company, user, {
            sourceType: 'PL',
            sourceId: pl.id,
            documentNumber: pl.plNumber,
            referenceOs,
            customerId,
            items: items.map((item) => ({
              productId: item.productId,
              quantity: item.requestedQty,
            })),
          });
          return pl;
        },
      );
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        ['P2034', 'P2002'].includes(String(error.code))
      ) {
        throw new ConflictException(
          'Order or stock changed during this request. Refresh and try again.',
        );
      }
      throw error;
    }
  }

  @Get('next-number')
  async getNextNumber(@Query('company') company: string) {
    if (!company) throw new BadRequestException('Company is required.');
    return { plNumber: await nextDocumentNumber(this.prisma, 'PL', company) };
  }

  @Get()
  async listPackingLists(@Query('company') company: string) {
    return await this.prisma.packingList.findMany({
      where: { company },
      include: { customer: true, items: true },
      orderBy: { createdAt: 'desc' }
    });
  }

  @Delete(':id/cancel')
  @LegacyCompanyRecord('packingList')
  @UseGuards(FulfillmentAuthGuard)
  cancelPackingList(
    @Param('id') id: string,
    @Req() request: FulfillmentRequest,
  ) {
    return this.removePackingList(id, request, false);
  }

  @Delete(':id')
  @LegacyCompanyRecord('packingList')
  @UseGuards(FulfillmentAuthGuard)
  deletePackingList(
    @Param('id') id: string,
    @Req() request: FulfillmentRequest,
  ) {
    return this.removePackingList(id, request, true);
  }

  private async removePackingList(
    id: string,
    request: FulfillmentRequest,
    hardDelete: boolean,
  ) {
    const company = String(request.headers['x-company']);
    const user = request.user.username;
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.packingList.findFirst({
            where: { id, company },
            include: { items: true },
          });
          if (!existing) throw new NotFoundException('Packing list not found.');
          const managed = await this.fulfillment.cancelDocument(
            tx,
            company,
            user,
            'PL',
            id,
          );
          if (
            !managed &&
            !['Cancelled', 'Returned'].includes(existing.status)
          ) {
            for (const item of existing.items) {
              await tx.product.update({
                where: { id: item.productId },
                data: { currentStock: { increment: item.requestedQty } },
              });
            }
          }
          const result = hardDelete
            ? await tx.packingList.delete({ where: { id } })
            : await tx.packingList.update({
                where: { id },
                data: { status: 'Cancelled' },
              });
          return { ...result, deliveryManaged: managed };
        },
        { isolationLevel: 'Serializable', maxWait: 5000, timeout: 20000 },
      );
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        ['P2034', 'P2002'].includes(String(error.code))
      ) {
        throw new ConflictException(
          'Order or stock changed during this request. Refresh and try again.',
        );
      }
      throw error;
    }
  }
}
