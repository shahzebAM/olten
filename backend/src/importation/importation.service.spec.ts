import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ImportationService } from './importation.service';

const containing = (value: Record<string, unknown>): unknown =>
  expect.objectContaining(value) as unknown;

function setup() {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    product: { count: jest.fn(), findFirst: jest.fn() },
    supplier: { findFirst: jest.fn() },
    purchaseRequisition: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    supplierQuotation: { create: jest.fn() },
    purchaseOrder: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
    },
    purchaseOrderItem: { findFirst: jest.fn(), update: jest.fn() },
    importSequence: { upsert: jest.fn().mockResolvedValue({ value: 1 }) },
    importFile: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    shipment: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    shipmentLine: { update: jest.fn() },
    shipmentClearance: { upsert: jest.fn() },
    goodsReceipt: { create: jest.fn() },
    goodsReceiptLine: { findFirst: jest.fn(), update: jest.fn() },
    importExpense: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  const client = {
    $transaction: jest.fn(
      async (work: (value: Prisma.TransactionClient) => Promise<unknown>) =>
        work(tx as unknown as Prisma.TransactionClient),
    ),
  };
  const service = new ImportationService();
  Object.defineProperty(service, 'prisma', { value: client });
  return { tx, service, client };
}

const admin = { id: 1, username: 'approver', role: 'Admin', modules: {} };
const requisition = {
  id: 'pr',
  company: 'Surgicom',
  status: 'Submitted',
  purchaseOrderId: null,
  items: [
    {
      id: 'req-line',
      productId: 1,
      quantity: 3,
      product: {
        name: 'Device',
        sku: 'MED',
        company: 'Surgicom',
        deletedAt: null,
        isActive: true,
      },
    },
  ],
  quotations: [
    {
      id: 'quote',
      supplierId: 'supplier',
      supplier: { company: 'Surgicom' },
      currency: 'USD',
      exchangeRate: new Prisma.Decimal('56.8'),
      validUntil: null,
      items: [
        {
          requisitionItemId: 'req-line',
          unitCost: new Prisma.Decimal('10.125'),
          minimumOrderQty: 1,
        },
      ],
    },
  ],
};

