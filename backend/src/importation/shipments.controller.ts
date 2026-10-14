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
// IMPORT FILES CONTROLLER  (IMP-YYYY-XXXXXX)
// ==========================================
@Controller('importation/import-files')
export class ImportFilesController {
  @Get('next-number')
  async nextImpNumber(@Query('company') company: string) {
    if (!company) throw new BadRequestException('company is required');
    const impNumber = await nextRefNumber('IMP', (year) =>
      prisma.importFile.findFirst({
        where: { company, impNumber: { startsWith: `IMP-${year}-` } },
        orderBy: { impNumber: 'desc' },
        select: { impNumber: true },
      }),
    );
    return { impNumber };
  }

  @Post()
  async create(@Body() body: any) {
    const { company, title, supplierId, supplierName, origin, notes, createdBy } = body;
    if (!company || !createdBy) throw new BadRequestException('company and createdBy are required');

    const impNumber = await nextRefNumber('IMP', (year) =>
      prisma.importFile.findFirst({
        where: { company, impNumber: { startsWith: `IMP-${year}-` } },
        orderBy: { impNumber: 'desc' },
        select: { impNumber: true },
      }),
    );

    return prisma.importFile.create({
      data: {
        impNumber, company,
        title: title ?? null,
        supplierId: supplierId ?? null,
        supplierName: supplierName ?? null,
        origin: origin ?? null,
        notes: notes ?? null,
        createdBy,
      },
    });
  }

