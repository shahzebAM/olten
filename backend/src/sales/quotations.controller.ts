import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { LegacyErpAccess, LegacyErpAuthGuard } from '../auth/legacy-erp-auth.guard';
import {
  createNumberedDocument,
  nextDocumentNumber,
} from './document-numbering';

@Controller('sales/quotations')
@UseGuards(LegacyErpAuthGuard)
@LegacyErpAccess('sales')
export class QuotationsController {
  private readonly prisma = new PrismaClient();

  @Post()
  async createQuotation(@Body() data: any) {
    const { company, customerId, items, isVatApplied, vatRate = 0.12, user, qtNumber } = data;
    if (typeof company !== 'string' || !company || !customerId || !items)
      throw new BadRequestException('Missing fields');

    return await createNumberedDocument(
      this.prisma,
      'QT',
      company,
      qtNumber,
      (tx, number) =>
        tx.quotation.create({
          data: {
            qtNumber: number,
            company,
            customerId,
            status: 'Draft',
            subtotal: data.subtotal,
            vatApplied: isVatApplied,
            vatRate,
            vatAmount: data.vatAmount,
            grandTotal: data.grandTotal,
            createdBy: user,
            items: { create: items },
          },
          include: { items: true, customer: true },
        }),
    );
  }

  @Get('next-number')
  async getNextNumber(@Query('company') company: string) {
    if (!company) throw new BadRequestException('Company is required.');
    return { qtNumber: await nextDocumentNumber(this.prisma, 'QT', company) };
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
