import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { FinanceDocument, Prisma, PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import * as v from '../importation/importation.validation';
import {
  mappedLines,
  postingAccounts,
  sourcePostingAccounts,
} from './posting-accounts';
import {
  Actor,
  Tx,
  assertApproval,
  audit,
  erpRoles,
  hasAccess,
  money,
  nextNumber,
  postJournal,
} from './phase3.shared';
import {
  allocateCents,
  billCalculation,
  CostExpense,
  CostItem,
  decimal,
  exchangeRate,
  landedCalculation,
  outstanding,
  roundMoney,
  sum,
} from './finance.calculations';

const balanceInclude = {
  memos: true,
  allocations: { include: { payment: true } },
} satisfies Prisma.FinanceDocumentInclude;
const MAX_BALANCES = 5000;
function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
function requiredDate(value: unknown, label: string) {
  const result = v.date(value, label);
  if (!result) throw new BadRequestException(`${label} is required.`);
  return result;
}
function id(value: unknown, label = 'ID') {
  return v.text(value, label, true, 200)!;
}
function allocateMemoAccounts(
  total: Prisma.Decimal,
  base: { code: string; debit: string }[],
) {
  const shares = allocateCents(
    total,
    base.map((line) => new Prisma.Decimal(line.debit)),
  );
  return base
    .map((line, index) => ({
      code: line.code,
      amount: shares[index].toFixed(2),
    }))
    .filter((line) => new Prisma.Decimal(line.amount).gt(0));
}

@Injectable()
export class FinanceService implements OnModuleDestroy {
  private readonly prisma = new PrismaClient();
  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
  private require(actor: Actor, scope: 'finance' | 'landed', write = false) {
    if (!hasAccess(actor, scope, write))
      throw new ForbiddenException(
        'Your ERP role does not permit this finance operation.',
      );
  }
  private direction(actor: Actor, value: unknown) {
    const direction = v.choice(value, ['AR', 'AP'], 'direction') as 'AR' | 'AP';
    const privileged =
      actor.role === 'Super Admin' ||
      erpRoles(actor).some((role) =>
        ['Management', 'Finance', 'Auditor'].includes(role),
      );
    if (direction === 'AP' && !privileged)
      throw new ForbiddenException('Supplier balances require Finance access.');
    return direction;
  }
  private async transaction<T>(
    company: string,
    work: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          if (
            !(await tx.company.findUnique({
              where: { name: company },
              select: { id: true },
            }))
          )
            throw new NotFoundException('This workspace is unavailable.');
          return work(tx);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10000,
          timeout: 30000,
        },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (['P2002', 'P2034'].includes(error.code) ||
          (error.code === 'P2010' &&
            ['40001', '40P01'].includes(String(error.meta?.code))))
      )
        throw new ConflictException(
          'This record changed or was already submitted. Refresh and retry.',
        );
      throw error;
    }
  }
  private async lockDocument(tx: Tx, company: string, documentId: string) {
    await tx.$queryRaw`SELECT id FROM "FinanceDocument" WHERE id = ${documentId} AND company = ${company} FOR UPDATE`;
    const document = await tx.financeDocument.findFirst({
      where: { id: documentId, company },
      include: balanceInclude,
    });
    if (!document)
      throw new NotFoundException(
        'Financial document not found in this workspace.',
      );
    return document;
  }

  async overview(company: string, actor: Actor) {
    const landed = hasAccess(actor, 'landed');
    const finance = hasAccess(actor, 'finance');
    if (!landed && !finance) throw new ForbiddenException();
    const allFinance =
      finance &&
      (actor.role === 'Super Admin' ||
        erpRoles(actor).some((role) =>
          ['Management', 'Finance', 'Auditor'].includes(role),
        ));
    const [
      landedCosts,
      documents,
      payments,
      paymentRequests,
      shipments,
      deliveries,
      customers,
      suppliers,
      products,
    ] = await Promise.all([
      landed
        ? this.prisma.landedCost.findMany({
            where: { company },
            orderBy: { createdAt: 'desc' },
            take: 200,
            include: { shipment: { select: { shipmentNumber: true } } },
          })
        : Promise.resolve([]),
      finance
        ? this.prisma.financeDocument.findMany({
            where: { company, ...(allFinance ? {} : { direction: 'AR' }) },
            orderBy: { createdAt: 'desc' },
            take: 300,
          })
        : Promise.resolve([]),
      finance
        ? this.prisma.financePayment.findMany({
            where: { company, ...(allFinance ? {} : { direction: 'AR' }) },
            orderBy: { createdAt: 'desc' },
            take: 200,
            include: { allocations: true },
          })
        : Promise.resolve([]),
      allFinance
        ? this.prisma.paymentRequest.findMany({
            where: { company },
            orderBy: { createdAt: 'desc' },
            take: 200,
          })
        : Promise.resolve([]),
      landed
        ? this.prisma.shipment.findMany({
            where: { company },
            include: {
              items: { include: { purchaseOrderItem: true } },
              expenses: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 200,
          })
        : Promise.resolve([]),
      finance
        ? this.prisma.delivery.findMany({
            where: {
              company,
              status: { in: ['PartiallyDelivered', 'Delivered'] },
            },
            include: {
              order: true,
              items: true,
              sources: { where: { cancelledAt: null } },
              pods: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 200,
          })
        : Promise.resolve([]),
      finance
        ? this.prisma.customer.findMany({
            where: { company },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
          })
        : Promise.resolve([]),
      landed || allFinance
        ? this.prisma.supplier.findMany({
            where: { company },
            select: { id: true, legalName: true },
            orderBy: { legalName: 'asc' },
          })
        : Promise.resolve([]),
      landed
        ? this.prisma.product.findMany({
            where: { company },
            select: {
              id: true,
              name: true,
              sku: true,
              landedCostReference: true,
            },
          })
        : Promise.resolve([]),
    ] as const);
    const customerMap = new Map<string, { id: string; name: string }>(
      customers.map(
        (customer: { id: string; name: string }) =>
          [customer.id, customer] as const,
      ),
    );
    return {
      landedCosts,
      documents: allFinance
        ? documents
        : documents.map((document: FinanceDocument) => ({
            id: document.id,
            number: document.number,
            kind: document.kind,
            status: document.status,
            direction: document.direction,
            partyId: document.partyId,
            dueDate: document.dueDate,
            total: document.total,
            subtotal: document.subtotal,
            taxAmount: document.taxAmount,
            currency: document.currency,
          })),
      payments,
      paymentRequests,
      shipments,
      deliveries: deliveries.map(
        (
          delivery: Prisma.DeliveryGetPayload<{
            include: { order: true; items: true; sources: true; pods: true };
          }>,
        ) => ({
          ...delivery,
          customer: customerMap.get(delivery.order.customerId),
          order: {
            ...delivery.order,
            customer: customerMap.get(delivery.order.customerId),
          },
        }),
      ),
      customers,
      suppliers,
      products,
      access: { landed, finance, approve: hasAccess(actor, 'finance', true) },
      limit: 200,
    };
  }

  async createLandedCost(company: string, actor: Actor, body: unknown) {
    this.require(actor, 'landed', true);
    const input = v.object(body);
    const shipmentId = id(input.shipmentId, 'Shipment');
    const allocationMethod = v.choice(
      input.allocationMethod,
      ['VALUE', 'WEIGHT', 'VOLUME', 'QUANTITY'],
      'allocation method',
    );
    const rawItems = v.rows(input.items);
    const rawExpenses = input.expenses === undefined ? [] : input.expenses;
    if (!Array.isArray(rawExpenses) || rawExpenses.length > 200)
      throw new BadRequestException('Provide at most 200 expenses.');
    const expenses: CostExpense[] = rawExpenses.map((raw: unknown) => {
      const line = v.object(raw);
      const currency = v.currency(line.currency);
      return {
        category: v.choice(
          line.category,
          [
            'FREIGHT',
            'INSURANCE',
            'CUSTOMS_DUTY',
            'PORT',
            'BROKERAGE',
            'OTHER',
          ],
          'expense category',
        ),
        description: v.text(line.description, 'Expense description')!,
        amount: money(line.amount, 'Expense amount').toFixed(2),
        currency,
        exchangeRate: exchangeRate(currency, line.exchangeRate).toString(),
      };
    });
    return this.transaction(company, async (tx) => {
      const shipment = await tx.shipment.findFirst({
        where: { id: shipmentId, company },
        include: {
          items: { include: { purchaseOrderItem: { include: { po: true } } } },
        },
      });
      if (!shipment)
        throw new NotFoundException('Shipment not found in this workspace.');
      v.unique(rawItems.map((line) => id(line.shipmentLineId)));
      if (rawItems.length !== shipment.items.length)
        throw new BadRequestException(
          'Every shipment line requires exactly one invoice cost.',
        );
      const items: CostItem[] = rawItems
        .map((line) => {
          const source = shipment.items.find(
            (item) => item.id === line.shipmentLineId,
          );
          if (!source || source.purchaseOrderItem.po.company !== company)
            throw new BadRequestException(
              'Shipment line does not belong to this workspace.',
            );
          const quantity = v.integer(line.quantity, 'Invoice quantity', 1);
          if (quantity !== source.shippedQty)
            throw new BadRequestException(
              'Invoice quantity must match the shipment line quantity.',
            );
          const currency = v.currency(line.currency);
          return {
            shipmentLineId: source.id,
            productId: source.purchaseOrderItem.productId,
            quantity,
            unitPrice: decimal(line.unitPrice, 'Invoice unit price').toString(),
            currency,
            exchangeRate: exchangeRate(currency, line.exchangeRate).toString(),
            weight: decimal(line.weight ?? '0', 'Unit weight').toString(),
            volume: decimal(line.volume ?? '0', 'Unit volume').toString(),
          };
        })
        .sort((a, b) => a.shipmentLineId.localeCompare(b.shipmentLineId));
      const productIds = [...new Set(items.map((line) => line.productId))];
      if (
        (await tx.product.count({
          where: { company, id: { in: productIds } },
        })) !== productIds.length
      )
        throw new BadRequestException(
          'Shipment products must belong to this workspace.',
        );
      const calculated = landedCalculation(items, expenses, allocationMethod);
      const record = await tx.landedCost.create({
        data: {
          company,
          number: await nextNumber(tx, company, 'LC'),
          shipmentId,
          status: 'PROVISIONAL',
          allocationMethod,
          total: calculated.total,
          data: json({ items, expenses, ...calculated }),
          createdBy: actor.username,
        },
      });
      await audit(tx, company, actor, 'CALCULATE', 'LandedCost', record.id, {
        total: calculated.total,
        allocationMethod,
      });
      return record;
    });
  }

  async finalizeLandedCost(company: string, actor: Actor, recordId: string) {
    this.require(actor, 'landed', true);
    return this.transaction(company, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "LandedCost" WHERE id = ${recordId} AND company = ${company} FOR UPDATE`;
      const record = await tx.landedCost.findFirst({
        where: { id: recordId, company },
      });
      if (!record) throw new NotFoundException('Landed cost not found.');
      assertApproval(actor, company, record.total);
      if (record.status === 'FINAL') return record;
      if (record.status !== 'PROVISIONAL')
        throw new ConflictException(
          'Only provisional landed costs can be finalized.',
        );
      const data = v.object(record.data);
      const grouped = new Map<
        number,
        { quantity: number; total: Prisma.Decimal }
      >();
      for (const allocation of v.rows(data.allocations)) {
        const productId = v.integer(allocation.productId, 'Product', 1);
        const previous = grouped.get(productId) ?? {
          quantity: 0,
          total: new Prisma.Decimal(0),
        };
        grouped.set(productId, {
          quantity:
            previous.quantity + v.integer(allocation.quantity, 'Quantity', 1),
          total: previous.total.add(money(allocation.totalCost, 'Cost')),
        });
      }
      for (const [productId, cost] of grouped) {
        v.integer(cost.quantity, 'Total product quantity', 1);
        const unitCost = cost.total
          .div(cost.quantity)
          .toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
        const changed = await tx.product.updateMany({
          where: { id: productId, company },
          data: { landedCostReference: unitCost },
        });
        if (changed.count !== 1)
          throw new ConflictException(
            'The product is unavailable in this workspace.',
          );
        await tx.productCostHistory.create({
          data: {
            company,
            productId,
            landedCostId: record.id,
            shipmentId: record.shipmentId,
            quantity: cost.quantity,
            unitCost,
            approvedBy: actor.username,
          },
        });
      }
      const finalized = await tx.landedCost.update({
        where: { id: record.id },
        data: {
          status: 'FINAL',
          approvedBy: actor.username,
          approvedAt: new Date(),
        },
      });
      await audit(tx, company, actor, 'FINALIZE', 'LandedCost', record.id, {
        total: record.total.toFixed(2),
        products: [...grouped.keys()],
        updatesManualPrice: false,
      });
      return finalized;
    });
  }

  async costHistory(company: string, actor: Actor, productId: number) {
    this.require(actor, 'landed');
    const product = await this.prisma.product.findFirst({
      where: { id: productId, company },
      select: { id: true, sku: true, name: true, landedCostReference: true },
    });
    if (!product) throw new NotFoundException('Product not found.');
    const history = await this.prisma.productCostHistory.findMany({
      where: { company, productId },
      include: {
        landedCost: { select: { number: true } },
        shipment: { select: { shipmentNumber: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return { product, history };
  }

  async invoiceFromDelivery(company: string, actor: Actor, body: unknown) {
    this.require(actor, 'finance', true);
    const input = v.object(body);
    const deliveryId = id(input.deliveryId, 'Delivery');
    const dueDate = requiredDate(input.dueDate, 'Due date');
    return this.transaction(company, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Delivery" WHERE id = ${deliveryId} AND company = ${company} FOR UPDATE`;
      const delivery = await tx.delivery.findFirst({
        where: { id: deliveryId, company },
        include: {
          items: true,
          order: true,
          pods: true,
          sources: { where: { company, sourceType: 'FO', cancelledAt: null } },
        },
      });
      if (
        !delivery ||
        !['PartiallyDelivered', 'Delivered'].includes(delivery.status) ||
        delivery.order.company !== company ||
        !delivery.pods.length ||
        !delivery.sources.length
      )
        throw new BadRequestException(
          'Billing requires confirmed POD quantities and an active Final Order.',
        );
      const customer = await tx.customer.findFirst({
        where: { id: delivery.order.customerId, company },
      });
      if (!customer)
        throw new BadRequestException(
          'The customer is unavailable in this workspace.',
        );
      const finalOrder = await tx.orderSlip.findFirst({
        where: {
          id: delivery.sources[0].sourceId,
          company,
          customerId: customer.id,
        },
        include: { items: true },
      });
      if (
        !finalOrder ||
        finalOrder.osNumber !== delivery.sources[0].documentNumber ||
        finalOrder.status === 'Cancelled'
      )
        throw new ConflictException('The linked Final Order is unavailable.');
      const cumulative = delivery.items
        .filter((item) => item.deliveredQty > 0)
        .sort((a, b) => a.productId - b.productId);
      const sourceKey = `DEL:${delivery.id}:${createHash('sha256')
        .update(
          JSON.stringify(
            cumulative.map((item) => [item.productId, item.deliveredQty]),
          ),
        )
        .digest('hex')
        .slice(0, 32)}`;
      const existing = await tx.financeDocument.findUnique({
        where: { company_sourceKey: { company, sourceKey } },
      });
      if (existing) return existing;
      const previous = await tx.financeDocument.findMany({
        where: {
          company,
          deliveryId,
          kind: 'INVOICE',
          status: { not: 'VOID' },
        },
      });
      const invoiced = new Map<number, number>();
      for (const document of previous)
        for (const line of v.rows(v.object(document.data).items)) {
          const productId = v.integer(line.productId, 'Stored product', 1);
          invoiced.set(
            productId,
            (invoiced.get(productId) ?? 0) +
              v.integer(line.quantity, 'Stored quantity', 1),
          );
        }
      const products = await tx.product.findMany({
        where: {
          company,
          id: { in: cumulative.map((item) => item.productId) },
        },
        select: { id: true, purchasePrice: true, landedCostReference: true },
      });
      const items = cumulative.flatMap((item) => {
        const quantity =
          item.deliveredQty - (invoiced.get(item.productId) ?? 0);
        if (quantity < 0)
          throw new ConflictException(
            'Previously billed quantities exceed the confirmed POD.',
          );
        if (quantity === 0) return [];
        const source = finalOrder.items.filter(
          (line) => line.productId === item.productId,
        );
        const product = products.find((row) => row.id === item.productId);
        if (source.length !== 1 || !product)
          throw new ConflictException(
            'The Final Order requires one unambiguous line per delivered product.',
          );
        if (
          item.deliveredQty > (source[0].confirmedQty ?? source[0].requestedQty)
        )
          throw new ConflictException(
            'Confirmed delivery exceeds the Final Order quantity.',
          );
        const subtotal = roundMoney(source[0].unitPrice.mul(quantity));
        const taxAmount = new Prisma.Decimal(0);
        const unitCost =
          product.landedCostReference ??
          new Prisma.Decimal(product.purchasePrice ?? 0);
        return [
          {
            productId: item.productId,
            sku: source[0].sku,
            description: source[0].productName,
            quantity,
            unitPrice: source[0].unitPrice.toFixed(2),
            subtotal: subtotal.toFixed(2),
            taxAmount: taxAmount.toFixed(2),
            total: subtotal.add(taxAmount).toFixed(2),
            unitCost: unitCost.toFixed(6),
            costSource: product.landedCostReference
              ? 'APPROVED_LANDED_REFERENCE'
              : 'MANUAL_COST_REFERENCE',
          },
        ];
      });
      if (!items.length)
        throw new ConflictException(
          'All confirmed POD quantities have already been invoiced.',
        );
      const subtotal = sum(
        items.map((line) => new Prisma.Decimal(line.subtotal)),
      );
      // Round the cumulative delivered subtotal once, then bill only its new VAT.
      // Separate PODs must not add an extra cent compared with the full order.
      const priorSubtotal = sum(previous.map((document) => document.subtotal));
      const priorTax = sum(previous.map((document) => document.taxAmount));
      const cumulativeTax = finalOrder.vatApplied
        ? roundMoney(priorSubtotal.add(subtotal).mul(finalOrder.vatRate))
        : new Prisma.Decimal(0);
      const taxAmount = cumulativeTax.minus(priorTax);
      if (taxAmount.lt(0))
        throw new ConflictException(
          'The Final Order tax changed after earlier billing.',
        );
      const lineTaxes = allocateCents(
        taxAmount,
        items.map((line) => new Prisma.Decimal(line.subtotal)),
      );
      items.forEach((line, index) => {
        line.taxAmount = lineTaxes[index].toFixed(2);
        line.total = new Prisma.Decimal(line.subtotal)
          .add(lineTaxes[index])
          .toFixed(2);
      });
      if (subtotal.add(taxAmount).lte(0))
        throw new BadRequestException(
          'A zero-value delivery cannot create a payable invoice.',
        );
      const issueDate = new Date(v.manilaDay(new Date()));
      if (dueDate < issueDate)
        throw new BadRequestException(
          'Due date cannot precede the invoice date.',
        );
      const record = await tx.financeDocument.create({
        data: {
          company,
          number: await nextNumber(tx, company, 'INV'),
          kind: 'INVOICE',
          direction: 'AR',
          partyId: customer.id,
          sourceKey,
          deliveryId,
          currency: 'PHP',
          exchangeRate: '1',
          issueDate,
          dueDate,
          subtotal,
          taxAmount,
          total: subtotal.add(taxAmount),
          data: json({
            items,
            finalOrderId: finalOrder.id,
            finalOrderNumber: finalOrder.osNumber,
            vatApplied: finalOrder.vatApplied,
            vatRate: finalOrder.vatRate.toString(),
            deliveryNumber: delivery.delNumber,
            podIds: delivery.pods.map((pod) => pod.id),
            confirmedQuantities: cumulative.map((item) => ({
              productId: item.productId,
              quantity: item.deliveredQty,
            })),
          }),
          createdBy: actor.username,
        },
      });
      await audit(tx, company, actor, 'DRAFT', 'FinanceDocument', record.id, {
        deliveryId,
        sourceKey,
        total: record.total.toFixed(2),
      });
      return record;
    });
  }

  async createBill(company: string, actor: Actor, body: unknown) {
    this.require(actor, 'finance', true);
    const input = v.object(body);
    const supplierId = id(input.supplierId, 'Supplier');
    const invoiceReference = id(
      input.invoiceReference,
      'Supplier invoice reference',
    );
    const currency = v.currency(input.currency);
    const rate = exchangeRate(currency, input.exchangeRate);
    const issueDate = requiredDate(input.issueDate, 'Issue date');
    const dueDate = requiredDate(input.dueDate, 'Due date');
    if (dueDate < issueDate)
      throw new BadRequestException('Due date cannot precede the bill date.');
    const calculated = billCalculation(v.rows(input.items), rate);
    const importExpenseId = v.text(
      input.importExpenseId,
      'Import expense',
      false,
      200,
    );
    return this.transaction(company, async (tx) => {
      if (
        !(await tx.supplier.findFirst({
          where: { company, id: supplierId },
          select: { id: true },
        }))
      )
        throw new NotFoundException('Supplier not found in this workspace.');
      if (importExpenseId) {
        const expense = await tx.importExpense.findFirst({
          where: { id: importExpenseId, shipment: { company } },
        });
        if (!expense || expense.paidAt || expense.status === 'Paid')
          throw new BadRequestException(
            'Only an unpaid expense in this workspace may be billed.',
          );
        if (
          await tx.financeDocument.findFirst({
            where: {
              company,
              kind: 'BILL',
              status: { not: 'VOID' },
              data: { path: ['importExpenseId'], equals: importExpenseId },
            },
          })
        )
          throw new ConflictException(
            'This import expense is already linked to a bill.',
          );
      }
      const sourceKey = `SUP:${supplierId}:${invoiceReference.toUpperCase()}`;
      if (
        await tx.financeDocument.findUnique({
          where: { company_sourceKey: { company, sourceKey } },
        })
      )
        throw new ConflictException(
          'This supplier invoice reference already exists.',
        );
      const record = await tx.financeDocument.create({
        data: {
          company,
          number: await nextNumber(tx, company, 'BILL'),
          kind: 'BILL',
          direction: 'AP',
          partyId: supplierId,
          sourceKey,
          currency,
          exchangeRate: rate,
          issueDate,
          dueDate,
          subtotal: calculated.subtotal,
          taxAmount: calculated.taxAmount,
          total: calculated.total,
          data: json({
            items: calculated.items,
            invoiceReference,
            importExpenseId: importExpenseId ?? null,
            settlementCurrency: 'PHP',
          }),
          createdBy: actor.username,
        },
      });
      await audit(tx, company, actor, 'DRAFT', 'FinanceDocument', record.id, {
        invoiceReference,
        total: record.total.toFixed(2),
      });
      return record;
    });
  }

  private documentLines(document: FinanceDocument, reverse = false) {
    const lines: { code: string; debit: string; credit: string }[] = [];
    const add = (code: string, amount: Prisma.Decimal, debit: boolean) => {
      if (amount.isZero()) return;
      lines.push({
        code,
        debit: (debit !== reverse ? amount : new Prisma.Decimal(0)).toFixed(2),
        credit: (debit !== reverse ? new Prisma.Decimal(0) : amount).toFixed(2),
      });
    };
    if (document.direction === 'AR') {
      add('1300', document.total, true);
      add('4000', document.subtotal, false);
      add('2200', document.taxAmount, false);
    } else {
      add('2100', document.total, false);
      add('1400', document.taxAmount, true);
      const items = v.object(document.data).items;
      if (document.kind === 'BILL' && Array.isArray(items)) {
        const accounts = new Map<string, Prisma.Decimal>();
        for (const raw of items) {
          const line = v.object(raw);
          const code = v.choice(
            line.accountCode,
            ['1200', '5000', '6000'],
            'Bill account',
          );
          accounts.set(
            code,
            (accounts.get(code) ?? new Prisma.Decimal(0)).add(
              money(line.subtotal, 'Line subtotal'),
            ),
          );
        }
        for (const [code, amount] of accounts) add(code, amount, true);
      } else add('5000', document.subtotal, true);
    }
    return lines;
  }

  private postingLines(document: FinanceDocument) {
    const lines = this.documentLines(document);
    if (document.kind === 'INVOICE') {
      const cost = sum(
        v
          .rows(v.object(document.data).items)
          .map((line) =>
            roundMoney(
              decimal(line.unitCost, 'Stored cost').mul(
                v.integer(line.quantity, 'Stored quantity', 1),
              ),
            ),
          ),
      );
      if (cost.gt(0))
        lines.push(
          { code: '5100', debit: cost.toFixed(2), credit: '0.00' },
          { code: '1200', debit: '0.00', credit: cost.toFixed(2) },
        );
    }
    return lines;
  }

  async postDocument(company: string, actor: Actor, documentId: string) {
    this.require(actor, 'finance', true);
    return this.transaction(company, async (tx) => {
      const document = await this.lockDocument(tx, company, documentId);
      assertApproval(actor, company, document.total);
      if (document.status === 'POSTED') return document;
      if (
        document.status !== 'DRAFT' ||
        !['INVOICE', 'BILL'].includes(document.kind)
      )
        throw new ConflictException(
          'Only draft invoices and bills can be posted.',
        );
      const accounts = await postingAccounts(tx, company);
      const lines = mappedLines(this.postingLines(document), accounts);
      await postJournal(tx, company, actor, {
        sourceKey: `DOC:${document.id}`,
        sourceType: document.kind,
        sourceId: document.id,
        date: document.issueDate,
        memo: `${document.number} posting`,
        approvalAmount: document.total.toFixed(2),
        lines,
      });
      const record = await tx.financeDocument.update({
        where: { id: document.id },
        data: {
          status: 'POSTED',
          postedAt: new Date(),
          postedBy: actor.username,
          data: json({ ...v.object(document.data), postingAccounts: accounts }),
        },
      });
      await audit(tx, company, actor, 'POST', 'FinanceDocument', document.id, {
        number: document.number,
        total: document.total.toFixed(2),
      });
      return record;
    });
  }

  async createMemo(company: string, actor: Actor, body: unknown) {
    this.require(actor, 'finance', true);
    const input = v.object(body);
    const documentId = id(input.documentId, 'Document');
    const kind = v.choice(
      input.kind,
      ['CREDIT_MEMO', 'DEBIT_MEMO'],
      'memo kind',
    );
    const amount = money(input.amount, 'Memo amount');
    const reason = v.text(input.reason, 'Memo reason')!;
    const submissionKey = id(input.submissionKey, 'Memo submission key');
    const sourceKey = `MEMO:${submissionKey}`;
    const lookup = { company_sourceKey: { company, sourceKey } };
    const replay = (existing: FinanceDocument) => {
      if (
        existing.status !== 'POSTED' ||
        existing.kind !== kind ||
        existing.relatedDocumentId !== documentId ||
        !existing.total.eq(amount) ||
        v.object(existing.data).reason !== reason
      )
        throw new ConflictException(
          'This submission key was already used for different memo details.',
        );
      return existing;
    };
    if (amount.lte(0))
      throw new BadRequestException('Memo amount must be positive.');
    assertApproval(actor, company, amount);
    try {
      return await this.transaction(company, async (tx) => {
        const existing = await tx.financeDocument.findUnique({ where: lookup });
        if (existing) return replay(existing);
        const original = await this.lockDocument(tx, company, documentId);
        if (
          original.status !== 'POSTED' ||
          !['INVOICE', 'BILL'].includes(original.kind)
        )
          throw new BadRequestException(
            'Memos require a posted invoice or bill.',
          );
        const accounts = await sourcePostingAccounts(
          tx,
          company,
          original,
          this.postingLines(original),
        );
        const credits = sum(
          original.memos
            .filter(
              (memo) => memo.status === 'POSTED' && memo.kind === 'CREDIT_MEMO',
            )
            .map((memo) => memo.total),
        );
        const debits = sum(
          original.memos
            .filter(
              (memo) => memo.status === 'POSTED' && memo.kind === 'DEBIT_MEMO',
            )
            .map((memo) => memo.total),
        );
        if (
          kind === 'CREDIT_MEMO' &&
          credits.add(amount).gt(original.total.add(debits))
        )
          throw new BadRequestException(
            'Credit memos cannot exceed the document and its posted debit memos.',
          );
        const earlier = original.memos.filter(
          (memo) => memo.status === 'POSTED' && memo.kind === kind,
        );
        const priorAmount = sum(earlier.map((memo) => memo.total));
        const priorTax = sum(earlier.map((memo) => memo.taxAmount));
        const taxAmount = roundMoney(
          priorAmount.add(amount).mul(original.taxAmount).div(original.total),
        ).minus(priorTax);
        const subtotal = amount.minus(taxAmount);
        let accountAllocations: { code: string; amount: string }[] = [];
        if (original.direction === 'AP') {
          const base = this.documentLines(original).filter(
            (line) => !['2100', '1400'].includes(line.code),
          );
          const cumulative = allocateMemoAccounts(
            sum(earlier.map((memo) => memo.subtotal)).add(subtotal),
            base,
          );
          const previousAccounts = new Map<string, Prisma.Decimal>();
          for (const memo of earlier) {
            const stored = v.object(memo.data).accountAllocations;
            const shares = Array.isArray(stored)
              ? stored.map((line) => {
                  const row = v.object(line);
                  return {
                    code: id(row.code),
                    amount: money(
                      row.amount,
                      'Stored allocation',
                      true,
                    ).toFixed(2),
                  };
                })
              : allocateMemoAccounts(memo.subtotal, base);
            for (const share of shares)
              previousAccounts.set(
                share.code,
                (previousAccounts.get(share.code) ?? new Prisma.Decimal(0)).add(
                  share.amount,
                ),
              );
          }
          accountAllocations = base
            .map((line) => ({
              code: line.code,
              amount: new Prisma.Decimal(
                cumulative.find((share) => share.code === line.code)?.amount ??
                  0,
              )
                .minus(previousAccounts.get(line.code) ?? 0)
                .toFixed(2),
            }))
            .filter((line) => !new Prisma.Decimal(line.amount).isZero());
        }
        const record = await tx.financeDocument.create({
          data: {
            company,
            number: await nextNumber(
              tx,
              company,
              kind === 'CREDIT_MEMO' ? 'CM' : 'DM',
            ),
            kind,
            direction: original.direction,
            partyId: original.partyId,
            status: 'POSTED',
            relatedDocumentId: original.id,
            sourceKey,
            currency: 'PHP',
            exchangeRate: '1',
            issueDate: new Date(v.manilaDay(new Date())),
            dueDate: original.dueDate,
            subtotal,
            taxAmount,
            total: amount,
            data: json({
              reason,
              originalNumber: original.number,
              accountAllocations,
              postingAccounts: accounts,
            }),
            createdBy: actor.username,
            postedBy: actor.username,
            postedAt: new Date(),
          },
        });
        // AP memos reverse the original expense/capitalization account proportions.
        let lines = this.documentLines(record, kind === 'CREDIT_MEMO');
        if (original.direction === 'AP') {
          lines = lines.filter((line) => line.code !== '5000');
          lines.push(
            ...accountAllocations.map((share) => {
              const amount = new Prisma.Decimal(share.amount);
              const debit = (kind !== 'CREDIT_MEMO') !== amount.isNegative();
              return {
                code: share.code,
                debit: debit ? amount.abs().toFixed(2) : '0.00',
                credit: debit ? '0.00' : amount.abs().toFixed(2),
              };
            }),
          );
        }
        await postJournal(tx, company, actor, {
          sourceKey: `DOC:${record.id}`,
          sourceType: kind,
          sourceId: record.id,
          date: record.issueDate,
          memo: `${record.number}: ${reason}`,
          approvalAmount: amount.toFixed(2),
          lines: mappedLines(lines, accounts),
        });
        await audit(
          tx,
          company,
          actor,
          'POST_MEMO',
          'FinanceDocument',
          record.id,
          {
            documentId,
            kind,
            amount: amount.toFixed(2),
            reason,
            submissionKey,
          },
        );
        return record;
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        const existing = await this.prisma.financeDocument.findUnique({
          where: lookup,
        });
        if (existing) return replay(existing);
      }
      throw error;
    }
  }

  private allocations(body: unknown) {
    const lines = v.rows(body).map((line) => ({
      documentId: id(line.documentId, 'Allocated document'),
      amount: money(line.amount, 'Allocation'),
    }));
    v.unique(lines.map((line) => line.documentId));
    if (lines.some((line) => line.amount.lte(0)))
      throw new BadRequestException(
        'Every payment allocation must be positive.',
      );
    return lines.sort((a, b) => a.documentId.localeCompare(b.documentId));
  }

  private async validateAllocations(
    tx: Tx,
    company: string,
    direction: string,
    partyId: string,
    allocations: { documentId: string; amount: Prisma.Decimal }[],
  ) {
    const documents: FinanceDocument[] = [];
    for (const line of allocations) {
      const document = await this.lockDocument(tx, company, line.documentId);
      if (
        document.status !== 'POSTED' ||
        document.kind !== (direction === 'AR' ? 'INVOICE' : 'BILL') ||
        document.direction !== direction ||
        document.partyId !== partyId
      )
        throw new BadRequestException(
          'Allocations must reference posted documents for the same party, direction, and workspace.',
        );
      if (line.amount.gt(outstanding(document).outstanding))
        throw new BadRequestException(
          `${document.number}: allocation exceeds the outstanding balance.`,
        );
      documents.push(document);
    }
    return documents;
  }

  async createPayment(company: string, actor: Actor, body: unknown) {
    this.require(actor, 'finance', true);
    const input = v.object(body);
    const direction = this.direction(actor, input.direction);
    const partyId = id(input.partyId, 'Customer or supplier');
    const amount = money(input.amount, 'Payment amount');
    const paidAt = requiredDate(input.paidAt, 'Payment date');
    const method = id(input.method, 'Payment method');
    const reference = id(input.reference, 'Payment reference');
    const idempotencyKey = id(input.idempotencyKey, 'Submission key');
    const allocations = this.allocations(input.allocations);
    const paymentRequestId = v.text(
      input.paymentRequestId,
      'Payment request',
      false,
      200,
    );
    if (
      amount.lte(0) ||
      !sum(allocations.map((line) => line.amount)).eq(amount)
    )
      throw new BadRequestException(
        'Payment allocations must exactly equal the positive payment amount.',
      );
    assertApproval(actor, company, amount);
    return this.transaction(company, async (tx) => {
      const existing = await tx.financePayment.findUnique({
        where: { company_idempotencyKey: { company, idempotencyKey } },
        include: {
          allocations: true,
          paymentRequests: { select: { id: true } },
        },
      });
      if (existing) {
        const signature = (
          lines: { documentId: string; amount: Prisma.Decimal }[],
        ) =>
          lines
            .map((line) => `${line.documentId}:${line.amount.toFixed(2)}`)
            .sort()
            .join('|');
        if (
          existing.direction !== direction ||
          existing.partyId !== partyId ||
          !existing.amount.eq(amount) ||
          existing.paidAt.getTime() !== paidAt.getTime() ||
          existing.method !== method ||
          existing.reference !== reference ||
          (existing.paymentRequests[0]?.id ?? undefined) !== paymentRequestId ||
          signature(existing.allocations) !== signature(allocations)
        )
          throw new ConflictException(
            'This submission key was already used for different payment details.',
          );
        return existing;
      }
      const party =
        direction === 'AR'
          ? await tx.customer.findFirst({
              where: { id: partyId, company },
              select: { id: true },
            })
          : await tx.supplier.findFirst({
              where: { id: partyId, company },
              select: { id: true },
            });
      if (!party)
        throw new NotFoundException(
          'Payment party not found in this workspace.',
        );
      const documents = await this.validateAllocations(
        tx,
        company,
        direction,
        partyId,
        allocations,
      );
      const accounts = await postingAccounts(tx, company);
      const controls = new Map<string, Prisma.Decimal>();
      for (const line of allocations) {
        const document = documents.find((row) => row.id === line.documentId)!;
        const original = await sourcePostingAccounts(
          tx,
          company,
          document,
          this.postingLines(document),
        );
        const code = original[direction === 'AR' ? '1300' : '2100'];
        controls.set(
          code,
          (controls.get(code) ?? new Prisma.Decimal(0)).add(line.amount),
        );
      }
      if (paymentRequestId) {
        await tx.$queryRaw`SELECT id FROM "PaymentRequest" WHERE id = ${paymentRequestId} AND company = ${company} FOR UPDATE`;
        const request = await tx.paymentRequest.findFirst({
          where: { id: paymentRequestId, company },
        });
        if (
          !request ||
          request.status !== 'APPROVED' ||
          request.supplierId !== partyId ||
          direction !== 'AP' ||
          !request.amount.eq(amount)
        )
          throw new BadRequestException(
            'Payment must match an approved, unpaid supplier request.',
          );
        const requested = this.allocations(v.object(request.data).allocations);
        if (
          JSON.stringify(
            requested.map((line) => [line.documentId, line.amount.toFixed(2)]),
          ) !==
          JSON.stringify(
            allocations.map((line) => [
              line.documentId,
              line.amount.toFixed(2),
            ]),
          )
        )
          throw new BadRequestException(
            'Payment allocations must match the approved request.',
          );
      }
      const payment = await tx.financePayment.create({
        data: {
          company,
          number: await nextNumber(
            tx,
            company,
            direction === 'AR' ? 'RCPT' : 'PAY',
          ),
          direction,
          partyId,
          amount,
          paidAt,
          method,
          reference,
          idempotencyKey,
          createdBy: actor.username,
          allocations: {
            create: allocations.map((line) => ({
              documentId: line.documentId,
              amount: line.amount,
            })),
          },
        },
        include: { allocations: true },
      });
      const bankLine = {
        code: accounts['1000'],
        debit: direction === 'AR' ? amount.toFixed(2) : '0.00',
        credit: direction === 'AP' ? amount.toFixed(2) : '0.00',
      };
      const controlLines = [...controls].map(([code, value]) => ({
        code,
        debit: direction === 'AP' ? value.toFixed(2) : '0.00',
        credit: direction === 'AR' ? value.toFixed(2) : '0.00',
      }));
      await postJournal(tx, company, actor, {
        sourceKey: `PAY:${payment.id}`,
        sourceType:
          direction === 'AR' ? 'CUSTOMER_PAYMENT' : 'SUPPLIER_PAYMENT',
        sourceId: payment.id,
        date: paidAt,
        memo: `${payment.number}: ${reference}`,
        lines:
          direction === 'AR'
            ? [bankLine, ...controlLines]
            : [...controlLines, bankLine],
      });
      if (paymentRequestId)
        await tx.paymentRequest.update({
          where: { id: paymentRequestId },
          data: { status: 'PAID', paymentId: payment.id },
        });
      await audit(
        tx,
        company,
        actor,
        'RECORD_PAYMENT',
        'FinancePayment',
        payment.id,
        json({
          direction,
          partyId,
          amount: amount.toFixed(2),
          paymentRequestId,
          allocations: allocations.map((line) => ({
            documentId: line.documentId,
            amount: line.amount.toFixed(2),
          })),
        }),
      );
      return payment;
    });
  }

  async createPaymentRequest(company: string, actor: Actor, body: unknown) {
    this.require(actor, 'finance', true);
    const input = v.object(body);
    const supplierId = id(input.supplierId, 'Supplier');
    const dueDate = requiredDate(input.dueDate, 'Due date');
    const notes = v.text(input.notes, 'Notes', false);
    const allocations = this.allocations(input.allocations);
    const amount = sum(allocations.map((line) => line.amount));
    return this.transaction(company, async (tx) => {
      if (
        !(await tx.supplier.findFirst({
          where: { id: supplierId, company },
          select: { id: true },
        }))
      )
        throw new NotFoundException('Supplier not found.');
      await this.validateAllocations(
        tx,
        company,
        'AP',
        supplierId,
        allocations,
      );
      const record = await tx.paymentRequest.create({
        data: {
          company,
          number: await nextNumber(tx, company, 'PRQ'),
          supplierId,
          amount,
          dueDate,
          notes,
          data: json({
            allocations: allocations.map((line) => ({
              documentId: line.documentId,
              amount: line.amount.toFixed(2),
            })),
          }),
          createdBy: actor.username,
        },
      });
      await audit(tx, company, actor, 'SUBMIT', 'PaymentRequest', record.id, {
        amount: amount.toFixed(2),
      });
      return record;
    });
  }

  async decidePaymentRequest(
    company: string,
    actor: Actor,
    requestId: string,
    body: unknown,
  ) {
    this.require(actor, 'finance', true);
    const input = v.object(body);
    const decision = v.choice(
      input.decision,
      ['APPROVED', 'REJECTED'],
      'request decision',
    );
    const reason = v.text(input.reason, 'Reason', decision === 'REJECTED');
    return this.transaction(company, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "PaymentRequest" WHERE id = ${requestId} AND company = ${company} FOR UPDATE`;
      const record = await tx.paymentRequest.findFirst({
        where: { id: requestId, company },
      });
      if (!record) throw new NotFoundException('Payment request not found.');
      assertApproval(actor, company, record.amount);
      if (record.status === decision) return record;
      if (record.status !== 'SUBMITTED')
        throw new ConflictException(
          'Only submitted requests can receive an approval decision.',
        );
      if (decision === 'APPROVED')
        await this.validateAllocations(
          tx,
          company,
          'AP',
          record.supplierId,
          this.allocations(v.object(record.data).allocations),
        );
      const updated = await tx.paymentRequest.update({
        where: { id: record.id },
        data: {
          status: decision,
          approvedBy: actor.username,
          approvedAt: new Date(),
        },
      });
      await audit(tx, company, actor, decision, 'PaymentRequest', record.id, {
        reason: reason ?? '',
        amount: record.amount.toFixed(2),
      });
      return updated;
    });
  }

  async balances(
    company: string,
    actor: Actor,
    rawDirection: 'AR' | 'AP',
    partyId?: string,
  ) {
    this.require(actor, 'finance');
    const direction = this.direction(actor, rawDirection);
    if (partyId) {
      const party =
        direction === 'AR'
          ? await this.prisma.customer.findFirst({
              where: { company, id: partyId },
              select: { id: true },
            })
          : await this.prisma.supplier.findFirst({
              where: { company, id: partyId },
              select: { id: true },
            });
      if (!party)
        throw new NotFoundException('Party not found in this workspace.');
    }
    return this.prisma.$transaction(
      async (tx) => {
        const principals = await tx.financeDocument.findMany({
          where: {
            company,
            direction,
            status: 'POSTED',
            kind: direction === 'AR' ? 'INVOICE' : 'BILL',
            ...(partyId ? { partyId } : {}),
          },
          include: balanceInclude,
          orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
          take: MAX_BALANCES + 1,
        });
        if (principals.length > MAX_BALANCES)
          throw new BadRequestException(
            'Narrow the balance query by customer or supplier; more than 5,000 posted documents match.',
          );
        const today = new Date(v.manilaDay(new Date())).getTime();
        const aging = {
          current: new Prisma.Decimal(0),
          days1to30: new Prisma.Decimal(0),
          days31to60: new Prisma.Decimal(0),
          days61to90: new Prisma.Decimal(0),
          over90: new Prisma.Decimal(0),
        };
        let totalOutstanding = new Prisma.Decimal(0);
        let creditBalance = new Prisma.Decimal(0);
        const documents = principals.map((document) => {
          const balance = outstanding(document);
          const ageDays = Math.max(
            0,
            Math.floor(
              (today - new Date(v.manilaDay(document.dueDate)).getTime()) /
                86400000,
            ),
          );
          if (balance.outstanding.gt(0)) {
            const bucket =
              ageDays === 0
                ? 'current'
                : ageDays <= 30
                  ? 'days1to30'
                  : ageDays <= 60
                    ? 'days31to60'
                    : ageDays <= 90
                      ? 'days61to90'
                      : 'over90';
            aging[bucket] = aging[bucket].add(balance.outstanding);
          } else creditBalance = creditBalance.add(balance.outstanding.abs());
          totalOutstanding = totalOutstanding.add(balance.outstanding);
          return {
            id: document.id,
            number: document.number,
            kind: document.kind,
            status: document.status,
            direction,
            partyId: document.partyId,
            dueDate: document.dueDate,
            total: document.total.toFixed(2),
            adjustments: balance.adjustments.toFixed(2),
            paid: balance.paid.toFixed(2),
            outstanding: balance.outstanding.toFixed(2),
            ageDays,
          };
        });
        return {
          documents,
          aging: Object.fromEntries(
            Object.entries(aging).map(([key, value]) => [
              key,
              value.toFixed(2),
            ]),
          ),
          totalOutstanding: totalOutstanding.toFixed(2),
          creditBalance: creditBalance.toFixed(2),
          truncated: false,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
