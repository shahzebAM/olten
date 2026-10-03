import { Controller, Get, Post, Patch, Body, Query, Param, Delete } from '@nestjs/common';
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
    @Query('category') category?: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10'
  ) {
    if (!company) return { data: [], total: 0, page: 1, totalPages: 0 };

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 10);
    const skip = (pageNum - 1) * limitNum;

   const whereClause: any = { company };
    
    if (category && category.trim() !== '') {
      whereClause.category = category.trim();
    }

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

  // ==========================================
  // CUSTOMER CATEGORIES & PRICING
  // ==========================================

  @Get('customer-categories')
  async getCategories(@Query('company') company: string) {
    return prisma.customerCategory.findMany({ where: { company } });
  }

  @Post('customer-categories')
  async createCategory(@Body() data: { name: string; company: string }) {
    return prisma.customerCategory.create({ data });
  }

  @Delete('customer-categories/:id')
  async deleteCategory(@Param('id') id: string) {
    return prisma.customerCategory.delete({ where: { id } });
  }

  @Get('category-prices')
  async getCategoryPrices(
    @Query('company') company: string, 
    @Query('categoryName') categoryName: string
  ) {
    return prisma.categoryPrice.findMany({ 
      where: { company, categoryName } 
    });
  }

  @Post('category-prices/bulk')
  async updateCategoryPrices(@Body() data: { company: string; categoryName: string; prices: { productId: number; price: number }[] }) {
    const { company, categoryName, prices } = data;
    
    // Uses a transaction to safely upsert (update or insert) all price changes at once
    const upserts = prices.map(p => 
      prisma.categoryPrice.upsert({
        where: {
          productId_categoryName_company: { productId: p.productId, categoryName, company }
        },
        update: { price: p.price },
        create: { productId: p.productId, categoryName, company, price: p.price }
      })
    );

    await prisma.$transaction(upserts);
    return { message: "Prices updated successfully" };
  }

@Post('customers')
  async createCustomer(@Body() data: any) {
    const companyPrefix = data.company.substring(0, 2).toUpperCase();
    
    // Find the most recently created customer for this company that has the correct prefix
    const lastCustomer = await prisma.customer.findFirst({
      where: { 
        company: data.company,
        id: { startsWith: `${companyPrefix}-` }
      },
      orderBy: { createdAt: 'desc' }
    });

    let nextNum = 1;
    if (lastCustomer) {
      const parts = lastCustomer.id.split('-');
      if (parts.length === 2) {
        const num = parseInt(parts[1], 10);
        if (!isNaN(num)) nextNum = num + 1;
      }
    }
    
    data.id = `${companyPrefix}-${String(nextNum).padStart(2, '0')}`;
    return prisma.customer.create({ data });
  }

  @Patch('customers/:id')
  async updateCustomer(@Param('id') id: string, @Body() data: any) {
    return prisma.customer.update({ where: { id }, data });
  }

  @Delete('customers/:id')
  async deleteCustomer(@Param('id') id: string) {
    return prisma.customer.delete({ where: { id } });
  }

  @Patch('customers/:id/balance')
  async updateCustomerBalance(@Param('id') id: string, @Body('amount') amount: number) {
    return prisma.customer.update({
      where: { id },
      data: { balance: { increment: amount } }
    });
  }
}