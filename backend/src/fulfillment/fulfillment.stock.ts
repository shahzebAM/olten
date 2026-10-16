import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { companyToday, parseIsoDate } from '../documentation/expiry-date.utils';

export type Tx = Prisma.TransactionClient;
export const LOT_STATUSES = [
  'AVAILABLE',
  'QUARANTINE',
  'DAMAGED',
  'REJECTED',
] as const;
type IncomingOrder = {
  status: string;
  items: {
    id: string;
    quantity: number;
    reservations: {
      quantity: number;
      dispatchedQty: number;
      releasedQty: number;
    }[];
    incoming: {
      id: string;
      shipmentLineId: string;
      quantity: number;
      createdAt: Date;
    }[];
  }[];
};

// A future promise never counts as stock. FIFO projection caps promises by both
// remaining shipment quantities and demand not already reserved or dispatched.
export function projectIncoming(
  orders: IncomingOrder[],
  shipmentLines: {
    id: string;
    shippedQty: number;
    receipts: { receivedQty: number }[];
  }[],
  excludedId?: string,
) {
  const shipmentRemaining = new Map(
    shipmentLines.map((line) => [
      line.id,
      Math.max(
        0,
        line.shippedQty -
          line.receipts.reduce((sum, receipt) => sum + receipt.receivedQty, 0),
      ),
    ]),
  );
  const demand = new Map<string, number>();
  const allocations: {
    id: string;
    shipmentLineId: string;
    orderLineId: string;
    quantity: number;
    createdAt: Date;
  }[] = [];
  for (const order of orders)
    for (const line of order.items) {
      demand.set(
        line.id,
        ['Cancelled', 'Completed'].includes(order.status)
          ? 0
          : Math.max(
              0,
              line.quantity -
                line.reservations.reduce(
                  (sum, reservation) =>
                    sum + reservation.quantity - reservation.releasedQty,
                  0,
                ),
            ),
      );
      allocations.push(
        ...line.incoming
          .filter((allocation) => allocation.id !== excludedId)
          .map((allocation) => ({ ...allocation, orderLineId: line.id })),
      );
    }
  allocations.sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
  const result = new Map<string, number>();
  for (const allocation of allocations) {
    const quantity = Math.min(
      allocation.quantity,
      demand.get(allocation.orderLineId) ?? 0,
      shipmentRemaining.get(allocation.shipmentLineId) ?? 0,
    );
    result.set(allocation.id, quantity);
    demand.set(
      allocation.orderLineId,
      (demand.get(allocation.orderLineId) ?? 0) - quantity,
    );
    shipmentRemaining.set(
      allocation.shipmentLineId,
      (shipmentRemaining.get(allocation.shipmentLineId) ?? 0) - quantity,
    );
  }
  return result;
}

