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

  // ==========================================
  // SALES ORDERS
  // ==========================================

  @Get('orders')
  async getOrders(@Query('company') company: string) {
    if (!company) return [];
    
    // Fetch orders and customers to map them together for the frontend
    const orders = await prisma.salesOrder.findMany({ where: { company } });
    const customers = await prisma.customer.findMany({ where: { company } });
    
    return orders.map(order => ({
      ...order,
      customer: customers.find(c => c.id === order.customerId) || null
    }));
  }

  @Post('orders')
  async createOrder(@Body() data: any) {
    return prisma.salesOrder.create({ data });
  }

  @Patch('orders/:id/status')
  async updateOrderStatus(@Param('id') id: string, @Body('status') status: string) {
    return prisma.salesOrder.update({ 
      where: { id }, 
      data: { status } 
    });
  }
}