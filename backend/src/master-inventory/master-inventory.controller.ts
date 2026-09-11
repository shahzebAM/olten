import { Controller, Get, Post, Body, Query, Delete, Param, Patch, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Controller() 
export class MasterInventoryController {
  private prisma = new PrismaClient();

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
  async findAllProducts(@Query('company') company: string) {
    if (!company) return [];
    return this.prisma.product.findMany({ where: { company }, orderBy: { id: 'desc' } });
  }

  @Patch('products/:id')
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

    if (cleanData.createdAt) cleanData.createdAt = new Date(cleanData.createdAt);
    if (cleanData.deletedAt) cleanData.deletedAt = new Date(cleanData.deletedAt);
    if (cleanData.purchasePrice !== undefined) cleanData.purchasePrice = parseFloat(cleanData.purchasePrice) || 0;
    if (cleanData.sellingPrice !== undefined) cleanData.sellingPrice = parseFloat(cleanData.sellingPrice) || 0;
    if (cleanData.minQuantity !== undefined) cleanData.minQuantity = parseInt(cleanData.minQuantity) || 10;
    if (cleanData.reorderLevel !== undefined) cleanData.reorderLevel = parseInt(cleanData.reorderLevel) || 20;
    if (currentStock !== undefined) cleanData.currentStock = parseInt(currentStock) || 0;

    return this.prisma.product.update({ 
      where: { id: parseInt(id) }, 
      data: cleanData 
    });
  }

  @Delete('products/:id')
  async removeProduct(@Param('id') id: string) {
    return this.prisma.product.delete({ where: { id: parseInt(id) } });
  }

  // ==========================================
  // 2. INVENTORY MOVEMENTS (Ledger)
  // ==========================================
  @Post('inventory-movements')
  async createMovement(@Body() data: any) {
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
  async findAllWarehouses(@Query('company') company: string) {
    if (!company) return [];
    return this.prisma.warehouse.findMany({ where: { company }, orderBy: { id: 'asc' } });
  }

  @Patch('warehouses/:id')
  async updateWarehouse(@Param('id') id: string, @Body() data: any) {
    return this.prisma.warehouse.update({
      where: { id: parseInt(id) },
      data: { name: data.name, address: data.location || data.address, status: data.status }
    });
  }

  @Delete('warehouses/:id')
  async removeWarehouse(@Param('id') id: string) {
    const wId = parseInt(id);
    return await this.prisma.$transaction(async (tx) => {
      await tx.inventoryMovement.updateMany({
        where: { warehouseId: wId },
        data: { warehouseId: null, remarks: 'Facility Deleted (Archived Record)' }
      });
      await tx.warehouseStock.deleteMany({
        where: { warehouseId: id } 
      });
      return tx.warehouse.delete({ where: { id: wId } });
    });
  }

  // ==========================================
  // 4. WAREHOUSE STOCK (Live Hub Balances)
  // ==========================================
  @Post('warehouse-stock')
  async assignStock(@Body() data: any) {
    const safeProductId = parseInt(data.productId);
    const safeWarehouseId = String(data.warehouseId); 
    const safeQuantity = parseInt(data.quantity);

    const existingStock = await this.prisma.warehouseStock.findFirst({
      where: { warehouseId: safeWarehouseId, productId: safeProductId }
    });

    if (existingStock) {
      return this.prisma.warehouseStock.update({
        where: { id: existingStock.id },
        data: { quantity: existingStock.quantity + safeQuantity, lastUpdated: new Date() }
      });
    } else {
      return this.prisma.warehouseStock.create({
        data: {
          warehouseId: safeWarehouseId,
          productId: safeProductId,
          sku: data.sku,
          quantity: safeQuantity,
          company: data.company
        }
      });
    }
  }

  @Get('warehouse-stock')
  async getStock(@Query('company') company: string) {
    if (!company) return [];
    return this.prisma.warehouseStock.findMany({ where: { company } });
  }

  @Delete('warehouse-stock/clear/:company')
  async clearAllHubStocks(@Param('company') company: string) {
    return this.prisma.warehouseStock.deleteMany({ where: { company } });
  }
}