export async function lockProduct(tx: Tx, company: string, productId: number) {
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "Product" WHERE "id" = ${productId} AND "company" = ${company} FOR UPDATE`,
  );
  const product = await tx.product.findFirst({
    where: { id: productId, company, deletedAt: null, isActive: true },
  });
  if (!product)
    throw new NotFoundException('Active product not found in this workspace.');
  return product;
}

export async function validateLocation(
  tx: Tx,
  company: string,
  warehouseId: string,
  binId?: string | null,
) {
  if (warehouseId !== 'MASTER') {
    if (
      !/^[1-9]\d*$/.test(warehouseId) ||
      !Number.isSafeInteger(Number(warehouseId))
    )
      throw new BadRequestException('Invalid warehouse.');
    const warehouse = await tx.warehouse.findFirst({
      where: { id: Number(warehouseId), company, status: 'Active' },
    });
    if (!warehouse)
      throw new BadRequestException(
        'Active warehouse not found in this workspace.',
      );
  }
  if (binId) {
    const bin = await tx.warehouseBin.findFirst({
      where: { id: binId, company, warehouseId },
    });
    if (!bin)
      throw new BadRequestException(
        'Bin does not belong to this warehouse and workspace.',
      );
  }
}

export async function physicalStock(
  tx: Tx,
  company: string,
  productId: number,
  warehouseId: string,
) {
  if (warehouseId === 'MASTER') {
    const product = await tx.product.findFirst({
      where: { id: productId, company },
    });
    if (!product) throw new NotFoundException('Product not found.');
    return product.currentStock;
  }
  const stock = await tx.warehouseStock.findUnique({
    where: { warehouseId_productId: { warehouseId, productId } },
  });
  if (stock && stock.company !== company)
    throw new ConflictException(
      'Warehouse balance belongs to another workspace.',
    );
  return stock?.quantity ?? 0;
}

export async function assertLegacyStockFloor(
  tx: Tx,
  company: string,
  productId: number,
  warehouseId: string,
  nextQuantity: number,
) {
  await lockProduct(tx, company, productId);
  if (
    !Number.isSafeInteger(nextQuantity) ||
    nextQuantity < 0 ||
    nextQuantity > 2147483647
  )
    throw new BadRequestException(
      'Stock must be a non-negative whole quantity.',
    );
  const total = await tx.warehouseLot.aggregate({
    where: { company, productId, warehouseId },
    _sum: { quantity: true },
  });
  if (nextQuantity < (total._sum.quantity ?? 0))
    throw new ConflictException(
      'This quantity includes tracked or reserved stock. Use warehouse transfers or an approved cycle count.',
    );
}

export function lotAvailable(
  lot: {
    status: string;
    quantity: number;
    reservedQty: number;
    expirationDate: Date | null;
  },
  controlled?: { expiryControlled: boolean; serialControlled: boolean },
  serialNumber?: string | null,
) {
  if (
    lot.status !== 'AVAILABLE' ||
    (lot.expirationDate && lot.expirationDate < companyToday())
  )
    return 0;
  if (controlled?.expiryControlled && !lot.expirationDate) return 0;
  if (controlled?.serialControlled && !serialNumber) return 0;
  return Math.max(0, lot.quantity - lot.reservedQty);
}

export function fefo<
  T extends { expirationDate: Date | null; receivedAt: Date; id: string },
>(lots: T[]) {
  return [...lots].sort(
    (a, b) =>
      (a.expirationDate?.getTime() ?? Infinity) -
        (b.expirationDate?.getTime() ?? Infinity) ||
      a.receivedAt.getTime() - b.receivedAt.getTime() ||
      a.id.localeCompare(b.id),
  );
}

export function assertScan(
  scan: unknown,
  product: { sku: string; name: string },
) {
  if (
    typeof scan !== 'string' ||
    ![
      product.sku,
      `${product.sku}${product.name}`,
      `${product.sku} ${product.name}`,
      `${product.sku}  ${product.name}`,
    ].includes(scan.trim())
  )
    throw new BadRequestException(
      'Scan does not match the selected product. Verify the selected batch, serial and bin.',
    );
}

export async function changeAggregate(
  tx: Tx,
  company: string,
  productId: number,
  warehouseId: string,
  delta: number,
  sku: string,
) {
  const previous = await physicalStock(tx, company, productId, warehouseId);
  const next = previous + delta;
  if (!Number.isSafeInteger(next) || next < 0 || next > 2147483647)
    throw new ConflictException(
      'Insufficient physical stock or stock limit exceeded.',
    );
  if (warehouseId === 'MASTER') {
    const updated = await tx.product.updateMany({
      where: { id: productId, company, currentStock: previous },
      data: { currentStock: next },
    });
    if (updated.count !== 1)
      throw new ConflictException('Stock changed. Refresh and try again.');
  } else {
    await tx.warehouseStock.upsert({
      where: { warehouseId_productId: { warehouseId, productId } },
      create: { company, warehouseId, productId, sku, quantity: next },
      update: { quantity: next, lastUpdated: new Date() },
    });
  }
  return { previousStock: previous, newStock: next };
}

export async function materializeLegacy(
  tx: Tx,
  company: string,
  actor: string,
  productId: number,
) {
  const product = await lockProduct(tx, company, productId);
  const warehouses = await tx.warehouse.findMany({
    where: { company, status: 'Active' },
    select: { id: true },
  });
  const stocks = await tx.warehouseStock.findMany({
    where: {
      company,
      productId,
      warehouseId: { in: warehouses.map((warehouse) => String(warehouse.id)) },
    },
  });
  const facilities = [
    {
      warehouseId: 'MASTER',
      quantity: product.currentStock,
      id: null as string | null,
    },
    ...stocks.map((s) => ({
      warehouseId: s.warehouseId,
      quantity: s.quantity,
      id: s.id,
    })),
  ];
  for (const stock of facilities) {
    const aggregate = await tx.warehouseLot.aggregate({
      where: { company, productId, warehouseId: stock.warehouseId },
      _sum: { quantity: true },
    });
    const missing = stock.quantity - (aggregate._sum.quantity ?? 0);
    if (missing < 0)
      throw new ConflictException(
        'Tracked lots exceed the physical balance. Reconcile the warehouse before continuing.',
      );
    if (missing > 0 && !product.expiryControlled && !product.serialControlled) {
      await validateLocation(tx, company, stock.warehouseId);
      await tx.warehouseLot.create({
        data: {
          company,
          productId,
          warehouseId: stock.warehouseId,
          warehouseStockId: stock.id,
          quantity: missing,
          createdBy: actor,
        },
      });
    }
  }
  return product;
}

type ReceiptLotInput = {
  productId: number;
  warehouseId: string;
  warehouseStockId?: string | null;
  binId?: string | null;
  receiptLineId: string;
  quantity: number;
  batchNumber?: string | null;
  expirationDate?: Date | string | null;
  serialNumber?: string | null;
};

export async function recordReceiptLot(
  tx: Tx,
  company: string,
  actor: string,
  input: ReceiptLotInput,
) {
  const product = await lockProduct(tx, company, input.productId);
  await validateLocation(tx, company, input.warehouseId, input.binId);
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1)
    throw new BadRequestException(
      'Receipt lot quantity must be positive and whole.',
    );
  const expiry = input.expirationDate
    ? parseIsoDate(input.expirationDate)
    : null;
  if (input.expirationDate && !expiry)
    throw new BadRequestException('Expiry must be a valid date.');
  if (product.expiryControlled && !expiry)
    throw new BadRequestException('This product requires an expiry date.');
  if (product.serialControlled && (!input.serialNumber || input.quantity !== 1))
    throw new BadRequestException(
      'Serialized goods require one unit and a serial number per placement.',
    );
  if (input.serialNumber && input.quantity !== 1)
    throw new BadRequestException(
      'A serial number identifies exactly one unit.',
    );
  const receipt = await tx.goodsReceiptLine.findFirst({
    where: {
      id: input.receiptLineId,
      receipt: { company },
      shipmentLine: { purchaseOrderItem: { productId: input.productId } },
    },
  });
  if (!receipt)
    throw new BadRequestException(
      'Receipt line does not belong to this product and workspace.',
    );
  if (input.warehouseStockId) {
    const balance = await tx.warehouseStock.findFirst({
      where: {
        id: input.warehouseStockId,
        company,
        productId: input.productId,
        warehouseId: input.warehouseId,
      },
    });
    if (!balance)
      throw new BadRequestException('Invalid warehouse stock reference.');
  }
  const tracked = await tx.warehouseLot.aggregate({
    where: {
      company,
      productId: input.productId,
      warehouseId: input.warehouseId,
    },
    _sum: { quantity: true },
  });
  if (
    (tracked._sum.quantity ?? 0) + input.quantity >
    (await physicalStock(tx, company, input.productId, input.warehouseId))
  )
    throw new ConflictException('Receipt lot exceeds physical stock.');
  return tx.warehouseLot.create({
    data: {
      company,
      createdBy: actor,
      productId: input.productId,
      warehouseId: input.warehouseId,
      warehouseStockId: input.warehouseStockId,
      binId: input.binId,
      receiptLineId: input.receiptLineId,
      quantity: input.quantity,
      batchNumber: input.batchNumber,
      expirationDate: expiry,
      serialNumber: input.serialNumber,
    },
  });
}
