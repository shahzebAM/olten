import { Controller, Get, Post, Body, Query, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Controller('sales/quotations')
export class QuotationsController {
  private readonly prisma = new PrismaClient();

  @Post()
  async createQuotation(@Body() data: any) {
    const { company, customerId, items, isVatApplied, vatRate = 0.12, user, qtNumber } = data;
    if (!company || !customerId || !items || !qtNumber) throw new BadRequestException('Missing fields');

    return await this.prisma.quotation.create({
      data: {
        qtNumber, company, customerId, status: 'Draft',
        subtotal: data.subtotal, vatApplied: isVatApplied, vatRate, vatAmount: data.vatAmount, grandTotal: data.grandTotal, createdBy: user,
        items: { create: items }
      },
      include: { items: true, customer: true }
    });
  }

  @Get()
  async listQuotations(@Query('company') company: string) {
    return await this.prisma.quotation.findMany({
      where: { company },
      include: { customer: true, items: true },
      orderBy: { createdAt: 'desc' }
    });
  }
}