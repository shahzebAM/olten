import { Controller, Get, Post, Patch, Delete, Body, Param, Query, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@Controller('sales/order-slips')
export class OrderSlipsController {

  // --- PHASE 4: EFFICIENT SERVER-SIDE SEARCH WITH LIVE INVENTORY ---
  @Get('search-products')
  async searchProducts(@Query('company') company: string, @Query('q') q: string) {
    if (!company || !q || q.length < 2) return [];

    // 1. Find matching products efficiently (limit to top 15 results, include currentStock)
    const products = await prisma.product.findMany({
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

    // 2. Fetch precise master warehouse stock for these matched products only
    const productIds = products.map(p => p.id);
    const hubStocks = await prisma.warehouseStock.findMany({
      where: { company, productId: { in: productIds } }
    });

    // 3. Map both stock totals back to the products
    return products.map(p => {
      const warehouseQty = hubStocks.filter(h => h.productId === p.id).reduce((sum, h) => sum + h.quantity, 0);
      return { 
        ...p, 
        officeStock: p.currentStock || 0,
        warehouseQty 
      };
    });
  }

  // --- PHASE 4: LIVE STOCK REFRESH ---
  @Post('refresh-stock')
  async refreshStock(@Body() data: { company: string, productIds: number[] }) {
    const { company, productIds } = data;
    if (!company || !productIds || productIds.length === 0) return {};

    const [dbProducts, hubStocks] = await Promise.all([
      prisma.product.findMany({ where: { company, id: { in: productIds } } }),
      prisma.warehouseStock.findMany({ where: { company, productId: { in: productIds } } })
    ]);

    const stockMap: Record<number, { officeStock: number, warehouseQty: number }> = {};
    productIds.forEach(id => stockMap[id] = { officeStock: 0, warehouseQty: 0 });

    dbProducts.forEach(p => { stockMap[p.id].officeStock = p.currentStock || 0; });
    hubStocks.forEach(h => { stockMap[h.productId].warehouseQty += h.quantity; });

    return stockMap;
  }

  @Post()
  async createOrderSlip(@Body() data: any) {
    const { company, customerId, items, isVatApplied, vatRate = 0.12, user } = data;

    if (!company || !customerId || !items || items.length === 0) {
      throw new BadRequestException('Missing required fields: company, customerId, or items.');
    }

    return await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id: customerId } });
      if (!customer) throw new NotFoundException('Customer record not found.');

      // --- PHASE 4: STRICT BACKEND REVALIDATION ---
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
        // PHASE 5: Strict Decimal Rounding
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

      // PHASE 5: Strict Decimal Rounding for Database Storage
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
  async listOrderSlips(@Query('company') company: string) {
    if (!company) throw new BadRequestException('Company parameter is required.');
    return await prisma.orderSlip.findMany({
      where: { company },
      include: { items: true, customer: true },
      orderBy: { createdAt: 'desc' }
    });
  }

  @Get(':id')
  async getOrderSlip(@Param('id') id: string) {
    const os = await prisma.orderSlip.findUnique({
      where: { id },
      include: { items: true, customer: true }
    });
    if (!os) throw new NotFoundException('Order Slip not found.');
    return os;
  }

  @Patch(':id')
  async updateOrderSlip(@Param('id') id: string, @Body() data: any) {
    const { status, user } = data;
    const existing = await prisma.orderSlip.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Order Slip not found.');
    if (existing.status === 'Cancelled') throw new BadRequestException('Cannot modify a cancelled Order Slip.');

    return await prisma.orderSlip.update({
      where: { id },
      data: { status, updatedBy: user },
      include: { items: true, customer: true }
    });
  }

  @Delete(':id/cancel')
  async cancelOrderSlip(@Param('id') id: string, @Body('user') user: string) {
    const existing = await prisma.orderSlip.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Order Slip not found.');

    return await prisma.orderSlip.update({
      where: { id },
      data: { status: 'Cancelled', updatedBy: user }
    });
  }
}