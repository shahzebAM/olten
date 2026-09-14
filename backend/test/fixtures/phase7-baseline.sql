-- Pre-Phase-7 sales tables for isolated migration and API integration tests.
-- CreateTable
CREATE TABLE "Product" (
    "id" SERIAL NOT NULL,
    "company" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "purchasePrice" DOUBLE PRECISION NOT NULL,
    "sellingPrice" DOUBLE PRECISION NOT NULL,
    "minQuantity" INTEGER NOT NULL DEFAULT 10,
    "reorderLevel" INTEGER NOT NULL DEFAULT 20,
    "unit" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "vatSetting" TEXT NOT NULL,
    "imageUrl" TEXT,
    "barcode" TEXT,
    "currentStock" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseStock" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "company" TEXT NOT NULL,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "creditLimit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderSlip" (
    "id" TEXT NOT NULL,
    "osNumber" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "subtotal" DECIMAL(12,2) NOT NULL,
    "vatApplied" BOOLEAN NOT NULL DEFAULT false,
    "vatRate" DECIMAL(4,2) NOT NULL DEFAULT 0.12,
    "vatAmount" DECIMAL(12,2) NOT NULL,
    "grandTotal" DECIMAL(12,2) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderSlip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderSlipItem" (
    "id" TEXT NOT NULL,
    "orderSlipId" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "requestedQty" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "lineTotal" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "OrderSlipItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Product_company_idx" ON "Product"("company");

-- CreateIndex
CREATE INDEX "Product_sku_idx" ON "Product"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseStock_warehouseId_productId_key" ON "WarehouseStock"("warehouseId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderSlip_osNumber_key" ON "OrderSlip"("osNumber");

-- CreateIndex
CREATE INDEX "OrderSlip_company_idx" ON "OrderSlip"("company");

-- AddForeignKey
ALTER TABLE "OrderSlip" ADD CONSTRAINT "OrderSlip_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderSlipItem" ADD CONSTRAINT "OrderSlipItem_orderSlipId_fkey" FOREIGN KEY ("orderSlipId") REFERENCES "OrderSlip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderSlipItem" ADD CONSTRAINT "OrderSlipItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
