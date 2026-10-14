import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query,
  BadRequestException, NotFoundException,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function padSeq(n: number) { return String(n).padStart(6, '0'); }

async function nextRefNumber(
  prefix: string,
  finder: (year: number) => Promise<{ [k: string]: unknown } | null>,
): Promise<string> {
  const year = new Date().getFullYear();
  const last = await finder(year);
  if (!last) return `${prefix}-${year}-000001`;
  const rec = last as Record<string, string>;
  const field = Object.keys(rec).find((k) => typeof rec[k] === 'string' && rec[k].startsWith(`${prefix}-${year}-`)) ?? '';
  const seq = parseInt((rec[field] ?? '').split('-').pop() ?? '0', 10);
  return `${prefix}-${year}-${padSeq(seq + 1)}`;
}

// ==========================================
// CUSTOMS ENTRY CONTROLLER  (CE-YYYY-XXXXXX)
// ==========================================
@Controller('importation/customs')
export class CustomsController {
  @Get('next-number')
  async nextCeNumber(@Query('company') company: string) {
    if (!company) throw new BadRequestException('company is required');
    const ceNumber = await nextRefNumber('CE', (year) =>
      prisma.customsEntry.findFirst({
        where: { company, ceNumber: { startsWith: `CE-${year}-` } },
        orderBy: { ceNumber: 'desc' },
        select: { ceNumber: true },
      }),
    );
    return { ceNumber };
  }

  @Post()
  async create(@Body() body: any) {
    const { shipmentId, company, brokerName, declarationRef, clearanceDate, status, notes, createdBy } = body;
    if (!shipmentId || !company || !createdBy) throw new BadRequestException('shipmentId, company and createdBy are required');

    const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
    if (!shipment) throw new NotFoundException('Shipment not found');

    const ceNumber = await nextRefNumber('CE', (year) =>
      prisma.customsEntry.findFirst({
        where: { company, ceNumber: { startsWith: `CE-${year}-` } },
        orderBy: { ceNumber: 'desc' },
        select: { ceNumber: true },
      }),
    );

    return prisma.customsEntry.create({
      data: {
        ceNumber, shipmentId, company,
        brokerName: brokerName ?? null,
        declarationRef: declarationRef ?? null,
        clearanceDate: clearanceDate ? new Date(clearanceDate) : null,
        status: status ?? 'Pending',
        notes: notes ?? null,
        createdBy,
      },
      include: { expenses: true },
    });
  }

  @Get()
  async list(@Query('shipmentId') shipmentId?: string, @Query('company') company?: string) {
    const where = shipmentId ? { shipmentId } : company ? { company } : undefined;
    if (!where) throw new BadRequestException('shipmentId or company is required');
    return prisma.customsEntry.findMany({
      where,
      include: { expenses: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const ce = await prisma.customsEntry.findUnique({ where: { id }, include: { expenses: true } });
    if (!ce) throw new NotFoundException('Customs entry not found');
    return ce;
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    const ce = await prisma.customsEntry.findUnique({ where: { id } });
    if (!ce) throw new NotFoundException('Customs entry not found');
    const { brokerName, declarationRef, clearanceDate, status, notes } = body;
    return prisma.customsEntry.update({
      where: { id },
      data: {
        brokerName: brokerName ?? ce.brokerName,
        declarationRef: declarationRef ?? ce.declarationRef,
        clearanceDate: clearanceDate ? new Date(clearanceDate) : ce.clearanceDate,
        status: status ?? ce.status,
        notes: notes ?? ce.notes,
      },
      include: { expenses: true },
    });
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const ce = await prisma.customsEntry.findUnique({ where: { id }, include: { expenses: true } });
    if (!ce) throw new NotFoundException('Customs entry not found');
    await prisma.customsEntry.delete({ where: { id } });
    return { message: 'Customs entry deleted' };
  }

  // ---- IMPORT EXPENSES ----

  @Post(':ceId/expenses')
  async addExpense(@Param('ceId') customsEntryId: string, @Body() body: any) {
    const ce = await prisma.customsEntry.findUnique({ where: { id: customsEntryId } });
    if (!ce) throw new NotFoundException('Customs entry not found');

    const { expenseType, description, currency, exchangeRate, amountForeign, paymentStatus, invoiceRef, createdBy } = body;
    if (!expenseType || !createdBy) throw new BadRequestException('expenseType and createdBy are required');

    const rate = Number(exchangeRate ?? 1);
    const foreign = Number(amountForeign ?? 0);
    return prisma.importExpense.create({
      data: {
        customsEntryId, company: ce.company,
        expenseType, description: description ?? null,
        currency: currency ?? 'PHP',
        exchangeRate: rate,
        amountForeign: foreign,
        amountPhp: foreign * rate,
        paymentStatus: paymentStatus ?? 'Estimated',
        invoiceRef: invoiceRef ?? null,
        createdBy,
      },
    });
  }

  @Patch(':ceId/expenses/:expId')
  async updateExpense(
    @Param('ceId') customsEntryId: string,
    @Param('expId') id: string,
    @Body() body: any,
  ) {
    const exp = await prisma.importExpense.findFirst({ where: { id, customsEntryId } });
    if (!exp) throw new NotFoundException('Expense not found');

    const { expenseType, description, currency, exchangeRate, amountForeign, paymentStatus, invoiceRef, paidAt } = body;
    const rate = exchangeRate != null ? Number(exchangeRate) : exp.exchangeRate;
    const foreign = amountForeign != null ? Number(amountForeign) : exp.amountForeign;

    return prisma.importExpense.update({
      where: { id },
      data: {
        expenseType: expenseType ?? exp.expenseType,
        description: description ?? exp.description,
        currency: currency ?? exp.currency,
        exchangeRate: rate,
        amountForeign: foreign,
        amountPhp: foreign * rate,
        paymentStatus: paymentStatus ?? exp.paymentStatus,
        invoiceRef: invoiceRef ?? exp.invoiceRef,
        paidAt: paidAt ? new Date(paidAt) : exp.paidAt,
      },
    });
  }

  @Delete(':ceId/expenses/:expId')
  async removeExpense(@Param('ceId') customsEntryId: string, @Param('expId') id: string) {
    const exp = await prisma.importExpense.findFirst({ where: { id, customsEntryId } });
    if (!exp) throw new NotFoundException('Expense not found');
    await prisma.importExpense.delete({ where: { id } });
    return { message: 'Expense deleted' };
  }
}
