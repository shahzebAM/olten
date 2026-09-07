import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@Controller('warehouse-stock')
export class WarehouseStockController {
  
  @Post()
  async assignStock(@Body() data: any) {
    const safeProductId = Number(data.productId);
    const safeQuantity = Number(data.quantity);

    const existing = await prisma.warehouseStock.findFirst({
      where: { 
        warehouseId: data.warehouseId, 
        productId: safeProductId 
      }
    });

    if (existing) {
      return prisma.warehouseStock.update({
        where: { id: existing.id },
        data: { quantity: existing.quantity + safeQuantity }
      });
    }

    return prisma.warehouseStock.create({
      data: {
        warehouseId: data.warehouseId,
        productId: safeProductId,
        sku: data.sku,
        quantity: safeQuantity,
        company: data.company
      }
    });
  }

  @Get()
  async findAll(@Query('company') company: string) {
    return prisma.warehouseStock.findMany({ where: { company } });
  }

  @Patch(':id')
  async updateStock(@Param('id') id: string, @Body() data: any) {
    return prisma.warehouseStock.update({
      where: { id },
      data: { quantity: Number(data.quantity) } 
    });
  }
}