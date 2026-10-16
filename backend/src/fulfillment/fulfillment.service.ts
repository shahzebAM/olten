import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { Prisma, PrismaClient, type WarehouseLot } from '@prisma/client';
import type { SessionAdmin } from '../auth/auth-session.service';
import * as v from '../importation/importation.validation';
import { companyToday, parseIsoDate } from '../documentation/expiry-date.utils';
import {
  assertScan,
  changeAggregate,
  fefo,
  lockProduct,
  lotAvailable,
  LOT_STATUSES,
  materializeLegacy,
  physicalStock,
  projectIncoming,
  validateLocation,
  type Tx,
} from './fulfillment.stock';

type User = Omit<SessionAdmin, 'password'>;
type DocumentInput = {
  sourceType: 'FO' | 'PL';
  sourceId: string;
  documentNumber: string;
  referenceOs?: string | null;
  customerId: string;
  items: { productId: number; quantity: number }[];
};
const orderInclude = {
  items: {
    include: {
      reservations: { include: { lot: { include: { bin: true } } } },
      incoming: true,
    },
  },
} as const;
const deliveryInclude = {
  items: {
    include: {
      orderLine: true,
      picks: {
        include: { lot: { include: { bin: true } }, reservation: true },
      },
    },
  },
  sources: true,
  pods: true,
  order: true,
} as const;
const countInclude = {
  lines: { include: { lot: { include: { bin: true } } } },
} as const;
const active = (reservation: {
  quantity: number;
  dispatchedQty: number;
  releasedQty: number;
}) =>
  reservation.quantity - reservation.dispatchedQty - reservation.releasedQty;
const issued = (delivery: { dispatchedAt: Date | null; status: string }) =>
  Boolean(delivery.dispatchedAt) ||
  ['Dispatched', 'PartiallyDelivered', 'Delivered'].includes(delivery.status);

export function samePodReceipt(
  receipt: { recipient: string; receivedAt: Date; items: unknown },
  input: { recipient: string; receivedAt: Date; items: unknown },
) {
  if (
    receipt.recipient !== input.recipient ||
    receipt.receivedAt.getTime() !== input.receivedAt.getTime() ||
    !Array.isArray(receipt.items) ||
    !Array.isArray(input.items) ||
    receipt.items.length !== input.items.length
  )
    return false;
  const incoming: unknown[] = input.items;
  return receipt.items.every((line: unknown) => {
    if (!line || typeof line !== 'object' || Array.isArray(line)) return false;
    const item = line as Record<string, unknown>;
    return incoming.some((candidate: unknown) => {
      if (
        !candidate ||
        typeof candidate !== 'object' ||
        Array.isArray(candidate)
      )
        return false;
      const other = candidate as Record<string, unknown>;
      return (
        item.deliveryItemId === other.deliveryItemId &&
        item.quantity === other.quantity
      );
    });
  });
}

