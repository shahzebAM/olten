import { Controller, Get, Post, Patch, Body, Query, Param } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@Controller('sales')
export class SalesController {

  // ==========================================
  // CUSTOMER MANAGEMENT
  // ==========================================

  @Get('customers')
  async getCustomers(
    @Query('company') company: string,
    @Query('search') search?: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10'
  ) {
    if (!company) return { data: [], total: 0, page: 1, totalPages: 0 };

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 10);
    const skip = (pageNum - 1) * limitNum;

    const whereClause: any = { company };

    if (search && search.trim() !== '') {
      const searchTerm = search.trim();
      whereClause.OR = [
        { name: { contains: searchTerm, mode: 'insensitive' } },
        { company: { contains: searchTerm, mode: 'insensitive' } },
        { id: { contains: searchTerm, mode: 'insensitive' } },
        { contact: { contains: searchTerm, mode: 'insensitive' } },
        { phone: { contains: searchTerm, mode: 'insensitive' } },
        { email: { contains: searchTerm, mode: 'insensitive' } }
      ];
    }

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where: whereClause,
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.customer.count({ where: whereClause })
    ]);

    return {
      data: customers,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum)
    };
  }

  @Post('customers')
  async createCustomer(@Body() data: any) {
    return prisma.customer.create({ data });
  }

  @Patch('customers/:id')
  async updateCustomer(@Param('id') id: string, @Body() data: any) {
    return prisma.customer.update({ where: { id }, data });
  }

  @Patch('customers/:id/balance')
  async updateCustomerBalance(@Param('id') id: string, @Body('amount') amount: number) {
    return prisma.customer.update({
      where: { id },
      data: { balance: { increment: amount } }
    });
  }
}