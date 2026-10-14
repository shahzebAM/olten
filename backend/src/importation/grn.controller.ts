import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query,
  BadRequestException, NotFoundException,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function padSeq(n: number) { return String(n).padStart(6, '0'); }

async function nextRefNumber(
  prefix: string,
  finder: (year: number) => Promise<{ [k: string]: unknown } | null>,
): Promise<string> {
  const year = new Date().getFullYear();
  const last = await finder(year);
  if (!last) return `${prefix}-${year}-000001`;
  const rec = last as Record<string, string>;
  const field = Object.keys(rec).find((k) => typeof rec[k] === 'string' && rec[k].startsWith(`${prefix}-${year}-`)) ?? '';
  const seq = parseInt((rec[field] ?? '').split('-').pop() ?? '0', 10);
  return `${prefix}-${year}-${padSeq(seq + 1)}`;
}

// ==========================================
// GOODS RECEIPT CONTROLLER  (GRN-YYYY-XXXXXX)
// ==========================================
@Controller('importation/grn')
export class GoodsReceiptController {
  @Get('next-number')
  async nextGrnNumber(@Query('company') company: string) {
    if (!company) throw new BadRequestException('company is required');
    const grnNumber = await nextRefNumber('GRN', (year) =>
      prisma.goodsReceipt.findFirst({
        where: { company, grnNumber: { startsWith: `GRN-${year}-` } },
        orderBy: { grnNumber: 'desc' },
        select: { grnNumber: true },
      }),
    );
    return { grnNumber };
  }

  @Post()
  async create(@Body() body: any) {
    const { shipmentId, company, receivedBy, remarks, lines } = body;
    if (!shipmentId || !company || !receivedBy) throw new BadRequestException('shipmentId, company and receivedBy are required');

    const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
    if (!shipment) throw new NotFoundException('Shipment not found');

    const grnNumber = await nextRefNumber('GRN', (year) =>
      prisma.goodsReceipt.findFirst({
        where: { company, grnNumber: { startsWith: `GRN-${year}-` } },
        orderBy: { grnNumber: 'desc' },
        select: { grnNumber: true },
      }),
    );

    return prisma.goodsReceipt.create({
      data: {
        grnNumber, shipmentId, company, receivedBy,
        remarks: remarks ?? null,
        status: 'Draft',
        lines: lines?.length
          ? {
              create: (lines as any[]).map((l) => ({
                poId: l.poId ?? null,
                poItemId: l.poItemId ?? null,
                productId: l.productId ? Number(l.productId) : null,
                sku: l.sku,
                productName: l.productName,
                batchNumber: l.batchNumber ?? null,
                expirationDate: l.expirationDate ? new Date(l.expirationDate) : null,
                orderedQty: Number(l.orderedQty ?? 0),
                shippedQty: Number(l.shippedQty ?? 0),
                clearedQty: Number(l.clearedQty ?? 0),
                receivedQty: Number(l.receivedQty ?? 0),
                acceptedQty: Number(l.acceptedQty ?? 0),
                rejectedQty: Number(l.rejectedQty ?? 0),
                qcStatus: l.qcStatus ?? 'Pending',
                qcNotes: l.qcNotes ?? null,
                photoUrls: l.photoUrls ?? [],
                quarantineStatus: l.quarantineStatus ?? null,
                quarantineReason: l.quarantineReason ?? null,
              })),
            }
          : undefined,
      },
      include: { lines: true },
    });
  }

