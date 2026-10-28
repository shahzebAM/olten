import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Query,
  Param,
  Delete,
  ConflictException,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { LegacyCompanyRecord, LegacyErpAccess, LegacyErpAuthGuard, LegacyReadModules, LegacyWriteModules } from '../auth/legacy-erp-auth.guard';

const prisma = new PrismaClient();
@Controller('sales')
@UseGuards(LegacyErpAuthGuard)
@LegacyErpAccess('sales')
export class SalesController {

  onModuleDestroy() {
    return prisma.$disconnect();
  }

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
  @LegacyReadModules('products', 'inventory', 'master_inventory', 'warehouses')
  async getCategories(@Query('company') company: string) {
    return prisma.customerCategory.findMany({ where: { company } });
  }

  @Post('customer-categories')
  async createCategory(@Body() data: { name: string; company: string }) {
    return prisma.customerCategory.create({ data });
  }

  @Delete('customer-categories/:id')
  @LegacyCompanyRecord('customerCategory')
  async deleteCategory(@Param('id') id: string) {
    return prisma.customerCategory.delete({ where: { id } });
  }

  @Get('category-prices')
  @LegacyReadModules('products', 'inventory', 'master_inventory', 'warehouses')
  async getCategoryPrices(
    @Query('company') company: string, 
    @Query('categoryName') categoryName: string
  ) {
    return prisma.categoryPrice.findMany({ 
      where: { company, categoryName } 
    });
  }

  @Post('category-prices/bulk')
  @LegacyWriteModules('products', 'inventory', 'master_inventory', 'warehouse', 'warehouses')
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
  @LegacyCompanyRecord('customer')
  async updateCustomer(@Param('id') id: string, @Body() data: any) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const customer = await tx.customer.findUnique({
            where: { id },
            select: { company: true },
          });
          if (!customer) throw new NotFoundException('Customer not found.');
          const identity = data as { id?: unknown; company?: unknown } | null;
          const identityChanged =
            (identity?.id !== undefined && identity.id !== id) ||
            (identity?.company !== undefined &&
              identity.company !== customer.company);
          if (identityChanged) {
            const company = customer.company;
            const history = await Promise.all([
              tx.financeDocument.count({
                where: { company, direction: 'AR', partyId: id },
              }),
              tx.financePayment.count({
                where: { company, direction: 'AR', partyId: id },
              }),
              tx.deviceAsset.count({ where: { company, customerId: id } }),
            ]);
            if (history.some((count) => count > 0))
              throw new ConflictException(
                'Customer identity and workspace cannot change after financial or device service history exists.',
              );
          }
          return tx.customer.update({ where: { id }, data });
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      )
        throw new ConflictException(
          'The customer changed during processing. Refresh and try again.',
        );
      throw error;
    }
  }

  @Delete('customers/:id')
  @LegacyCompanyRecord('customer')
  async deleteCustomer(@Param('id') id: string) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const customer = await tx.customer.findUnique({
            where: { id },
            select: { company: true },
          });
          if (!customer) throw new NotFoundException('Customer not found.');
          const company = customer.company;
          if (
            await tx.customerOrder.count({ where: { customerId: id, company } })
          ) {
            throw new ConflictException(
              'A customer with fulfillment order history cannot be deleted.',
            );
          }
          const history = await Promise.all([
            tx.financeDocument.count({
              where: { company, direction: 'AR', partyId: id },
            }),
            tx.financePayment.count({
              where: { company, direction: 'AR', partyId: id },
            }),
            tx.deviceAsset.count({ where: { company, customerId: id } }),
          ]);
          if (history.some((count) => count > 0))
            throw new ConflictException(
              'A customer with financial or device service history cannot be deleted.',
            );
          return tx.customer.delete({ where: { id } });
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      )
        throw new ConflictException(
          'The customer changed during processing. Refresh and try again.',
        );
      throw error;
    }
  }

  @Patch('customers/:id/balance')
  @LegacyCompanyRecord('customer')
  async updateCustomerBalance(@Param('id') id: string, @Body('amount') amount: number) {
    return prisma.customer.update({
      where: { id },
      data: { balance: { increment: amount } }
    });
  }
}