  @Get()
  async list(@Query('company') company: string, @Query('status') status?: string) {
    if (!company) throw new BadRequestException('company is required');
    return prisma.importFile.findMany({
      where: { company, ...(status ? { status } : {}) },
      include: {
        shipments: {
          include: { poLinks: { include: { po: true } }, customsEntries: true, goodsReceipts: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const imp = await prisma.importFile.findUnique({
      where: { id },
      include: {
        shipments: { include: { poLinks: { include: { po: { include: { items: true } } } }, customsEntries: { include: { expenses: true } }, goodsReceipts: { include: { lines: true } } } },
        documents: true,
      },
    });
    if (!imp) throw new NotFoundException('Import file not found');
    return imp;
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    const imp = await prisma.importFile.findUnique({ where: { id } });
    if (!imp) throw new NotFoundException('Import file not found');
    const { title, supplierId, supplierName, origin, status, notes } = body;
    return prisma.importFile.update({
      where: { id },
      data: {
        title: title ?? imp.title,
        supplierId: supplierId ?? imp.supplierId,
        supplierName: supplierName ?? imp.supplierName,
        origin: origin ?? imp.origin,
        status: status ?? imp.status,
        notes: notes ?? imp.notes,
      },
    });
  }

  @Post(':id/link-document')
  async linkDocument(@Param('id') id: string, @Body() body: { documentId: number; docLinkStatus?: string }) {
    if (!body?.documentId) throw new BadRequestException('documentId is required');
    const imp = await prisma.importFile.findUnique({ where: { id } });
    if (!imp) throw new NotFoundException('Import file not found');
    return prisma.document.update({
      where: { id: Number(body.documentId) },
      data: {
        importFileId: id,
        docLinkStatus: body.docLinkStatus ?? 'received',
      },
    });
  }

  @Delete(':id/unlink-document/:docId')
  async unlinkDocument(@Param('id') id: string, @Param('docId') docId: string) {
    return prisma.document.update({
      where: { id: Number(docId) },
      data: { importFileId: null, docLinkStatus: null },
    });
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const imp = await prisma.importFile.findUnique({ where: { id }, include: { shipments: true } });
    if (!imp) throw new NotFoundException('Import file not found');
    if (imp.shipments.length > 0) throw new BadRequestException('Cannot delete an Import File that has linked shipments.');
    await prisma.importFile.delete({ where: { id } });
    return { message: 'Import file deleted' };
  }
}

// ==========================================
// SHIPMENTS CONTROLLER  (SHP-YYYY-XXXXXX)
// ==========================================
@Controller('importation/shipments')
export class ShipmentsController {
  @Get('next-number')
  async nextShpNumber(@Query('company') company: string) {
    if (!company) throw new BadRequestException('company is required');
    const shpNumber = await nextRefNumber('SHP', (year) =>
      prisma.shipment.findFirst({
        where: { company, shpNumber: { startsWith: `SHP-${year}-` } },
        orderBy: { shpNumber: 'desc' },
        select: { shpNumber: true },
      }),
    );
    return { shpNumber };
  }

  @Post()
  async create(@Body() body: any) {
    const { importFileId, company, forwarder, carrier, shippingMode, blAwbNumber, containerRef, portOfOrigin, portOfDestination, etd, eta, notes, createdBy, poIds } = body;
    if (!importFileId || !company || !createdBy) throw new BadRequestException('importFileId, company and createdBy are required');

    const impFile = await prisma.importFile.findUnique({ where: { id: importFileId } });
    if (!impFile) throw new NotFoundException('Import file not found');

    const shpNumber = await nextRefNumber('SHP', (year) =>
      prisma.shipment.findFirst({
        where: { company, shpNumber: { startsWith: `SHP-${year}-` } },
        orderBy: { shpNumber: 'desc' },
        select: { shpNumber: true },
      }),
    );

    return prisma.$transaction(async (tx) => {
      const shipment = await tx.shipment.create({
        data: {
          shpNumber, importFileId, company,
          forwarder: forwarder ?? null,
          carrier: carrier ?? null,
          shippingMode: shippingMode ?? null,
          blAwbNumber: blAwbNumber ?? null,
          containerRef: containerRef ?? null,
          portOfOrigin: portOfOrigin ?? null,
          portOfDestination: portOfDestination ?? null,
          etd: etd ? new Date(etd) : null,
          eta: eta ? new Date(eta) : null,
          notes: notes ?? null,
          createdBy,
        },
      });
      // Link POs if provided
      if (Array.isArray(poIds) && poIds.length > 0) {
        await tx.shipmentPO.createMany({
          data: (poIds as string[]).map((poId) => ({ shipmentId: shipment.id, poId, addedBy: createdBy })),
          skipDuplicates: true,
        });
      }
      return tx.shipment.findUnique({
        where: { id: shipment.id },
        include: { poLinks: { include: { po: true } } },
      });
    });
  }

  @Get()
  async list(@Query('importFileId') importFileId?: string, @Query('company') company?: string) {
    const where = importFileId ? { importFileId } : company ? { company } : undefined;
    if (!where) throw new BadRequestException('importFileId or company is required');
    return prisma.shipment.findMany({
      where,
      include: {
        poLinks: { include: { po: { include: { items: true } } } },
        customsEntries: { include: { expenses: true } },
        goodsReceipts: { include: { lines: true } },
        documents: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const shp = await prisma.shipment.findUnique({
      where: { id },
      include: {
        poLinks: { include: { po: { include: { items: true } } } },
        customsEntries: { include: { expenses: true } },
        goodsReceipts: { include: { lines: true } },
        documents: true,
      },
    });
    if (!shp) throw new NotFoundException('Shipment not found');
    return shp;
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    const shp = await prisma.shipment.findUnique({ where: { id } });
    if (!shp) throw new NotFoundException('Shipment not found');
    const { forwarder, carrier, shippingMode, blAwbNumber, containerRef, portOfOrigin, portOfDestination, etd, eta, revisedEta, actualArrival, status, delayReason, notes } = body;
    return prisma.shipment.update({
      where: { id },
      data: {
        forwarder: forwarder ?? shp.forwarder,
        carrier: carrier ?? shp.carrier,
        shippingMode: shippingMode ?? shp.shippingMode,
        blAwbNumber: blAwbNumber ?? shp.blAwbNumber,
        containerRef: containerRef ?? shp.containerRef,
        portOfOrigin: portOfOrigin ?? shp.portOfOrigin,
        portOfDestination: portOfDestination ?? shp.portOfDestination,
        etd: etd ? new Date(etd) : shp.etd,
        eta: eta ? new Date(eta) : shp.eta,
        revisedEta: revisedEta ? new Date(revisedEta) : shp.revisedEta,
        actualArrival: actualArrival ? new Date(actualArrival) : shp.actualArrival,
        status: status ?? shp.status,
        delayReason: delayReason ?? shp.delayReason,
        notes: notes ?? shp.notes,
      },
    });
  }

  // Link a PO to this shipment
  @Post(':id/link-po')
  async linkPo(@Param('id') shipmentId: string, @Body() body: { poId: string; addedBy?: string }) {
    if (!body?.poId) throw new BadRequestException('poId is required');
    const shp = await prisma.shipment.findUnique({ where: { id: shipmentId } });
    if (!shp) throw new NotFoundException('Shipment not found');
    const po = await prisma.purchaseOrder.findUnique({ where: { id: body.poId } });
    if (!po) throw new NotFoundException('Purchase Order not found');
    return prisma.shipmentPO.upsert({
      where: { shipmentId_poId: { shipmentId, poId: body.poId } },
      update: {},
      create: { shipmentId, poId: body.poId, addedBy: body.addedBy ?? null },
    });
  }

  @Delete(':id/unlink-po/:poId')
  async unlinkPo(@Param('id') shipmentId: string, @Param('poId') poId: string) {
    await prisma.shipmentPO.delete({ where: { shipmentId_poId: { shipmentId, poId } } }).catch(() => {});
    return { message: 'PO unlinked from shipment' };
  }

  @Post(':id/link-document')
  async linkDocument(@Param('id') id: string, @Body() body: { documentId: number; docLinkStatus?: string }) {
    if (!body?.documentId) throw new BadRequestException('documentId is required');
    const shp = await prisma.shipment.findUnique({ where: { id } });
    if (!shp) throw new NotFoundException('Shipment not found');
    return prisma.document.update({
      where: { id: Number(body.documentId) },
      data: {
        shipmentId: id,
        docLinkStatus: body.docLinkStatus ?? 'received',
      },
    });
  }

  @Delete(':id/unlink-document/:docId')
  async unlinkDocument(@Param('id') id: string, @Param('docId') docId: string) {
    return prisma.document.update({
      where: { id: Number(docId) },
      data: { shipmentId: null, docLinkStatus: null },
    });
  }

  @Patch('document-status/:docId')
  async updateDocStatus(@Param('docId') docId: string, @Body() body: { docLinkStatus: string }) {
    if (!body?.docLinkStatus) throw new BadRequestException('docLinkStatus is required');
    return prisma.document.update({
      where: { id: Number(docId) },
      data: { docLinkStatus: body.docLinkStatus },
    });
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const shp = await prisma.shipment.findUnique({ where: { id }, include: { goodsReceipts: true } });
    if (!shp) throw new NotFoundException('Shipment not found');
    if (shp.goodsReceipts.length > 0) throw new BadRequestException('Cannot delete a shipment with existing GRNs.');
    await prisma.shipment.delete({ where: { id } });
    return { message: 'Shipment deleted' };
  }
}
