import { Controller, Get, Post, Body, Query, Delete, Param, Patch } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@Controller('inventory-movements')
export class InventoryMovementsController {
  
  @Post()
  async create(@Body() data: any) {
    return prisma.inventoryMovement.create({
      data: {
        productId: data.productId,
        productName: data.productName,
        sku: data.sku,
        type: data.type,
        quantity: data.quantity,
        previousStock: data.previousStock,
        newStock: data.newStock,
        reference: data.reference,
        remarks: data.remarks,
        user: data.user,
        company: data.company,
        date: new Date(),
      }
    });
  }

  @Get()
  async findAll(@Query('company') company: string) {
    return prisma.inventoryMovement.findMany({
      where: { company },
      orderBy: { date: 'desc' }
    });
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() data: any) {
    return prisma.inventoryMovement.update({
      where: { id },
      data: {
        reference: data.reference,
        remarks: data.remarks
      }
    });
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return prisma.inventoryMovement.delete({ where: { id } });
  }
}