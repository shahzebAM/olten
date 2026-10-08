import { Controller, Get, Post, Body, Query, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Controller('sales/packing-lists')
export class PackingListsController {
  private readonly prisma = new PrismaClient();

  @Post()
  async createPackingList(@Body() data: any) {
    const { company, customerId, items, isVatApplied, vatRate = 0.12, user, plNumber, referenceOs } = data;
    
    // Deduct stock upon PL creation just like Final Orders
    return await this.prisma.$transaction(async (tx) => {
      const pl = await tx.packingList.create({
        data: {
          plNumber, referenceOs, company, customerId, status: 'Generated',
          subtotal: data.subtotal, vatApplied: isVatApplied, vatRate, vatAmount: data.vatAmount, grandTotal: data.grandTotal, createdBy: user,
          items: { create: items }
        },
        include: { items: true, customer: true }
      });

      for (const item of items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { currentStock: { decrement: item.requestedQty } }
        });
      }
      return pl;
    });
  }

  @Get()
  async listPackingLists(@Query('company') company: string) {
    return await this.prisma.packingList.findMany({
      where: { company },
      include: { customer: true, items: true },
      orderBy: { createdAt: 'desc' }
    });
  }
}