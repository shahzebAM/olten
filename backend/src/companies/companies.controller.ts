import { Controller, Get, Post, Delete, Body, Param } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@Controller('companies')
export class CompaniesController {
  
  @Get()
  async findAll() {
    return prisma.company.findMany({ orderBy: { createdAt: 'asc' } });
  }

  @Post()
  async create(@Body() data: { name: string }) {
    return prisma.company.create({ data: { name: data.name } });
  }

  @Delete(':name')
  async remove(@Param('name') name: string) {
    return prisma.company.delete({ where: { name } });
  }
}