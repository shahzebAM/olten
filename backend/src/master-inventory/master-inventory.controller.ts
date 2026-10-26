import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Delete,
  Param,
  Patch,
  NotFoundException,
  BadRequestException,
  ConflictException,
  UseGuards,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  assertLegacyStockFloor,
  lockProduct,
  validateLocation,
} from '../fulfillment/fulfillment.stock';
import { object } from '../importation/importation.validation';
import { LegacyCompanyRecord, LegacyErpAccess, LegacyErpAuthGuard, LegacyReadModules } from '../auth/legacy-erp-auth.guard';
@Controller() 
@UseGuards(LegacyErpAuthGuard)
@LegacyErpAccess('inventory')
export class MasterInventoryController {
  private prisma = new PrismaClient();

  private async assertUntrackedMutation(
    tx: Prisma.TransactionClient,
    company: string,
    productId: number,
  ) {
    if (await tx.warehouseLot.count({ where: { company, productId } })) {
      throw new ConflictException(
        'This product has tracked warehouse stock. Use Warehouse Operations for quantity changes.',
      );
    }
  }

  // ==========================================
  // 1. PRODUCTS (Master Catalog)
  // ==========================================
  @Post('products')
  async createProduct(@Body() data: any) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const product = await tx.product.create({
          data: {
            company: data.company,
            name: data.name,
            sku: data.sku,
            category: data.category || 'General',
            purchasePrice: parseFloat(data.purchasePrice) || 0,
            sellingPrice: parseFloat(data.sellingPrice) || 0,
            minQuantity: parseInt(data.minQuantity) || 10,
            reorderLevel: parseInt(data.reorderLevel) || 20,
            unit: data.unit || 'pcs',
            vatSetting: data.vatSetting || 'NONE',
            currentStock: parseInt(data.initialQuantity) || 0,
            imageUrl: data.imageUrl || null,
            barcode: data.barcode || null,
            createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
          }
        });