describe('Phase 1 procurement and importation service', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-15T06:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('creates a requisition only for active products belonging to the company', async () => {
    const { tx, service } = setup();
    tx.product.count.mockResolvedValue(0);
    await expect(
      service.createRequisition('Surgicom', 'buyer', {
        purpose: 'Restock',
        items: [{ productId: 1, quantity: 3 }],
      }),
    ).rejects.toThrow(/unavailable/);
    expect(tx.purchaseRequisition.create).not.toHaveBeenCalled();
    tx.product.count.mockResolvedValue(1);
    await service.createRequisition('Surgicom', 'buyer', {
      purpose: 'Restock',
      items: [{ productId: 1, quantity: 3 }],
    });
    expect(tx.purchaseRequisition.create).toHaveBeenCalledWith(
      containing({
        data: containing({
          prNumber: 'PR-2026-000001',
          company: 'Surgicom',
          createdBy: 'buyer',
        }),
      }),
    );
  });

  it('converts supplier quotation to PHP and rounds line amounts before PO approval', async () => {
    const { tx, service, client } = setup();
    tx.purchaseRequisition.findFirst.mockResolvedValue(requisition);
    tx.purchaseOrder.create.mockResolvedValue({ id: 'generated-po' });
    await service.approve('Surgicom', admin, 'pr', { quotationId: 'quote' });
    expect(client.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
      maxWait: 5000,
      timeout: 20000,
    });
    expect(tx.$executeRaw).toHaveBeenCalledWith(
      expect.anything(),
      'sales-document-number:poNumber',
    );
    expect(tx.purchaseOrder.create).toHaveBeenCalledWith({
      data: containing({
        subtotal: 1725.3,
        grandTotal: 1725.3,
        vatApplied: false,
        supplierId: 'supplier',
        items: {
          create: [
            {
              productId: 1,
              productName: 'Device',
              sku: 'MED',
              requestedQty: 3,
              unitCost: 575.1,
              lineTotal: 1725.3,
            },
          ],
        },
      }),
    });
    expect(tx.purchaseRequisition.update).toHaveBeenCalledWith(
      containing({
        data: containing({
          status: 'Approved',
          purchaseOrderId: 'generated-po',
          selectedQuotationId: 'quote',
          approvedBy: 'approver',
        }),
      }),
    );
  });

  it('uses decimal half-up rounding for fractional prices', async () => {
    const { tx, service } = setup();
    tx.purchaseRequisition.findFirst.mockResolvedValue({
      ...requisition,
      quotations: [
        {
          ...requisition.quotations[0],
          currency: 'PHP',
          exchangeRate: new Prisma.Decimal(1),
          items: [
            {
              requisitionItemId: 'req-line',
              unitCost: new Prisma.Decimal('1.005'),
              minimumOrderQty: 1,
            },
          ],
        },
      ],
    });
    tx.purchaseOrder.create.mockResolvedValue({ id: 'po' });
    await service.approve('Surgicom', admin, 'pr', { quotationId: 'quote' });
    expect(tx.purchaseOrder.create).toHaveBeenCalledWith({
      data: containing({ subtotal: 3.02, grandTotal: 3.02 }),
    });
  });

  it('retries PO approval with a fresh transaction after a concurrent save', async () => {
    const { tx, service, client } = setup();
    tx.purchaseRequisition.findFirst
      .mockRejectedValueOnce({ code: 'P2034' })
      .mockResolvedValue(requisition);
    tx.purchaseOrder.create.mockResolvedValue({ id: 'generated-po' });
    tx.purchaseRequisition.update.mockResolvedValue({ status: 'Approved' });
    const approval = service.approve('Surgicom', admin, 'pr', {
      quotationId: 'quote',
    });
    const result = expect(approval).resolves.toMatchObject({
      status: 'Approved',
    });
    await jest.runAllTimersAsync();
    await result;
    expect(client.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(tx.purchaseOrder.create).toHaveBeenCalledTimes(1);
    expect(tx.purchaseRequisition.update).toHaveBeenCalledTimes(1);
  });

  it('keeps import PO format and advances past numbers used by ordinary POs', async () => {
    const { tx, service } = setup();
    tx.purchaseRequisition.findFirst.mockResolvedValue(requisition);
    tx.importSequence.upsert
      .mockResolvedValueOnce({ value: 1 })
      .mockResolvedValueOnce({ value: 2 });
    tx.purchaseOrder.findUnique
      .mockResolvedValueOnce({ id: 'existing-ordinary-po' })
      .mockResolvedValueOnce(null);
    tx.purchaseOrder.create.mockResolvedValue({ id: 'generated-po' });
    await service.approve('Surgicom', admin, 'pr', { quotationId: 'quote' });
    expect(tx.purchaseOrder.create).toHaveBeenCalledWith({
      data: containing({ poNumber: 'PO-2026-000002' }),
    });
    expect(tx.importSequence.upsert).toHaveBeenCalledTimes(2);
  });

  it('requires approver rights and prevents repeated approval', async () => {
    const { tx, service } = setup();
    await expect(
      service.approve('Surgicom', { ...admin, role: 'Purchasing' }, 'pr', {
        quotationId: 'quote',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    tx.purchaseRequisition.findFirst.mockResolvedValue({
      ...requisition,
      status: 'Approved',
      purchaseOrderId: 'po',
    });
    await expect(
      service.approve('Surgicom', admin, 'pr', { quotationId: 'quote' }),
    ).rejects.toThrow(/once/);
    expect(tx.purchaseOrder.create).not.toHaveBeenCalled();
  });

  it('rejects expired quotations and cross-tenant requisitions', async () => {
    const { tx, service } = setup();
    tx.purchaseRequisition.findFirst.mockResolvedValue(null);
    await expect(
      service.approve('Other', admin, 'pr', { quotationId: 'quote' }),
    ).rejects.toThrow(/not found/);
    expect(tx.purchaseRequisition.findFirst).toHaveBeenCalledWith(
      containing({ where: { id: 'pr', company: 'Other' } }),
    );
    tx.purchaseRequisition.findFirst.mockResolvedValue({
      ...requisition,
      quotations: [
        { ...requisition.quotations[0], validUntil: new Date('2026-10-14') },
      ],
    });
    await expect(
      service.approve('Surgicom', admin, 'pr', { quotationId: 'quote' }),
    ).rejects.toThrow(/expired/);
  });

  it('requires complete quotations, available suppliers, and MOQ within requested quantities', async () => {
    const { tx, service } = setup();
    tx.purchaseRequisition.findFirst.mockResolvedValue({
      ...requisition,
      status: 'Draft',
    });
    tx.supplier.findFirst.mockResolvedValue({ id: 'supplier' });
    const input = {
      supplierId: 'supplier',
      currency: 'USD',
      exchangeRate: 56.8,
      leadTimeDays: 14,
      paymentTerms: '30 days',
      items: [
        { requisitionItemId: 'req-line', unitCost: 10, minimumOrderQty: 4 },
      ],
    };
    await expect(
      service.addQuotation('Surgicom', 'buyer', 'pr', input),
    ).rejects.toThrow(/minimum order/);
    await expect(
      service.addQuotation('Surgicom', 'buyer', 'pr', {
        ...input,
        items: [
          { requisitionItemId: 'other-line', unitCost: 10, minimumOrderQty: 1 },
        ],
      }),
    ).rejects.toThrow(/exactly once/);
    tx.supplier.findFirst.mockResolvedValue(null);
    await expect(
      service.addQuotation('Surgicom', 'buyer', 'pr', input),
    ).rejects.toThrow(/Supplier/);
  });

  it('rejects incorrect PHP rates and rates that round to zero in storage', async () => {
    const { service } = setup();
    await expect(
      service.addQuotation('Surgicom', 'buyer', 'pr', {
        currency: 'PHP',
        exchangeRate: 2,
        supplierId: 's',
      }),
    ).rejects.toThrow(/rate of 1/);
    await expect(
      service.addQuotation('Surgicom', 'buyer', 'pr', {
        currency: 'USD',
        exchangeRate: 0.0000001,
        supplierId: 's',
      }),
    ).rejects.toThrow(/six decimal/);
  });

  it('prevents cumulative overshipment and rejects legacy received purchase orders', async () => {
    const { tx, service } = setup();
    tx.importFile.findFirst.mockResolvedValue({ id: 'imp' });
    const poItem = {
      requestedQty: 10,
      confirmedQty: null,
      productId: 1,
      po: { status: 'Generated' },
      shipmentLines: [{ shippedQty: 7 }],
    };
    tx.purchaseOrderItem.findFirst.mockResolvedValue(poItem);
    const input = {
      importFileId: 'imp',
      mode: 'Sea',
      items: [{ purchaseOrderItemId: 'po-line', shippedQty: 4 }],
    };
    await expect(
      service.createShipment('Surgicom', 'buyer', input),
    ).rejects.toThrow(/cannot exceed/);
    tx.purchaseOrderItem.findFirst.mockResolvedValue({
      ...poItem,
      confirmedQty: 2,
      shipmentLines: [],
    });
    await expect(
      service.createShipment('Surgicom', 'buyer', input),
    ).rejects.toThrow(/legacy receiving/);
    tx.purchaseOrderItem.findFirst.mockResolvedValue({
      ...poItem,
      po: { status: 'Stocked' },
    });
    await expect(
      service.createShipment('Surgicom', 'buyer', input),
    ).rejects.toThrow(/unavailable/);
    expect(tx.shipment.create).not.toHaveBeenCalled();
  });

  it('creates partial shipments and retains the PO line relation', async () => {
    const { tx, service } = setup();
    tx.importFile.findFirst.mockResolvedValue({ id: 'imp' });
    tx.purchaseOrderItem.findFirst.mockResolvedValue({
      requestedQty: 10,
      productId: 1,
      po: { status: 'Generated' },
      shipmentLines: [{ shippedQty: 7 }],
    });
    tx.product.findFirst.mockResolvedValue({ id: 1 });
    await service.createShipment('Surgicom', 'buyer', {
      importFileId: 'imp',
      mode: 'Air',
      items: [{ purchaseOrderItemId: 'po-line', shippedQty: 3 }],
    });
    expect(tx.shipment.create).toHaveBeenCalledWith(
      containing({
        data: containing({
          shipmentNumber: 'SHP-2026-000001',
          items: {
            create: [{ purchaseOrderItemId: 'po-line', shippedQty: 3 }],
          },
        }),
      }),
    );
  });

  it('rejects clearance beyond shipped or below quantities already received', async () => {
    const { tx, service } = setup();
    tx.shipment.findFirst.mockResolvedValue({
      status: 'Arrived',
      items: [{ id: 'line', shippedQty: 10, receipts: [{ receivedQty: 6 }] }],
    });
    await expect(
      service.clearance('Surgicom', 'broker', 'shp', {
        status: 'In Progress',
        items: [{ shipmentLineId: 'line', clearedQty: 5 }],
      }),
    ).rejects.toThrow(/between received and shipped/);
    await expect(
      service.clearance('Surgicom', 'broker', 'shp', {
        status: 'In Progress',
        items: [{ shipmentLineId: 'line', clearedQty: 11 }],
      }),
    ).rejects.toThrow(/between received and shipped/);
    await expect(
      service.clearance('Surgicom', 'broker', 'shp', {
        status: 'Cleared',
        clearanceDate: '2026-10-15',
        items: [{ shipmentLineId: 'line', clearedQty: 8 }],
      }),
    ).rejects.toThrow(/every shipped unit/);
    expect(tx.shipmentLine.update).not.toHaveBeenCalled();
  });

  it('requires arrival and clearance before receiving and protects cumulative receipt limits', async () => {
    const { tx, service } = setup();
    const input = {
      items: [
        {
          shipmentLineId: 'line',
          receivedQty: 4,
          acceptedQty: 2,
          rejectedQty: 1,
          heldQty: 1,
        },
      ],
    };
    tx.shipment.findFirst.mockResolvedValue({
      status: 'In Transit',
      actualArrival: null,
    });
    await expect(
      service.receipt('Surgicom', 'qc', 'shp', input),
    ).rejects.toThrow(/arrival/);
    tx.shipment.findFirst.mockResolvedValue({
      status: 'Arrived',
      actualArrival: new Date('2026-10-14'),
      items: [{ id: 'line', clearedQty: 10, receipts: [{ receivedQty: 7 }] }],
    });
    await expect(
      service.receipt('Surgicom', 'qc', 'shp', input),
    ).rejects.toThrow(/cleared quantity/);
    expect(tx.goodsReceipt.create).not.toHaveBeenCalled();
  });

  it('creates GRN classifications without posting held or rejected stock', async () => {
    const { tx, service } = setup();
    tx.shipment.findFirst.mockResolvedValue({
      status: 'Arrived',
      actualArrival: new Date('2026-10-14'),
      items: [{ id: 'line', clearedQty: 10, receipts: [{ receivedQty: 6 }] }],
    });
    await service.receipt('Surgicom', 'qc', 'shp', {
      items: [
        {
          shipmentLineId: 'line',
          receivedQty: 4,
          acceptedQty: 2,
          rejectedQty: 1,
          heldQty: 1,
          expirationDate: '2026-10-15',
          photos: ['data:image/png;base64,YWJj'],
        },
      ],
    });
    expect(tx.goodsReceipt.create).toHaveBeenCalledWith(
      containing({
        data: containing({
          grnNumber: 'GRN-2026-000001',
          items: {
            create: [
              containing({
                receivedQty: 4,
                acceptedQty: 2,
                rejectedQty: 1,
                heldQty: 1,
                inspectedBy: 'qc',
              }),
            ],
          },
        }),
      }),
    );
  });

  it.each([
    { quantities: [6], expected: 'Partially Received', received: 6 },
    { quantities: [6, 4], expected: 'Received', received: 10 },
  ])(
    'synchronizes cumulative physical receiving to the existing PO: $expected',
    async ({ quantities, expected, received }) => {
      const { tx, service } = setup();
      tx.shipment.findFirst.mockResolvedValue({
        status: 'Arrived',
        actualArrival: new Date('2026-10-14'),
        items: [
          {
            id: 'line',
            purchaseOrderItemId: 'po-line',
            clearedQty: 10,
            receipts: [],
          },
        ],
      });
      tx.purchaseOrder.findMany.mockResolvedValue([
        {
          id: 'po',
          items: [
            {
              id: 'po-line',
              requestedQty: 10,
              shipmentLines: quantities.map((receivedQty) => ({
                receipts: [{ receivedQty }],
              })),
            },
          ],
        },
      ]);
      await service.receipt('Surgicom', 'qc', 'shp', {
        items: [
          {
            shipmentLineId: 'line',
            receivedQty: 4,
            acceptedQty: 2,
            rejectedQty: 1,
            heldQty: 1,
          },
        ],
      });
      expect(tx.purchaseOrderItem.update).toHaveBeenCalledWith({
        where: { id: 'po-line' },
        data: { confirmedQty: received, shortageQty: 10 - received },
      });
      expect(tx.purchaseOrder.update).toHaveBeenCalledWith({
        where: { id: 'po' },
        data: containing({ status: expected, updatedBy: 'qc' }),
      });
    },
  );

  it('rejects acceptance of expired stock and QC changes below placed stock', async () => {
    const { tx, service } = setup();
    tx.shipment.findFirst.mockResolvedValue({
      status: 'Arrived',
      actualArrival: new Date('2026-10-14'),
      items: [{ id: 'line', clearedQty: 10, receipts: [] }],
    });
    await expect(
      service.receipt('Surgicom', 'qc', 'shp', {
        items: [
          {
            shipmentLineId: 'line',
            receivedQty: 2,
            acceptedQty: 2,
            rejectedQty: 0,
            heldQty: 0,
            expirationDate: '2026-10-14',
          },
        ],
      }),
    ).rejects.toThrow(/Expired/);
    tx.goodsReceiptLine.findFirst.mockResolvedValue({
      receivedQty: 5,
      acceptedQty: 3,
      placedQty: 3,
      expirationDate: null,
      receipt: { shipment: { status: 'Arrived' } },
    });
    await expect(
      service.qc('Surgicom', 'qc', 'receipt-line', {
        acceptedQty: 2,
        rejectedQty: 1,
        heldQty: 2,
      }),
    ).rejects.toThrow(/already placed/);
  });

  it('requires a payment date for paid expenses and preserves amount rounding', async () => {
    const { tx, service } = setup();
    const input = {
      category: 'Duties',
      description: 'Import duty',
      currency: 'PHP',
      amount: 123.455,
      status: 'Paid',
    };
    await expect(
      service.expense('Surgicom', 'finance', 'shp', input),
    ).rejects.toThrow(/Payment date/);
    tx.shipment.findFirst.mockResolvedValue({ id: 'shp' });
    await service.expense('Surgicom', 'finance', 'shp', {
      ...input,
      paidAt: '2026-10-15',
    });
    expect(tx.importExpense.create).toHaveBeenCalledWith({
      data: containing({
        amount: new Prisma.Decimal('123.46'),
        status: 'Paid',
      }),
    });
  });

  it.each(['2026-10-15', undefined])(
    'accepts Manila calendar dates today during early morning operations (%p)',
    async (receivedAt) => {
      jest.setSystemTime(new Date('2026-10-14T17:00:00Z'));
      const { tx, service } = setup();
      tx.shipment.findFirst.mockResolvedValue({
        status: 'Arrived',
        actualArrival: new Date('2026-10-15'),
        items: [{ id: 'line', clearedQty: 2, receipts: [] }],
      });
      await service.receipt('Surgicom', 'qc', 'shp', {
        receivedAt,
        items: [
          {
            shipmentLineId: 'line',
            receivedQty: 2,
            acceptedQty: 2,
            rejectedQty: 0,
            heldQty: 0,
          },
        ],
      });
      expect(tx.goodsReceipt.create).toHaveBeenCalled();
      await service.expense('Surgicom', 'finance', 'shp', {
        category: 'Taxes',
        description: 'Customs tax',
        currency: 'PHP',
        amount: 10,
        status: 'Paid',
        paidAt: '2026-10-15',
      });
      expect(tx.importExpense.create).toHaveBeenCalled();
    },
  );

  it('records missing deliveries with discrepancy notes and no available stock', async () => {
    const { tx, service } = setup();
    tx.shipment.findFirst.mockResolvedValue({
      status: 'Arrived',
      actualArrival: new Date('2026-10-14'),
      items: [{ id: 'line', clearedQty: 10, receipts: [] }],
    });
    const item = {
      shipmentLineId: 'line',
      receivedQty: 0,
      acceptedQty: 0,
      rejectedQty: 0,
      heldQty: 0,
    };
    await expect(
      service.receipt('Surgicom', 'qc', 'shp', { items: [item] }),
    ).rejects.toThrow(/discrepancy/);
    await service.receipt('Surgicom', 'qc', 'shp', {
      items: [{ ...item, notes: 'Carton missing at unloading.' }],
    });
    expect(tx.goodsReceipt.create).toHaveBeenCalledWith(
      containing({
        data: containing({
          items: {
            create: [
              containing({
                receivedQty: 0,
                acceptedQty: 0,
                notes: 'Carton missing at unloading.',
              }),
            ],
          },
        }),
      }),
    );
  });

  it('prevents closing a shipment before holds resolve and accepted stock is placed', async () => {
    const { tx, service } = setup();
    tx.shipment.findFirst.mockResolvedValue({
      status: 'Arrived',
      actualArrival: new Date('2026-10-14'),
      items: [
        {
          shippedQty: 4,
          clearedQty: 4,
          receipts: [
            { receivedQty: 4, heldQty: 1, acceptedQty: 3, placedQty: 2 },
          ],
        },
      ],
    });
    await expect(
      service.updateShipment('Surgicom', 'shp', { status: 'Closed' }),
    ).rejects.toThrow(/resolve QC holds/);
    await expect(
      service.updateShipment('Surgicom', 'shp', { status: 'Planned' }),
    ).rejects.toThrow(/backwards/);
  });
});
