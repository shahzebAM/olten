import {
  BadRequestException,
  Body,
  CanActivate,
  ConflictException,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Headers,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { AuthSessionService } from '../auth/auth-session.service';
import { companyToday } from '../documentation/expiry-date.utils';
import {
  lockProduct,
  recordReceiptLot,
} from '../fulfillment/fulfillment.stock';

@Injectable()
export class ReceivingAuthGuard implements CanActivate {
  constructor(private readonly sessions: AuthSessionService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const user = await this.sessions.authenticate(
      request.headers.authorization,
    );
    const rawCompany = request.headers['x-company'];
    if (
      typeof rawCompany !== 'string' ||
      !rawCompany.trim() ||
      rawCompany.length > 100
    ) {
      throw new BadRequestException('A valid company header is required.');
    }
    const company = rawCompany.trim();
    const modules = (
      user.modules &&
      typeof user.modules === 'object' &&
      !Array.isArray(user.modules)
        ? user.modules
        : {}
    ) as Record<string, unknown>;
    const companies = (
      modules.companies &&
      typeof modules.companies === 'object' &&
      !Array.isArray(modules.companies)
        ? modules.companies
        : {}
    ) as Record<string, unknown>;
    if (
      user.role !== 'Super Admin' &&
      ((modules.inventory !== true &&
        modules.master_inventory !== true &&
        modules.warehouses !== true &&
        modules.warehouse !== true &&
        modules.importation !== true) ||
        companies[company] !== true)
    ) {
      throw new ForbiddenException(
        'You do not have receiving access in this workspace.',
      );
    }
    if (!(await this.sessions.companyExists(company)))
      throw new ForbiddenException('This workspace is unavailable.');
    request.headers['x-company'] = company;
    request.headers['x-username'] = user.username;
    return true;
  }
}

type Placement = {
  receiptLineId: string;
  warehouseId: string;
  quantity: number;
  binId?: string;
  serialNumber?: string;
};

@Controller('importation')
@UseGuards(ReceivingAuthGuard)
export class ImportReceivingController implements OnModuleDestroy {
  private readonly prisma = new PrismaClient();

  @Get('receiving-queue')
  async queue(@Headers('x-company') company: string) {
    const receipts = await this.prisma.goodsReceipt.findMany({
      where: { company },
      include: {
        shipment: true,
        items: {
          include: {
            shipmentLine: {
              include: {
                purchaseOrderItem: {
                  include: { po: { include: { supplier: true } } },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return receipts
      .map((receipt) => ({
        id: receipt.id,
        goodsReceiptId: receipt.id,
        poNumber: receipt.grnNumber,
        osReference: receipt.shipment.shipmentNumber,
        status: 'QC Accepted',
        supplierName: [
          ...new Set(
            receipt.items
              .map(
                (item) =>
                  item.shipmentLine.purchaseOrderItem.po.supplier?.legalName,
              )
              .filter(Boolean),
          ),
        ].join(', '),
        items: receipt.items
          .filter((item) => item.acceptedQty > item.placedQty)
          .map((item) => ({
            id: item.id,
            productId: item.shipmentLine.purchaseOrderItem.productId,
            sku: item.shipmentLine.purchaseOrderItem.sku,
            productName: item.shipmentLine.purchaseOrderItem.productName,
            confirmedQty: item.acceptedQty - item.placedQty,
            batchNumber: item.batchNumber,
            expirationDate: item.expirationDate,
          })),
      }))
      .filter((receipt) => receipt.items.length > 0);
  }

  @Post('receipts/:id/place')
  async place(
    @Param('id') id: string,
    @Headers('x-company') company: string,
    @Headers('x-username') username: string,
    @Body() body: { placements: Placement[] },
  ) {
    if (
      !Array.isArray(body?.placements) ||
      !body.placements.length ||
      body.placements.length > 500
    ) {
      throw new BadRequestException(
        'At least one stock placement is required (maximum 500).',
      );
    }
    const ids = new Set<string>();
    for (const placement of body.placements) {
      if (
        !placement ||
        typeof placement.receiptLineId !== 'string' ||
        !placement.receiptLineId ||
        (placement.binId !== undefined &&
          (typeof placement.binId !== 'string' || !placement.binId.trim())) ||
        (placement.serialNumber !== undefined &&
          (typeof placement.serialNumber !== 'string' ||
            !placement.serialNumber.trim() ||
            placement.serialNumber.length > 150)) ||
        ids.has(placement.receiptLineId) ||
        !Number.isSafeInteger(placement.quantity) ||
        placement.quantity <= 0 ||
        placement.quantity > 2147483647 ||
        typeof placement.warehouseId !== 'string' ||
        (placement.warehouseId !== 'MASTER' &&
          (!/^[1-9]\d*$/.test(placement.warehouseId) ||
            !Number.isSafeInteger(Number(placement.warehouseId)) ||
            Number(placement.warehouseId) > 2147483647))
      ) {
        throw new BadRequestException(
          'Each placement needs a unique receipt line, positive whole quantity and valid facility.',
        );
      }
      ids.add(placement.receiptLineId);
    }
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const receipt = await tx.goodsReceipt.findFirst({
            where: { id, company },
            include: {
              items: {
                include: {
                  shipmentLine: { include: { purchaseOrderItem: true } },
                },
              },
            },
          });
          if (!receipt)
            throw new NotFoundException(
              'Goods receipt not found in this workspace.',
            );
          for (const placement of body.placements) {
            const item = receipt.items.find(
              (line) => line.id === placement.receiptLineId,
            );
            if (!item)
              throw new BadRequestException(
                'Receipt line does not belong to this receipt.',
              );
            if (placement.quantity > item.acceptedQty - item.placedQty) {
              throw new ConflictException(
                'Only accepted, unplaced quantities can enter stock. Refresh the receiving queue.',
              );
            }
            if (item.expirationDate && item.expirationDate < companyToday()) {
              throw new BadRequestException(
                'Expired goods cannot be placed into available stock.',
              );
            }
            const product = await tx.product.findFirst({
              where: {
                id: item.shipmentLine.purchaseOrderItem.productId,
                company,
                deletedAt: null,
                isActive: true,
              },
            });
            if (!product)
              throw new BadRequestException(
                'An active master catalog product is required for every placement.',
              );
            await lockProduct(tx, company, product.id);
            const claimed = await tx.goodsReceiptLine.updateMany({
              where: {
                id: item.id,
                placedQty: item.placedQty,
                acceptedQty: item.acceptedQty,
              },
              data: { placedQty: { increment: placement.quantity } },
            });
            if (claimed.count !== 1)
              throw new ConflictException(
                'This receipt changed. Refresh and try again.',
              );
            let previousStock: number;
            let newStock: number;
            let warehouseId: number | null = null;
            let warehouseStockId: string | null = null;
            if (placement.warehouseId === 'MASTER') {
              const updated = await tx.product.update({
                where: { id: product.id },
                data: { currentStock: { increment: placement.quantity } },
              });
              newStock = updated.currentStock;
              previousStock = newStock - placement.quantity;
            } else {
              warehouseId = Number(placement.warehouseId);
              const warehouse = await tx.warehouse.findFirst({
                where: { id: warehouseId, company, status: 'Active' },
              });
              if (!warehouse)
                throw new BadRequestException(
                  'An active warehouse in this workspace is required.',
                );
              const stock = await tx.warehouseStock.upsert({
                where: {
                  warehouseId_productId: {
                    warehouseId: placement.warehouseId,
                    productId: product.id,
                  },
                },
                create: {
                  company,
                  warehouseId: placement.warehouseId,
                  productId: product.id,
                  sku: product.sku,
                  quantity: placement.quantity,
                },
                update: {
                  quantity: { increment: placement.quantity },
                  lastUpdated: new Date(),
                },
              });
              if (stock.company !== company)
                throw new ConflictException(
                  'Warehouse balance belongs to another workspace.',
                );
              newStock = stock.quantity;
              previousStock = newStock - placement.quantity;
              warehouseStockId = stock.id;
            }
            const lot = await recordReceiptLot(tx, company, username, {
              productId: product.id,
              warehouseId: placement.warehouseId,
              warehouseStockId,
              binId: placement.binId,
              receiptLineId: item.id,
              quantity: placement.quantity,
              batchNumber: item.batchNumber,
              expirationDate: item.expirationDate?.toISOString().slice(0, 10),
              serialNumber: placement.serialNumber?.trim(),
            });
            await tx.inventoryMovement.create({
              data: {
                company,
                productId: product.id,
                productName: product.name,
                sku: product.sku,
                type: 'RECEIVE',
                quantity: placement.quantity,
                previousStock,
                newStock,
                reference: receipt.grnNumber,
                remarks: 'QC accepted import receipt',
                user: username,
                warehouseId,
                batchNumber: item.batchNumber,
                expirationDate: item.expirationDate,
                lotId: lot.id,
                binId: lot.binId,
                serialNumber: lot.serialNumber,
              },
            });
          }
          return { success: true, grnNumber: receipt.grnNumber };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2034' || error.code === 'P2002')
      ) {
        throw new ConflictException(
          'Stock changed during placement. Refresh and try again.',
        );
      }
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
