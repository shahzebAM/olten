import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import type { SessionAdmin } from '../auth/auth-session.service';
import { numberedDocumentTransaction } from '../sales/document-numbering';
import * as v from './importation.validation';

const requisitionInclude = {
  items: { include: { product: true } },
  quotations: { include: { supplier: true, items: true } },
  purchaseOrder: true,
} as const;
const lineInclude = {
  purchaseOrderItem: { include: { po: true } },
  receipts: true,
} as const;
const receiptInclude = {
  shipment: true,
  items: { include: { shipmentLine: { include: lineInclude } } },
} as const;
const shipmentInclude = {
  importFile: true,
  items: { include: lineInclude },
  clearance: true,
  expenses: true,
  receipts: { include: { items: true } },
} as const;
type Identity = Omit<SessionAdmin, 'password'>;

@Injectable()
export class ImportationService implements OnModuleDestroy {
  private readonly prisma = new PrismaClient();

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }

  private async transaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 15000,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2034', 'P2002'].includes(error.code)
      ) {
        throw new ConflictException(
          'This record changed during processing. Refresh and try again.',
        );
      }
      throw error;
    }
  }

  private async number(tx: Prisma.TransactionClient, prefix: string) {
    const year = new Intl.DateTimeFormat('en', {
      year: 'numeric',
      timeZone: 'Asia/Manila',
    }).format(new Date());
    const sequence = await tx.importSequence.upsert({
      where: { key: `${prefix}:${year}` },
      create: { key: `${prefix}:${year}`, value: 1 },
      update: { value: { increment: 1 } },
    });
    return `${prefix}-${year}-${String(sequence.value).padStart(6, '0')}`;
  }

  private canApprove(user: Identity) {
    const modules =
      user.modules &&
      typeof user.modules === 'object' &&
      !Array.isArray(user.modules)
        ? (user.modules as Record<string, unknown>)
        : {};
    if (
      !['Super Admin', 'Admin'].includes(user.role) &&
      modules.importation_approve !== true
    ) {
      throw new ForbiddenException(
        'An administrator or purchasing approver must approve or reject requisitions.',
      );
    }
  }

  async overview(company: string) {
    const [
      requisitions,
      importFiles,
      shipments,
      receipts,
      products,
      suppliers,
      purchaseOrders,
    ] = await Promise.all([
      this.prisma.purchaseRequisition.findMany({
        where: { company },
        include: requisitionInclude,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.importFile.findMany({
        where: { company },
        include: { shipments: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.shipment.findMany({
        where: { company },
        include: shipmentInclude,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.goodsReceipt.findMany({
        where: { company },
        include: receiptInclude,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.product.findMany({
        where: { company, deletedAt: null, isActive: true },
        select: { id: true, name: true, sku: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.supplier.findMany({
        where: { company },
        select: { id: true, legalName: true },
        orderBy: { legalName: 'asc' },
      }),
      this.prisma.purchaseOrder.findMany({
        where: { company, status: { not: 'Cancelled' } },
        include: { items: { include: { shipmentLines: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      requisitions,
      importFiles,
      shipments: shipments.map((shipment) => ({
        ...shipment,
        ...v.shipmentDelay(shipment),
      })),
      receipts,
      products,
      suppliers,
      purchaseOrders,
    };
  }

  async createRequisition(company: string, user: string, input: unknown) {
    const data = v.object(input);
    const purpose = v.text(data.purpose, 'Purpose')!;
    const neededBy = v.date(data.neededBy, 'Needed by');
    const items = v.rows(data.items).map((item) => ({
      productId: v.integer(item.productId, 'Product ID', 1),
      quantity: v.integer(item.quantity, 'Quantity', 1),
    }));
    v.unique(items.map((item) => item.productId));
    return this.transaction(async (tx) => {
      const products = await tx.product.count({
        where: {
          company,
          id: { in: items.map((item) => item.productId) },
          deletedAt: null,
          isActive: true,
        },
      });
      if (products !== items.length)
        throw new BadRequestException(
          'One or more products are unavailable in this workspace.',
        );
      return tx.purchaseRequisition.create({
        data: {
          prNumber: await this.number(tx, 'PR'),
          company,
          purpose,
          neededBy,
          createdBy: user,
          items: { create: items },
        },
        include: requisitionInclude,
      });
    });
  }

  async addQuotation(
    company: string,
    user: string,
    id: string,
    input: unknown,
  ) {
    const data = v.object(input);
    const supplierId = v.text(data.supplierId, 'Supplier', true, 100)!;
    const currency = v.currency(data.currency);
    const exchangeRate = v.amount(data.exchangeRate, 'Exchange rate', true);
    if (new Prisma.Decimal(exchangeRate).decimalPlaces() > 6)
      throw new BadRequestException(
        'Exchange rates support at most six decimal places.',
      );
    if (currency === 'PHP' && exchangeRate !== 1)
      throw new BadRequestException(
        'PHP quotations must use an exchange rate of 1.',
      );
    const leadTimeDays = v.integer(data.leadTimeDays, 'Lead time');
    const paymentTerms = v.text(data.paymentTerms, 'Payment terms')!;
    const validUntil = v.date(data.validUntil, 'Valid until');
    const notes = v.text(data.notes, 'Notes', false);
    const items = v.rows(data.items).map((item) => ({
      requisitionItemId: v.text(
        item.requisitionItemId,
        'Requisition item',
        true,
        100,
      )!,
      unitCost: v.amount(item.unitCost, 'Unit cost'),
      minimumOrderQty: v.integer(
        item.minimumOrderQty ?? 1,
        'Minimum order quantity',
        1,
      ),
    }));
    if (
      items.some(
        (item) => new Prisma.Decimal(item.unitCost).decimalPlaces() > 6,
      )
    )
      throw new BadRequestException(
        'Unit costs support at most six decimal places.',
      );
    v.unique(items.map((item) => item.requisitionItemId));
    return this.transaction(async (tx) => {
      const requisition = await tx.purchaseRequisition.findFirst({
        where: { id, company },
        include: { items: true },
      });
      if (!requisition) throw new NotFoundException('Requisition not found.');
      if (requisition.status !== 'Draft')
        throw new BadRequestException(
          'Only draft requisitions can receive quotations.',
        );
      if (
        !(await tx.supplier.findFirst({ where: { id: supplierId, company } }))
      )
        throw new BadRequestException(
          'Supplier is unavailable in this workspace.',
        );
      if (
        items.length !== requisition.items.length ||
        items.some(
          (item) =>
            !requisition.items.some(
              (line) => line.id === item.requisitionItemId,
            ),
        )
      ) {
        throw new BadRequestException(
          'The quotation must cover every requisition item exactly once.',
        );
      }
      if (
        items.some(
          (item) =>
            item.minimumOrderQty >
            requisition.items.find(
              (line) => line.id === item.requisitionItemId,
            )!.quantity,
        )
      ) {
        throw new BadRequestException(
          'A quotation minimum order quantity exceeds the requested quantity.',
        );
      }
      return tx.supplierQuotation.create({
        data: {
          requisitionId: id,
          supplierId,
          currency,
          exchangeRate,
          leadTimeDays,
          paymentTerms,
          validUntil,
          notes,
          createdBy: user,
          items: { create: items },
        },
        include: { supplier: true, items: true },
      });
    });
  }

  async submit(company: string, id: string) {
    return this.transaction(async (tx) => {
      const request = await tx.purchaseRequisition.findFirst({
        where: { id, company },
        include: { quotations: true },
      });
      if (!request) throw new NotFoundException('Requisition not found.');
      if (request.status !== 'Draft' || request.quotations.length === 0)
        throw new BadRequestException(
          'A draft requisition needs at least one supplier quotation before submission.',
        );
      return tx.purchaseRequisition.update({
        where: { id },
        data: { status: 'Submitted' },
        include: requisitionInclude,
      });
    });
  }

  async approve(company: string, user: Identity, id: string, input: unknown) {
    this.canApprove(user);
    const quotationId = v.text(
      v.object(input).quotationId,
      'Quotation',
      true,
      100,
    )!;
    return numberedDocumentTransaction(this.prisma, 'PO', async (tx) => {
      const request = await tx.purchaseRequisition.findFirst({
        where: { id, company },
        include: requisitionInclude,
      });
      if (!request) throw new NotFoundException('Requisition not found.');
      if (request.status !== 'Submitted' || request.purchaseOrderId)
        throw new BadRequestException(
          'Only a submitted requisition can be approved once.',
        );
      const quote = request.quotations.find((item) => item.id === quotationId);
      if (!quote)
        throw new BadRequestException(
          'Select a quotation belonging to this requisition.',
        );
      if (quote.validUntil && v.isExpired(quote.validUntil))
        throw new BadRequestException('This quotation has expired.');
      if (
        quote.supplier.company !== company ||
        request.items.some(
          (item) =>
            item.product.company !== company ||
            item.product.deletedAt ||
            !item.product.isActive,
        )
      ) {
        throw new BadRequestException(
          'A quoted supplier or product is no longer available in this workspace.',
        );
      }
      const items = request.items.map((item) => {
        const price = quote.items.find(
          (line) => line.requisitionItemId === item.id,
        );
        if (!price || price.minimumOrderQty > item.quantity)
          throw new BadRequestException(
            'Quotation does not meet the requisition quantities.',
          );
        const unitCost = price.unitCost
          .mul(quote.exchangeRate)
          .toDecimalPlaces(6);
        return {
          productId: item.productId,
          productName: item.product.name,
          sku: item.product.sku,
          requestedQty: item.quantity,
          unitCost: unitCost.toNumber(),
          lineTotal: unitCost.mul(item.quantity).toDecimalPlaces(2).toNumber(),
        };
      });
      const subtotal = items
        .reduce(
          (total, item) => total.add(item.lineTotal),
          new Prisma.Decimal(0),
        )
        .toDecimalPlaces(2)
        .toNumber();
      let poNumber = await this.number(tx, 'PO');
      while (
        await tx.purchaseOrder.findUnique({
          where: { poNumber },
          select: { id: true },
        })
      )
        poNumber = await this.number(tx, 'PO');
      const po = await tx.purchaseOrder.create({
        data: {
          company,
          poNumber,
          supplierId: quote.supplierId,
          status: 'Generated',
          subtotal,
          grandTotal: subtotal,
          vatApplied: false,
          vatAmount: 0,
          createdBy: user.username,
          items: { create: items },
        },
      });
      return tx.purchaseRequisition.update({
        where: { id },
        data: {
          status: 'Approved',
          approvedBy: user.username,
          approvedAt: new Date(),
          selectedQuotationId: quote.id,
          purchaseOrderId: po.id,
        },
        include: requisitionInclude,
      });
    });
  }

  async reject(company: string, user: Identity, id: string, input: unknown) {
    this.canApprove(user);
    const reason = v.text(v.object(input).reason, 'Rejection reason')!;
    return this.transaction(async (tx) => {
      const request = await tx.purchaseRequisition.findFirst({
        where: { id, company },
      });
      if (!request) throw new NotFoundException('Requisition not found.');
      if (request.status !== 'Submitted')
        throw new BadRequestException(
          'Only submitted requisitions can be rejected.',
        );
      return tx.purchaseRequisition.update({
        where: { id },
        data: {
          status: 'Rejected',
          rejectionReason: reason,
          approvedBy: user.username,
          approvedAt: new Date(),
        },
        include: requisitionInclude,
      });
    });
  }

  async createImportFile(company: string, user: string, input: unknown) {
    const data = v.object(input);
    const title = v.text(data.title, 'Title')!;
    const notes = v.text(data.notes, 'Notes', false);
    return this.transaction(async (tx) =>
      tx.importFile.create({
        data: {
          importNumber: await this.number(tx, 'IMP'),
          company,
          title,
          notes,
          createdBy: user,
        },
      }),
    );
  }

  async updateImportFile(company: string, id: string, input: unknown) {
    const data = v.object(input);
    const title =
      data.title === undefined ? undefined : v.text(data.title, 'Title');
    const notes =
      data.notes === undefined
        ? undefined
        : (v.text(data.notes, 'Notes', false) ?? null);
    const status =
      data.status === undefined
        ? undefined
        : v.choice(data.status, ['Open', 'Closed'], 'import file status');
    return this.transaction(async (tx) => {
      const file = await tx.importFile.findFirst({
        where: { id, company },
        include: { shipments: true },
      });
      if (!file) throw new NotFoundException('Import file not found.');
      if (
        status === 'Closed' &&
        file.shipments.some((shipment) => shipment.status !== 'Closed')
      )
        throw new BadRequestException(
          'Close all shipments before closing this import file.',
        );
      return tx.importFile.update({
        where: { id },
        data: { title, notes, status },
      });
    });
  }

  private logistics(data: Record<string, unknown>) {
    const result: Record<string, string | Date | null | undefined> = {};
    for (const field of [
      'forwarder',
      'carrier',
      'blAwbNumber',
      'containerReference',
      'notes',
    ]) {
      if (data[field] !== undefined)
        result[field] = v.text(data[field], field, false) ?? null;
    }
    for (const field of ['etd', 'eta', 'revisedEta', 'actualArrival']) {
      if (data[field] !== undefined)
        result[field] = v.date(data[field], field) ?? null;
    }
    if (data.mode !== undefined)
      result.mode = v.choice(
        data.mode,
        ['Sea', 'Air', 'Land'],
        'shipping mode',
      );
    return result;
  }

  private checkDates(shipment: {
    etd?: Date | null;
    eta?: Date | null;
    revisedEta?: Date | null;
    actualArrival?: Date | null;
  }) {
    if (
      shipment.etd &&
      ((shipment.eta && shipment.eta < shipment.etd) ||
        (shipment.revisedEta && shipment.revisedEta < shipment.etd) ||
        (shipment.actualArrival && shipment.actualArrival < shipment.etd))
    ) {
      throw new BadRequestException(
        'Arrival dates cannot be earlier than departure.',
      );
    }
    if (
      shipment.actualArrival &&
      v.manilaDay(shipment.actualArrival) > v.manilaDay(new Date())
    )
      throw new BadRequestException('Actual arrival cannot be in the future.');
  }

  async createShipment(company: string, user: string, input: unknown) {
    const data = v.object(input);
    const importFileId = v.text(data.importFileId, 'Import file', true, 100)!;
    const mode = v.choice(data.mode, ['Sea', 'Air', 'Land'], 'shipping mode');
    const logistics = this.logistics(data);
    if (logistics.actualArrival)
      throw new BadRequestException(
        'Create a planned shipment before recording arrival.',
      );
    this.checkDates(logistics);
    const items = v.rows(data.items).map((item) => ({
      purchaseOrderItemId: v.text(
        item.purchaseOrderItemId,
        'PO item',
        true,
        100,
      )!,
      shippedQty: v.integer(item.shippedQty, 'Shipped quantity', 1),
    }));
    v.unique(items.map((item) => item.purchaseOrderItemId));
    return this.transaction(async (tx) => {
      if (
        !(await tx.importFile.findFirst({
          where: { id: importFileId, company, status: 'Open' },
        }))
      )
        throw new BadRequestException(
          'Select an open import file in this workspace.',
        );
      for (const item of items) {
        const poItem = await tx.purchaseOrderItem.findFirst({
          where: { id: item.purchaseOrderItemId, po: { company } },
          include: { po: true, shipmentLines: true },
        });
        if (
          !poItem ||
          ['Cancelled', 'Received', 'Stocked'].includes(poItem.po.status)
        )
          throw new BadRequestException(
            'A selected PO item is unavailable for shipment.',
          );
        if (poItem.confirmedQty && poItem.shipmentLines.length === 0)
          throw new BadRequestException(
            'A PO already received through legacy receiving cannot be added to importation.',
          );
        if (
          poItem.shipmentLines.reduce((sum, line) => sum + line.shippedQty, 0) +
            item.shippedQty >
          poItem.requestedQty
        )
          throw new BadRequestException(
            'Total shipped quantity cannot exceed the PO ordered quantity.',
          );
        if (
          !(await tx.product.findFirst({
            where: { id: poItem.productId, company, deletedAt: null },
          }))
        )
          throw new BadRequestException(
            'A selected product is unavailable in this workspace.',
          );
      }
      return tx.shipment.create({
        data: {
          ...logistics,
          company,
          importFileId,
          mode,
          shipmentNumber: await this.number(tx, 'SHP'),
          createdBy: user,
          items: { create: items },
        },
        include: shipmentInclude,
      });
    });
  }

  async updateShipment(company: string, id: string, input: unknown) {
    const data = v.object(input);
    const logistics = this.logistics(data);
    const status =
      data.status === undefined
        ? undefined
        : v.choice(
            data.status,
            ['Planned', 'In Transit', 'Arrived', 'Closed'],
            'shipment status',
          );
    return this.transaction(async (tx) => {
      const shipment = await tx.shipment.findFirst({
        where: { id, company },
        include: { items: { include: { receipts: true } } },
      });
      if (!shipment) throw new NotFoundException('Shipment not found.');
      const merged = { ...shipment, ...logistics };
      this.checkDates(merged);
      const nextStatus = status ?? shipment.status;
      const order = ['Planned', 'In Transit', 'Arrived', 'Closed'];
      if (order.indexOf(nextStatus) < order.indexOf(shipment.status))
        throw new BadRequestException('Shipment status cannot move backwards.');
      if (nextStatus === 'Arrived' || nextStatus === 'Closed') {
        if (!merged.actualArrival)
          throw new BadRequestException(
            'Record actual arrival before marking a shipment arrived or closed.',
          );
      } else if (merged.actualArrival)
        throw new BadRequestException(
          'Use Arrived status when recording actual arrival.',
        );
      if (shipment.status === 'Closed')
        throw new BadRequestException('Closed shipments cannot be edited.');
      if (
        nextStatus === 'Closed' &&
        shipment.items.some(
          (line) =>
            line.clearedQty !== line.shippedQty ||
            line.receipts.reduce(
              (sum, receipt) => sum + receipt.receivedQty,
              0,
            ) !== line.shippedQty ||
            line.receipts.some(
              (receipt) =>
                receipt.heldQty > 0 || receipt.placedQty < receipt.acceptedQty,
            ),
        )
      ) {
        throw new BadRequestException(
          'Clear, receive, resolve QC holds, and place all accepted stock before closing the shipment.',
        );
      }
      return tx.shipment.update({
        where: { id },
        data: { ...logistics, status },
        include: shipmentInclude,
      });
    });
  }

  async clearance(company: string, user: string, id: string, input: unknown) {
    const data = v.object(input);
    const status = v.choice(
      data.status,
      ['Pending', 'In Progress', 'Cleared'],
      'clearance status',
    );
    const broker = v.text(data.broker, 'Broker', false);
    const declarationReference = v.text(
      data.declarationReference,
      'Declaration reference',
      false,
    );
    const entryReference = v.text(
      data.entryReference,
      'Entry reference',
      false,
    );
    const clearanceDate = v.date(data.clearanceDate, 'Clearance date');
    const items = v.rows(data.items).map((item) => ({
      shipmentLineId: v.text(item.shipmentLineId, 'Shipment line', true, 100)!,
      clearedQty: v.integer(item.clearedQty, 'Cleared quantity'),
    }));
    v.unique(items.map((item) => item.shipmentLineId));
    if (status === 'Cleared' && !clearanceDate)
      throw new BadRequestException(
        'A clearance date is required for cleared shipments.',
      );
    if (clearanceDate && v.manilaDay(clearanceDate) > v.manilaDay(new Date()))
      throw new BadRequestException('Clearance date cannot be in the future.');
    return this.transaction(async (tx) => {
      const shipment = await tx.shipment.findFirst({
        where: { id, company },
        include: { items: { include: { receipts: true } } },
      });
      if (!shipment) throw new NotFoundException('Shipment not found.');
      if (shipment.status === 'Closed')
        throw new BadRequestException('Closed shipments cannot be edited.');
      if (items.length !== shipment.items.length)
        throw new BadRequestException(
          'Provide clearance quantities for every shipment line.',
        );
      for (const item of items) {
        const line = shipment.items.find(
          (candidate) => candidate.id === item.shipmentLineId,
        );
        if (
          !line ||
          item.clearedQty > line.shippedQty ||
          item.clearedQty <
            line.receipts.reduce((sum, receipt) => sum + receipt.receivedQty, 0)
        )
          throw new BadRequestException(
            'Cleared quantities must be between received and shipped quantities.',
          );
        if (status === 'Cleared' && item.clearedQty !== line.shippedQty)
          throw new BadRequestException(
            'Fully cleared status requires every shipped unit to be cleared.',
          );
        if (status === 'Pending' && item.clearedQty > 0)
          throw new BadRequestException(
            'Use In Progress or Cleared status when clearing quantities.',
          );
        await tx.shipmentLine.update({
          where: { id: line.id },
          data: { clearedQty: item.clearedQty },
        });
      }
      return tx.shipmentClearance.upsert({
        where: { shipmentId: id },
        create: {
          shipmentId: id,
          broker,
          declarationReference,
          entryReference,
          clearanceDate,
          status,
          updatedBy: user,
        },
        update: {
          broker,
          declarationReference,
          entryReference,
          clearanceDate,
          status,
          updatedBy: user,
        },
      });
    });
  }

  async expense(
    company: string,
    user: string,
    id: string,
    input: unknown,
    update = false,
  ) {
    const data = v.object(input);
    const category = v.choice(
      data.category,
      [
        'Duties',
        'Taxes',
        'Brokerage',
        'Port Handling',
        'Storage',
        'Demurrage',
        'Other',
      ],
      'expense category',
    );
    const description = v.text(data.description, 'Description')!;
    const currency = v.currency(data.currency);
    const amount = new Prisma.Decimal(
      v.amount(data.amount, 'Expense amount'),
    ).toDecimalPlaces(2);
    const status = v.choice(
      data.status,
      ['Estimated', 'Accrued', 'Invoiced', 'Paid'],
      'expense status',
    );
    const invoiceReference = v.text(
      data.invoiceReference,
      'Invoice reference',
      false,
    );
    const paidAt = v.date(data.paidAt, 'Payment date');
    if (status === 'Paid' && !paidAt)
      throw new BadRequestException(
        'Payment date is required for paid expenses.',
      );
    if (status !== 'Paid' && paidAt)
      throw new BadRequestException('A payment date requires Paid status.');
    if (paidAt && v.manilaDay(paidAt) > v.manilaDay(new Date()))
      throw new BadRequestException('Payment date cannot be in the future.');
    return this.transaction(async (tx) => {
      if (update) {
        const expense = await tx.importExpense.findFirst({
          where: { id, shipment: { company } },
        });
        if (!expense) throw new NotFoundException('Expense not found.');
        return tx.importExpense.update({
          where: { id },
          data: {
            category,
            description,
            currency,
            amount,
            status,
            invoiceReference: invoiceReference ?? null,
            paidAt: paidAt ?? null,
          },
        });
      }
      if (!(await tx.shipment.findFirst({ where: { id, company } })))
        throw new NotFoundException('Shipment not found.');
      return tx.importExpense.create({
        data: {
          shipmentId: id,
          category,
          description,
          currency,
          amount,
          status,
          invoiceReference,
          paidAt,
          createdBy: user,
        },
      });
    });
  }

  async receipt(company: string, user: string, id: string, input: unknown) {
    const data = v.object(input);
    const receivedAt = v.date(data.receivedAt, 'Received at') ?? new Date();
    if (v.manilaDay(receivedAt) > v.manilaDay(new Date()))
      throw new BadRequestException('Received date cannot be in the future.');
    const notes = v.text(data.notes, 'Notes', false);
    const items = v.rows(data.items).map((item) => {
      const receivedQty = v.integer(item.receivedQty, 'Received quantity');
      const photos = v.photos(item.photos);
      const notes = v.text(item.notes, 'Line notes', false);
      if (receivedQty === 0 && !notes && photos.length === 0) {
        throw new BadRequestException(
          'A missing delivery requires discrepancy notes or photos.',
        );
      }
      return {
        shipmentLineId: v.text(
          item.shipmentLineId,
          'Shipment line',
          true,
          100,
        )!,
        receivedQty,
        ...v.qcQuantities(item, receivedQty),
        batchNumber: v.text(item.batchNumber, 'Batch number', false, 200),
        expirationDate: v.date(item.expirationDate, 'Expiration date'),
        photos,
        notes,
        inspectedBy: user,
      };
    });
    v.unique(items.map((item) => item.shipmentLineId));
    return this.transaction(async (tx) => {
      const shipment = await tx.shipment.findFirst({
        where: { id, company },
        include: { items: { include: { receipts: true } } },
      });
      if (!shipment) throw new NotFoundException('Shipment not found.');
      if (shipment.status !== 'Arrived' || !shipment.actualArrival)
        throw new BadRequestException(
          'Record shipment arrival before receiving goods.',
        );
      if (v.manilaDay(receivedAt) < v.manilaDay(shipment.actualArrival))
        throw new BadRequestException(
          'Receipt cannot precede shipment arrival.',
        );
      for (const item of items) {
        const line = shipment.items.find(
          (candidate) => candidate.id === item.shipmentLineId,
        );
        if (
          !line ||
          line.receipts.reduce((sum, receipt) => sum + receipt.receivedQty, 0) +
            item.receivedQty >
            line.clearedQty
        )
          throw new BadRequestException(
            'Cumulative received quantity cannot exceed the cleared quantity.',
          );
        if (
          item.expirationDate &&
          v.isExpired(item.expirationDate, receivedAt) &&
          item.acceptedQty > 0
        )
          throw new BadRequestException(
            'Expired goods must be rejected or held for review.',
          );
      }
      const receipt = await tx.goodsReceipt.create({
        data: {
          grnNumber: await this.number(tx, 'GRN'),
          company,
          shipmentId: id,
          receivedAt,
          notes,
          createdBy: user,
          items: { create: items },
        },
        include: receiptInclude,
      });
      const purchaseOrderItemIds = shipment.items
        .filter((line) => items.some((item) => item.shipmentLineId === line.id))
        .map((line) => line.purchaseOrderItemId);
      const purchaseOrders = await tx.purchaseOrder.findMany({
        where: {
          company,
          items: { some: { id: { in: purchaseOrderItemIds } } },
        },
        include: {
          items: {
            include: { shipmentLines: { include: { receipts: true } } },
          },
        },
      });
      for (const po of purchaseOrders) {
        let totalReceived = 0;
        let fullyReceived = true;
        for (const line of po.items) {
          const confirmedQty =
            line.shipmentLines.length > 0
              ? line.shipmentLines.reduce(
                  (sum, shipmentLine) =>
                    sum +
                    shipmentLine.receipts.reduce(
                      (received, receiptLine) =>
                        received + receiptLine.receivedQty,
                      0,
                    ),
                  0,
                )
              : (line.confirmedQty ?? 0);
          totalReceived += confirmedQty;
          if (confirmedQty < line.requestedQty) fullyReceived = false;
          if (line.shipmentLines.length > 0) {
            await tx.purchaseOrderItem.update({
              where: { id: line.id },
              data: {
                confirmedQty,
                shortageQty: Math.max(0, line.requestedQty - confirmedQty),
              },
            });
          }
        }
        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: {
            status: fullyReceived
              ? 'Received'
              : totalReceived > 0
                ? 'Partially Received'
                : 'Generated',
            updatedBy: user,
            receivedAt,
          },
        });
      }
      return receipt;
    });
  }

  async qc(company: string, user: string, id: string, input: unknown) {
    const data = v.object(input);
    return this.transaction(async (tx) => {
      const line = await tx.goodsReceiptLine.findFirst({
        where: { id, receipt: { company } },
        include: { receipt: { include: { shipment: true } } },
      });
      if (!line) throw new NotFoundException('Receipt line not found.');
      if (line.receipt.shipment.status === 'Closed')
        throw new BadRequestException(
          'Closed shipments cannot be reinspected.',
        );
      const quantities = v.qcQuantities(data, line.receivedQty, line.placedQty);
      if (
        quantities.acceptedQty > line.acceptedQty &&
        line.expirationDate &&
        v.isExpired(line.expirationDate)
      )
        throw new BadRequestException(
          'Expired goods cannot be released to available stock.',
        );
      return tx.goodsReceiptLine.update({
        where: { id },
        data: {
          ...quantities,
          notes: v.text(data.notes, 'Notes', false),
          ...(data.photos === undefined
            ? {}
            : { photos: v.photos(data.photos) }),
          inspectedBy: user,
        },
      });
    });
  }
}
