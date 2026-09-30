import { Controller, Get, Post, Patch, Delete, Body, Param, Query, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Controller('procurement')
export class ProcurementController {
  private readonly prisma = new PrismaClient();

  // ==========================================
  // 1. SUPPLIERS WORKFLOW
  // ==========================================

  @Post('suppliers')
  async createSupplier(@Body() data: any) {
    const { company, legalName, tradeName, tin, address, contactPerson, phone, email, paymentTerms } = data;

    if (!company || !legalName || !tin || !address) {
      throw new BadRequestException('Company, Legal Name, TIN, and Address are required.');
    }

    const existing = await this.prisma.supplier.findFirst({
      where: { tin, company }
    });

    if (existing) {
      throw new ConflictException('A supplier with this TIN already exists.');
    }

    return await this.prisma.supplier.create({
      data: {
        company, legalName, tradeName: tradeName || null, tin, address,
        contactPerson: contactPerson || null, phone: phone || null, email: email || null,
        paymentTerms: paymentTerms || 'Cash on Delivery', apBalance: 0
      }
    });
  }

  @Get('suppliers')
  async listSuppliers(@Query('company') company: string) {
    if (!company) throw new BadRequestException('Company is required.');
    return await this.prisma.supplier.findMany({
      where: { company },
      orderBy: { legalName: 'asc' }
    });
  }

  @Patch('suppliers/:id')
  async updateSupplier(@Param('id') id: string, @Body() data: any) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw new NotFoundException('Supplier not found.');

    const { legalName, tradeName, tin, address, contactPerson, phone, email, paymentTerms } = data;
    return await this.prisma.supplier.update({
      where: { id },
      data: { legalName, tradeName, tin, address, contactPerson, phone, email, paymentTerms }
    });
  }

  @Delete('suppliers/:id')
  async deleteSupplier(@Param('id') id: string) {
    const supplier = await this.prisma.supplier.findUnique({ 
      where: { id },
      include: { purchaseOrders: true }
    });
    
    if (!supplier) throw new NotFoundException('Supplier not found.');
    if (supplier.purchaseOrders && supplier.purchaseOrders.length > 0) {
      throw new BadRequestException('Cannot delete a supplier that has existing Purchase Orders.');
    }

    return await this.prisma.supplier.delete({ where: { id } });
  }

  // ==========================================
  // 2. PURCHASE ORDERS WORKFLOW
  // ==========================================

  @Get('purchase-orders/next-po-number')
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

  @Post('purchase-orders')
  async createPurchaseOrder(@Body() data: any) {
    const { company, items, isVatApplied, vatRate = 0.12, user, osReference, poNumber, supplierId } = data;

    if (!company || !items || items.length === 0 || !poNumber) {
      throw new BadRequestException('Missing required fields.');
    }

    const existing = await this.prisma.purchaseOrder.findUnique({ where: { poNumber } });
    if (existing) throw new BadRequestException(`P.O. Number ${poNumber} already exists!`);

    if (supplierId) {
      const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId } });
      if (!supplier) throw new BadRequestException('The selected supplier does not exist.');
    }

    return await this.prisma.$transaction(async (tx) => {
      let calculatedSubtotal = 0;
      
      const cleanItems = items.map((item: any) => {
        const lineTotal = Math.round((Number(item.requestedQty) * Number(item.unitCost)) * 100) / 100;
        calculatedSubtotal += lineTotal;
        
        return {
          productId: Number(item.productId), // Safely parsing the 32-bit integer generated on frontend
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
          supplierId: supplierId || null, 
          items: { create: cleanItems }
        },
        include: { items: true }
      });
    });
  }

  @Get('purchase-orders')
  async listPurchaseOrders(@Query('company') company: string) {
    if (!company) throw new BadRequestException('Company is required.');
    
    const pos = await this.prisma.purchaseOrder.findMany({
      where: { company },
      include: { 
        items: true,
        supplier: true 
      },
      orderBy: { createdAt: 'desc' },
    });

    return pos.map(po => ({
      ...po,
      supplierName: po.supplier ? po.supplier.legalName : null
    }));
  }

  @Post('purchase-orders/:id/receive')
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

  @Patch('suppliers/:id/catalog')
  async updateSupplierCatalog(@Param('id') id: string, @Body() data: { catalog: any[] }) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw new NotFoundException('Supplier not found.');

    return await this.prisma.supplier.update({
      where: { id },
      data: { catalog: data.catalog }
    });
  }

  // --- ADD THIS AT THE BOTTOM OF THE FILE ---
  @Patch('purchase-orders/:id/status')
  async updatePurchaseOrderStatus(@Param('id') id: string, @Body() data: { status: string; user: string }) {
    const existing = await this.prisma.purchaseOrder.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('P.O. not found.');

    return await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: data.status, updatedBy: data.user }
    });
  }

  @Delete('purchase-orders/:id/cancel')
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

  @Delete('purchase-orders/:id')
  async hardDeletePurchaseOrder(@Param('id') id: string) {
    return this.prisma.purchaseOrder.delete({ where: { id } });
  }
}