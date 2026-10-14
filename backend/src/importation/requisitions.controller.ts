import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query,
  BadRequestException, NotFoundException, ConflictException,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ---------- helpers ----------
function padSeq(n: number) { return String(n).padStart(6, '0'); }
function yyyyFromDate(d: Date) { return d.getFullYear(); }

async function nextRefNumber(
  prefix: string,
  finder: (year: number) => Promise<{ [k: string]: unknown } | null>,
): Promise<string> {
  const year = yyyyFromDate(new Date());
  const last = await finder(year);
  if (!last) return `${prefix}-${year}-000001`;
  const anyLast = last as Record<string, string>;
  const field =
    Object.keys(anyLast).find((k) => typeof anyLast[k] === 'string' && anyLast[k].startsWith(`${prefix}-${year}-`)) ?? '';
  const raw = anyLast[field] ?? '';
  const seq = parseInt((raw as string).split('-').pop() ?? '0', 10);
  return `${prefix}-${year}-${padSeq(seq + 1)}`;
}

// ==========================================
// PURCHASE REQUISITION CONTROLLER
// ==========================================
@Controller('procurement/requisitions')
export class RequisitionsController {
  @Get('next-number')
  async nextPrNumber(@Query('company') company: string) {
    if (!company) throw new BadRequestException('company is required');
    const prNumber = await nextRefNumber('PR', (year) =>
      prisma.purchaseRequisition.findFirst({
        where: { company, prNumber: { startsWith: `PR-${year}-` } },
        orderBy: { prNumber: 'desc' },
        select: { prNumber: true },
      }),
    );
    return { prNumber };
  }

  @Post()
  async create(@Body() body: any) {
    const { company, requestedBy, department, purpose, priority, neededBy, notes, items } = body;
    if (!company || !requestedBy || !items?.length)
      throw new BadRequestException('company, requestedBy and items are required');

    const prNumber = await nextRefNumber('PR', (year) =>
      prisma.purchaseRequisition.findFirst({
        where: { company, prNumber: { startsWith: `PR-${year}-` } },
        orderBy: { prNumber: 'desc' },
        select: { prNumber: true },
      }),
    );

    return prisma.purchaseRequisition.create({
      data: {
        prNumber, company, requestedBy,
        department: department ?? null,
        purpose: purpose ?? null,
        priority: priority ?? 'Normal',
        neededBy: neededBy ? new Date(neededBy) : null,
        notes: notes ?? null,
        items: {
          create: (items as any[]).map((i) => ({
            productId: i.productId ? Number(i.productId) : null,
            sku: i.sku ?? null,
            productName: i.productName,
            requestedQty: Number(i.requestedQty),
            unit: i.unit ?? 'pcs',
            estimatedCost: i.estimatedCost != null ? Number(i.estimatedCost) : null,
            notes: i.notes ?? null,
          })),
        },
      },
      include: { items: true },
    });
  }

