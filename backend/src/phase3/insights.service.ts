import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { GeminiService } from '../documentation/gemini.service';
import {
  companyToday,
  daysBetween,
  parseIsoDate,
} from '../documentation/expiry-date.utils';
import * as v from '../importation/importation.validation';
import {
  audit,
  erpRoles,
  hasAccess,
  money,
  nextNumber,
  type Actor,
  type Tx,
} from './phase3.shared';
import { FinanceService } from './finance.service';

const LIMIT = 1000;
const DAY = 86_400_000;
const leaders = ['Management', 'Auditor'];
const reportDefinitions = [
  {
    id: 'inventory-valuation',
    title: 'Inventory valuation',
    scope: 'finance',
    roles: [...leaders, 'Finance'],
  },
  {
    id: 'stock-availability',
    title: 'Stock availability',
    scope: 'warehouse',
    roles: [
      ...leaders,
      'Warehouse',
      'Sales',
      'Delivery',
      'Purchasing',
      'Importation',
      'QC/Regulatory',
      'Finance',
    ],
  },
  {
    id: 'shipment-performance',
    title: 'Shipment performance',
    scope: 'importation',
    roles: [...leaders, 'Purchasing', 'Importation'],
  },
  {
    id: 'landed-cost',
    title: 'Landed cost approvals',
    scope: 'landed',
    roles: [...leaders, 'Finance', 'Importation', 'Purchasing'],
  },
  {
    id: 'sales-margin',
    title: 'Posted sales margin',
    scope: 'finance',
    roles: [...leaders, 'Finance'],
  },
  {
    id: 'receivables-aging',
    title: 'Receivables aging',
    scope: 'finance',
    roles: [...leaders, 'Sales', 'Finance'],
  },
  {
    id: 'payables-aging',
    title: 'Payables aging',
    scope: 'finance',
    roles: [...leaders, 'Purchasing', 'Finance'],
  },
  {
    id: 'customer-balances',
    title: 'Customer balances',
    scope: 'finance',
    roles: [...leaders, 'Sales', 'Finance'],
  },
  {
    id: 'supplier-balances',
    title: 'Supplier balances',
    scope: 'finance',
    roles: [...leaders, 'Purchasing', 'Finance'],
  },
  {
    id: 'delivery-fulfillment',
    title: 'Delivery fulfillment',
    scope: 'delivery',
    roles: [...leaders, 'Sales', 'Delivery', 'Warehouse'],
  },
  {
    id: 'device-service',
    title: 'Device warranty and service',
    scope: 'service',
    roles: [...leaders, 'Warehouse', 'QC/Regulatory', 'Sales', 'Delivery'],
  },
] as const;

export interface ManagementReport {
  id: string;
  title: string;
  columns: string[];
  rows: Record<string, string | number | boolean | null>[];
  generatedAt: string;
  truncated: boolean;
  limit: number;
  note?: string;
}

export function addCalendarMonths(value: Date, months: number): Date {
  const result = new Date(value);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const end = new Date(result);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  result.setUTCDate(Math.min(day, end.getUTCDate()));
  return result;
}

function calendar(value: unknown, label: string): Date {
  const result = parseIsoDate(value);
  if (!result)
    throw new BadRequestException(
      `${label} must be a valid YYYY-MM-DD calendar date.`,
    );
  return result;
}

function iso(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : null;
}

