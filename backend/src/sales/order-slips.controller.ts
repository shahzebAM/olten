import { Controller, Get, Post, Patch, Delete, Body, Param, Query, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

// Note: Ensure OrderSlipProcessingService, SalesPrismaService, ProcessOrderSlipInput, 
// and lockOrderSlip are imported at the top of your actual file.

@Controller('sales/order-slips')
export class OrderSlipsController {
  constructor(private readonly processing: OrderSlipProcessingService, private readonly prisma: SalesPrismaService) {}

  @Get(':id/review')
  reviewOrderSlip(@Param('id') id: string, @Query('company') company: string) {
    return this.processing.review(id, company);
  }

  @Post(':id/process')
  processOrderSlip(@Param('id') id: string, @Body() data: ProcessOrderSlipInput) {
    return this.processing.process(id, data);
  }

  // --- PHASE 7: SHORTAGE MANAGEMENT ENDPOINTS ---
  @Get('system/shortages')
  async getShortages(@Query('company') company: string) {
    if (!company) throw new BadRequestException('Company required.');
    return await this.prisma.shortage.findMany({
      where: { company },
      include: { customer: { select: { name: true } } },
      orderBy: { createdAt: 'desc' }
    });
  }

  @Patch('system/shortages/:id')
  async updateShortageStatus(@Param('id') id: string, @Body() data: any) {
    const { status, user } = data;
    return await this.prisma.shortage.update({
      where: { id },
      data: { status, updatedBy: user }
    });
  }

  @Get('search-products')
  async searchProducts(@Query('company') company: string, @Query('q') q: string) {
    if (!company || !q || q.length < 2) return [];

    const products = await this.prisma.product.findMany({
      where: {
        company,
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { sku: { contains: q, mode: 'insensitive' } },
          { category: { contains: q, mode: 'insensitive' } }
        ]
      },
      take: 15,
      select: { id: true, sku: true, name: true, category: true, sellingPrice: true, currentStock: true }
    });

    if (products.length === 0) return [];

    const productIds = products.map(p => p.id);
    const [hubStocks, allWarehouses] = await Promise.all([
      this.prisma.warehouseStock.findMany({ where: { company, productId: { in: productIds } } }),
      this.prisma.warehouse.findMany({ where: { company } })
    ]);

    const whMap = new Map(allWarehouses.map(w => [String(w.id), w.name]));

    return products.map(p => {
      const productStocks = hubStocks.filter(h => h.productId === p.id);
      const warehouseQty = productStocks.reduce((sum, h) => sum + h.quantity, 0);
      
      const warehouseBreakdown = productStocks
        .filter(h => h.quantity > 0)
        .map(h => ({
          name: whMap.get(String(h.warehouseId)) || `Depot ${h.warehouseId}`,
          quantity: h.quantity
        }));

      return { ...p, officeStock: p.currentStock || 0, warehouseQty, warehouseBreakdown };
    });
  }

  @Post('refresh-stock')
  async refreshStock(@Body() data: { company: string, productIds: number[] }) {
    const { company, productIds } = data;
    if (!company || !productIds || productIds.length === 0) return {};

    const [dbProducts, hubStocks, allWarehouses] = await Promise.all([
      this.prisma.product.findMany({ where: { company, id: { in: productIds } } }),
      this.prisma.warehouseStock.findMany({ where: { company, productId: { in: productIds } } }),
      this.prisma.warehouse.findMany({ where: { company } })
    ]);

    const whMap = new Map(allWarehouses.map(w => [String(w.id), w.name]));
    const stockMap: Record<number, { officeStock: number, warehouseQty: number, warehouseBreakdown: any[] }> = {};
    
    productIds.forEach(id => stockMap[id] = { officeStock: 0, warehouseQty: 0, warehouseBreakdown: [] });
    dbProducts.forEach(p => { stockMap[p.id].officeStock = p.currentStock || 0; });
    
    hubStocks.forEach(h => { 
      stockMap[h.productId].warehouseQty += h.quantity;
      if (h.quantity > 0) {
        stockMap[h.productId].warehouseBreakdown.push({
          name: whMap.get(String(h.warehouseId)) || `Depot ${h.warehouseId}`,
          quantity: h.quantity
        });
      }
    });

    return stockMap;
  }

  @Post()
  async createOrderSlip(@Body() data: any) {
    const { company, customerId, items, isVatApplied, vatRate = 0.12, user } = data;

    if (!company || !customerId || !items || items.length === 0) {
      throw new BadRequestException('Missing required fields: company, customerId, or items.');
    }

    return await this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id: customerId } });
      if (!customer) throw new NotFoundException('Customer record not found.');

      const productIds = items.map((i: any) => Number(i.productId));
      const dbProducts = await tx.product.findMany({ where: { id: { in: productIds }, company } });

      let calculatedSubtotal = 0;
      const cleanItems: any[] = [];

      for (const item of items) {
        const requestedQty = Number(item.requestedQty);
        if (!item.productId || !requestedQty || requestedQty <= 0) {
          throw new BadRequestException(`Invalid quantity for SKU: ${item.sku}`);
        }
        
        const product = dbProducts.find(p => p.id === Number(item.productId));
        if (!product) throw new NotFoundException(`Product not found: ${item.sku}`);

        const unitPrice = Number(product.sellingPrice); 
        const lineTotal = Math.round((requestedQty * unitPrice) * 100) / 100;
        
        calculatedSubtotal += lineTotal;
        cleanItems.push({
          productId: product.id,
          sku: product.sku,
          productName: product.name,
          requestedQty,
          unitPrice,
          lineTotal
        });
      }

      const lastOs = await tx.orderSlip.findFirst({
        where: { company },
        orderBy: { osNumber: 'desc' }
      });

      let nextNum = 1;
      if (lastOs && lastOs.osNumber.startsWith('OS-')) {
        const lastNum = parseInt(lastOs.osNumber.replace('OS-', ''), 10);
        if (!isNaN(lastNum)) nextNum = lastNum + 1;
      }
      const osNumber = `OS-${String(nextNum).padStart(6, '0')}`;

      calculatedSubtotal = Math.round(calculatedSubtotal * 100) / 100;
      const calculatedVat = isVatApplied ? Math.round((calculatedSubtotal * Number(vatRate)) * 100) / 100 : 0;
      const calculatedGrandTotal = Math.round((calculatedSubtotal + calculatedVat) * 100) / 100;

      return await tx.orderSlip.create({
        data: {
          osNumber,
          company,
          customerId,
          status: 'Generated', 
          subtotal: calculatedSubtotal,
          vatApplied: isVatApplied,
          vatRate: Number(vatRate),
          vatAmount: calculatedVat,
          grandTotal: calculatedGrandTotal,
          createdBy: user,
          items: {
            create: cleanItems
          }
        },
        include: { items: true, customer: true }
      });
    });
  }

  @Get()
  async listOrderSlips(
    @Query('company') company: string,
    @Query('page') pageStr: string,
    @Query('limit') limitStr: string,
    @Query('search') search: string,
    @Query('status') status: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string
  ) {
    if (!company) throw new BadRequestException('Company is required.');

    const page = Math.max(1, parseInt(pageStr) || 1);
    const limit = Math.max(1, parseInt(limitStr) || 15);
    const skip = (page - 1) * limit;

    const whereClause: Prisma.OrderSlipWhereInput = { company };

    if (status && status !== 'All') {
      whereClause.status = status;
    }

    if (search) {
      whereClause.OR = [
        { osNumber: { contains: search, mode: 'insensitive' } },
        { customerId: { contains: search, mode: 'insensitive' } },
        { createdBy: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } }
      ];
    }

    if (startDate && endDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      whereClause.createdAt = { gte: start, lte: end };
    }

    const [data, total] = await Promise.all([
      this.prisma.orderSlip.findMany({
        where: whereClause,
        include: { customer: { select: { name: true, id: true } }, items: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      this.prisma.orderSlip.count({ where: whereClause })
    ]);

    return { data, total, page, totalPages: Math.ceil(total / limit) };
  }

  @Get(':id')
  async getOrderSlip(@Param('id') id: string) {
    const os = await this.prisma.orderSlip.findUnique({
      where: { id },
      include: { items: true, customer: true }
    });
    if (!os) throw new NotFoundException('Order Slip not found.');
    return os;
  }

  // --- PHASE 7: PHYSICAL VERIFICATION TRANSACTION ---
  @Post(':id/verify')
  async verifyOrderSlip(@Param('id') id: string, @Body() data: any) {
    const { user, verifications } = data; 
    
    return await this.prisma.$transaction(async (tx) => {
      // Respecting the custom lock structure from your codebase
      if (typeof lockOrderSlip === 'function') await lockOrderSlip(tx, id);

      const os = await tx.orderSlip.findUnique({ where: { id }, include: { items: true, customer: true } });
      if (!os) throw new NotFoundException('Order Slip not found.');
      if (os.status === 'Cancelled') throw new BadRequestException('Cannot verify a cancelled Order Slip.');

      let hasShortage = false;

      for (const v of verifications) {
        const item = os.items.find(i => i.id === v.itemId);
        if (!item) continue;

        const requested = item.requestedQty;
        const confirmed = Math.max(0, Number(v.confirmedQty) || 0);
        const shortage = Math.max(0, requested - confirmed);

        await tx.orderSlipItem.update({
          where: { id: item.id },
          data: { confirmedQty: confirmed, shortageQty: shortage }
        });

        if (shortage > 0) {
          hasShortage = true;
          await tx.shortage.create({
            data: {
              company: os.company,
              orderSlipId: os.id,
              orderSlipItemId: item.id,
              customerId: os.customerId,
              osNumber: os.osNumber,
              sku: item.sku,
              productName: item.productName,
              requestedQty: requested,
              confirmedQty: confirmed,
              shortageQty: shortage,
              status: 'Open',
              createdBy: user
            }
          });
        }
      }

      const newStatus = hasShortage ? 'Partially Verified' : 'Verified';
      return await tx.orderSlip.update({
        where: { id },
        data: { status: newStatus, updatedBy: user },
        include: { items: true, customer: true }
      });
    });
  }

  // --- ADVANCED EDIT ACTION (Modify Status, Items, and VAT) ---
  @Patch(':id')
  async updateOrderSlip(@Param('id') id: string, @Body() data: any) {
    const { status, user, items, isVatApplied, vatRate = 0.12 } = data;
    return await this.prisma.$transaction(async (tx) => {
      await lockOrderSlip(tx, id);
      const existing = await tx.orderSlip.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('Order Slip not found.');
      if (existing.status === 'Cancelled') throw new BadRequestException('Cannot modify a cancelled Order Slip.');
      if (existing.processedAt && (items !== undefined || isVatApplied !== undefined)) {
        throw new BadRequestException('Processed quantities and totals are locked to preserve physical verification and shortage records.');
      }
      
      const allowedStatuses = existing.processedAt
        ? ['Processed', 'Shipped', 'Completed', 'Cancelled']
        : ['Draft', 'Generated', 'Cancelled', ...(['Shipped', 'Completed'].includes(existing.status) ? [existing.status] : [])];
      
      if (status && !allowedStatuses.includes(status)) {
        throw new BadRequestException('Use Process O.S. to physically verify this order before advancing its status.');
      }

      if (status === 'Cancelled') {
        await tx.shortage.updateMany({
          where: { orderSlipId: id, status: { notIn: ['Fulfilled', 'Cancelled'] } },
          data: { status: 'Cancelled', updatedBy: user },
        });
      }

      // Deep Update
      if (items && Array.isArray(items)) {
        await tx.orderSlipItem.deleteMany({ where: { orderSlipId: id } });

        const productIds = items.map((i: any) => Number(i.productId));
        const dbProducts = await tx.product.findMany({ where: { id: { in: productIds }, company: existing.company } });

        let calculatedSubtotal = 0;
        const cleanItems: any[] = [];

        for (const item of items) {
          const requestedQty = Number(item.requestedQty);
          if (!item.productId || !requestedQty || requestedQty <= 0) continue;
          
          const product = dbProducts.find(p => p.id === Number(item.productId));
          if (!product) continue;

          const unitPrice = Number(product.sellingPrice); 
          const lineTotal = Math.round((requestedQty * unitPrice) * 100) / 100;
          
          calculatedSubtotal += lineTotal;
          cleanItems.push({
            productId: product.id,
            sku: product.sku,
            productName: product.name,
            requestedQty,
            unitPrice,
            lineTotal
          });
        }

        calculatedSubtotal = Math.round(calculatedSubtotal * 100) / 100;
        const applyVat = isVatApplied !== undefined ? isVatApplied : existing.vatApplied;
        const calculatedVat = applyVat ? Math.round((calculatedSubtotal * Number(vatRate)) * 100) / 100 : 0;
        const calculatedGrandTotal = Math.round((calculatedSubtotal + calculatedVat) * 100) / 100;

        return await tx.orderSlip.update({
          where: { id },
          data: { 
            status: status || existing.status, 
            updatedBy: user,
            subtotal: calculatedSubtotal,
            vatApplied: applyVat,
            vatAmount: calculatedVat,
            grandTotal: calculatedGrandTotal,
            items: { create: cleanItems }
          },
          include: { items: true, customer: true }
        });
      }

      // Status Update
      return await tx.orderSlip.update({
        where: { id },
        data: { status, updatedBy: user },
        include: { items: true, customer: true }
      });
    });
  }

  @Delete(':id/cancel')
  async cancelOrderSlip(@Param('id') id: string, @Body('user') user: string) {
    return this.prisma.$transaction(async tx => {
      await lockOrderSlip(tx, id);
      const existing = await tx.orderSlip.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('Order Slip not found.');
      await tx.shortage.updateMany({
        where: { orderSlipId: id, status: { notIn: ['Fulfilled', 'Cancelled'] } },
        data: { status: 'Cancelled', updatedBy: user },
      });
      return tx.orderSlip.update({ where: { id }, data: { status: 'Cancelled', updatedBy: user } });
    });
  }

  @Delete(':id')
  async hardDeleteOrderSlip(@Param('id') id: string) {
    return this.prisma.$transaction(async tx => {
      await lockOrderSlip(tx, id);
      const existing = await tx.orderSlip.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('Order Slip not found.');
      if (existing.processedAt || await tx.shortage.count({ where: { orderSlipId: id } })) {
        throw new BadRequestException('A verified O.S. must be kept as the source of its physical quantities and shortages. Cancel it instead.');
      }
      return tx.orderSlip.delete({ where: { id } });
    });
  }
}