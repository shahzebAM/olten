import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@Controller('warehouse-transfers')
export class WarehouseTransfersController {
  
  @Post()
  async createTransfer(@Body() data: any) {
    const transfer = await prisma.warehouseTransfer.create({
      data: {
        sourceId: data.sourceId,
        destinationId: data.destinationId,
        productId: data.productId,
        sku: data.sku,
        quantity: data.quantity,
        reference: data.reference,
        user: data.user,
        company: data.company
      }
    });

    const sourceStock = await prisma.warehouseStock.findFirst({
      where: { warehouseId: data.sourceId, productId: data.productId }
    });
    if (sourceStock) {
      await prisma.warehouseStock.update({
        where: { id: sourceStock.id },
        data: { quantity: sourceStock.quantity - data.quantity }
      });
    }

    const destStock = await prisma.warehouseStock.findFirst({
      where: { warehouseId: data.destinationId, productId: data.productId }
    });
    if (destStock) {
      await prisma.warehouseStock.update({
        where: { id: destStock.id },
        data: { quantity: destStock.quantity + data.quantity }
      });
    } else {
      await prisma.warehouseStock.create({
        data: {
          warehouseId: data.destinationId,
          productId: data.productId,
          sku: data.sku,
          quantity: data.quantity,
          company: data.company
        }
      });
    }

    return transfer;
  }

  @Get()
  async findAll(@Query('company') company: string) {
    return prisma.warehouseTransfer.findMany({ 
      where: { company },
      orderBy: { transferDate: 'desc' }
    });
  }
}