@Injectable()
export class FulfillmentService implements OnModuleDestroy {
  private readonly prisma = new PrismaClient();
  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
  async transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 20000,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2034', 'P2002'].includes(error.code)
      )
        throw new ConflictException(
          'Stock or document changed. Refresh and try again.',
        );
      throw error;
    }
  }
  canApprove(user: User) {
    const permissions = (
      user.modules && typeof user.modules === 'object' ? user.modules : {}
    ) as Record<string, unknown>;
    if (
      !['Super Admin', 'Admin'].includes(user.role) &&
      permissions.warehouse_approve !== true
    )
      throw new ForbiddenException(
        'A warehouse approver or administrator is required.',
      );
  }
  private async number(tx: Tx, prefix: string) {
    const year = new Intl.DateTimeFormat('en', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
    }).format(new Date());
    const seq = await tx.importSequence.upsert({
      where: { key: `${prefix}:${year}` },
      create: { key: `${prefix}:${year}`, value: 1 },
      update: { value: { increment: 1 } },
    });
    return `${prefix}-${year}-${String(seq.value).padStart(6, '0')}`;
  }
  private async order(tx: Tx, company: string, id: string) {
    const order = await tx.customerOrder.findFirst({
      where: { id, company },
      include: orderInclude,
    });
    if (!order)
      throw new NotFoundException(
        'Customer order not found in this workspace.',
      );
    return order;
  }
  private async delivery(tx: Tx, company: string, id: string) {
    const delivery = await tx.delivery.findFirst({
      where: { id, company },
      include: deliveryInclude,
    });
    if (!delivery)
      throw new NotFoundException('Delivery not found in this workspace.');
    return delivery;
  }
  private async count(tx: Tx, company: string, id: string) {
    const count = await tx.cycleCount.findFirst({
      where: { id, company },
      include: countInclude,
    });
    if (!count)
      throw new NotFoundException('Cycle count not found in this workspace.');
    return count;
  }
  private async lot(tx: Tx, company: string, id: string) {
    const lot = await tx.warehouseLot.findFirst({
      where: { id, company },
      include: { bin: true },
    });
    if (!lot)
      throw new NotFoundException('Stock lot not found in this workspace.');
    await lockProduct(tx, company, lot.productId);
    return lot;
  }
  private async movement(
    tx: Tx,
    company: string,
    user: string,
    lot: {
      id: string;
      productId: number;
      warehouseId: string;
      binId: string | null;
      batchNumber: string | null;
      serialNumber: string | null;
      expirationDate: Date | null;
    },
    type: string,
    quantity: number,
    balances: { previousStock: number; newStock: number },
    reference: string,
    remarks?: string,
  ) {
    const product = await tx.product.findFirstOrThrow({
      where: { id: lot.productId, company },
    });
    return tx.inventoryMovement.create({
      data: {
        company,
        user,
        productId: lot.productId,
        productName: product.name,
        sku: product.sku,
        type,
        quantity,
        ...balances,
        reference,
        remarks,
        warehouseId:
          lot.warehouseId === 'MASTER' ? null : Number(lot.warehouseId),
        lotId: lot.id,
        binId: lot.binId,
        batchNumber: lot.batchNumber,
        serialNumber: lot.serialNumber,
        expirationDate: lot.expirationDate,
      },
    });
  }
  async overview(company: string) {
    const [
      products,
      warehouses,
      bins,
      lots,
      orders,
      deliveries,
      cycleCounts,
      receipts,
      customers,
      shipments,
    ] = await Promise.all([
      this.prisma.product.findMany({
        where: { company },
        orderBy: { name: 'asc' },
      }),
      this.prisma.warehouse.findMany({
        where: { company },
        orderBy: { id: 'asc' },
      }),
      this.prisma.warehouseBin.findMany({
        where: { company },
        orderBy: { code: 'asc' },
      }),
      this.prisma.warehouseLot.findMany({
        where: { company },
        include: { bin: true },
        orderBy: [{ expirationDate: 'asc' }, { receivedAt: 'asc' }],
      }),
      this.prisma.customerOrder.findMany({
        where: { company },
        include: orderInclude,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.delivery.findMany({
        where: { company },
        include: deliveryInclude,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.cycleCount.findMany({
        where: { company },
        include: countInclude,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.goodsReceiptLine.findMany({
        where: {
          receipt: { company },
          OR: [
            { heldQty: { gt: 0 } },
            { rejectedQty: { gt: 0 } },
            { acceptedQty: { gt: 0 } },
          ],
        },
        include: {
          receipt: true,
          shipmentLine: { include: { purchaseOrderItem: true } },
        },
      }),
      this.prisma.customer.findMany({
        where: { company },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.shipment.findMany({
        where: { company, status: { notIn: ['Cancelled', 'Closed'] } },
        include: {
          items: { include: { purchaseOrderItem: true, receipts: true } },
        },
      }),
    ]);
    const byProduct = new Map(products.map((product) => [product.id, product]));
    const lotView = (lot: (typeof lots)[number]) => ({
      ...lot,
      product: byProduct.get(lot.productId),
      effectiveStatus:
        lot.expirationDate && lot.expirationDate < companyToday()
          ? 'EXPIRED'
          : lot.status,
      availableQty: lotAvailable(
        lot,
        byProduct.get(lot.productId),
        lot.serialNumber,
      ),
    });
    const projectedIncoming = projectIncoming(
      orders,
      shipments.flatMap((shipment) => shipment.items),
    );
    return {
      products: products.filter(
        (product) => !product.deletedAt && product.isActive,
      ),
      warehouses,
      bins,
      customers,
      lots: lots.map(lotView),
      orders: orders.map((order) => ({
        ...order,
        customer: customers.find(
          (customer) => customer.id === order.customerId,
        ),
        items: order.items.map((line) => ({
          ...line,
          product: byProduct.get(line.productId),
          reservedQty: line.reservations.reduce(
            (sum, reservation) => sum + active(reservation),
            0,
          ),
          dispatchedQty: line.reservations.reduce(
            (sum, reservation) => sum + reservation.dispatchedQty,
            0,
          ),
          incoming: line.incoming.map((allocation) => ({
            ...allocation,
            pendingQty: projectedIncoming.get(allocation.id) ?? 0,
          })),
          incomingQty: line.incoming.reduce(
            (sum, allocation) =>
              sum + (projectedIncoming.get(allocation.id) ?? 0),
            0,
          ),
          remainingQty: Math.max(0, line.quantity - line.deliveredQty),
          reservations: line.reservations.map((reservation) => ({
            ...reservation,
            activeQty: active(reservation),
            lot: lotView(reservation.lot),
          })),
        })),
      })),
      deliveries: deliveries.map((delivery) => ({
        ...delivery,
        customer: customers.find(
          (customer) => customer.id === delivery.order.customerId,
        ),
        items: delivery.items.map((item) => ({
          ...item,
          product: byProduct.get(item.productId),
          picks: item.picks.map((pick) => ({
            ...pick,
            lot: lotView(pick.lot),
          })),
        })),
      })),
      cycleCounts: cycleCounts.map((count) => ({
        ...count,
        lines: count.lines.map((line) => ({ ...line, lot: lotView(line.lot) })),
      })),
      qcBalances: receipts.map((line) => ({
        receiptLineId: line.id,
        grnNumber: line.receipt.grnNumber,
        productId: line.shipmentLine.purchaseOrderItem.productId,
        sku: line.shipmentLine.purchaseOrderItem.sku,
        productName: line.shipmentLine.purchaseOrderItem.productName,
        quarantineQty: line.heldQty,
        rejectedQty: line.rejectedQty,
        acceptedUnplacedQty: line.acceptedQty - line.placedQty,
        batchNumber: line.batchNumber,
        expirationDate: line.expirationDate,
      })),
      shipments: shipments.map((shipment) => ({
        ...shipment,
        items: shipment.items.map((line) => ({
          ...line,
          productId: line.purchaseOrderItem.productId,
          sku: line.purchaseOrderItem.sku,
          productName: line.purchaseOrderItem.productName,
          incomingQty: Math.max(
            0,
            line.shippedQty -
              line.receipts.reduce(
                (sum, receipt) => sum + receipt.receivedQty,
                0,
              ),
          ),
        })),
      })),
    };
  }
  async availableStock(tx: Tx, company: string, productIds: number[]) {
    const [products, stocks, lots, warehouses] = await Promise.all([
      tx.product.findMany({ where: { company, id: { in: productIds } } }),
      tx.warehouseStock.findMany({
        where: { company, productId: { in: productIds } },
      }),
      tx.warehouseLot.findMany({
        where: { company, productId: { in: productIds } },
      }),
      tx.warehouse.findMany({ where: { company, status: 'Active' } }),
    ]);
    const result: Record<
      number,
      {
        officeStock: number;
        warehouseQty: number;
        warehouseBreakdown: { name: string; quantity: number }[];
        availableQty: number;
        reservedQty: number;
      }
    > = {};
    for (const product of products) {
      const facilities = [
        { warehouseId: 'MASTER', quantity: product.currentStock },
        ...stocks.filter(
          (stock) =>
            stock.productId === product.id &&
            warehouses.some(
              (warehouse) => String(warehouse.id) === stock.warehouseId,
            ),
        ),
      ];
      const available = facilities.map((stock) => {
        const tracked = lots.filter(
          (lot) =>
            lot.productId === product.id &&
            lot.warehouseId === stock.warehouseId,
        );
        const unknown =
          product.expiryControlled || product.serialControlled
            ? 0
            : Math.max(
                0,
                stock.quantity -
                  tracked.reduce((sum, lot) => sum + lot.quantity, 0),
              );
        return {
          warehouseId: stock.warehouseId,
          quantity:
            unknown +
            tracked.reduce(
              (sum, lot) => sum + lotAvailable(lot, product, lot.serialNumber),
              0,
            ),
        };
      });
      const officeStock =
        available.find((stock) => stock.warehouseId === 'MASTER')?.quantity ??
        0;
      const warehouseBreakdown = available
        .filter((stock) => stock.warehouseId !== 'MASTER' && stock.quantity > 0)
        .map((stock) => ({
          name:
            warehouses.find(
              (warehouse) => String(warehouse.id) === stock.warehouseId,
            )?.name ?? stock.warehouseId,
          quantity: stock.quantity,
        }));
      const warehouseQty = warehouseBreakdown.reduce(
        (sum, stock) => sum + stock.quantity,
        0,
      );
      result[product.id] = {
        officeStock,
        warehouseQty,
        warehouseBreakdown,
        availableQty: officeStock + warehouseQty,
        reservedQty: lots
          .filter((lot) => lot.productId === product.id)
          .reduce((sum, lot) => sum + lot.reservedQty, 0),
      };
    }
    return result;
  }
  async createBin(company: string, input: unknown) {
    const data = v.object(input);
    const warehouseId = v.text(data.warehouseId, 'Warehouse', true, 20)!;
    const labels = [
      'building',
      'floor',
      'zone',
      'rack',
      'shelf',
      'bin',
    ] as const;
    const parts = labels.map((label) => {
      const text = v.text(data[label], label, true, 30)!;
      if (!/^[A-Za-z0-9_]+$/.test(text))
        throw new BadRequestException(
          'Location labels must use letters, numbers or underscores.',
        );
      return text.toUpperCase();
    });
    return this.transaction(async (tx) => {
      await validateLocation(tx, company, warehouseId);
      return tx.warehouseBin.create({
        data: {
          company,
          warehouseId,
          code: parts.join('-'),
          building: parts[0],
          floor: parts[1],
          zone: parts[2],
          rack: parts[3],
          shelf: parts[4],
          bin: parts[5],
        },
      });
    });
  }
  async controls(company: string, user: User, id: number, input: unknown) {
    this.canApprove(user);
    const data = v.object(input);
    if (
      typeof data.expiryControlled !== 'boolean' ||
      typeof data.serialControlled !== 'boolean'
    )
      throw new BadRequestException('Both product controls must be boolean.');
    return this.transaction(async (tx) => {
      await lockProduct(tx, company, id);
      const reserved = await tx.warehouseLot.findMany({
        where: { company, productId: id, reservedQty: { gt: 0 } },
      });
      if (
        reserved.some(
          (lot) =>
            (data.expiryControlled && !lot.expirationDate) ||
            (data.serialControlled && !lot.serialNumber),
        )
      )
        throw new ConflictException(
          'Release incompatible reservations before enabling product controls.',
        );
      return tx.product.update({
        where: { id },
        data: {
          expiryControlled: data.expiryControlled as boolean,
          serialControlled: data.serialControlled as boolean,
        },
      });
    });
  }
  async registerLot(company: string, user: string, input: unknown) {
    const data = v.object(input);
    const productId = v.integer(data.productId, 'Product', 1);
    const quantity = v.integer(data.quantity, 'Quantity', 1);
    const warehouseId = v.text(data.warehouseId, 'Warehouse', true, 20)!;
    const binId = v.text(data.binId, 'Bin', false, 100);
    const batchNumber = v.text(data.batchNumber, 'Batch', false, 100);
    const serialNumber = v.text(data.serialNumber, 'Serial', false, 150);
    const status =
      data.status === undefined
        ? 'AVAILABLE'
        : v.choice(data.status, LOT_STATUSES, 'stock status');
    const expirationDate = data.expirationDate
      ? parseIsoDate(data.expirationDate)
      : null;
    if (data.expirationDate && !expirationDate)
      throw new BadRequestException('Expiry must be a valid calendar date.');
    return this.transaction(async (tx) => {
      const product = await lockProduct(tx, company, productId);
      await validateLocation(tx, company, warehouseId, binId);
      if (product.expiryControlled && !expirationDate)
        throw new BadRequestException(
          'An expiry date is required for this product.',
        );
      if (
        (product.serialControlled && !serialNumber) ||
        (serialNumber && quantity !== 1)
      )
        throw new BadRequestException(
          'Serialized goods require one unit and a serial number.',
        );
      const aggregate = await tx.warehouseLot.aggregate({
        where: { company, productId, warehouseId },
        _sum: { quantity: true },
      });
      const physical = await physicalStock(tx, company, productId, warehouseId);
      let missing = quantity - (physical - (aggregate._sum.quantity ?? 0));
      if (missing > 0) {
        const unknown = await tx.warehouseLot.findMany({
          where: {
            company,
            productId,
            warehouseId,
            status: 'AVAILABLE',
            binId: null,
            batchNumber: null,
            serialNumber: null,
            expirationDate: null,
          },
          orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
        });
        for (const lot of unknown) {
          const moved = Math.min(missing, lot.quantity - lot.reservedQty);
          if (moved > 0) {
            await tx.warehouseLot.update({
              where: { id: lot.id },
              data: {
                quantity: { decrement: moved },
                version: { increment: 1 },
              },
            });
            missing -= moved;
          }
          if (missing <= 0) break;
        }
      }
      if (missing > 0)
        throw new ConflictException(
          'Only existing untracked or unallocated unlocated stock can be registered. Receive new goods through receiving.',
        );
      const stock =
        warehouseId === 'MASTER'
          ? null
          : await tx.warehouseStock.findUnique({
              where: { warehouseId_productId: { warehouseId, productId } },
            });
      return tx.warehouseLot.create({
        data: {
          company,
          productId,
          warehouseId,
          warehouseStockId: stock?.id,
          binId,
          quantity,
          batchNumber,
          serialNumber,
          expirationDate,
          status,
          createdBy: user,
        },
      });
    });
  }
  async lotStatus(company: string, user: string, id: string, input: unknown) {
    const status = v.choice(
      v.object(input).status,
      LOT_STATUSES,
      'stock status',
    );
    return this.transaction(async (tx) => {
      const lot = await this.lot(tx, company, id);
      if (lot.reservedQty > 0 && status !== 'AVAILABLE')
        throw new ConflictException(
          'Reserved stock must be released before changing its status.',
        );
      const updated = await tx.warehouseLot.update({
        where: { id },
        data: { status, version: { increment: 1 } },
      });
      const physical = await physicalStock(
        tx,
        company,
        lot.productId,
        lot.warehouseId,
      );
      await this.movement(
        tx,
        company,
        user,
        lot,
        'STATUS',
        lot.quantity,
        { previousStock: physical, newStock: physical },
        lot.id,
        `${lot.status} to ${status}`,
      );
      return updated;
    });
  }
  async transfer(company: string, user: string, input: unknown) {
    const data = v.object(input);
    const id = v.text(data.lotId, 'Lot')!;
    const quantity = v.integer(data.quantity, 'Quantity', 1);
    const destinationWarehouseId = v.text(
      data.destinationWarehouseId,
      'Destination warehouse',
      true,
      20,
    )!;
    const destinationBinId = v.text(
      data.destinationBinId,
      'Destination bin',
      false,
      100,
    );
    return this.transaction(async (tx) => {
      const lot = await this.lot(tx, company, id);
      const product = await lockProduct(tx, company, lot.productId);
      assertScan(data.scan, product);
      await validateLocation(
        tx,
        company,
        destinationWarehouseId,
        destinationBinId,
      );
      if (quantity > lot.quantity - lot.reservedQty)
        throw new ConflictException(
          'Only unreserved physical stock can be transferred.',
        );
      if (
        lot.warehouseId === destinationWarehouseId &&
        (lot.binId ?? null) === (destinationBinId ?? null)
      )
        throw new BadRequestException('Choose a different bin or warehouse.');
      if (lot.serialNumber && quantity !== 1)
        throw new BadRequestException(
          'A serial transfer must move exactly one unit.',
        );
      const origin = await physicalStock(
        tx,
        company,
        lot.productId,
        lot.warehouseId,
      );
      let sourceBalances = { previousStock: origin, newStock: origin };
      let destinationBalances = sourceBalances;
      if (lot.warehouseId !== destinationWarehouseId) {
        sourceBalances = await changeAggregate(
          tx,
          company,
          lot.productId,
          lot.warehouseId,
          -quantity,
          product.sku,
        );
        destinationBalances = await changeAggregate(
          tx,
          company,
          lot.productId,
          destinationWarehouseId,
          quantity,
          product.sku,
        );
      }
      const stock =
        destinationWarehouseId === 'MASTER'
          ? null
          : await tx.warehouseStock.findUnique({
              where: {
                warehouseId_productId: {
                  warehouseId: destinationWarehouseId,
                  productId: lot.productId,
                },
              },
            });
      let destination: WarehouseLot;
      if (lot.serialNumber)
        destination = await tx.warehouseLot.update({
          where: { id },
          data: {
            warehouseId: destinationWarehouseId,
            warehouseStockId: stock?.id ?? null,
            binId: destinationBinId ?? null,
            version: { increment: 1 },
          },
        });
      else {
        await tx.warehouseLot.update({
          where: { id },
          data: {
            quantity: { decrement: quantity },
            version: { increment: 1 },
          },
        });
        destination = await tx.warehouseLot.create({
          data: {
            company,
            productId: lot.productId,
            warehouseId: destinationWarehouseId,
            warehouseStockId: stock?.id,
            binId: destinationBinId,
            receiptLineId: lot.receiptLineId,
            batchNumber: lot.batchNumber,
            expirationDate: lot.expirationDate,
            status: lot.status,
            quantity,
            receivedAt: lot.receivedAt,
            createdBy: user,
          },
        });
      }
      await this.movement(
        tx,
        company,
        user,
        lot,
        'TRANSFER',
        quantity,
        sourceBalances,
        `BIN-${lot.id}`,
        'Transfer out',
      );
      await this.movement(
        tx,
        company,
        user,
        destination,
        'TRANSFER',
        quantity,
        destinationBalances,
        `BIN-${lot.id}`,
        'Transfer in',
      );
      return destination;
    });
  }
  async createCount(company: string, user: string, input: unknown) {
    const data = v.object(input);
    if (
      !Array.isArray(data.lotIds) ||
      !data.lotIds.length ||
      data.lotIds.length > 200 ||
      data.lotIds.some((id) => typeof id !== 'string')
    )
      throw new BadRequestException('Choose between 1 and 200 stock lots.');
    const lotIds = data.lotIds as string[];
    v.unique(lotIds);
    return this.transaction(async (tx) => {
      const lines: Prisma.CycleCountLineUncheckedCreateWithoutCycleCountInput[] =
        [];
      for (const lotId of [...lotIds].sort()) {
        const lot = await this.lot(tx, company, lotId);
        lines.push({
          lotId,
          expectedQty: lot.quantity,
          expectedReservedQty: lot.reservedQty,
          expectedVersion: lot.version,
        });
      }
      return tx.cycleCount.create({
        data: {
          company,
          adjNumber: await this.number(tx, 'ADJ'),
          notes: v.text(data.notes, 'Notes', false),
          createdBy: user,
          lines: { create: lines },
        },
        include: countInclude,
      });
    });
  }
  async countLine(
    company: string,
    user: string,
    id: string,
    lineId: string,
    input: unknown,
  ) {
    const data = v.object(input);
    const countedQty = v.integer(data.countedQty, 'Counted quantity');
    return this.transaction(async (tx) => {
      const count = await this.count(tx, company, id);
      if (!['Draft', 'RecountRequired'].includes(count.status))
        throw new ConflictException('This count is no longer editable.');
      const line = count.lines.find((line) => line.id === lineId);
      if (!line) throw new NotFoundException('Count line not found.');
      const product = await lockProduct(tx, company, line.lot.productId);
      assertScan(data.scan, product);
      if (line.lot.serialNumber && countedQty > 1)
        throw new BadRequestException(
          'Serialized stock counts must be zero or one.',
        );
      await tx.cycleCountLine.update({
        where: { id: lineId },
        data: { countedQty, countedBy: user, countedAt: new Date() },
      });
      return this.count(tx, company, id);
    });
  }
  async submitCount(company: string, id: string) {
    return this.transaction(async (tx) => {
      const count = await this.count(tx, company, id);
      if (!['Draft', 'RecountRequired'].includes(count.status))
        throw new ConflictException(
          'Only a draft or recount can be submitted.',
        );
      if (count.lines.some((line) => line.countedQty === null))
        throw new BadRequestException(
          'Count every selected lot before submission.',
        );
      return tx.cycleCount.update({
        where: { id },
        data: { status: 'Submitted', submittedAt: new Date() },
        include: countInclude,
      });
    });
  }
  async recount(company: string, user: User, id: string, input: unknown) {
    this.canApprove(user);
    const reason = v.text(v.object(input).reason, 'Recount reason')!;
    return this.transaction(async (tx) => {
      const count = await this.count(tx, company, id);
      if (count.status !== 'Submitted')
        throw new ConflictException('Only submitted counts can be recounted.');
      for (const line of count.lines) {
        const lot = await this.lot(tx, company, line.lotId);
        await tx.cycleCountLine.update({
          where: { id: line.id },
          data: {
            expectedQty: lot.quantity,
            expectedReservedQty: lot.reservedQty,
            expectedVersion: lot.version,
            countedQty: null,
            countedBy: null,
            countedAt: null,
          },
        });
      }
      return tx.cycleCount.update({
        where: { id },
        data: {
          status: 'RecountRequired',
          recountReason: reason,
          submittedAt: null,
        },
        include: countInclude,
      });
    });
  }
  async approveCount(company: string, user: User, id: string) {
    this.canApprove(user);
    return this.transaction(async (tx) => {
      const count = await this.count(tx, company, id);
      if (count.status === 'Approved') return count;
      if (count.status !== 'Submitted')
        throw new ConflictException('Submit the count before approval.');
      for (const line of [...count.lines].sort(
        (a, b) => a.lot.productId - b.lot.productId || a.id.localeCompare(b.id),
      )) {
        const lot = await this.lot(tx, company, line.lotId);
        const product = await lockProduct(tx, company, lot.productId);
        if (
          lot.version !== line.expectedVersion ||
          lot.quantity !== line.expectedQty ||
          lot.reservedQty !== line.expectedReservedQty
        )
          throw new ConflictException(
            'Stock changed after this count began. Request a recount before approval.',
          );
        if (
          line.countedQty === null ||
          line.countedQty < lot.reservedQty ||
          (lot.serialNumber && line.countedQty > 1)
        )
          throw new ConflictException(
            'A count cannot remove reserved stock or duplicate a serial.',
          );
        const delta = line.countedQty - lot.quantity;
        if (delta) {
          const balances = await changeAggregate(
            tx,
            company,
            lot.productId,
            lot.warehouseId,
            delta,
            product.sku,
          );
          const changed = await tx.warehouseLot.updateMany({
            where: { id: lot.id, version: line.expectedVersion },
            data: { quantity: line.countedQty, version: { increment: 1 } },
          });
          if (changed.count !== 1)
            throw new ConflictException('Stock changed during approval.');
          await this.movement(
            tx,
            company,
            user.username,
            lot,
            'ADJUST',
            Math.abs(delta),
            balances,
            count.adjNumber,
            `Approved cycle count: ${lot.quantity} to ${line.countedQty}`,
          );
        }
      }
      return tx.cycleCount.update({
        where: { id },
        data: {
          status: 'Approved',
          approvedBy: user.username,
          approvedAt: new Date(),
        },
        include: countInclude,
      });
    });
  }
  private demand(input: unknown) {
    const lines = v.rows(input).map((row) => ({
      productId: v.integer(row.productId, 'Product', 1),
      quantity: v.integer(row.quantity, 'Quantity', 1),
    }));
    v.unique(lines.map((line) => line.productId));
    return lines;
  }
  createOrder(): never {
    throw new BadRequestException(
      'Create an Order Slip first, then use Approve & reserve. Customer P.O.s must originate from an Order Slip.',
    );
  }
  async approveFromOs(company: string, user: User, id: string) {
    this.canApprove(user);
    return this.transaction((tx) =>
      this.approveOrderSlip(tx, company, user.username, id),
    );
  }
  async approveOrderSlip(
    tx: Tx,
    company: string,
    user: string,
    orderSlipId: string,
  ) {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "OrderSlip" WHERE "id" = ${orderSlipId} AND "company" = ${company} FOR UPDATE`,
    );
    const os = await tx.orderSlip.findFirst({
      where: { id: orderSlipId, company },
      include: { items: true },
    });
    if (!os || !os.osNumber.startsWith('OS'))
      throw new NotFoundException('Order slip not found in this workspace.');
    if (['Cancelled', 'Returned'].includes(os.status))
      throw new ConflictException(
        'Cancelled or returned order slips cannot be approved.',
      );
    let order = await tx.customerOrder.findUnique({
      where: { sourceOrderSlipId: orderSlipId },
      include: orderInclude,
    });
    if (!order) {
      const finalized = await tx.orderSlip.findFirst({
        where: {
          company,
          referenceOs: os.osNumber,
          osNumber: { startsWith: 'FO' },
          status: { notIn: ['Cancelled', 'Returned'] },
        },
      });
      if (finalized)
        throw new ConflictException(
          'This order already has a historical Final Order. Create a new order for Phase 2 fulfillment.',
        );
      const grouped = new Map<number, number>();
      for (const item of os.items)
        grouped.set(
          item.productId,
          (grouped.get(item.productId) ?? 0) + item.requestedQty,
        );
      const items = this.demand(
        [...grouped].map(([productId, quantity]) => ({ productId, quantity })),
      );
      order = await tx.customerOrder.create({
        data: {
          company,
          customerId: os.customerId,
          sourceOrderSlipId: os.id,
          sourceOsNumber: os.osNumber,
          soNumber: await this.number(tx, 'SO'),
          createdBy: user,
          items: { create: items },
        },
        include: orderInclude,
      });
    }
    if (order.company !== company)
      throw new NotFoundException('Customer order not found.');
    if (order.status === 'Cancelled')
      throw new ConflictException(
        'This customer order was cancelled. Create a new order.',
      );
    await this.reserveOrder(tx, company, user, order.id);
    await tx.orderSlip.update({
      where: { id: os.id },
      data: { status: 'Approved', updatedBy: user },
    });
    return this.order(tx, company, order.id);
  }
  private async reserveOrder(
    tx: Tx,
    company: string,
    user: string,
    id: string,
  ) {
    const order = await this.order(tx, company, id);
    if (['Cancelled', 'Completed'].includes(order.status))
      throw new ConflictException(
        'This customer order cannot reserve additional stock.',
      );
    const warehouses = await tx.warehouse.findMany({
      where: { company, status: 'Active' },
    });
    const warehouseIds = [
      'MASTER',
      ...warehouses.map((warehouse) => String(warehouse.id)),
    ];
    for (const line of [...order.items].sort(
      (a, b) => a.productId - b.productId,
    )) {
      const product = await materializeLegacy(
        tx,
        company,
        user,
        line.productId,
      );
      for (const reservation of line.reservations) {
        const remaining = active(reservation);
        if (
          remaining > 0 &&
          (!warehouseIds.includes(reservation.lot.warehouseId) ||
            lotAvailable(
              { ...reservation.lot, reservedQty: 0 },
              product,
              reservation.lot.serialNumber,
            ) === 0)
        ) {
          const staged = await tx.deliveryPick.count({
            where: {
              reservationId: reservation.id,
              deliveryItem: {
                delivery: { status: { in: ['Draft', 'Scheduled'] } },
              },
            },
          });
          if (staged)
            throw new ConflictException(
              'An expired or unavailable reservation is staged for delivery. Cancel its picking list first.',
            );
          await tx.stockReservation.update({
            where: { id: reservation.id },
            data: { releasedQty: { increment: remaining } },
          });
          await tx.warehouseLot.update({
            where: { id: reservation.lotId },
            data: {
              reservedQty: { decrement: remaining },
              version: { increment: 1 },
            },
          });
        }
      }
      const existing = await tx.stockReservation.findMany({
        where: { orderLineId: line.id },
      });
      let needed =
        line.quantity -
        existing.reduce(
          (sum, reservation) =>
            sum + reservation.dispatchedQty + active(reservation),
          0,
        );
      const lots = fefo(
        await tx.warehouseLot.findMany({
          where: {
            company,
            productId: line.productId,
            warehouseId: { in: warehouseIds },
            status: 'AVAILABLE',
            quantity: { gt: 0 },
          },
        }),
      );
      for (const lot of lots) {
        if (needed <= 0) break;
        const quantity = Math.min(
          needed,
          lotAvailable(lot, product, lot.serialNumber),
        );
        if (!quantity) continue;
        const claimed = await tx.warehouseLot.updateMany({
          where: {
            id: lot.id,
            version: lot.version,
            reservedQty: lot.reservedQty,
          },
          data: {
            reservedQty: { increment: quantity },
            version: { increment: 1 },
          },
        });
        if (claimed.count !== 1)
          throw new ConflictException('Stock changed during reservation.');
        await tx.stockReservation.create({
          data: { orderLineId: line.id, lotId: lot.id, quantity },
        });
        needed -= quantity;
      }
    }
    await tx.customerOrder.update({
      where: { id },
      data: {
        status: 'Open',
        approvedAt: order.approvedAt ?? new Date(),
        approvedBy: order.approvedBy ?? user,
      },
    });
    return this.order(tx, company, id);
  }
  async reserve(company: string, user: User, id: string) {
    this.canApprove(user);
    return this.transaction((tx) =>
      this.reserveOrder(tx, company, user.username, id),
    );
  }
  private async cancelOrderTx(
    tx: Tx,
    company: string,
    user: string,
    id: string,
  ) {
    const order = await this.order(tx, company, id);
    if (order.status === 'Cancelled') return order;
    const deliveries = await tx.delivery.findMany({ where: { orderId: id } });
    if (deliveries.some((delivery) => issued(delivery)))
      throw new ConflictException(
        'An issued delivery prevents cancellation. Complete its POD and handle a return separately.',
      );
    for (const line of [...order.items].sort(
      (a, b) => a.productId - b.productId,
    )) {
      await lockProduct(tx, company, line.productId);
      for (const reservation of line.reservations) {
        const quantity = active(reservation);
        if (quantity > 0) {
          await tx.warehouseLot.update({
            where: { id: reservation.lotId },
            data: {
              reservedQty: { decrement: quantity },
              version: { increment: 1 },
            },
          });
          await tx.stockReservation.update({
            where: { id: reservation.id },
            data: { releasedQty: { increment: quantity } },
          });
        }
      }
    }
    await tx.deliveryPick.deleteMany({
      where: { deliveryItem: { delivery: { orderId: id } } },
    });
    await tx.delivery.updateMany({
      where: { orderId: id },
      data: { status: 'Cancelled' },
    });
    await tx.deliverySource.updateMany({
      where: { delivery: { orderId: id }, cancelledAt: null },
      data: { cancelledAt: new Date() },
    });
    return tx.customerOrder.update({
      where: { id },
      data: { status: 'Cancelled' },
      include: orderInclude,
    });
  }
  async cancelOrder(company: string, user: string, id: string) {
    return this.transaction((tx) => this.cancelOrderTx(tx, company, user, id));
  }
  async assertOrderSlipMutable(tx: Tx, company: string, orderSlipId: string) {
    const order = await tx.customerOrder.findFirst({
      where: { company, sourceOrderSlipId: orderSlipId },
    });
    if (!order) return false;
    throw new ConflictException(
      'This Order Slip has a fulfillment history. Create a replacement Order Slip to change its items or customer.',
    );
  }
  async cancelOrderSlip(
    tx: Tx,
    company: string,
    user: string,
    orderSlipId: string,
  ) {
    const order = await tx.customerOrder.findFirst({
      where: { company, sourceOrderSlipId: orderSlipId },
    });
    if (!order) return false;
    await this.cancelOrderTx(tx, company, user, order.id);
    return true;
  }
  async incoming(company: string, id: string, input: unknown) {
    const data = v.object(input);
    const orderLineId = v.text(data.orderLineId, 'Order line')!;
    const shipmentLineId = v.text(data.shipmentLineId, 'Shipment line')!;
    const quantity = v.integer(data.quantity, 'Incoming allocation');
    return this.transaction(async (tx) => {
      const order = await this.order(tx, company, id);
      const line = order.items.find((line) => line.id === orderLineId);
      if (!line)
        throw new BadRequestException(
          'Order line does not belong to this order.',
        );
      await lockProduct(tx, company, line.productId);
      const own = await tx.incomingAllocation.findUnique({
        where: { orderLineId_shipmentLineId: { orderLineId, shipmentLineId } },
      });
      if (quantity === 0) {
        if (own) await tx.incomingAllocation.delete({ where: { id: own.id } });
        return { released: true };
      }
      if (['Cancelled', 'Completed'].includes(order.status))
        throw new ConflictException(
          'This order cannot allocate incoming shipments.',
        );
      const shipment = await tx.shipmentLine.findFirst({
        where: {
          id: shipmentLineId,
          shipment: { company, status: { notIn: ['Cancelled', 'Closed'] } },
          purchaseOrderItem: { productId: line.productId, po: { company } },
        },
        include: { receipts: true },
      });
      if (!shipment)
        throw new BadRequestException(
          'Incoming shipment must match this product and workspace.',
        );
      const orders = await tx.customerOrder.findMany({
        where: { company },
        include: orderInclude,
      });
      const shipmentLines = await tx.shipmentLine.findMany({
        where: {
          shipment: { company, status: { notIn: ['Cancelled', 'Closed'] } },
        },
        include: { receipts: true },
      });
      const projected = projectIncoming(orders, shipmentLines, own?.id);
      const allocations = orders.flatMap((order) =>
        order.items.flatMap((line) =>
          line.incoming.map((allocation) => ({
            ...allocation,
            orderLineId: line.id,
          })),
        ),
      );
      const usedShipment = allocations
        .filter((allocation) => allocation.shipmentLineId === shipmentLineId)
        .reduce(
          (sum, allocation) => sum + (projected.get(allocation.id) ?? 0),
          0,
        );
      const usedLine = allocations
        .filter((allocation) => allocation.orderLineId === orderLineId)
        .reduce(
          (sum, allocation) => sum + (projected.get(allocation.id) ?? 0),
          0,
        );
      const available =
        shipment.shippedQty -
        shipment.receipts.reduce(
          (sum, receipt) => sum + receipt.receivedQty,
          0,
        ) -
        usedShipment;
      const demand =
        line.quantity -
        line.reservations.reduce(
          (sum, reservation) =>
            sum + reservation.quantity - reservation.releasedQty,
          0,
        ) -
        usedLine;
      if (quantity > available || quantity > demand)
        throw new ConflictException(
          'Allocation exceeds incoming shipment or unfulfilled order quantity.',
        );
      return tx.incomingAllocation.upsert({
        where: { orderLineId_shipmentLineId: { orderLineId, shipmentLineId } },
        create: { orderLineId, shipmentLineId, quantity },
        update: { quantity },
      });
    });
  }
  private async createDeliveryTx(
    tx: Tx,
    company: string,
    user: string,
    orderId: string,
    items: { orderLineId: string; quantity: number }[],
  ) {
    const order = await this.order(tx, company, orderId);
    if (order.status !== 'Open' || !order.approvedAt)
      throw new ConflictException(
        'Approve and reserve the customer order before creating a delivery.',
      );
    if (!items.length || items.length > 200)
      throw new BadRequestException(
        'Provide between 1 and 200 delivery lines.',
      );
    v.unique(items.map((item) => item.orderLineId));
    const existing = await tx.deliveryItem.findMany({
      where: {
        orderLineId: { in: items.map((item) => item.orderLineId) },
        delivery: { status: { not: 'Cancelled' } },
      },
    });
    const lines: Prisma.DeliveryItemUncheckedCreateWithoutDeliveryInput[] = [];
    for (const input of items) {
      const quantity = v.integer(input.quantity, 'Delivery quantity', 1);
      const line = order.items.find((line) => line.id === input.orderLineId);
      if (!line)
        throw new BadRequestException(
          'Delivery line does not belong to this customer order.',
        );
      await lockProduct(tx, company, line.productId);
      const allocated = existing
        .filter((item) => item.orderLineId === line.id)
        .reduce((sum, item) => sum + item.quantity, 0);
      const reserved = line.reservations.reduce(
        (sum, reservation) => sum + active(reservation),
        0,
      );
      const draftPlanned = await tx.deliveryItem.aggregate({
        where: {
          orderLineId: line.id,
          delivery: { status: { in: ['Draft', 'Scheduled'] } },
        },
        _sum: { quantity: true },
      });
      if (
        quantity > line.quantity - allocated ||
        quantity > reserved - (draftPlanned._sum.quantity ?? 0)
      )
        throw new ConflictException(
          'Delivery exceeds the remaining reserved order balance. Reserve incoming stock or reduce this partial delivery.',
        );
      lines.push({ orderLineId: line.id, productId: line.productId, quantity });
    }
    return tx.delivery.create({
      data: {
        company,
        orderId,
        delNumber: await this.number(tx, 'DEL'),
        createdBy: user,
        items: { create: lines },
      },
      include: deliveryInclude,
    });
  }
  async createDelivery(company: string, user: string, input: unknown) {
    const data = v.object(input);
    const orderId = v.text(data.orderId, 'Customer order')!;
    const items = v.rows(data.items).map((row) => ({
      orderLineId: v.text(row.orderLineId, 'Order line')!,
      quantity: v.integer(row.quantity, 'Quantity', 1),
    }));
    return this.transaction((tx) =>
      this.createDeliveryTx(tx, company, user, orderId, items),
    );
  }
  async ensureDocumentDelivery(
    tx: Tx,
    company: string,
    user: string,
    input: DocumentInput,
  ) {
    const marker = await tx.deliverySource.findUnique({
      where: {
        company_sourceType_sourceId: {
          company,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
        },
      },
    });
    if (marker) {
      if (marker.cancelledAt)
        throw new ConflictException(
          'This document was cancelled. Generate a new document.',
        );
      return this.delivery(tx, company, marker.deliveryId);
    }
    if (!input.referenceOs)
      throw new ConflictException(
        'Approve and reserve the source Order Slip or customer order before generating FO/PL.',
      );
    let order = await tx.customerOrder.findFirst({
      where: {
        company,
        OR: [
          { sourceOsNumber: input.referenceOs },
          { soNumber: input.referenceOs },
        ],
      },
      include: orderInclude,
    });
    const direct = await tx.deliverySource.findFirst({
      where: { company, documentNumber: input.referenceOs, cancelledAt: null },
      include: { delivery: true },
    });
    if (!order && direct)
      order = await this.order(tx, company, direct.delivery.orderId);
    if (
      !order ||
      order.status !== 'Open' ||
      !order.approvedAt ||
      order.customerId !== input.customerId
    )
      throw new ConflictException(
        'Approve and reserve the matching source order before generating FO/PL.',
      );
    const grouped = new Map<number, number>();
    for (const item of input.items)
      grouped.set(
        v.integer(item.productId, 'Product', 1),
        (grouped.get(item.productId) ?? 0) +
          v.integer(item.quantity, 'Quantity', 1),
      );
    const items = [...grouped].map(([productId, quantity]) => {
      const line = order.items.find((line) => line.productId === productId);
      if (!line)
        throw new ConflictException(
          'Document product is not present in the reserved source order.',
        );
      return { orderLineId: line.id, productId, quantity };
    });
    const matches = (candidate: {
      items: { productId: number; quantity: number }[];
    }) =>
      candidate.items.length === items.length &&
      items.every((item) =>
        candidate.items.some(
          (line) =>
            line.productId === item.productId &&
            line.quantity === item.quantity,
        ),
      );
    let delivery = direct
      ? await this.delivery(tx, company, direct.deliveryId)
      : null;
    if (
      delivery &&
      (issued(delivery) ||
        !matches(delivery) ||
        delivery.sources.some(
          (source) =>
            !source.cancelledAt && source.sourceType === input.sourceType,
        ))
    )
      throw new ConflictException(
        'The referenced dispatch is already issued or has different quantities.',
      );
    if (!delivery) {
      const candidates = await tx.delivery.findMany({
        where: {
          orderId: order.id,
          company,
          status: { in: ['Draft', 'Scheduled'] },
        },
        include: deliveryInclude,
        orderBy: { createdAt: 'asc' },
      });
      delivery =
        candidates.find(
          (candidate) =>
            matches(candidate) &&
            !candidate.sources.some(
              (source) =>
                !source.cancelledAt && source.sourceType === input.sourceType,
            ),
        ) ?? null;
    }
    if (!delivery)
      delivery = await this.createDeliveryTx(
        tx,
        company,
        user,
        order.id,
        items,
      );
    await tx.deliverySource.create({
      data: {
        company,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        documentNumber: input.documentNumber,
        deliveryId: delivery.id,
      },
    });
    return this.delivery(tx, company, delivery.id);
  }
  async assertDocumentMutable(
    tx: Tx,
    company: string,
    sourceType: string,
    sourceId: string,
  ) {
    const marker = await tx.deliverySource.findUnique({
      where: { company_sourceType_sourceId: { company, sourceType, sourceId } },
      include: { delivery: { include: deliveryInclude } },
    });
    if (!marker) return false;
    if (issued(marker.delivery))
      throw new ConflictException(
        'Dispatched documents cannot be changed or cancelled. Record a return separately.',
      );
    if (
      marker.delivery.items.some((item) =>
        item.picks.some((pick) => pick.verifiedQty > 0),
      )
    )
      throw new ConflictException(
        'Clear or cancel verified picking before changing the document.',
      );
    if (
      !marker.cancelledAt &&
      marker.delivery.sources.filter((source) => !source.cancelledAt).length > 1
    )
      throw new ConflictException(
        'This dispatch is shared by FO and PL. Cancel the document before replacing it.',
      );
    return true;
  }
  async cancelDocument(
    tx: Tx,
    company: string,
    user: string,
    sourceType: string,
    sourceId: string,
  ) {
    const marker = await tx.deliverySource.findUnique({
      where: { company_sourceType_sourceId: { company, sourceType, sourceId } },
    });
    if (!marker) return false;
    if (marker.cancelledAt) return true;
    const delivery = await this.delivery(tx, company, marker.deliveryId);
    if (issued(delivery))
      throw new ConflictException(
        'An issued delivery cannot be cancelled. Record a return separately.',
      );
    await tx.deliverySource.update({
      where: { id: marker.id },
      data: { cancelledAt: new Date() },
    });
    if (
      delivery.sources.filter(
        (source) => !source.cancelledAt && source.id !== marker.id,
      ).length === 0
    )
      await this.cancelDeliveryTx(tx, company, delivery.id);
    return true;
  }
  async getDelivery(company: string, id: string) {
    return this.delivery(this.prisma, company, id);
  }
  async pickList(company: string, user: string, id: string) {
    return this.transaction(async (tx) => {
      const delivery = await this.delivery(tx, company, id);
      if (!['Draft', 'Scheduled'].includes(delivery.status))
        throw new ConflictException(
          'Picking is available only before dispatch.',
        );
      if (
        delivery.items.some((item) =>
          item.picks.some((pick) => pick.verifiedQty > 0),
        )
      )
        throw new ConflictException(
          'Cancel the draft delivery before replacing verified picking.',
        );
      await tx.deliveryPick.deleteMany({
        where: { deliveryItem: { deliveryId: id } },
      });
      for (const item of [...delivery.items].sort(
        (a, b) => a.productId - b.productId,
      )) {
        const product = await lockProduct(tx, company, item.productId);
        const reservations = await tx.stockReservation.findMany({
          where: { orderLineId: item.orderLineId },
          include: {
            lot: true,
            picks: {
              include: { deliveryItem: { include: { delivery: true } } },
            },
          },
        });
        const sorted = fefo(
          reservations.map((reservation) => ({
            ...reservation.lot,
            reservation,
          })),
        );
        let needed = item.quantity;
        for (const entry of sorted) {
          if (!needed) break;
          const reservation = entry.reservation;
          if (
            !lotAvailable(
              { ...entry, reservedQty: 0 },
              product,
              entry.serialNumber,
            )
          )
            continue;
          await validateLocation(tx, company, entry.warehouseId, entry.binId);
          const staged = reservation.picks
            .filter((pick) =>
              ['Draft', 'Scheduled'].includes(
                pick.deliveryItem.delivery.status,
              ),
            )
            .reduce((sum, pick) => sum + pick.quantity, 0);
          const quantity = Math.min(
            needed,
            Math.max(0, active(reservation) - staged),
          );
          if (!quantity) continue;
          await tx.deliveryPick.create({
            data: {
              deliveryItemId: item.id,
              reservationId: reservation.id,
              lotId: entry.id,
              quantity,
            },
          });
          needed -= quantity;
        }
        if (needed)
          throw new ConflictException(
            'Available reservations do not cover this delivery. Cancel expired picks and reserve replacement stock.',
          );
      }
      return this.delivery(tx, company, id);
    });
  }
  async verifyPick(
    company: string,
    user: string,
    id: string,
    pickId: string,
    input: unknown,
  ) {
    const data = v.object(input);
    const quantity = v.integer(data.quantity, 'Verified quantity', 1);
    return this.transaction(async (tx) => {
      const delivery = await this.delivery(tx, company, id);
      if (!['Draft', 'Scheduled'].includes(delivery.status))
        throw new ConflictException('Picking is closed for this delivery.');
      const pick = delivery.items
        .flatMap((item) => item.picks)
        .find((pick) => pick.id === pickId);
      if (!pick)
        throw new NotFoundException('Pick line not found in this delivery.');
      const product = await lockProduct(tx, company, pick.lot.productId);
      assertScan(data.scan, product);
      if (quantity !== pick.quantity)
        throw new BadRequestException(
          'Confirm exactly the quantity on this picking line. Create a smaller partial delivery if necessary.',
        );
      if (pick.lot.serialNumber && data.serialNumber !== pick.lot.serialNumber)
        throw new BadRequestException('Confirm the selected serial number.');
      if (pick.lot.batchNumber && data.batchNumber !== pick.lot.batchNumber)
        throw new BadRequestException('Confirm the selected batch number.');
      if (pick.lot.binId && data.binId !== pick.lot.binId)
        throw new BadRequestException('Confirm the selected bin.');
      if (
        !lotAvailable(
          { ...pick.lot, reservedQty: 0 },
          product,
          pick.lot.serialNumber,
        )
      )
        throw new ConflictException('This lot is expired or unavailable.');
      return tx.deliveryPick.update({
        where: { id: pickId },
        data: {
          verifiedQty: quantity,
          verifiedBy: user,
          verifiedAt: new Date(),
        },
      });
    });
  }
  async schedule(company: string, id: string, input: unknown) {
    const data = v.object(input);
    const scheduledAt = v.date(data.scheduledAt, 'Dispatch schedule');
    const carrier = v.text(data.carrier, 'Carrier', true, 150)!;
    if (!scheduledAt)
      throw new BadRequestException('Dispatch schedule is required.');
    return this.transaction(async (tx) => {
      const delivery = await this.delivery(tx, company, id);
      if (!['Draft', 'Scheduled'].includes(delivery.status))
        throw new ConflictException('Only draft deliveries can be scheduled.');
      return tx.delivery.update({
        where: { id },
        data: {
          scheduledAt,
          carrier,
          trackingNumber: v.text(
            data.trackingNumber,
            'Tracking number',
            false,
            150,
          ),
          notes: v.text(data.notes, 'Notes', false),
          status: 'Scheduled',
        },
        include: deliveryInclude,
      });
    });
  }
  async dispatch(company: string, user: string, id: string) {
    return this.transaction(async (tx) => {
      const delivery = await this.delivery(tx, company, id);
      if (issued(delivery)) return delivery;
      if (
        delivery.status !== 'Scheduled' ||
        !delivery.scheduledAt ||
        !delivery.carrier
      )
        throw new ConflictException(
          'Schedule the dispatch and carrier before issuing goods.',
        );
      if (delivery.order.status !== 'Open')
        throw new ConflictException('The source customer order is not open.');
      for (const item of [...delivery.items].sort(
        (a, b) => a.productId - b.productId,
      )) {
        const product = await lockProduct(tx, company, item.productId);
        if (
          !item.picks.length ||
          item.picks.reduce((sum, pick) => sum + pick.quantity, 0) !==
            item.quantity ||
          item.picks.some((pick) => pick.verifiedQty !== pick.quantity)
        )
          throw new ConflictException(
            'Every delivery quantity must have a fully verified picking line.',
          );
        for (const pick of item.picks) {
          const lot = await this.lot(tx, company, pick.lotId);
          await validateLocation(tx, company, lot.warehouseId, lot.binId);
          const reservation = await tx.stockReservation.findUniqueOrThrow({
            where: { id: pick.reservationId },
          });
          if (
            active(reservation) < pick.quantity ||
            lot.reservedQty < pick.quantity ||
            lot.quantity < pick.quantity ||
            !lotAvailable({ ...lot, reservedQty: 0 }, product, lot.serialNumber)
          )
            throw new ConflictException(
              'Picked stock changed or expired. Refresh and rebuild the picking list.',
            );
          const changed = await tx.warehouseLot.updateMany({
            where: {
              id: lot.id,
              version: lot.version,
              reservedQty: lot.reservedQty,
            },
            data: {
              quantity: { decrement: pick.quantity },
              reservedQty: { decrement: pick.quantity },
              version: { increment: 1 },
            },
          });
          if (changed.count !== 1)
            throw new ConflictException('Stock changed during dispatch.');
          await tx.stockReservation.update({
            where: { id: reservation.id },
            data: { dispatchedQty: { increment: pick.quantity } },
          });
          const balances = await changeAggregate(
            tx,
            company,
            lot.productId,
            lot.warehouseId,
            -pick.quantity,
            product.sku,
          );
          await this.movement(
            tx,
            company,
            user,
            lot,
            'DISPATCH',
            pick.quantity,
            balances,
            delivery.delNumber,
            'Confirmed dispatch',
          );
        }
      }
      const claimed = await tx.delivery.updateMany({
        where: { id, status: 'Scheduled', dispatchedAt: null },
        data: {
          status: 'Dispatched',
          dispatchedAt: new Date(),
          dispatchedBy: user,
        },
      });
      if (claimed.count !== 1)
        throw new ConflictException('Delivery changed during dispatch.');
      return this.delivery(tx, company, id);
    });
  }
  async pod(company: string, user: string, id: string, input: unknown) {
    const data = v.object(input);
    const recipient = v.text(data.recipient, 'Recipient', true, 150)!;
    const receivedAt = v.date(data.receivedAt, 'Received at');
    const documentId =
      data.documentId === undefined
        ? undefined
        : v.integer(data.documentId, 'Document', 1);
    const receiptUrl = v.text(
      data.receiptUrl,
      'Signed receipt URL',
      false,
      2000000,
    );
    if (!receivedAt || receivedAt > new Date(Date.now() + 300000))
      throw new BadRequestException('A valid receipt time is required.');
    if (!documentId && !receiptUrl)
      throw new BadRequestException(
        'Attach a signed receipt document or receipt link.',
      );
    if (receiptUrl && !/^https:\/\//.test(receiptUrl))
      throw new BadRequestException('Receipt links must use HTTPS.');
    const items = v.rows(data.items).map((row) => ({
      deliveryItemId: v.text(row.deliveryItemId, 'Delivery line')!,
      quantity: v.integer(row.quantity, 'Delivered quantity', 1),
    }));
    v.unique(items.map((item) => item.deliveryItemId));
    return this.transaction(async (tx) => {
      const delivery = await this.delivery(tx, company, id);
      if (
        delivery.pods.some((receipt) =>
          samePodReceipt(receipt, { recipient, receivedAt, items }),
        )
      )
        return delivery;
      if (!issued(delivery) || delivery.status === 'Delivered')
        throw new ConflictException(
          'POD requires an issued delivery with outstanding quantities.',
        );
      if (receivedAt < delivery.dispatchedAt!)
        throw new BadRequestException('Receipt time cannot precede dispatch.');
      const receiptDocument = documentId
        ? await tx.document.findFirst({ where: { id: documentId, company } })
        : null;
      if (documentId && !receiptDocument)
        throw new BadRequestException(
          'Receipt document not found in this workspace.',
        );
      const signedReceiptUrl =
        receiptUrl ??
        (receiptDocument?.googleDriveLink?.startsWith('https://')
          ? receiptDocument.googleDriveLink
          : undefined);
      for (const input of items) {
        const item = delivery.items.find(
          (item) => item.id === input.deliveryItemId,
        );
        if (!item || input.quantity > item.quantity - item.deliveredQty)
          throw new ConflictException(
            'Delivered quantity exceeds this dispatch remaining balance.',
          );
        await lockProduct(tx, company, item.productId);
        await tx.deliveryItem.update({
          where: { id: item.id },
          data: { deliveredQty: { increment: input.quantity } },
        });
        await tx.customerOrderLine.update({
          where: { id: item.orderLineId },
          data: { deliveredQty: { increment: input.quantity } },
        });
      }
      await tx.deliveryPod.create({
        data: {
          deliveryId: id,
          recipient,
          receivedAt,
          receiptUrl: signedReceiptUrl,
          documentId,
          notes: v.text(data.notes, 'Notes', false),
          items,
          createdBy: user,
        },
      });
      const updated = await this.delivery(tx, company, id);
      const complete = updated.items.every(
        (item) => item.deliveredQty === item.quantity,
      );
      await tx.delivery.update({
        where: { id },
        data: { status: complete ? 'Delivered' : 'PartiallyDelivered' },
      });
      const order = await this.order(tx, company, delivery.orderId);
      if (order.items.every((line) => line.deliveredQty === line.quantity))
        await tx.customerOrder.update({
          where: { id: order.id },
          data: { status: 'Completed' },
        });
      return this.delivery(tx, company, id);
    });
  }
  private async cancelDeliveryTx(tx: Tx, company: string, id: string) {
    const delivery = await this.delivery(tx, company, id);
    if (issued(delivery))
      throw new ConflictException('An issued delivery cannot be cancelled.');
    if (delivery.status === 'Cancelled') return delivery;
    await tx.deliveryPick.deleteMany({
      where: { deliveryItem: { deliveryId: id } },
    });
    await tx.deliverySource.updateMany({
      where: { deliveryId: id, cancelledAt: null },
      data: { cancelledAt: new Date() },
    });
    return tx.delivery.update({
      where: { id },
      data: { status: 'Cancelled' },
      include: deliveryInclude,
    });
  }
  async cancelDelivery(company: string, id: string) {
    return this.transaction((tx) => this.cancelDeliveryTx(tx, company, id));
  }
}