  @Get()
  async list(@Query('company') company: string, @Query('status') status?: string) {
    if (!company) throw new BadRequestException('company is required');
    return prisma.purchaseRequisition.findMany({
      where: { company, ...(status ? { status } : {}) },
      include: { items: true, quotations: { include: { items: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const pr = await prisma.purchaseRequisition.findUnique({
      where: { id },
      include: { items: true, quotations: { include: { items: true } } },
    });
    if (!pr) throw new NotFoundException('Requisition not found');
    return pr;
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    const pr = await prisma.purchaseRequisition.findUnique({ where: { id } });
    if (!pr) throw new NotFoundException('Requisition not found');
    if (pr.status === 'PO Issued') throw new BadRequestException('Cannot edit a requisition after a PO has been issued.');

    const { department, purpose, priority, neededBy, notes } = body;
    return prisma.purchaseRequisition.update({
      where: { id },
      data: {
        department: department ?? pr.department,
        purpose: purpose ?? pr.purpose,
        priority: priority ?? pr.priority,
        neededBy: neededBy ? new Date(neededBy) : pr.neededBy,
        notes: notes ?? pr.notes,
      },
    });
  }

  @Patch(':id/approve')
  async approve(@Param('id') id: string, @Body() body: { approvedBy: string }) {
    if (!body?.approvedBy) throw new BadRequestException('approvedBy is required');
    const pr = await prisma.purchaseRequisition.findUnique({ where: { id } });
    if (!pr) throw new NotFoundException('Requisition not found');
    if (pr.status !== 'Pending Approval') throw new BadRequestException('Only requisitions in "Pending Approval" status can be approved.');
    return prisma.purchaseRequisition.update({
      where: { id },
      data: { status: 'Approved', approvedBy: body.approvedBy, approvedAt: new Date() },
    });
  }

  @Patch(':id/reject')
  async reject(@Param('id') id: string, @Body() body: { rejectedBy: string; reason?: string }) {
    if (!body?.rejectedBy) throw new BadRequestException('rejectedBy is required');
    const pr = await prisma.purchaseRequisition.findUnique({ where: { id } });
    if (!pr) throw new NotFoundException('Requisition not found');
    if (pr.status !== 'Pending Approval') throw new BadRequestException('Only requisitions in "Pending Approval" status can be rejected.');
    return prisma.purchaseRequisition.update({
      where: { id },
      data: { status: 'Rejected', rejectedBy: body.rejectedBy, rejectedAt: new Date(), rejectionReason: body.reason ?? null },
    });
  }

  @Patch(':id/submit')
  async submit(@Param('id') id: string) {
    const pr = await prisma.purchaseRequisition.findUnique({ where: { id } });
    if (!pr) throw new NotFoundException('Requisition not found');
    if (pr.status !== 'Draft') throw new BadRequestException('Only draft requisitions can be submitted.');
    return prisma.purchaseRequisition.update({ where: { id }, data: { status: 'Pending Approval' } });
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const pr = await prisma.purchaseRequisition.findUnique({ where: { id } });
    if (!pr) throw new NotFoundException('Requisition not found');
    if (!['Draft', 'Rejected'].includes(pr.status))
      throw new BadRequestException('Only Draft or Rejected requisitions can be deleted.');
    await prisma.purchaseRequisition.delete({ where: { id } });
    return { message: 'Requisition deleted' };
  }
}

// ==========================================
// SUPPLIER QUOTATION CONTROLLER
// ==========================================
@Controller('procurement/supplier-quotations')
export class SupplierQuotationsController {
  @Get('next-number')
  async nextSqNumber(@Query('company') company: string) {
    if (!company) throw new BadRequestException('company is required');
    const sqNumber = await nextRefNumber('SQ', (year) =>
      prisma.supplierQuotation.findFirst({
        where: { requisition: { company }, sqNumber: { startsWith: `SQ-${year}-` } },
        orderBy: { sqNumber: 'desc' },
        select: { sqNumber: true },
      }),
    );
    return { sqNumber };
  }

  @Post()
  async create(@Body() body: any) {
    const { requisitionId, supplierId, supplierName, currency, exchangeRate, paymentTerms, leadTimeDays, validUntil, notes, createdBy, items } = body;
    if (!requisitionId || !supplierName || !createdBy || !items?.length)
      throw new BadRequestException('requisitionId, supplierName, createdBy and items are required');

    const pr = await prisma.purchaseRequisition.findUnique({ where: { id: requisitionId } });
    if (!pr) throw new NotFoundException('Requisition not found');

    const sqNumber = await nextRefNumber('SQ', (year) =>
      prisma.supplierQuotation.findFirst({
        where: { requisition: { company: pr.company }, sqNumber: { startsWith: `SQ-${year}-` } },
        orderBy: { sqNumber: 'desc' },
        select: { sqNumber: true },
      }),
    );

    const rate = Number(exchangeRate ?? 1);
    const cleanItems = (items as any[]).map((i) => {
      const unitForeign = Number(i.unitPriceForeign ?? 0);
      const unitPhp = unitForeign * rate;
      const qty = Number(i.quotedQty ?? 0);
      return {
        productId: i.productId ? Number(i.productId) : null,
        sku: i.sku ?? null,
        productName: i.productName,
        moq: Number(i.moq ?? 1),
        quotedQty: qty,
        unitPriceForeign: unitForeign,
        unitPricePhp: unitPhp,
        lineTotal: qty * unitPhp,
      };
    });

    return prisma.supplierQuotation.create({
      data: {
        sqNumber, requisitionId,
        supplierId: supplierId ?? null,
        supplierName, currency: currency ?? 'PHP',
        exchangeRate: rate,
        paymentTerms: paymentTerms ?? null,
        leadTimeDays: leadTimeDays ? Number(leadTimeDays) : null,
        validUntil: validUntil ? new Date(validUntil) : null,
        notes: notes ?? null,
        createdBy,
        items: { create: cleanItems },
      },
      include: { items: true },
    });
  }

  @Get()
  async list(@Query('requisitionId') requisitionId: string) {
    if (!requisitionId) throw new BadRequestException('requisitionId is required');
    return prisma.supplierQuotation.findMany({
      where: { requisitionId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Patch(':id/approve')
  async approve(@Param('id') id: string, @Body() body: { approvedBy: string }) {
    if (!body?.approvedBy) throw new BadRequestException('approvedBy is required');
    const sq = await prisma.supplierQuotation.findUnique({ where: { id } });
    if (!sq) throw new NotFoundException('Quotation not found');
    // Mark sibling quotations as rejected
    await prisma.supplierQuotation.updateMany({
      where: { requisitionId: sq.requisitionId, id: { not: id } },
      data: { status: 'Rejected' },
    });
    return prisma.supplierQuotation.update({
      where: { id },
      data: { status: 'Approved', approvedBy: body.approvedBy, approvedAt: new Date() },
    });
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const sq = await prisma.supplierQuotation.findUnique({ where: { id } });
    if (!sq) throw new NotFoundException('Quotation not found');
    await prisma.supplierQuotation.delete({ where: { id } });
    return { message: 'Quotation deleted' };
  }
}