@Injectable()
export class InsightsService implements OnModuleDestroy {
  private readonly prisma = new PrismaClient();
  constructor(
    private readonly gemini: GeminiService,
    private readonly finance: FinanceService,
  ) {}
  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }

  private require(
    actor: Actor,
    scope: 'service' | 'executive' | 'ai',
    write = false,
  ) {
    if (!hasAccess(actor, scope, write))
      throw new ForbiddenException(
        'Your ERP role does not permit this operation.',
      );
  }

  private allowedReports(actor: Actor) {
    this.require(actor, 'executive');
    const roles = erpRoles(actor);
    return reportDefinitions.filter((report) => {
      if (actor.role === 'Super Admin') return true;
      if (!report.roles.some((role) => roles.includes(role))) return false;
      if (
        report.scope === 'finance' ||
        report.scope === 'landed' ||
        report.scope === 'service'
      )
        return hasAccess(actor, report.scope);
      return true;
    });
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
          timeout: 20000,
        },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      ) {
        throw new ConflictException(
          'The record changed or already exists. Refresh and retry.',
        );
      }
      throw error;
    }
  }

  private warrantyStatus(until: Date | null, today = companyToday()) {
    if (!until) return 'UNSPECIFIED';
    const days = daysBetween(until, today);
    return days < 0 ? 'EXPIRED' : days <= 30 ? 'EXPIRING' : 'ACTIVE';
  }

  private async eligibleSerials(company: string, tx: Tx = this.prisma) {
    const picks = await tx.deliveryPick.findMany({
      where: {
        verifiedQty: { gt: 0 },
        lot: { company, serialNumber: { not: null } },
        deliveryItem: {
          delivery: {
            company,
            order: { company },
            status: { in: ['Delivered', 'PartiallyDelivered'] },
            pods: { some: {} },
          },
        },
      },
      include: {
        lot: { select: { productId: true, serialNumber: true } },
        deliveryItem: {
          include: {
            delivery: {
              include: {
                order: true,
                pods: { select: { receivedAt: true, items: true } },
              },
            },
          },
        },
      },
      orderBy: { id: 'asc' },
      take: LIMIT + 1,
    });
    // Partial multi-serial lines cannot establish which individual serial the recipient accepted.
    const [products, customers] = await Promise.all([
      tx.product.findMany({
        where: {
          company,
          id: {
            in: [...new Set(picks.map((pick) => pick.deliveryItem.productId))],
          },
        },
        select: { id: true, sku: true, name: true },
      }),
      tx.customer.findMany({
        where: {
          company,
          id: {
            in: [
              ...new Set(
                picks.map(
                  (pick) => pick.deliveryItem.delivery.order.customerId,
                ),
              ),
            ],
          },
        },
        select: { id: true, name: true },
      }),
    ]);
    const eligible = picks.filter(
      (pick) =>
        pick.deliveryItem.deliveredQty === pick.deliveryItem.quantity &&
        pick.deliveryItem.quantity > 0 &&
        pick.quantity === 1 &&
        pick.verifiedQty === 1 &&
        pick.lot.productId === pick.deliveryItem.productId &&
        products.some(
          (product) => product.id === pick.deliveryItem.productId,
        ) &&
        customers.some(
          (customer) =>
            customer.id === pick.deliveryItem.delivery.order.customerId,
        ),
    );
    return {
      truncated: picks.length > LIMIT,
      rows: eligible
        .slice(0, LIMIT)
        .map((pick) => {
          const item = pick.deliveryItem;
          const receipts = item.delivery.pods.filter(
            (pod) =>
              Array.isArray(pod.items) &&
              pod.items.some(
                (line) =>
                  line &&
                  typeof line === 'object' &&
                  !Array.isArray(line) &&
                  line.deliveryItemId === item.id &&
                  Number(line.quantity) > 0,
              ),
          );
          const quantity = receipts.reduce(
            (sum, pod) =>
              sum +
              (pod.items as { deliveryItemId: string; quantity: number }[])
                .filter((line) => line.deliveryItemId === item.id)
                .reduce((n, line) => n + line.quantity, 0),
            0,
          );
          const soldAt = receipts.length
            ? new Date(
                Math.max(...receipts.map((pod) => pod.receivedAt.getTime())),
              )
            : null;
          return {
            deliveryId: item.deliveryId,
            delNumber: item.delivery.delNumber,
            productId: item.productId,
            sku: products.find((product) => product.id === item.productId)!.sku,
            productName: products.find(
              (product) => product.id === item.productId,
            )!.name,
            customerId: item.delivery.order.customerId,
            customerName: customers.find(
              (customer) => customer.id === item.delivery.order.customerId,
            )!.name,
            serialNumber: pick.lot.serialNumber!,
            soldAt,
            covered: quantity >= item.quantity,
          };
        })
        .filter((row) => row.covered && row.soldAt),
    };
  }

  async serviceOverview(company: string, actor: Actor) {
    this.require(actor, 'service');
    const [assets, visits, serials, customers, products] = await Promise.all([
      this.prisma.deviceAsset.findMany({
        where: { company },
        include: {
          product: { select: { sku: true, name: true } },
          customer: { select: { name: true } },
          delivery: { select: { delNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: LIMIT + 1,
      }),
      this.prisma.serviceVisit.findMany({
        where: { company },
        include: {
          asset: {
            include: {
              product: { select: { sku: true, name: true } },
              customer: { select: { name: true } },
            },
          },
        },
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
        take: LIMIT + 1,
      }),
      this.eligibleSerials(company),
      this.prisma.customer.findMany({
        where: { company },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
        take: LIMIT + 1,
      }),
      this.prisma.product.findMany({
        where: { company, deletedAt: null },
        select: { id: true, sku: true, name: true },
        orderBy: { name: 'asc' },
        take: LIMIT + 1,
      }),
    ]);
    const registered = new Set(assets.map((asset) => asset.serialNumber));
    return {
      assets: assets.slice(0, LIMIT).map((asset) => ({
        ...asset,
        warrantyStatus: this.warrantyStatus(asset.warrantyUntil),
      })),
      visits: visits.slice(0, LIMIT),
      eligibleSerials: serials.rows.filter(
        (row) => !registered.has(row.serialNumber),
      ),
      customers: customers.slice(0, LIMIT),
      products: products.slice(0, LIMIT),
      truncated:
        serials.truncated ||
        [assets, visits, customers, products].some(
          (rows) => rows.length > LIMIT,
        ),
      limit: LIMIT,
    };
  }

  async registerAsset(company: string, actor: Actor, input: unknown) {
    this.require(actor, 'service', true);
    const body = v.object(input);
    const deliveryId = v.text(body.deliveryId, 'Delivery', true, 100)!;
    const productId = v.integer(body.productId, 'Product', 1);
    const serialNumber = v.text(body.serialNumber, 'Serial number', true, 200)!;
    const intervalMonths =
      body.intervalMonths === undefined
        ? 6
        : v.integer(body.intervalMonths, 'Maintenance interval', 1);
    if (intervalMonths > 120)
      throw new BadRequestException(
        'Maintenance interval cannot exceed 120 months.',
      );
    const warrantyUntil = body.warrantyUntil
      ? calendar(body.warrantyUntil, 'Warranty expiration')
      : null;
    return this.transaction(company, async (tx) => {
      // The exact serial is looked up rather than relying on the bounded picker result.
      const pick = await tx.deliveryPick.findFirst({
        where: {
          quantity: 1,
          verifiedQty: 1,
          lot: { company, productId, serialNumber },
          deliveryItem: {
            deliveryId,
            productId,
            delivery: { company, order: { company } },
          },
        },
        include: {
          deliveryItem: {
            include: { delivery: { include: { order: true, pods: true } } },
          },
        },
      });
      if (!pick)
        throw new BadRequestException(
          'Choose a verified serial from a confirmed delivery.',
        );
      const item = pick.deliveryItem;
      const delivery = item.delivery;
      const [customer, product] = await Promise.all([
        tx.customer.findFirst({
          where: { id: delivery.order.customerId, company },
          select: { id: true },
        }),
        tx.product.findFirst({
          where: { id: productId, company },
          select: { id: true },
        }),
      ]);
      if (
        !['Delivered', 'PartiallyDelivered'].includes(delivery.status) ||
        item.deliveredQty !== item.quantity ||
        item.quantity <= 0 ||
        !customer ||
        !product
      ) {
        throw new BadRequestException(
          'The selected serial line must be fully received with proof of delivery.',
        );
      }
      const receipts = delivery.pods.filter(
        (pod) =>
          Array.isArray(pod.items) &&
          pod.items.some(
            (line) =>
              line &&
              typeof line === 'object' &&
              !Array.isArray(line) &&
              line.deliveryItemId === item.id &&
              Number(line.quantity) > 0,
          ),
      );
      const covered = receipts.reduce(
        (sum, pod) =>
          sum +
          (pod.items as { deliveryItemId: string; quantity: number }[])
            .filter((line) => line.deliveryItemId === item.id)
            .reduce((n, line) => n + line.quantity, 0),
        0,
      );
      if (!receipts.length || covered < item.quantity)
        throw new BadRequestException(
          'Proof of delivery does not cover this serial line.',
        );
      const receivedAt = new Date(
        Math.max(...receipts.map((pod) => pod.receivedAt.getTime())),
      );
      const soldAt = calendar(v.manilaDay(receivedAt), 'Delivery date');
      if (warrantyUntil && warrantyUntil < soldAt)
        throw new BadRequestException(
          'Warranty expiration cannot be before delivery.',
        );
      const asset = await tx.deviceAsset.create({
        data: {
          company,
          productId,
          customerId: delivery.order.customerId,
          deliveryId,
          serialNumber,
          soldAt,
          warrantyUntil,
          intervalMonths,
          nextMaintenanceAt: addCalendarMonths(soldAt, intervalMonths),
          createdBy: actor.username,
        },
      });
      await audit(tx, company, actor, 'REGISTER', 'DeviceAsset', asset.id, {
        serialNumber,
        deliveryId,
        productId,
      });
      return asset;
    });
  }

  async createVisit(company: string, actor: Actor, input: unknown) {
    this.require(actor, 'service', true);
    const body = v.object(input);
    const assetId = v.text(body.assetId, 'Device', true, 100)!;
    const type = v.choice(body.type, ['PM', 'REPAIR'], 'Service type');
    const dueDate = calendar(body.dueDate, 'Service date');
    const technician = v.text(body.technician, 'Technician', true, 200)!;
    const notes = v.text(body.notes, 'Notes', false, 4000);
    return this.transaction(company, async (tx) => {
      const asset = await tx.deviceAsset.findFirst({
        where: { id: assetId, company, status: 'ACTIVE' },
      });
      if (!asset) throw new NotFoundException('Active device not found.');
      if (dueDate < asset.soldAt)
        throw new BadRequestException(
          'Service date cannot be before device delivery.',
        );
      if (
        type === 'PM' &&
        (await tx.serviceVisit.findFirst({
          where: {
            company,
            assetId,
            type: 'PM',
            status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
          },
        }))
      ) {
        throw new ConflictException(
          'This device already has an open preventive maintenance visit.',
        );
      }
      const visit = await tx.serviceVisit.create({
        data: {
          company,
          number: await nextNumber(tx, company, 'SVC'),
          assetId,
          type,
          dueDate,
          technician,
          notes,
          parts: [],
          createdBy: actor.username,
        },
      });
      if (type === 'PM')
        await tx.deviceAsset.update({
          where: { id: asset.id },
          data: { nextMaintenanceAt: dueDate },
        });
      await audit(tx, company, actor, 'SCHEDULE', 'ServiceVisit', visit.id, {
        assetId,
        type,
        dueDate: iso(dueDate),
      });
      return visit;
    });
  }

  async updateVisit(company: string, actor: Actor, id: string, input: unknown) {
    this.require(actor, 'service', true);
    const body = v.object(input);
    const status = v.choice(
      body.status,
      ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
      'Service status',
    );
    const notes = v.text(body.notes, 'Notes', false, 4000);
    let parts:
      { description: string; quantity: number; unitCost: string }[] | undefined;
    if (body.parts !== undefined) {
      if (!Array.isArray(body.parts) || body.parts.length > 200)
        throw new BadRequestException('Provide at most 200 parts.');
      parts = body.parts.map((entry) => {
        const part = v.object(entry);
        return {
          description: v.text(part.description, 'Part description', true, 500)!,
          quantity: v.integer(part.quantity, 'Part quantity', 1),
          unitCost: money(part.unitCost, 'Part cost').toFixed(2),
        };
      });
    }
    const cost =
      body.cost === undefined ? undefined : money(body.cost, 'Service cost');
    return this.transaction(company, async (tx) => {
      const visit = await tx.serviceVisit.findFirst({
        where: { id, company, asset: { company } },
        include: { asset: true },
      });
      if (!visit) throw new NotFoundException('Service visit not found.');
      const allowed =
        visit.status === 'SCHEDULED'
          ? ['SCHEDULED', 'IN_PROGRESS', 'CANCELLED']
          : visit.status === 'IN_PROGRESS'
            ? ['IN_PROGRESS', 'COMPLETED', 'CANCELLED']
            : [];
      if (!allowed.includes(status))
        throw new ConflictException(
          'This service status transition is not permitted.',
        );
      const effectiveParts =
        parts ??
        (Array.isArray(visit.parts)
          ? (visit.parts as typeof parts & object)
          : []);
      const partsTotal = effectiveParts.reduce(
        (sum, part) =>
          sum.plus(new Prisma.Decimal(part.unitCost).mul(part.quantity)),
        new Prisma.Decimal(0),
      );
      const finalCost = money(
        (cost ?? (parts ? partsTotal : visit.cost)).toFixed(2),
        'Service cost',
      );
      if (finalCost.lt(partsTotal))
        throw new BadRequestException(
          'Service cost cannot be below the total parts cost.',
        );
      const completedAt = status === 'COMPLETED' ? new Date() : null;
      const result = await tx.serviceVisit.update({
        where: { id },
        data: {
          status,
          ...(notes !== undefined ? { notes } : {}),
          ...(parts !== undefined ? { parts } : {}),
          cost: finalCost,
          completedAt,
        },
      });
      if (visit.type === 'PM' && completedAt) {
        await tx.deviceAsset.update({
          where: { id: visit.assetId },
          data: {
            nextMaintenanceAt: addCalendarMonths(
              calendar(v.manilaDay(completedAt), 'Completion date'),
              visit.asset.intervalMonths,
            ),
          },
        });
      }
      await audit(tx, company, actor, status, 'ServiceVisit', id, {
        from: visit.status,
        cost: finalCost.toFixed(2),
        parts: effectiveParts,
      });
      return result;
    });
  }

  async report(
    company: string,
    actor: Actor,
    id: string,
  ): Promise<ManagementReport> {
    const definition = this.allowedReports(actor).find(
      (report) => report.id === id,
    );
    if (!definition)
      throw new ForbiddenException(
        'This report is unavailable for your ERP role.',
      );
    let rows: ManagementReport['rows'] = [];
    let truncated = false;
    let note: string | undefined;
    const today = companyToday();
    if (id === 'inventory-valuation' || id === 'stock-availability') {
      const stocks = await this.prisma.warehouseStock.groupBy({
        by: ['productId'],
        where: { company },
        _sum: { quantity: true },
        orderBy: { productId: 'asc' },
        take: LIMIT + 1,
      });
      truncated = stocks.length > LIMIT;
      const ids = stocks.slice(0, LIMIT).map((stock) => stock.productId);
      const [products, conditions, expired] = await Promise.all([
        this.prisma.product.findMany({
          where: { company, id: { in: ids } },
          select: {
            id: true,
            sku: true,
            name: true,
            purchasePrice: true,
            landedCostReference: true,
            minQuantity: true,
            reorderLevel: true,
          },
        }),
        this.prisma.warehouseLot.groupBy({
          by: ['productId', 'status'],
          where: { company, productId: { in: ids } },
          _sum: { quantity: true, reservedQty: true },
        }),
        this.prisma.warehouseLot.groupBy({
          by: ['productId'],
          where: {
            company,
            productId: { in: ids },
            status: 'AVAILABLE',
            expirationDate: { lt: new Date(today.getTime() - 8 * 3600000) },
          },
          _sum: { quantity: true, reservedQty: true },
        }),
      ]);
      rows = stocks
        .slice(0, LIMIT)
        .flatMap<ManagementReport['rows'][number]>((stock) => {
          const product = products.find(
            (product) => product.id === stock.productId,
          );
          if (!product) return [];
          const quantity = stock._sum.quantity ?? 0;
          if (id === 'inventory-valuation') {
            const unit =
              product.landedCostReference ??
              new Prisma.Decimal(String(product.purchasePrice));
            return [
              {
                productId: product.id,
                sku: product.sku,
                productName: product.name,
                quantity,
                unitCost: unit.toFixed(6),
                costBasis: product.landedCostReference
                  ? 'Approved landed reference'
                  : 'Manual purchase reference',
                value: unit.mul(quantity).toFixed(2),
              },
            ];
          }
          const lots = conditions.filter((lot) => lot.productId === product.id);
          const total = (status: string) =>
            lots
              .filter((lot) => lot.status === status)
              .reduce((sum, lot) => sum + (lot._sum.quantity ?? 0), 0);
          const expiredAvailable = expired.find(
            (lot) => lot.productId === product.id,
          );
          const reserved = Math.max(
            0,
            lots
              .filter((lot) => lot.status === 'AVAILABLE')
              .reduce((sum, lot) => sum + (lot._sum.reservedQty ?? 0), 0) -
              (expiredAvailable?._sum.reservedQty ?? 0),
          );
          const blocked = lots
            .filter((lot) => lot.status !== 'AVAILABLE')
            .reduce((sum, lot) => sum + (lot._sum.quantity ?? 0), 0);
          const available = Math.max(
            0,
            quantity -
              reserved -
              blocked -
              (expiredAvailable?._sum.quantity ?? 0),
          );
          return [
            {
              productId: product.id,
              sku: product.sku,
              productName: product.name,
              physical: quantity,
              available,
              reserved,
              quarantine: total('QUARANTINE'),
              damaged: total('DAMAGED'),
              expired:
                total('EXPIRED') + (expiredAvailable?._sum.quantity ?? 0),
              rejected: total('REJECTED'),
              reorderLevel: product.reorderLevel,
              lowStock: available <= product.reorderLevel,
            },
          ];
        });
      if (id === 'inventory-valuation')
        note =
          'Reference valuation, not FIFO/weighted-average statutory costing. Manual purchase prices and tier overrides are unchanged.';
    } else if (id === 'shipment-performance') {
      const shipments = await this.prisma.shipment.findMany({
        where: { company },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: LIMIT + 1,
      });
      truncated = shipments.length > LIMIT;
      rows = shipments.slice(0, LIMIT).map((shipment) => ({
        shipmentNumber: shipment.shipmentNumber,
        status: shipment.status,
        carrier: shipment.carrier,
        eta: iso(shipment.eta),
        revisedEta: iso(shipment.revisedEta),
        actualArrival: iso(shipment.actualArrival),
        ...v.shipmentDelay(shipment),
      }));
    } else if (id === 'landed-cost') {
      const costs = await this.prisma.landedCost.findMany({
        where: { company },
        include: { shipment: { select: { shipmentNumber: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: LIMIT + 1,
      });
      truncated = costs.length > LIMIT;
      rows = costs.slice(0, LIMIT).map((cost) => ({
        number: cost.number,
        shipment: cost.shipment.shipmentNumber,
        status: cost.status,
        allocationMethod: cost.allocationMethod,
        currency: cost.baseCurrency,
        total: cost.total.toFixed(2),
        approvedAt: iso(cost.approvedAt),
        approvedBy: cost.approvedBy,
      }));
    } else if (id === 'delivery-fulfillment') {
      const deliveries = await this.prisma.delivery.findMany({
        where: { company },
        include: { order: true, items: true, pods: { select: { id: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: LIMIT + 1,
      });
      const customers = await this.prisma.customer.findMany({
        where: {
          company,
          id: {
            in: [
              ...new Set(
                deliveries.map((delivery) => delivery.order.customerId),
              ),
            ],
          },
        },
        select: { id: true, name: true },
      });
      truncated = deliveries.length > LIMIT;
      rows = deliveries.slice(0, LIMIT).map((delivery) => ({
        number: delivery.delNumber,
        customer:
          customers.find(
            (customer) => customer.id === delivery.order.customerId,
          )?.name ?? delivery.order.customerId,
        order: delivery.order.sourceOsNumber ?? delivery.order.soNumber,
        status: delivery.status,
        scheduledAt: iso(delivery.scheduledAt),
        dispatchedAt: iso(delivery.dispatchedAt),
        ordered: delivery.items.reduce((sum, item) => sum + item.quantity, 0),
        delivered: delivery.items.reduce(
          (sum, item) => sum + item.deliveredQty,
          0,
        ),
        podCount: delivery.pods.length,
        carrier: delivery.carrier,
      }));
    } else if (id === 'device-service') {
      const assets = await this.prisma.deviceAsset.findMany({
        where: { company },
        include: {
          product: { select: { sku: true, name: true } },
          customer: { select: { name: true } },
          visits: {
            where: { company, status: { in: ['SCHEDULED', 'IN_PROGRESS'] } },
            select: { id: true },
            take: LIMIT,
          },
        },
        orderBy: [{ nextMaintenanceAt: 'asc' }, { id: 'asc' }],
        take: LIMIT + 1,
      });
      truncated = assets.length > LIMIT;
      rows = assets.slice(0, LIMIT).map((asset) => ({
        serialNumber: asset.serialNumber,
        sku: asset.product.sku,
        productName: asset.product.name,
        customer: asset.customer.name,
        soldAt: iso(asset.soldAt),
        warrantyUntil: iso(asset.warrantyUntil),
        warrantyStatus: this.warrantyStatus(asset.warrantyUntil, today),
        nextMaintenanceAt: iso(asset.nextMaintenanceAt),
        maintenanceOverdue:
          !!asset.nextMaintenanceAt && asset.nextMaintenanceAt < today,
        openVisits: asset.visits.length,
      }));
    } else if (id === 'sales-margin') {
      const documents = await this.prisma.financeDocument.findMany({
        where: { company, status: 'POSTED', direction: 'AR' },
        orderBy: [{ issueDate: 'desc' }, { id: 'asc' }],
        take: LIMIT + 1,
      });
      truncated = documents.length > LIMIT;
      const ids = documents.slice(0, LIMIT).map((document) => document.id);
      const journals = await this.prisma.accountingJournal.findMany({
        where: { company, status: 'POSTED', sourceId: { in: ids } },
        include: {
          entries: {
            where: { account: { company, code: '5100' } },
            select: { debit: true, credit: true },
          },
        },
      });
      rows = documents.slice(0, LIMIT).map((document) => {
        const revenue =
          document.kind === 'CREDIT_MEMO'
            ? document.subtotal.negated()
            : document.subtotal;
        const matched = journals.filter(
          (journal) => journal.sourceId === document.id,
        );
        const cogs = matched.reduce(
          (sum, journal) =>
            journal.entries.reduce(
              (amount, entry) => amount.plus(entry.debit).minus(entry.credit),
              sum,
            ),
          new Prisma.Decimal(0),
        );
        const memo = ['CREDIT_MEMO', 'DEBIT_MEMO'].includes(document.kind);
        const data =
          document.data &&
          typeof document.data === 'object' &&
          !Array.isArray(document.data)
            ? document.data
            : null;
        const explicitZeroCost =
          !!data &&
          Array.isArray(data.items) &&
          data.items.length > 0 &&
          data.items.every(
            (item) =>
              item &&
              typeof item === 'object' &&
              !Array.isArray(item) &&
              typeof item.unitCost === 'string' &&
              /^0+(?:\.0+)?$/.test(item.unitCost),
          );
        const knownCost =
          memo ||
          matched.some((journal) => journal.entries.length > 0) ||
          (matched.length > 0 && explicitZeroCost);
        const postedCost = memo ? new Prisma.Decimal(0) : cogs;
        return {
          number: document.number,
          kind: document.kind,
          date: iso(document.issueDate),
          revenue: revenue.toFixed(2),
          postedCost: knownCost ? postedCost.toFixed(2) : null,
          margin: knownCost ? revenue.minus(postedCost).toFixed(2) : null,
        };
      });
      note =
        'Revenue excludes VAT. Invoice cost uses the posted landed/manual cost reference locked at invoice draft, not FIFO or weighted-average valuation. Financial memos adjust revenue without changing stock or COGS. Missing cost evidence is blank.';
    } else {
      const balances = await this.balanceRows(
        company,
        actor,
        id.startsWith('receivables') || id === 'customer-balances'
          ? 'AR'
          : 'AP',
      );
      truncated = balances.truncated;
      if (id.endsWith('-aging'))
        rows = balances.rows.filter((row) =>
          new Prisma.Decimal(row.outstanding).gt(0),
        );
      else {
        const grouped = new Map<
          string,
          {
            partyId: string;
            party: string;
            outstanding: Prisma.Decimal;
            overdue: Prisma.Decimal;
            creditBalance: Prisma.Decimal;
          }
        >();
        for (const row of balances.rows) {
          const group = grouped.get(row.partyId) ?? {
            partyId: row.partyId,
            party: row.party,
            outstanding: new Prisma.Decimal(0),
            overdue: new Prisma.Decimal(0),
            creditBalance: new Prisma.Decimal(0),
          };
          group.outstanding = group.outstanding.plus(row.outstanding);
          if (row.daysOverdue > 0 && new Prisma.Decimal(row.outstanding).gt(0))
            group.overdue = group.overdue.plus(row.outstanding);
          if (new Prisma.Decimal(row.outstanding).lt(0))
            group.creditBalance = group.creditBalance.minus(row.outstanding);
          grouped.set(row.partyId, group);
        }
        rows = [...grouped.values()].map((group) => ({
          partyId: group.partyId,
          party: group.party,
          outstanding: group.outstanding.toFixed(2),
          overdue: group.overdue.toFixed(2),
          creditBalance: group.creditBalance.toFixed(2),
        }));
      }
      note =
        'Balances include posted Phase 3 documents, memos and posted allocated payments; legacy opening balances are separate. Truncated reports are partial and must not be used as full balances.';
    }
    return {
      id,
      title: definition.title,
      columns: rows.length ? Object.keys(rows[0]) : [],
      rows,
      generatedAt: new Date().toISOString(),
      truncated,
      limit: LIMIT,
      ...(note ? { note } : {}),
    };
  }

  private async balanceRows(
    company: string,
    actor: Actor,
    direction: 'AR' | 'AP',
  ) {
    const balances = await this.finance.balances(company, actor, direction);
    const documents = balances.documents;
    const ids = [
      ...new Set(documents.slice(0, LIMIT).map((document) => document.partyId)),
    ];
    const names =
      direction === 'AR'
        ? (
            await this.prisma.customer.findMany({
              where: { company, id: { in: ids } },
              select: { id: true, name: true },
            })
          ).map((party) => ({ id: party.id, name: party.name }))
        : (
            await this.prisma.supplier.findMany({
              where: { company, id: { in: ids } },
              select: { id: true, legalName: true },
            })
          ).map((party) => ({ id: party.id, name: party.legalName }));
    return {
      truncated:
        documents.length > LIMIT ||
        ('truncated' in balances && balances.truncated === true),
      rows: documents
        .slice(0, LIMIT)
        .map((document) => {
          const daysOverdue = Math.max(0, document.ageDays);
          return {
            number: document.number,
            partyId: document.partyId,
            party:
              names.find((party) => party.id === document.partyId)?.name ??
              document.partyId,
            dueDate: iso(new Date(document.dueDate)),
            outstanding: document.outstanding,
            daysOverdue,
            aging:
              daysOverdue === 0
                ? 'Current'
                : daysOverdue <= 30
                  ? '1–30'
                  : daysOverdue <= 60
                    ? '31–60'
                    : daysOverdue <= 90
                      ? '61–90'
                      : '90+',
          };
        })
        .filter((row) => !new Prisma.Decimal(row.outstanding).isZero()),
    };
  }

  private async forecast(company: string) {
    const today = companyToday();
    const start = new Date(today.getTime() - 89 * DAY - 8 * 3600000);
    const end = new Date(today.getTime() + DAY - 8 * 3600000);
    const receipts = await this.prisma.deliveryPod.findMany({
      where: {
        delivery: { company, order: { company } },
        receivedAt: { gte: start, lt: end },
      },
      include: {
        delivery: {
          select: { items: { select: { id: true, productId: true } } },
        },
      },
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
      take: LIMIT + 1,
    });
    const products = await this.prisma.product.findMany({
      where: {
        company,
        id: {
          in: [
            ...new Set(
              receipts.flatMap((receipt) =>
                receipt.delivery.items.map((item) => item.productId),
              ),
            ),
          ],
        },
      },
      select: { id: true, sku: true, name: true },
    });
    const demand = new Map<
      number,
      {
        productId: number;
        sku: string;
        productName: string;
        deliveredQuantity: number;
      }
    >();
    for (const receipt of receipts.slice(0, LIMIT)) {
      if (!Array.isArray(receipt.items)) continue;
      for (const entry of receipt.items) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry))
          continue;
        const item = receipt.delivery.items.find(
          (item) => item.id === entry.deliveryItemId,
        );
        const product = products.find(
          (product) => product.id === item?.productId,
        );
        if (
          !item ||
          !product ||
          typeof entry.quantity !== 'number' ||
          !Number.isSafeInteger(entry.quantity) ||
          entry.quantity <= 0
        )
          continue;
        const row = demand.get(item.productId) ?? {
          productId: item.productId,
          sku: product.sku,
          productName: product.name,
          deliveredQuantity: 0,
        };
        row.deliveredQuantity += entry.quantity;
        demand.set(item.productId, row);
      }
    }
    const enough =
      receipts.length > 0 &&
      receipts.length <= LIMIT &&
      daysBetween(
        today,
        calendar(v.manilaDay(receipts[0].receivedAt), 'Delivery date'),
      ) >= 14;
    return {
      method:
        'Confirmed POD quantities in the trailing 90 calendar days / 90 × 30; no seasonality or unmet demand assumed.',
      historyDays: 90,
      projectionDays: 30,
      status: enough ? 'AVAILABLE' : 'INSUFFICIENT_DATA',
      reason:
        receipts.length > LIMIT
          ? 'The receipt query limit was reached; narrow historical reporting before relying on a forecast.'
          : enough
            ? null
            : 'At least 14 days of delivery history is needed. Sparse history may understate demand.',
      rows: [...demand.values()]
        .sort((a, b) => b.deliveredQuantity - a.deliveredQuantity)
        .slice(0, 200)
        .map((row) => ({
          ...row,
          averageDaily: Number((row.deliveredQuantity / 90).toFixed(4)),
          projectedQuantity: enough
            ? Math.ceil((row.deliveredQuantity / 90) * 30)
            : null,
        })),
    };
  }

  async executive(company: string, actor: Actor) {
    const reports = this.allowedReports(actor).map(({ id, title, scope }) => ({
      id,
      title,
      scope,
    }));
    const allowed = new Set(reports.map((report) => report.id));
    const alerts: {
      id: string;
      title: string;
      count: number;
      severity: string;
      reportId?: string;
    }[] = [];
    const summary: {
      id: string;
      title: string;
      value: string | number;
      unit?: string;
    }[] = [];
    const today = companyToday();
    let forecast: unknown = null;
    if (allowed.has('shipment-performance')) {
      const [active, delayed, pendingReceipts] = await Promise.all([
        this.prisma.shipment.count({
          where: { company, status: { notIn: ['Closed', 'Cancelled'] } },
        }),
        this.prisma.shipment.count({
          where: {
            company,
            actualArrival: null,
            status: { notIn: ['Closed', 'Cancelled'] },
            OR: [
              { revisedEta: { lt: new Date(today.getTime() - 8 * 3600000) } },
              {
                revisedEta: null,
                eta: { lt: new Date(today.getTime() - 8 * 3600000) },
              },
            ],
          },
        }),
        this.prisma.shipment.count({
          where: {
            company,
            actualArrival: { not: null },
            status: { notIn: ['Closed', 'Cancelled'] },
            receipts: { none: {} },
          },
        }),
      ]);
      summary.push({
        id: 'active-shipments',
        title: 'Active shipments',
        value: active,
      });
      alerts.push(
        {
          id: 'delayed-shipments',
          title: 'Delayed shipments',
          count: delayed,
          severity: 'warning',
          reportId: 'shipment-performance',
        },
        {
          id: 'pending-receipts',
          title: 'Arrived shipments awaiting initial receipt',
          count: pendingReceipts,
          severity: 'info',
          reportId: 'shipment-performance',
        },
      );
    }
    if (allowed.has('delivery-fulfillment')) {
      const pending = await this.prisma.delivery.count({
        where: { company, status: { notIn: ['Delivered', 'Cancelled'] } },
      });
      alerts.push({
        id: 'pending-deliveries',
        title: 'Pending deliveries',
        count: pending,
        severity: 'info',
        reportId: 'delivery-fulfillment',
      });
      forecast = await this.forecast(company);
    }
    if (allowed.has('stock-availability')) {
      const stock = await this.report(company, actor, 'stock-availability');
      alerts.push({
        id: 'low-stock',
        title: stock.truncated ? 'Low stock (partial dataset)' : 'Low stock',
        count: stock.rows.filter((row) => row.lowStock).length,
        severity: 'warning',
        reportId: 'stock-availability',
      });
    }
    if (allowed.has('receivables-aging')) {
      const ar = await this.balanceRows(company, actor, 'AR');
      const overdue = ar.rows.filter(
        (row) =>
          row.daysOverdue > 0 && new Prisma.Decimal(row.outstanding).gt(0),
      );
      alerts.push({
        id: 'overdue-receivables',
        title: ar.truncated
          ? 'Overdue receivables (partial dataset)'
          : 'Overdue receivables',
        count: overdue.length,
        severity: 'warning',
        reportId: 'receivables-aging',
      });
      summary.push({
        id: 'receivables',
        title: ar.truncated
          ? 'Net receivables (partial dataset)'
          : 'Net receivables',
        value: ar.rows
          .reduce(
            (sum, row) => sum.plus(row.outstanding),
            new Prisma.Decimal(0),
          )
          .toFixed(2),
        unit: 'PHP',
      });
    }
    if (allowed.has('device-service')) {
      const due = await this.prisma.deviceAsset.count({
        where: { company, status: 'ACTIVE', nextMaintenanceAt: { lte: today } },
      });
      alerts.push({
        id: 'service-due',
        title: 'Maintenance due',
        count: due,
        severity: 'warning',
        reportId: 'device-service',
      });
    }
    // Expiry alerts do not expose document names/contents; only roles handling compliance receive the count.
    if (
      actor.role === 'Super Admin' ||
      erpRoles(actor).some((role) =>
        [
          'Management',
          'Auditor',
          'QC/Regulatory',
          'Importation',
          'Purchasing',
        ].includes(role),
      )
    ) {
      const count = await this.prisma.document.count({
        where: {
          company,
          status: 'ACTIVE',
          expiryDate: { lte: new Date(today.getTime() + 30 * DAY) },
        },
      });
      alerts.push({
        id: 'expiring-documents',
        title: 'Expired / expiring documents (30 days)',
        count,
        severity: 'warning',
      });
    }
    return {
      alerts,
      summary,
      forecast,
      reports,
      generatedAt: new Date().toISOString(),
    };
  }

  async query(company: string, actor: Actor, input: unknown) {
    this.require(actor, 'ai');
    const question = v.text(v.object(input).question, 'Question', true, 2000)!;
    const allowed = this.allowedReports(actor);
    if (!allowed.length)
      throw new ForbiddenException(
        'No management reports are permitted for this role.',
      );
    const reports = [] as {
      id: string;
      title: string;
      rows: ManagementReport['rows'];
      truncated: boolean;
      note?: string;
    }[];
    for (const definition of allowed) {
      const report = await this.report(company, actor, definition.id);
      reports.push({
        id: report.id,
        title: report.title,
        rows: report.rows.slice(0, 20),
        truncated: report.truncated || report.rows.length > 20,
        note: report.note,
      });
    }
    try {
      const result = await this.gemini.answerExecutiveQuestion(question, {
        company,
        generatedAt: new Date().toISOString(),
        reports,
      });
      await this.transaction(company, (tx) =>
        audit(tx, company, actor, 'QUERY', 'ExecutiveAI', 'read-only', {
          reportIds: reports.map((report) => report.id),
        }),
      );
      return { ...result, generatedAt: new Date().toISOString() };
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      throw new ServiceUnavailableException(
        'The AI analysis could not be completed. Reports remain available; retry the question later.',
      );
    }
  }

  async ocr(company: string, actor: Actor, input: unknown) {
    this.requireOcr(actor);
    const documentId = v.integer(v.object(input).documentId, 'Document', 1);
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, company, status: 'ACTIVE' },
      select: { id: true, geminiFileUri: true, mimeType: true },
    });
    if (!document) throw new NotFoundException('Uploaded document not found.');
    if (!document.geminiFileUri)
      throw new BadRequestException(
        'This document has not been indexed for AI reading. Re-index it in the document module first.',
      );
    try {
      const extracted = await this.gemini.extractInvoiceForReview({
        fileUri: document.geminiFileUri,
        mimeType: document.mimeType,
      });
      await this.transaction(company, (tx) =>
        audit(
          tx,
          company,
          actor,
          'OCR_REVIEW',
          'Document',
          String(document.id),
          { reviewRequired: true },
        ),
      );
      return { reviewRequired: true as const, extracted };
    } catch {
      throw new ServiceUnavailableException(
        'Invoice reading could not be completed. Verify the uploaded document and retry; no finance records were created.',
      );
    }
  }

  private requireOcr(actor: Actor) {
    this.require(actor, 'ai');
    const modules =
      actor.modules &&
      typeof actor.modules === 'object' &&
      !Array.isArray(actor.modules)
        ? (actor.modules as Record<string, unknown>)
        : {};
    if (actor.role !== 'Super Admin' && modules.ai_docs !== true) {
      throw new ForbiddenException(
        'Document module access is required to read uploaded invoices.',
      );
    }
    if (
      actor.role !== 'Super Admin' &&
      !erpRoles(actor).some((role) =>
        ['Management', 'Finance', 'Purchasing', 'Importation'].includes(role),
      )
    ) {
      throw new ForbiddenException(
        'Invoice reading is restricted to Finance, Purchasing and Importation.',
      );
    }
  }

  async ocrDocuments(company: string, actor: Actor) {
    this.requireOcr(actor);
    return this.prisma.document.findMany({
      where: {
        company,
        status: 'ACTIVE',
        geminiFileUri: { not: null },
        OR: [
          { mimeType: { startsWith: 'image/' } },
          { mimeType: { startsWith: 'text/' } },
          {
            mimeType: {
              in: [
                'application/pdf',
                'application/json',
                'application/xml',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              ],
            },
          },
        ],
      },
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        status: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: LIMIT,
    });
  }
}
