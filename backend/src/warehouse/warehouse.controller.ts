import { Controller, Get, Post, Delete, Body, Param, Query } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@Controller('warehouses')
export class WarehousesController {
  
  @Post()
  async create(@Body() data: any) {
    return prisma.warehouse.create({
      data: {
        company: data.company,
        name: data.name,
        location: data.location,
        isActive: data.isActive ?? true
      }
    });
  }

  @Get()
  async findAll(@Query('company') company: string) {
    return prisma.warehouse.findMany({ where: { company } });
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    // 1. Wipe all physical quantities hosted in this warehouse
    await prisma.warehouseStock.deleteMany({ 
      where: { warehouseId: id } 
    });

    // 2. Wipe any transfer histories linked to this warehouse to prevent orphaned records
    await prisma.warehouseTransfer.deleteMany({
      where: { 
        OR: [ { sourceId: id }, { destinationId: id } ] 
      }
    });

    // 3. Destroy the warehouse itself
    return prisma.warehouse.delete({ where: { id } });
  }
}