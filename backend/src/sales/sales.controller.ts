import { Controller, Get, Post, Patch, Body, Query, Param } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@Controller('sales')
export class SalesController {

  // ==========================================
  // CUSTOMER MANAGEMENT
  // ==========================================

  @Get('customers')
  async getCustomers(@Query('company') company: string) {
    if (!company) return [];
    return prisma.customer.findMany({ where: { company } });
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