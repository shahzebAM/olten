import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { CompanyAuthGuard } from '../auth/company-auth.guard';
import { DocumentService } from '../documentation/document.service';

const prisma = new PrismaClient();

@Controller('companies')
@UseGuards(CompanyAuthGuard)
export class CompaniesController {
  constructor(private readonly documents: DocumentService) {}
  
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
    return this.documents.deleteCompanyWorkspace(name);
  }
}