  @Get()
  async list(@Query('shipmentId') shipmentId?: string, @Query('company') company?: string) {
    const where = shipmentId ? { shipmentId } : company ? { company } : undefined;
    if (!where) throw new BadRequestException('shipmentId or company is required');
    return prisma.goodsReceipt.findMany({
      where,
      include: { lines: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const grn = await prisma.goodsReceipt.findUnique({ where: { id }, include: { lines: true } });
    if (!grn) throw new NotFoundException('GRN not found');
    return grn;
  }

  @Patch(':id')
  async updateHeader(@Param('id') id: string, @Body() body: any) {
    const grn = await prisma.goodsReceipt.findUnique({ where: { id } });
    if (!grn) throw new NotFoundException('GRN not found');
    if (grn.status === 'Completed') throw new BadRequestException('Cannot edit a completed GRN.');
    return prisma.goodsReceipt.update({
      where: { id },
      data: {
        status: body.status ?? grn.status,
        remarks: body.remarks ?? grn.remarks,
        receivedBy: body.receivedBy ?? grn.receivedBy,
      },
      include: { lines: true },
    });
  }

  // ---- GRN LINES ----

  @Post(':grnId/lines')
  async addLine(@Param('grnId') grnId: string, @Body() body: any) {
    const grn = await prisma.goodsReceipt.findUnique({ where: { id: grnId } });
    if (!grn) throw new NotFoundException('GRN not found');
    if (grn.status === 'Completed') throw new BadRequestException('Cannot add lines to a completed GRN.');

    if (!body.sku || !body.productName) throw new BadRequestException('sku and productName are required');

    return prisma.goodsReceiptLine.create({
      data: {
        grnId,
        poId: body.poId ?? null,
        poItemId: body.poItemId ?? null,
        productId: body.productId ? Number(body.productId) : null,
        sku: body.sku,
        productName: body.productName,
        batchNumber: body.batchNumber ?? null,
        expirationDate: body.expirationDate ? new Date(body.expirationDate) : null,
        orderedQty: Number(body.orderedQty ?? 0),
        shippedQty: Number(body.shippedQty ?? 0),
        clearedQty: Number(body.clearedQty ?? 0),
        receivedQty: Number(body.receivedQty ?? 0),
        acceptedQty: Number(body.acceptedQty ?? 0),
        rejectedQty: Number(body.rejectedQty ?? 0),
        qcStatus: body.qcStatus ?? 'Pending',
        qcNotes: body.qcNotes ?? null,
        photoUrls: body.photoUrls ?? [],
        quarantineStatus: body.quarantineStatus ?? null,
        quarantineReason: body.quarantineReason ?? null,
      },
    });
  }

  @Patch(':grnId/lines/:lineId')
  async updateLine(
    @Param('grnId') grnId: string,
    @Param('lineId') id: string,
    @Body() body: any,
  ) {
    const line = await prisma.goodsReceiptLine.findFirst({ where: { id, grnId } });
    if (!line) throw new NotFoundException('GRN line not found');

    const { receivedQty, acceptedQty, rejectedQty, qcStatus, qcNotes, photoUrls, quarantineStatus, quarantineReason, batchNumber, expirationDate } = body;

    return prisma.goodsReceiptLine.update({
      where: { id },
      data: {
        receivedQty: receivedQty != null ? Number(receivedQty) : line.receivedQty,
        acceptedQty: acceptedQty != null ? Number(acceptedQty) : line.acceptedQty,
        rejectedQty: rejectedQty != null ? Number(rejectedQty) : line.rejectedQty,
        qcStatus: qcStatus ?? line.qcStatus,
        qcNotes: qcNotes ?? line.qcNotes,
        photoUrls: photoUrls ?? line.photoUrls,
        quarantineStatus: quarantineStatus !== undefined ? quarantineStatus : line.quarantineStatus,
        quarantineReason: quarantineReason !== undefined ? quarantineReason : line.quarantineReason,
        batchNumber: batchNumber ?? line.batchNumber,
        expirationDate: expirationDate ? new Date(expirationDate) : line.expirationDate,
      },
    });
  }

  @Delete(':grnId/lines/:lineId')
  async removeLine(@Param('grnId') grnId: string, @Param('lineId') id: string) {
    const line = await prisma.goodsReceiptLine.findFirst({ where: { id, grnId } });
    if (!line) throw new NotFoundException('GRN line not found');
    await prisma.goodsReceiptLine.delete({ where: { id } });
    return { message: 'Line deleted' };
  }

  /**
   * Complete a GRN: validates quantities, pushes accepted lines to
   * MasterInventory receiving queue (InventoryMovement RECEIVE records
   * and increments Product.currentStock), and locks rejected lines in quarantine.
   */
  @Post(':id/complete')
  async complete(@Param('id') id: string, @Body() body: { completedBy: string }) {
    if (!body?.completedBy) throw new BadRequestException('completedBy is required');

    return prisma.$transaction(async (tx) => {
      const grn = await tx.goodsReceipt.findUnique({ where: { id }, include: { lines: true } });
      if (!grn) throw new NotFoundException('GRN not found');
      if (grn.status === 'Completed') throw new BadRequestException('GRN is already completed.');
      if (grn.status === 'Cancelled') throw new BadRequestException('Cannot complete a cancelled GRN.');

      for (const line of grn.lines) {
        if (line.pushedToInventory) continue;

        // Push accepted qty into MasterInventory as a RECEIVE movement
        if (line.acceptedQty > 0 && line.productId) {
          const product = await tx.product.findUnique({ where: { id: line.productId } });
          if (product) {
            const previousStock = product.currentStock;
            const newStock = previousStock + line.acceptedQty;

            await tx.product.update({
              where: { id: line.productId },
              data: { currentStock: newStock },
            });

            await tx.inventoryMovement.create({
              data: {
                company: grn.company,
                productId: line.productId,
                productName: line.productName,
                sku: line.sku,
                type: 'RECEIVE',
                quantity: line.acceptedQty,
                previousStock,
                newStock,
                reference: grn.grnNumber,
                remarks: `GRN Receipt — Batch: ${line.batchNumber ?? 'N/A'}`,
                user: body.completedBy,
                batchNumber: line.batchNumber ?? null,
                expirationDate: line.expirationDate ?? null,
              },
            });
          }
        }

        // Lock rejected qty in quarantine
        const updates: Record<string, unknown> = { pushedToInventory: true, pushedAt: new Date() };
        if (line.rejectedQty > 0 && !line.quarantineStatus) {
          updates.quarantineStatus = 'Hold';
          updates.qcStatus = line.qcStatus === 'Pending' ? 'Failed' : line.qcStatus;
        }

        await tx.goodsReceiptLine.update({ where: { id: line.id }, data: updates });
      }

      return tx.goodsReceipt.update({
        where: { id },
        data: { status: 'Completed' },
        include: { lines: true },
      });
    });
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const grn = await prisma.goodsReceipt.findUnique({ where: { id } });
    if (!grn) throw new NotFoundException('GRN not found');
    if (grn.status === 'Completed') throw new BadRequestException('Cannot delete a completed GRN.');
    await prisma.goodsReceipt.delete({ where: { id } });
    return { message: 'GRN deleted' };
  }
}
