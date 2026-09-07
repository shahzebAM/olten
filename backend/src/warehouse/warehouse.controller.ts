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
        isActive: data.isActive ?? true // FIXED: Prevents Prisma crash if undefined
      }
    });
  }

  @Get()
  async findAll(@Query('company') company: string) {
    return prisma.warehouse.findMany({ where: { company } });
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return prisma.warehouse.delete({ where: { id } });
  }
}