import { Controller, Get, Post, Patch, Delete, Body, Param, Query, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Controller('procurement/purchase-orders')
export class PurchaseOrdersController {
  private readonly prisma = new PrismaClient();
  
  // --- FETCH NEXT P.O. NUMBER ---
  @Get('next-po-number')
  async getNextPoNumber(@Query('company') company: string) {
    const lastPo = await this.prisma.purchaseOrder.findFirst({
      where: { company },
      orderBy: { createdAt: 'desc' }
    });
    
    let nextNum = 1;
    if (lastPo && lastPo.poNumber.match(/(\d+)$/)) {
      const match = lastPo.poNumber.match(/(\d+)$/);
      if (match) {
        nextNum = parseInt(match[0], 10) + 1;
        const prefix = lastPo.poNumber.substring(0, match.index);
        const padding = match[0].length;
        return { poNumber: `${prefix}${String(nextNum).padStart(padding, '0')}` };
      }
    }
    return { poNumber: 'PO-000001' };
  }

  // --- CREATE PURCHASE ORDER WITH SUPPLIER LINKAGE ---
  @Post()
  async createPurchaseOrder(@Body() data: any) {
    const { company, items, isVatApplied, vatRate = 0.12, user, osReference, poNumber, supplierId } = data;

    if (!company || !items || items.length === 0 || !poNumber) {
      throw new BadRequestException('Missing required fields.');
    }

    // Prevent duplicates
    const existing = await this.prisma.purchaseOrder.findUnique({ where: { poNumber } });
    if (existing) throw new BadRequestException(`P.O. Number ${poNumber} already exists!`);

    // Verify and fetch supplier details if a supplierId is provided
    let supplierName: string | null = null; // FIX: Explicitly type as string OR null
    
    if (supplierId) {
      const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId } });
      if (!supplier) throw new BadRequestException('The selected supplier does not exist.');
      supplierName = supplier.legalName;
    }

    return await this.prisma.$transaction(async (tx) => {
      let calculatedSubtotal = 0;
      const cleanItems = items.map((item: any) => {
        const lineTotal = Math.round((Number(item.requestedQty) * Number(item.unitCost)) * 100) / 100;
        calculatedSubtotal += lineTotal;
        return {
          productId: Number(item.productId),
          sku: item.sku,
          productName: item.productName,
          requestedQty: Number(item.requestedQty),
          unitCost: Number(item.unitCost),
          lineTotal
        };
      });

      calculatedSubtotal = Math.round(calculatedSubtotal * 100) / 100;
      const calculatedVat = isVatApplied ? Math.round((calculatedSubtotal * Number(vatRate)) * 100) / 100 : 0;
      const calculatedGrandTotal = Math.round((calculatedSubtotal + calculatedVat) * 100) / 100;

      return await tx.purchaseOrder.create({
        data: {
          poNumber, 
          company, 
          osReference, 
          status: 'Generated', 
          subtotal: calculatedSubtotal, 
          vatApplied: isVatApplied,
          vatRate: Number(vatRate), 
          vatAmount: calculatedVat, 
          grandTotal: calculatedGrandTotal,
          createdBy: user,
          supplierId: supplierId || null, // Link to Supplier ID
          supplierName: supplierName,     // Store the name directly for fast querying
          items: { create: cleanItems }
        },
        include: { items: true }
      });
    });
  }

  // --- LIST ALL PURCHASE ORDERS ---
  @Get()
  async listPurchaseOrders(@Query('company') company: string) {
    if (!company) throw new BadRequestException('Company is required.');
    return await this.prisma.purchaseOrder.findMany({
      where: { company },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  // --- RECEIVE PURCHASE ORDER ---
  @Post(':id/receive')
  async receivePurchaseOrder(@Param('id') id: string, @Body() data: any) {
    const { user, verifications } = data; 
    return await this.prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
      if (!po) throw new NotFoundException('P.O. not found.');
      if (po.status === 'Cancelled') throw new BadRequestException('Cannot receive a cancelled P.O.');

      let hasShortage = false;

      for (const v of verifications) {
        const item = po.items.find(i => i.id === v.itemId);
        if (!item) continue;

        const requested = item.requestedQty;
        const confirmed = Math.max(0, Number(v.confirmedQty) || 0);
        const shortage = Math.max(0, requested - confirmed);

        await tx.purchaseOrderItem.update({
          where: { id: item.id },
          data: { confirmedQty: confirmed, shortageQty: shortage }
        });

        if (shortage > 0) {
          hasShortage = true;
          await tx.shortage.create({
            data: {
              company: po.company,
              poNumber: po.poNumber,
              purchaseOrderId: po.id,
              purchaseOrderItemId: item.id,
              sku: item.sku,
              productName: item.productName,
              requestedQty: requested,
              confirmedQty: confirmed,
              shortageQty: shortage,
              status: 'Pending Purchase',
              createdBy: user
            }
          });
        }
      }

      const newStatus = hasShortage ? 'Partially Received' : 'Received';
      return await tx.purchaseOrder.update({
        where: { id },
        data: { status: newStatus, updatedBy: user, receivedAt: new Date() },
        include: { items: true }
      });
    });
  }

  // --- CANCEL PURCHASE ORDER ---
  @Delete(':id/cancel')
  async cancelPurchaseOrder(@Param('id') id: string, @Body('user') user: string) {
    return this.prisma.$transaction(async tx => {
      const existing = await tx.purchaseOrder.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('P.O. not found.');
      await tx.shortage.updateMany({
        where: { purchaseOrderId: id, status: { notIn: ['Fulfilled', 'Cancelled'] } },
        data: { status: 'Cancelled', updatedBy: user },
      });
      return tx.purchaseOrder.update({ where: { id }, data: { status: 'Cancelled', updatedBy: user } });
    });
  }

  // --- HARD DELETE PURCHASE ORDER ---
  @Delete(':id')
  async hardDeletePurchaseOrder(@Param('id') id: string) {
    return this.prisma.purchaseOrder.delete({ where: { id } });
  }
}