import { Controller, Get, Post, Patch, Delete, Body, Param, Query, BadRequestException, NotFoundException, ConflictException, UseGuards } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { LegacyCompanyRecord, LegacyErpAccess, LegacyErpAuthGuard, LegacyReadModules, LegacyWriteModules } from '../auth/legacy-erp-auth.guard';
import {
  createNumberedDocument,
  nextDocumentNumber,
} from './document-numbering';

@Controller('procurement')
@UseGuards(LegacyErpAuthGuard)
@LegacyErpAccess('purchasing')
export class ProcurementController {
  private readonly prisma = new PrismaClient();

  private async importSafeTransaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    try {
      return await this.prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        Array.isArray(error.meta?.target) &&
        error.meta.target.includes('poNumber')
      ) {
        throw new ConflictException(
          'That P.O. number was already saved. Refresh the next number or enter another number.',
        );
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        throw new ConflictException(
          'The P.O. changed during processing. Refresh and try again.',
        );
      }
      throw error;
    }
  }

  private async requireLegacyReceiving(
    client: Prisma.TransactionClient,
    id: string,
  ) {
    const imported = await client.purchaseOrder.findFirst({
      where: {
        id,
        OR: [
          { requisition: { isNot: null } },
          { items: { some: { shipmentLines: { some: {} } } } },
        ],
      },
      select: { id: true },
    });
    if (imported)
      throw new BadRequestException(
        'This P.O. is managed by Importation. Use shipment GRN and QC receiving.',
      );
  }

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
  @LegacyCompanyRecord('supplier')
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
  @LegacyCompanyRecord('supplier')
  async deleteSupplier(@Param('id') id: string) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const supplier = await tx.supplier.findUnique({
            where: { id },
            include: { purchaseOrders: true },
          });
          if (!supplier) throw new NotFoundException('Supplier not found.');
          if (supplier.purchaseOrders.length > 0)
            throw new BadRequestException(
              'Cannot delete a supplier that has existing Purchase Orders.',
            );
          const company = supplier.company;
          const history = await Promise.all([
            tx.financeDocument.count({
              where: { company, direction: 'AP', partyId: id },
            }),
            tx.financePayment.count({
              where: { company, direction: 'AP', partyId: id },
            }),
            tx.paymentRequest.count({ where: { company, supplierId: id } }),
          ]);
          if (history.some((count) => count > 0))
            throw new ConflictException(
              'A supplier with financial or payment request history cannot be deleted.',
            );
          return tx.supplier.delete({ where: { id } });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      )
        throw new ConflictException(
          'The supplier changed during processing. Refresh and try again.',
        );
      throw error;
    }
  }

  // ==========================================
  // 2. PURCHASE ORDERS WORKFLOW
  // ==========================================

  @Get('purchase-orders/next-po-number')
  async getNextPoNumber(@Query('company') company: string) {
    return { poNumber: await nextDocumentNumber(this.prisma, 'PO', company) };
  }

  @Post('purchase-orders')
  async createPurchaseOrder(@Body() data: any) {
    const {
      company,
      items,
      isVatApplied,
      vatRate = 0.12,
      user,
      supplierId,
    } = data;
    const fields = data as { poNumber?: unknown; osReference?: unknown };
    const requestedNumber =
      typeof fields.poNumber === 'string' ? fields.poNumber.trim() : '';
    const osReference =
      typeof fields.osReference === 'string' ? fields.osReference.trim() : '';

    if (
      typeof company !== 'string' ||
      !company ||
      !items ||
      items.length === 0
    ) {
      throw new BadRequestException('Missing required fields.');
    }
    if (fields.poNumber !== undefined && typeof fields.poNumber !== 'string')
      throw new BadRequestException('Invalid P.O. number.');
    if (!osReference.startsWith('OS')) {
      throw new BadRequestException(
        'A valid source Order Slip is required to create a P.O.',
      );
    }
    if (requestedNumber && !/\d$/.test(requestedNumber)) {
      throw new BadRequestException(
        'P.O. number must end in digits so the next number can increment.',
      );
    }

    if (supplierId) {
      const supplier = await this.prisma.supplier.findUnique({
        where: { id: supplierId },
      });
      if (!supplier)
        throw new BadRequestException('The selected supplier does not exist.');
    }

    const save = async (tx: Prisma.TransactionClient, poNumber: string) => {
      const source = await tx.orderSlip.findFirst({
        where: { company, osNumber: osReference },
        select: { status: true },
      });
      if (!source || ['Cancelled', 'Returned'].includes(source.status)) {
        throw new BadRequestException(
          'The source Order Slip must exist in this company and must not be cancelled or returned.',
        );
      }
      let calculatedSubtotal = new Prisma.Decimal(0);

      const cleanItems = items.map((item: any) => {
        const lineTotal = new Prisma.Decimal(Number(item.requestedQty))
          .mul(Number(item.unitCost))
          .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
          .toNumber();
        calculatedSubtotal = calculatedSubtotal.add(lineTotal);

        return {
          productId: Number(item.productId), // Safely parsing the 32-bit integer generated on frontend
          sku: item.sku,
          productName: item.productName,
          requestedQty: Number(item.requestedQty),
          unitCost: Number(item.unitCost),
          lineTotal,
        };
      });

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

      return await tx.purchaseOrder.create({
        data: {
          poNumber,
          company,
          osReference,
          status: 'Generated',
          subtotal: calculatedSubtotal.toNumber(),
          vatApplied: isVatApplied,
          vatRate: Number(vatRate),
          vatAmount: calculatedVat,
          grandTotal: calculatedGrandTotal,
          createdBy: user,
          supplierId: supplierId || null,
          items: { create: cleanItems },
        },
        include: { items: true },
      });
    };
    return createNumberedDocument(
      this.prisma,
      'PO',
      company,
      fields.poNumber,
      save,
    );
  }

  @Get('purchase-orders')
  @LegacyReadModules('products', 'inventory', 'master_inventory', 'warehouses')
  async listPurchaseOrders(@Query('company') company: string) {
    if (!company) throw new BadRequestException('Company is required.');
    
    const pos = await this.prisma.purchaseOrder.findMany({
      where: { company },
      include: { 
        items: true,
        supplier: true,
        requisition: { select: { id: true } },
        _count: { select: { items: { where: { shipmentLines: { some: {} } } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return pos.map(po => ({
      ...po,
      supplierName: po.supplier ? po.supplier.legalName : null,
      importManaged: !!po.requisition || po._count.items > 0,
    }));
  }

  @Post('purchase-orders/:id/receive')
  @LegacyCompanyRecord('purchaseOrder')
  async receivePurchaseOrder(@Param('id') id: string, @Body() data: any) {
    const { user, verifications } = data; 
    return await this.importSafeTransaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
      if (!po) throw new NotFoundException('P.O. not found.');
      await this.requireLegacyReceiving(tx, id);
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
  @LegacyCompanyRecord('supplier')
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
  @LegacyWriteModules('products', 'inventory', 'master_inventory', 'warehouse', 'warehouses')
  @LegacyCompanyRecord('purchaseOrder')
  async updatePurchaseOrderStatus(@Param('id') id: string, @Body() data: { status: string; user: string }) {
    const existing = await this.prisma.purchaseOrder.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('P.O. not found.');

    return this.importSafeTransaction(async tx => {
      await this.requireLegacyReceiving(tx, id);
      return tx.purchaseOrder.update({ where: { id }, data: { status: data.status, updatedBy: data.user } });
    });
  }

  @Delete('purchase-orders/:id/cancel')
  @LegacyCompanyRecord('purchaseOrder')
  async cancelPurchaseOrder(@Param('id') id: string, @Body('user') user: string) {
    return this.importSafeTransaction(async tx => {
      const existing = await tx.purchaseOrder.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('P.O. not found.');
      const linked = await tx.shipmentLine.count({ where: { purchaseOrderItem: { purchaseOrderId: id } } });
      if (linked) throw new BadRequestException('A shipment-linked P.O. cannot be cancelled. Resolve the shipment first.');
      await tx.shortage.updateMany({
        where: { purchaseOrderId: id, status: { notIn: ['Fulfilled', 'Cancelled'] } },
        data: { status: 'Cancelled', updatedBy: user },
      });
      return tx.purchaseOrder.update({ where: { id }, data: { status: 'Cancelled', updatedBy: user } });
    });
  }

  @Delete('purchase-orders/:id')
  @LegacyCompanyRecord('purchaseOrder')
  async hardDeletePurchaseOrder(@Param('id') id: string) {
    return this.importSafeTransaction(async tx => {
      await this.requireLegacyReceiving(tx, id);
      return tx.purchaseOrder.delete({ where: { id } });
    });
  }
}
