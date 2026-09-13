import { Controller, Get, Post, Patch, Body, Param, Query, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@Controller('purchasing')
export class PurchasingController {
  
  // --- SUPPLIERS ---
  @Post('suppliers')
  async createSupplier(
    @Body() data: { company: string; name: string; contact?: string; phone?: string; email?: string }
  ) {
    return prisma.supplier.create({
      data: {
        company: data.company,
        name: data.name,
        contact: data.contact || null,
        phone: data.phone || null,
        email: data.email || null,
        balance: 0,
        isActive: true
      }
    });
  }

  @Get('suppliers')
  async getSuppliers(@Query('company') company: string) {
    return prisma.supplier.findMany({ where: { company } });
  }

  @Patch('suppliers/:id')
  async updateSupplier(@Param('id') id: string, @Body() data: any) {
    return prisma.supplier.update({
      where: { id },
      data: {
        name: data.name,
        contact: data.contact,
        phone: data.phone,
        email: data.email
      }
    });
  }

  @Patch('suppliers/:id/balance')
  async updateBalance(@Param('id') id: string, @Body() data: { amount: number }) {
    const supplier = await prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw new NotFoundException('Supplier not found');

    return prisma.supplier.update({
      where: { id },
      data: { balance: supplier.balance + Number(data.amount) }
    });
  }

  // --- PURCHASE ORDERS ---
  @Post('pos')
  async createPO(@Body() data: any) {
    return prisma.purchaseOrder.create({
      data: {
        company: data.company,
        poNumber: data.poNumber,
        supplierId: data.supplierId,
        totalAmount: Number(data.totalAmount),
        user: data.user,
        status: data.status || 'PENDING',
        items: {
          create: data.items.map((item: any) => ({
            productId: Number(item.productId),
            sku: String(item.sku),
            productName: String(item.productName),
            quantity: Number(item.quantity),
            unitPrice: Number(item.unitPrice),
            total: Number(item.total)
          }))
        }
      },
      include: { items: true, supplier: true }
    });
  }

  @Get('pos')
  async getPOs(@Query('company') company: string) {
    return prisma.purchaseOrder.findMany({ 
      where: { company },
      include: { items: true, supplier: true },
      orderBy: { date: 'desc' }
    });
  }

  @Patch('pos/:id/status')
  async updatePOStatus(@Param('id') id: string, @Body() data: { status: string }) {
    return prisma.purchaseOrder.update({
      where: { id },
      data: { status: data.status },
      include: { items: true, supplier: true }
    });
  }
} 