        if (data.initialQuantity && parseInt(data.initialQuantity) > 0) {
          await tx.inventoryMovement.create({
            data: {
              company: data.company,
              productId: product.id,
              productName: product.name,
              sku: product.sku,
              type: 'RECEIVE',
              quantity: parseInt(data.initialQuantity),
              previousStock: 0,
              newStock: parseInt(data.initialQuantity),
              remarks: 'Initial System Entry (Master Stock)',
              user: data.username || 'System Admin',
              warehouseId: null, 
              employeeId: null,
              batchNumber: data.batchNumber || null,
              expirationDate: data.expirationDate ? new Date(data.expirationDate).toISOString() : null,
            }
          });
        }
        return product;
      });
    } catch (error: any) {
      throw new Error(`Unified Product Creation Error: ${error.message}`);
    }
  }

  @Get('products')
  @LegacyReadModules('purchasing', 'sales', 'importation')
  async findAllProducts(@Query('company') company: string) {
    if (!company) return [];
    return this.prisma.product.findMany({ where: { company }, orderBy: { id: 'desc' } });
  }

  @Patch('products/:id')
  @LegacyCompanyRecord('product')
  async updateProduct(@Param('id') id: string, @Body() data: any) {
    // Strip all non-schema or immutable parameters to prevent Prisma validation crashes
    const {
      id: _id,
      username,
      initialQuantity,
      warehouseId,
      batchNumber,
      expirationDate,
      previousImageUrl,
      currentStock,
      ...cleanData
    } = data;
    delete (cleanData as Record<string, unknown>).expiryControlled;
    delete (cleanData as Record<string, unknown>).serialControlled;

    if (cleanData.createdAt)
      cleanData.createdAt = new Date(cleanData.createdAt);
    if (cleanData.deletedAt)
      cleanData.deletedAt = new Date(cleanData.deletedAt);
    if (cleanData.purchasePrice !== undefined)
      cleanData.purchasePrice = parseFloat(cleanData.purchasePrice) || 0;
    if (cleanData.sellingPrice !== undefined)
      cleanData.sellingPrice = parseFloat(cleanData.sellingPrice) || 0;
    if (cleanData.minQuantity !== undefined)
      cleanData.minQuantity = parseInt(cleanData.minQuantity) || 10;
    if (cleanData.reorderLevel !== undefined)
      cleanData.reorderLevel = parseInt(cleanData.reorderLevel) || 20;
    return this.prisma.$transaction(
      async (tx) => {
        const product = await tx.product.findUnique({
          where: { id: Number(id) },
        });
        if (!product) throw new NotFoundException('Product not found.');
        const workspace = (cleanData as Record<string, unknown>).company;
        if (workspace !== undefined && workspace !== product.company) {
          throw new BadRequestException(
            'A product cannot move to another workspace.',
          );
        }
        if (currentStock !== undefined) {
          const quantity = Number(currentStock);
          if (
            (typeof currentStock !== 'number' &&
              typeof currentStock !== 'string') ||
            String(currentStock).trim() === '' ||
            !Number.isSafeInteger(quantity)
          ) {
            throw new BadRequestException(
              'Stock must be a non-negative whole quantity.',
            );
          }
          if (quantity !== product.currentStock) {
            await lockProduct(tx, product.company, product.id);
            await assertLegacyStockFloor(
              tx,
              product.company,
              product.id,
              'MASTER',
              quantity,
            );
            await this.assertUntrackedMutation(tx, product.company, product.id);
          }
          cleanData.currentStock = quantity;
        }
        return tx.product.update({
          where: { id: product.id },
          data: cleanData,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  @Delete('products/:id')
  @LegacyCompanyRecord('product')
  async removeProduct(@Param('id') id: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const product = await tx.product.findUnique({
          where: { id: Number(id) },
        });
        if (!product) throw new NotFoundException('Product not found.');
        await this.assertUntrackedMutation(tx, product.company, product.id);
        if (
          await tx.customerOrderLine.count({
            where: {
              productId: product.id,
              order: { company: product.company },
            },
          })
        ) {
          throw new ConflictException(
            'A product with fulfillment order history cannot be deleted.',
          );
        }
        return tx.product.delete({ where: { id: product.id } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  // ==========================================
  // 2. INVENTORY MOVEMENTS (Ledger)
  // ==========================================
  @Post('inventory-movements')
  async createMovement(@Body() data: any) {
    const movement = object(data);
    await this.assertUntrackedMutation(
      this.prisma,
      typeof movement.company === 'string' ? movement.company : '',
      Number(movement.productId),
    );
    return this.prisma.inventoryMovement.create({
      data: {
        productId: data.productId,
        productName: data.productName,
        sku: data.sku,
        type: data.type,
        quantity: data.quantity,
        previousStock: data.previousStock,
        newStock: data.newStock,
        reference: data.reference,
        remarks: data.remarks,
        user: data.user,
        company: data.company,
        date: new Date(),
        batchNumber: data.batchNumber || null,
        expirationDate: data.expirationDate ? new Date(data.expirationDate).toISOString() : null,
        warehouseId: data.warehouseId ? parseInt(data.warehouseId) : null,
        employeeId: data.employeeId ? parseInt(data.employeeId) : null,
      }
    });
  }

  @Get('inventory-movements')
  async findAllMovements(@Query('company') company: string) {
    return this.prisma.inventoryMovement.findMany({
      where: { company },
      orderBy: { date: 'desc' },
      include: { warehouse: true, employee: true }
    });
  }

  @Delete('inventory-movements/clear/:company')
  async clearHistory(@Param('company') company: string) {
    return this.prisma.inventoryMovement.deleteMany({ where: { company } });
  }

  // ==========================================
  // 3. WAREHOUSE DIRECTORY
  // ==========================================
  @Post('warehouses')
  async createWarehouse(@Body() data: any) {
    return this.prisma.warehouse.create({
      data: {
        company: data.company,
        name: data.name,
        address: data.location || data.address || 'Not Specified',
        status: data.status || 'Active',
      }
    });
  }

  @Get('warehouses')
  @LegacyReadModules('purchasing', 'sales', 'importation')
  async findAllWarehouses(@Query('company') company: string) {
    if (!company) return [];
    return this.prisma.warehouse.findMany({ where: { company }, orderBy: { id: 'asc' } });
  }

  @Patch('warehouses/:id')
  @LegacyCompanyRecord('warehouse')
  async updateWarehouse(@Param('id') id: string, @Body() data: any) {
    return this.prisma.warehouse.update({
      where: { id: parseInt(id) },
      data: { name: data.name, address: data.location || data.address, status: data.status }
    });
  }

  @Delete('warehouses/:id')
  @LegacyCompanyRecord('warehouse')
  async removeWarehouse(@Param('id') id: string) {
    const wId = parseInt(id);
    return await this.prisma.$transaction(
      async (tx) => {
        if (
          (await tx.warehouseBin.count({ where: { warehouseId: id } })) ||
          (await tx.warehouseLot.count({ where: { warehouseId: id } }))
        ) {
          throw new ConflictException(
            'This warehouse has bin or lot history and cannot be deleted.',
          );
        }
        await tx.inventoryMovement.updateMany({
          where: { warehouseId: wId },
          data: {
            warehouseId: null,
            remarks: 'Facility Deleted (Archived Record)',
          },
        });
        await tx.warehouseStock.deleteMany({
          where: { warehouseId: id },
        });
        return tx.warehouse.delete({ where: { id: wId } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  // ==========================================
  // 4. WAREHOUSE STOCK (Live Hub Balances)
  // ==========================================
  @Post('warehouse-stock')
  async assignStock(@Body() body: unknown) {
    const data = object(body);
    const safeProductId = Number(data.productId);
    const safeWarehouseId = String(data.warehouseId);
    const safeQuantity = Number(data.quantity);
    if (
      !Number.isSafeInteger(safeProductId) ||
      safeProductId < 1 ||
      !Number.isSafeInteger(safeQuantity) ||
      (typeof data.quantity !== 'number' &&
        typeof data.quantity !== 'string') ||
      String(data.quantity).trim() === '' ||
      typeof data.company !== 'string' ||
      !data.company.trim() ||
      safeWarehouseId === 'MASTER'
    ) {
      throw new BadRequestException(
        'A product, workspace, warehouse and whole stock quantity are required.',
      );
    }
    const company = data.company;
    return this.prisma.$transaction(
      async (tx) => {
        const product = await lockProduct(tx, company, safeProductId);
        await validateLocation(tx, company, safeWarehouseId);
        const existingStock = await tx.warehouseStock.findUnique({
          where: {
            warehouseId_productId: {
              warehouseId: safeWarehouseId,
              productId: safeProductId,
            },
          },
        });
        if (existingStock && existingStock.company !== company)
          throw new ConflictException(
            'Warehouse balance belongs to another workspace.',
          );
        const quantity = (existingStock?.quantity ?? 0) + safeQuantity;
        await assertLegacyStockFloor(
          tx,
          company,
          safeProductId,
          safeWarehouseId,
          quantity,
        );
        if (safeQuantity !== 0)
          await this.assertUntrackedMutation(tx, company, safeProductId);
        return tx.warehouseStock.upsert({
          where: {
            warehouseId_productId: {
              warehouseId: safeWarehouseId,
              productId: safeProductId,
            },
          },
          create: {
            company,
            warehouseId: safeWarehouseId,
            productId: safeProductId,
            sku: product.sku,
            quantity,
          },
          update: { quantity, lastUpdated: new Date() },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  @Get('warehouse-stock')
  async getStock(@Query('company') company: string) {
    if (!company) return [];
    return this.prisma.warehouseStock.findMany({ where: { company } });
  }

  @Delete('warehouse-stock/clear/:company')
  async clearAllHubStocks(@Param('company') company: string) {
    return this.prisma.$transaction(
      async (tx) => {
        if (
          await tx.warehouseLot.count({
            where: { company, warehouseId: { not: 'MASTER' } },
          })
        ) {
          throw new ConflictException(
            'Tracked warehouse stock must be adjusted through Warehouse Operations.',
          );
        }
        return tx.warehouseStock.deleteMany({ where: { company } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

// ==========================================
  // 5. CUSTOMER CATEGORIES & AUTO-PRICING
  // ==========================================
  @Post('customer-categories')
  async createCustomerCategory(@Body() data: any) {
    const { company, name, markupPercent = 20 } = data; // Defaults to 20% markup if not provided

    try {
      return await this.prisma.$transaction(async (tx) => {
        // 1. Create the new customer category
        const category = await tx.customerCategory.create({
          data: {
            name: name,
            company: company,
          }
        });

        // 2. Fetch all products for this company
        const products = await tx.product.findMany({
          where: { company: company },
          select: { id: true, purchasePrice: true, sellingPrice: true }
        });

        if (products.length > 0) {
          // 3. Generate distinct price entries for the new tier
          const newTierPrices = products.map((p: any) => {
            const baseCost = Number(p.purchasePrice) || Number(p.sellingPrice) || 0;
            const generatedPrice = Number((baseCost * (1 + markupPercent / 100)).toFixed(2));

            return {
              company: company,
              categoryName: name, 
              productId: p.id,
              price: generatedPrice,
            };
          });

          // 4. Batch-save the new prices without touching existing category prices
          await tx.categoryPrice.createMany({
            data: newTierPrices,
            skipDuplicates: true, // Safely ignores if a price somehow already exists
          });
        }

        return { category, message: `Successfully created tier and generated prices for ${products.length} products.` };
      });
    } catch (error: any) {
      throw new Error(`Failed to create category and generate prices: ${error.message}`);
    }
  }
}
