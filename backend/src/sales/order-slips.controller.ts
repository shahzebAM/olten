import {
  Controller,
  Get,
  Post,
  Patch,
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
import { PrismaClient, Prisma } from '@prisma/client';
import { LegacyCompanyRecord, LegacyErpAccess, LegacyErpAuthGuard } from '../auth/legacy-erp-auth.guard';
import { FulfillmentService } from '../fulfillment/fulfillment.service';
import {
  createNumberedDocument,
  nextDocumentNumber,
} from './document-numbering';
import {
  FulfillmentAccess,
  FulfillmentAuthGuard,
  type FulfillmentRequest,
} from '../fulfillment/fulfillment-auth.guard';
import {
  assertLegacyStockFloor,
  lockProduct,
} from '../fulfillment/fulfillment.stock';

@Controller('sales/order-slips')
@UseGuards(LegacyErpAuthGuard)
@LegacyErpAccess('sales')
@FulfillmentAccess('sales')
export class OrderSlipsController {
  private readonly prisma = new PrismaClient();

  constructor(private readonly fulfillment: FulfillmentService) {}

  private async mutate<T>(
    action: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(action, {
        isolationLevel: 'Serializable',
        maxWait: 5000,
        timeout: 20000,
      });
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

  // --- CUSTOMER SEARCH ENDPOINT TO SUPPORT KEYBOARD NAV ---
  @Get('search-customers')
  async searchCustomers(@Query('company') company: string, @Query('q') q: string) {
    if (!company || !q || q.length < 2) return [];

    const searchString = q.toLowerCase();
    const allCompanyCustomers = await this.prisma.customer.findMany({
      where: { company },
      select: { id: true, name: true, email: true, phone: true }
    });

    return allCompanyCustomers.filter(c => (c.name && c.name.toLowerCase().includes(searchString))).slice(0, 15);
  }

  @Post('save-qrs')
  @LegacyErpAccess('qr')
  async saveProductQRs(@Body() data: { company: string }) {
    if (!data.company) throw new BadRequestException('Company is required');

    // Find all products that don't have a QR code saved yet
    const productsToUpdate = await this.prisma.product.findMany({ 
      where: { company: data.company, qrCodeUrl: null } 
    });

    if (productsToUpdate.length === 0) return { message: 'All products already have QRs saved!' };

    // Batch update them in the database
    const updates = productsToUpdate.map(p => {
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(`${p.sku}${p.name}`)}`;
      return this.prisma.product.update({
        where: { id: p.id },
        data: { qrCodeUrl: qrUrl }
      });
    });

    await this.prisma.$transaction(updates);
    return { message: `Successfully saved ${updates.length} QR codes to database.` };
  }

  @Get('all-products')
  @LegacyErpAccess('qr')
  async getAllProducts(@Query('company') company: string) {
    if (!company) return [];
    return await this.prisma.product.findMany({
      where: { company },
     select: { id: true, sku: true, name: true, category: true, sellingPrice: true, currentStock: true, qrCodeUrl: true },
      orderBy: { name: 'asc' }
    });
  }

  @Get('search-products')
  async searchProducts(
    @Query('company') company: string,
    @Query('q') q: string,
  ) {
    if (!company || !q || q.length < 2) return [];
    const searchString = q.toLowerCase();

    const allCompanyProducts = await this.prisma.product.findMany({
      where: { company },
      select: {
        id: true,
        sku: true,
        name: true,
        category: true,
        sellingPrice: true,
        currentStock: true,
      },
    });

    const products = allCompanyProducts
      .filter(
        (p) =>
          (p.name && p.name.toLowerCase().includes(searchString)) ||
          (p.sku && p.sku.toLowerCase().includes(searchString)) ||
          (p.category && p.category.toLowerCase().includes(searchString)),
      )
      .slice(0, 15);

    if (products.length === 0) return [];

    const productIds = products.map((p) => p.id);
    const availability = await this.fulfillment.availableStock(
      this.prisma,
      company,
      productIds,
    );
    return products.map((p) => ({ ...p, ...availability[p.id] }));
  }

  @Post('refresh-stock')
  @UseGuards(FulfillmentAuthGuard)
  async refreshStock(
    @Body() data: { company: string; productIds: number[] },
    @Req() request: FulfillmentRequest,
  ) {
    const company = String(request.headers['x-company']);
    const { productIds } = data;
    if (!company || !productIds || productIds.length === 0) return {};

    return this.fulfillment.availableStock(this.prisma, company, productIds);
  }

  @Get('shortages/all')
  async getShortages(@Query('company') company: string) {
     if (!company) throw new BadRequestException("Company is required");
     return await this.prisma.shortage.findMany({
       where: { company },
       include: { orderSlip: { include: { customer: true } } },
       orderBy: { createdAt: 'desc' }
     });
  }

  @Patch('shortages/:id/status')
  @LegacyCompanyRecord('shortage')
  async updateShortageStatus(@Param('id') id: string, @Body() body: any) {
     return await this.prisma.shortage.update({ where: { id }, data: { status: body.status } });
  }

  @Get('next-number')
  async getNextNumber(
    @Query('company') company: string,
    @Query('type') type = 'OS',
  ) {
    if (type !== 'OS' && type !== 'FO')
      throw new BadRequestException('Select OS or FO numbering.');
    return { osNumber: await nextDocumentNumber(this.prisma, type, company) };
  }

  @Post()
  @UseGuards(FulfillmentAuthGuard)
  async createOrderSlip(
    @Body()
    data: {
      customerId: string;
      items: {
        productId: unknown;
        requestedQty: unknown;
        sku?: string;
        unitPrice?: unknown;
      }[];
      isVatApplied: boolean;
      vatRate?: number;
      osNumber?: string;
      documentType?: 'OS' | 'FO';
      referenceOs?: string;
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
      osNumber: customOsNumber,
      referenceOs,
    } = data;

    if (!company || !customerId || !Array.isArray(items) || items.length === 0)
      throw new BadRequestException('Missing required fields.');
    if (customOsNumber !== undefined && typeof customOsNumber !== 'string')
      throw new BadRequestException('Invalid order number.');
    if (
      data.documentType !== undefined &&
      !['OS', 'FO'].includes(data.documentType)
    )
      throw new BadRequestException('Select OS or FO numbering.');
    if (
      data.documentType &&
      customOsNumber?.trim() &&
      !customOsNumber.trim().startsWith(data.documentType)
    )
      throw new BadRequestException(
        'The number must start with the selected document type.',
      );
    const kind =
      data.documentType ??
      (customOsNumber?.trim().startsWith('FO') ? 'FO' : 'OS');

    const save = async (tx: Prisma.TransactionClient, osNumber: string) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, company },
      });
      if (!customer) throw new NotFoundException('Customer record not found.');

      const productIds = items.map((i) => Number(i.productId));
      const dbProducts = await tx.product.findMany({
        where: { id: { in: productIds }, company },
      });

      let calculatedSubtotal = new Prisma.Decimal(0);
      const cleanItems: Prisma.OrderSlipItemUncheckedCreateWithoutOrderSlipInput[] =
        [];

      for (const item of items) {
        const requestedQty = Number(item.requestedQty);
        if (
          !item.productId ||
          !Number.isSafeInteger(requestedQty) ||
          requestedQty <= 0
        )
          throw new BadRequestException(
            `Invalid quantity for SKU: ${item.sku}`,
          );

        const product = dbProducts.find((p) => p.id === Number(item.productId));
        if (!product)
          throw new NotFoundException(`Product not found: ${item.sku}`);

        const unitPrice =
          Number(item.unitPrice) || Number(product.sellingPrice);
        const lineTotal = new Prisma.Decimal(requestedQty)
          .mul(unitPrice)
          .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
          .toNumber();

        calculatedSubtotal = calculatedSubtotal.add(lineTotal);
        cleanItems.push({
          productId: product.id,
          sku: product.sku,
          productName: product.name,
          requestedQty,
          unitPrice,
          lineTotal,
        });
      }

      const calculatedVat = isVatApplied
        ? calculatedSubtotal
            .mul(Number(vatRate))
            .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
            .toNumber()
        : 0;
      const calculatedGrandTotal =
        calculatedSubtotal
          .add(calculatedVat)
          .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
          .toNumber();

      const newOs = await tx.orderSlip.create({
        data: {
          osNumber,
          referenceOs: referenceOs || null,
          company,
          customerId,
          status: 'Generated',
          subtotal: calculatedSubtotal.toNumber(),
          vatApplied: isVatApplied,
          vatRate: Number(vatRate),
          vatAmount: calculatedVat,
          grandTotal: calculatedGrandTotal,
          createdBy: user,
          items: { create: cleanItems },
        },
        include: {
          items: { include: { product: { select: { currentStock: true } } } },
          customer: true,
        },
      });

      if (osNumber.startsWith('FO') || osNumber.startsWith('PL')) {
        await this.fulfillment.ensureDocumentDelivery(tx, company, user, {
          sourceType: osNumber.startsWith('FO') ? 'FO' : 'PL',
          sourceId: newOs.id,
          documentNumber: osNumber,
          referenceOs,
          customerId,
          items: cleanItems.map((item) => ({
            productId: item.productId,
            quantity: item.requestedQty,
          })),
        });
      }

      return {
        ...newOs,
        items: newOs.items.map((i: any) => ({
          ...i,
          officeStock: i.product?.currentStock || 0,
        })),
      };
    };
    return createNumberedDocument(
      this.prisma,
      kind,
      company,
      customOsNumber,
      save,
    );
  }

  @Get()
  async listOrderSlips(
    @Query('company') company: string, @Query('page') pageStr: string, @Query('limit') limitStr: string, @Query('search') search: string, @Query('status') status: string, @Query('startDate') startDate: string, @Query('endDate') endDate: string
  ) {
    if (!company) throw new BadRequestException('Company is required.');

    const page = Math.max(1, parseInt(pageStr) || 1);
    const limit = Math.max(1, parseInt(limitStr) || 15);
    const skip = (page - 1) * limit;
    const whereClause: Prisma.OrderSlipWhereInput = { company };

    if (status && status !== 'All') whereClause.status = status;
    if (search) {
      whereClause.OR = [
        { osNumber: { contains: search, mode: 'insensitive' } }, { referenceOs: { contains: search, mode: 'insensitive' } },
        { customerId: { contains: search, mode: 'insensitive' } }, { createdBy: { contains: search, mode: 'insensitive' } }, { customer: { name: { contains: search, mode: 'insensitive' } } }
      ];
    }
    if (startDate && endDate) {
      const start = new Date(startDate); start.setHours(0, 0, 0, 0);
      const end = new Date(endDate); end.setHours(23, 59, 59, 999);
      whereClause.createdAt = { gte: start, lte: end };
    }

    const [data, total] = await Promise.all([
      this.prisma.orderSlip.findMany({ where: whereClause, include: { customer: { select: { name: true, id: true } }, items: { include: { product: { select: { currentStock: true } } } } }, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      this.prisma.orderSlip.count({ where: whereClause })
    ]);

    const formattedData = data.map((os: any) => ({ ...os, items: os.items.map((i: any) => ({ ...i, officeStock: i.product?.currentStock || 0 })) }));
    return { data: formattedData, total, page, totalPages: Math.ceil(total / limit) };
  }

  @Get(':id')
  @LegacyCompanyRecord('orderSlip')
  async getOrderSlip(@Param('id') id: string) {
    const os = await this.prisma.orderSlip.findUnique({ where: { id }, include: { items: { include: { product: { select: { currentStock: true } } } }, customer: true } });
    if (!os) throw new NotFoundException('Order Slip not found.');
    return { ...os, items: os.items.map((i: any) => ({ ...i, officeStock: i.product?.currentStock || 0 })) };
  }

  @Patch(':id/process')
  @LegacyCompanyRecord('orderSlip')
  @UseGuards(FulfillmentAuthGuard)
  async processOrderSlip(
    @Param('id') id: string,
    @Body() body: any,
    @Req() request: FulfillmentRequest,
  ) {
    const { items } = body;
    const company = String(request.headers['x-company']);
    const user = request.user.username;
    return await this.mutate(async (tx) => {
      const os = await tx.orderSlip.findFirst({
        where: { id, company },
        include: { items: true },
      });
      if (!os) throw new NotFoundException('Order Slip not found');
      await this.fulfillment.assertOrderSlipMutable(tx, company, id);

      let hasShortage = false;
      for (const input of items) {
        const osItem = os.items.find((i: any) => i.id === input.id);
        if (!osItem) continue;

        const requestedQty = osItem.requestedQty;
        const physicalQty = Number(input.physicalQty) || 0;
        const shortageQty = Math.max(0, requestedQty - physicalQty);

        if (shortageQty > 0) hasShortage = true;
        await tx.orderSlipItem.update({
          where: { id: osItem.id },
          data: { confirmedQty: physicalQty, shortageQty },
        });

        if (shortageQty > 0) {
          await tx.shortage.create({
            data: {
              orderSlipId: os.id,
              orderSlipItemId: osItem.id,
              company: os.company,
              customerId: os.customerId,
              osNumber: os.osNumber,
              sku: osItem.sku,
              productName: osItem.productName,
              requestedQty: requestedQty,
              confirmedQty: physicalQty,
              shortageQty: shortageQty,
              status: 'Open',
              createdBy: user,
            },
          });
        }
      }

      await tx.orderSlip.update({
        where: { id },
        data: {
          status: hasShortage ? 'Partially Verified' : 'Verified',
          processedAt: new Date(),
        },
      });
      return { success: true };
    });
  }

  @Patch(':id')
  @LegacyCompanyRecord('orderSlip')
  @UseGuards(FulfillmentAuthGuard)
  async updateOrderSlip(
    @Param('id') id: string,
    @Body() data: any,
    @Req() request: FulfillmentRequest,
  ) {
    const {
      status,
      items,
      isVatApplied,
      vatRate = 0.12,
      customerId,
      referenceOs,
    } = data;
    const company = String(request.headers['x-company']);
    const user = request.user.username;
    return await this.mutate(async (tx) => {
      const existing = await tx.orderSlip.findFirst({
        where: { id, company },
        include: { items: true },
      });
      if (!existing) throw new NotFoundException('Order Slip not found.');
      if (existing.status === 'Cancelled')
        throw new BadRequestException('Cannot modify a cancelled Order Slip.');
      if (status === 'Approved' && existing.status !== 'Approved')
        throw new BadRequestException(
          'Use Approve & reserve to approve an Order Slip.',
        );
      const cancelled = status === 'Cancelled' || status === 'Returned';
      const outbound =
        existing.osNumber.startsWith('FO') ||
        existing.osNumber.startsWith('PL');
      const sourceType = existing.osNumber.startsWith('FO') ? 'FO' : 'PL';
      const managed = outbound
        ? cancelled
          ? await this.fulfillment.cancelDocument(
              tx,
              company,
              user,
              sourceType,
              id,
            )
          : await this.fulfillment.assertDocumentMutable(
              tx,
              company,
              sourceType,
              id,
            )
        : false;
      if (existing.osNumber.startsWith('OS')) {
        if (cancelled)
          await this.fulfillment.cancelOrderSlip(tx, company, user, id);
        else if (items || customerId || referenceOs !== undefined)
          await this.fulfillment.assertOrderSlipMutable(tx, company, id);
      }
      if (
        managed &&
        !cancelled &&
        (items || customerId || referenceOs !== undefined)
      ) {
        throw new BadRequestException(
          'This document is linked to delivery. Cancel the undispatched document and generate a replacement to change its items.',
        );
      }
      if (
        customerId &&
        !(await tx.customer.findFirst({ where: { id: customerId, company } }))
      )
        throw new NotFoundException('Customer record not found.');

      // RULE: Do not allow OS cancellation if FO exists.
      if (
        existing.osNumber.startsWith('OS') &&
        (status === 'Cancelled' || status === 'Returned')
      ) {
        const activeFo = await tx.orderSlip.findFirst({
          where: {
            company,
            referenceOs: existing.osNumber,
            status: { notIn: ['Cancelled', 'Returned'] },
          },
        });
        if (activeFo)
          throw new BadRequestException(
            `Cannot cancel OS. An active Final Order (${activeFo.osNumber}) exists. Cancel the Final Order first.`,
          );
      }

      // RULE: If FO is cancelled via patch, restore stock immediately.
      if (
        !managed &&
        existing.osNumber.startsWith('FO') &&
        cancelled &&
        existing.status !== 'Cancelled' &&
        existing.status !== 'Returned'
      ) {
        for (const item of existing.items) {
          await tx.product.update({
            where: { id: item.productId },
            data: { currentStock: { increment: item.requestedQty } },
          });
        }
      }

      if (items && Array.isArray(items)) {
        // RULE: Reconcile stock modifications if FO items are edited
        if (
          !managed &&
          (existing.osNumber.startsWith('FO') ||
            existing.osNumber.startsWith('PL')) &&
          !cancelled
        ) {
          for (const oldItem of existing.items) {
            await tx.product.update({
              where: { id: oldItem.productId },
              data: { currentStock: { increment: oldItem.requestedQty } },
            });
          }
        }

        await tx.orderSlipItem.deleteMany({ where: { orderSlipId: id } });
        const productIds = items.map((i: any) => Number(i.productId));
        const dbProducts = await tx.product.findMany({
          where: { id: { in: productIds }, company: existing.company },
        });

        let calculatedSubtotal = new Prisma.Decimal(0);
        const cleanItems: Prisma.OrderSlipItemUncheckedCreateWithoutOrderSlipInput[] =
          [];

        for (const item of items) {
          const requestedQty = Number(item.requestedQty);
          if (!item.productId || !requestedQty || requestedQty <= 0) continue;
          const product = dbProducts.find(
            (p) => p.id === Number(item.productId),
          );
          if (!product) continue;

          const unitPrice =
            Number(item.unitPrice) || Number(product.sellingPrice);
          const lineTotal = new Prisma.Decimal(requestedQty)
            .mul(unitPrice)
            .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
            .toNumber();
          calculatedSubtotal = calculatedSubtotal.add(lineTotal);
          cleanItems.push({
            productId: product.id,
            sku: product.sku,
            productName: product.name,
            requestedQty,
            unitPrice,
            lineTotal,
          });
        }

        // Apply new deductions if FO is edited
        if (
          !managed &&
          (existing.osNumber.startsWith('FO') ||
            existing.osNumber.startsWith('PL')) &&
          !cancelled
        ) {
          for (const newItem of cleanItems) {
            const product = await lockProduct(tx, company, newItem.productId);
            await assertLegacyStockFloor(
              tx,
              company,
              newItem.productId,
              'MASTER',
              product.currentStock - newItem.requestedQty,
            );
            await tx.product.update({
              where: { id: newItem.productId },
              data: { currentStock: { decrement: newItem.requestedQty } },
            });
          }
        }

        const applyVat =
          isVatApplied !== undefined ? isVatApplied : existing.vatApplied;
        const calculatedVat = applyVat
          ? calculatedSubtotal
              .mul(Number(vatRate))
              .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
              .toNumber()
          : 0;
        const calculatedGrandTotal =
          calculatedSubtotal
            .add(calculatedVat)
            .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
            .toNumber();

        const updatedOs = await tx.orderSlip.update({
          where: { id },
          data: {
            status: status || existing.status,
            referenceOs:
              referenceOs !== undefined ? referenceOs : existing.referenceOs,
            customerId: customerId || existing.customerId,
            updatedBy: user,
            subtotal: calculatedSubtotal.toNumber(),
            vatApplied: applyVat,
            vatAmount: calculatedVat,
            grandTotal: calculatedGrandTotal,
            items: { create: cleanItems },
          },
          include: {
            items: { include: { product: { select: { currentStock: true } } } },
            customer: true,
          },
        });
        return {
          ...updatedOs,
          items: updatedOs.items.map((i: any) => ({
            ...i,
            officeStock: i.product?.currentStock || 0,
          })),
        };
      }

      const updatedStatusOs = await tx.orderSlip.update({
        where: { id },
        data: {
          status,
          referenceOs:
            referenceOs !== undefined ? referenceOs : existing.referenceOs,
          customerId: customerId || existing.customerId,
          updatedBy: user,
        },
        include: {
          items: { include: { product: { select: { currentStock: true } } } },
          customer: true,
        },
      });

      return {
        ...updatedStatusOs,
        items: updatedStatusOs.items.map((i: any) => ({
          ...i,
          officeStock: i.product?.currentStock || 0,
        })),
      };
    });
  }

  @Delete(':id/cancel')
  @LegacyCompanyRecord('orderSlip')
  @UseGuards(FulfillmentAuthGuard)
  async cancelOrderSlip(
    @Param('id') id: string,
    @Req() request: FulfillmentRequest,
  ) {
    const company = String(request.headers['x-company']);
    const user = request.user.username;
    return await this.mutate(async (tx) => {
      const existing = await tx.orderSlip.findFirst({
        where: { id, company },
        include: { items: true },
      });
      if (!existing) throw new NotFoundException('Order Slip not found.');
      if (existing.status === 'Cancelled' || existing.status === 'Returned')
        return existing;
      const outbound =
        existing.osNumber.startsWith('FO') ||
        existing.osNumber.startsWith('PL');
      const managed = outbound
        ? await this.fulfillment.cancelDocument(
            tx,
            company,
            user,
            existing.osNumber.startsWith('FO') ? 'FO' : 'PL',
            id,
          )
        : false;

      if (existing.osNumber.startsWith('OS')) {
        const activeFo = await tx.orderSlip.findFirst({
          where: {
            company,
            referenceOs: existing.osNumber,
            status: { notIn: ['Cancelled', 'Returned'] },
          },
        });
        if (activeFo)
          throw new BadRequestException(
            `Cannot cancel OS. An active Final Order (${activeFo.osNumber}) exists. Cancel the Final Order first.`,
          );
        await this.fulfillment.cancelOrderSlip(tx, company, user, id);
      }

      if (!managed && existing.osNumber.startsWith('FO')) {
        for (const item of existing.items) {
          await tx.product.update({
            where: { id: item.productId },
            data: { currentStock: { increment: item.requestedQty } },
          });
        }
      }

      const cancelledOrder = await tx.orderSlip.update({
        where: { id },
        data: { status: 'Cancelled', updatedBy: user },
      });
      return { ...cancelledOrder, deliveryManaged: managed };
    });
  }

  @Delete(':id')
  @LegacyCompanyRecord('orderSlip')
  @UseGuards(FulfillmentAuthGuard)
  async hardDeleteOrderSlip(
    @Param('id') id: string,
    @Req() request: FulfillmentRequest,
  ) {
    const company = String(request.headers['x-company']);
    const user = request.user.username;
    return await this.mutate(async (tx) => {
      const existing = await tx.orderSlip.findFirst({
        where: { id, company },
        include: { items: true },
      });
      if (!existing) throw new NotFoundException('Order Slip not found.');
      const outbound =
        existing.osNumber.startsWith('FO') ||
        existing.osNumber.startsWith('PL');
      const managed = outbound
        ? await this.fulfillment.cancelDocument(
            tx,
            company,
            user,
            existing.osNumber.startsWith('FO') ? 'FO' : 'PL',
            id,
          )
        : false;

      if (existing.osNumber.startsWith('OS')) {
        const linkedFo = await tx.orderSlip.findFirst({
          where: { company, referenceOs: existing.osNumber },
        });
        if (linkedFo)
          throw new BadRequestException(
            `Cannot delete OS. A Final Order (${linkedFo.osNumber}) is tied to it. Delete the Final Order first.`,
          );
        await this.fulfillment.cancelOrderSlip(tx, company, user, id);
      }

      if (
        !managed &&
        existing.osNumber.startsWith('FO') &&
        existing.status !== 'Cancelled' &&
        existing.status !== 'Returned'
      ) {
        for (const item of existing.items) {
          await tx.product.update({
            where: { id: item.productId },
            data: { currentStock: { increment: item.requestedQty } },
          });
        }
      }

      await tx.orderSlipItem.deleteMany({ where: { orderSlipId: id } });
      return await tx.orderSlip.delete({ where: { id } });
    });
  }
}
