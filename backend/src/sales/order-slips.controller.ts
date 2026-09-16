import { Controller, Get, Post, Patch, Delete, Body, Param, Query, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';

@Controller('sales/order-slips')
export class OrderSlipsController {
  private readonly prisma = new PrismaClient();

  @Get('search-products')
  async searchProducts(@Query('company') company: string, @Query('q') q: string) {
    if (!company || !q || q.length < 2) return [];

    // Force lower case search string to combat database collation issues
    const searchString = q.toLowerCase();

    // 1. First fetch products for the company
    const allCompanyProducts = await this.prisma.product.findMany({
      where: { company },
      select: { id: true, sku: true, name: true, category: true, sellingPrice: true, currentStock: true }
    });

    // 2. Perform the case-insensitive search in memory (100% reliable regardless of DB type)
    const products = allCompanyProducts.filter(p =>
      (p.name && p.name.toLowerCase().includes(searchString)) ||
      (p.sku && p.sku.toLowerCase().includes(searchString)) ||
      (p.category && p.category.toLowerCase().includes(searchString))
    ).slice(0, 15); // limit to 15 results

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
@Post()
  async createOrderSlip(@Body() data: any) {
    // 1. ADDED osNumber extraction here
    const { company, customerId, items, isVatApplied, vatRate = 0.12, user, osNumber: customOsNumber } = data;

    if (!company || !customerId || !items || items.length === 0) {
      throw new BadRequestException('Missing required fields: company, customerId, or items.');
    }

    return await this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id: customerId } });
      if (!customer) throw new NotFoundException('Customer record not found.');

      // 2. NEW CUSTOM OS NUMBER LOGIC
      let osNumber = customOsNumber?.trim();
      
      if (osNumber) {
        // Prevent duplicate OS Numbers
        const existing = await tx.orderSlip.findFirst({ where: { company, osNumber } });
        if (existing) throw new BadRequestException(`Order Slip number ${osNumber} is already in use!`);
      } else {
        // Fallback auto-generator if frontend sends nothing
        const lastOs = await tx.orderSlip.findFirst({
          where: { company },
          orderBy: { osNumber: 'desc' }
        });

        let nextNum = 1;
        if (lastOs && lastOs.osNumber.startsWith('OS-')) {
          const lastNum = parseInt(lastOs.osNumber.replace('OS-', ''), 10);
          if (!isNaN(lastNum)) nextNum = lastNum + 1;
        }
        osNumber = `OS-${String(nextNum).padStart(6, '0')}`;
      }

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

        // Trust the custom unit price passed from the frontend
        const unitPrice = Number(item.unitPrice) || Number(product.sellingPrice); 
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
      const calculatedVat = isVatApplied ? Math.round((calculatedSubtotal * Number(vatRate)) * 100) / 100 : 0;
      const calculatedGrandTotal = Math.round((calculatedSubtotal + calculatedVat) * 100) / 100;

      return await tx.orderSlip.create({
        data: {
          osNumber, // Uses the dynamically determined number
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

  // --- ADVANCED EDIT ACTION (Modify Status, Items, and VAT) ---
  @Patch(':id')
  async updateOrderSlip(@Param('id') id: string, @Body() data: any) {
    const { status, user, items, isVatApplied, vatRate = 0.12 } = data;
    const existing = await this.prisma.orderSlip.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Order Slip not found.');
    if (existing.status === 'Cancelled') throw new BadRequestException('Cannot modify a cancelled Order Slip.');

    return await this.prisma.$transaction(async (tx) => {
      // If items are passed, we perform a deep update
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

      // If no items passed, just update status
      return await tx.orderSlip.update({
        where: { id },
        data: { status, updatedBy: user },
        include: { items: true, customer: true }
      });
    });
  }

  @Delete(':id/cancel')
  async cancelOrderSlip(@Param('id') id: string, @Body('user') user: string) {
    const existing = await this.prisma.orderSlip.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Order Slip not found.');

    return await this.prisma.orderSlip.update({
      where: { id },
      data: { status: 'Cancelled', updatedBy: user }
    });
  }

  // Process Order Slip & Calculate Shortages
  @Patch(':id/process')
  async processOrderSlip(@Param('id') id: string, @Body() body: any) {
    const { items, user } = body; 
    return await this.prisma.$transaction(async (tx) => {
      const os = await tx.orderSlip.findUnique({ where: { id }, include: { items: true } });
      if (!os) throw new NotFoundException('Order Slip not found');

      let hasShortage = false;

      for (const input of items) {
        const osItem = os.items.find((i: any) => i.id === input.id);
        if (!osItem) continue;

        const requestedQty = osItem.requestedQty;
        const physicalQty = Number(input.physicalQty) || 0;
        const shortageQty = Math.max(0, requestedQty - physicalQty); // Never negative

        if (shortageQty > 0) hasShortage = true;

        // 1. Update OS Item
        await tx.orderSlipItem.update({
          where: { id: osItem.id },
          data: { physicalQty, shortageQty }
        });

        // 2. Create Shortage Record if applicable
        if (shortageQty > 0) {
          await tx.shortage.create({
            data: {
              orderSlipId: os.id,
              orderSlipItemId: osItem.id,
              company: os.company,
              customerId: os.customerId,  // <-- ADDED THIS
              osNumber: os.osNumber,
              sku: osItem.sku,
              productName: osItem.productName,
              requestedQty: requestedQty,
              confirmedQty: physicalQty,
              shortageQty: shortageQty,
              status: 'Open'
            }
          });
        }
      }

      // 3. Update overall OS Status
      await tx.orderSlip.update({
        where: { id },
        data: { status: hasShortage ? 'Partially Verified' : 'Verified' }
      });

      return { success: true };
    });
  }

  // Fetch Shortages
  @Get('shortages/all')
  async getShortages(@Query('company') company: string) {
     if (!company) throw new BadRequestException("Company is required");
     return await this.prisma.shortage.findMany({
       where: { company },
       include: { orderSlip: { include: { customer: true } } },
       orderBy: { createdAt: 'desc' }
     });
  }

  // Update Shortage Status
  @Patch('shortages/:id/status')
  async updateShortageStatus(@Param('id') id: string, @Body() body: any) {
     return await this.prisma.shortage.update({
       where: { id },
       data: { status: body.status }
     });
  }

  @Delete(':id')
  async hardDeleteOrderSlip(@Param('id') id: string) {
    const existing = await this.prisma.orderSlip.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Order Slip not found.');

    await this.prisma.orderSlipItem.deleteMany({ where: { orderSlipId: id } });
    return await this.prisma.orderSlip.delete({ where: { id } });
  }
}