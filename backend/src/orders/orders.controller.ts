import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@Controller()
export class OrdersController {
  
  // ==========================================
  // ORDER SLIPS
  // ==========================================
  @Post('erp/order-slips')
  async createOS(@Body() data: any) {
    const osNumber = `OS-${Date.now().toString().slice(-6)}`;
    return await prisma.orderSlip.create({
      data: {
        osNumber,
        company: data.company,
        customerId: data.customerId,
        subtotal: data.subtotal,
        vatAmount: data.vatAmount,
        isVatApplied: data.isVatApplied,
        grandTotal: data.grandTotal,
        user: data.user,
        items: {
          create: data.items.map((i: any) => ({
            productId: i.productId, 
            sku: i.sku, 
            productName: i.productName, 
            requestedQty: i.requestedQty, 
            unitPrice: i.unitPrice, 
            total: i.total
          }))
        }
      }
    });
  }

  @Get('erp/order-slips')
  async getOS(@Query('company') company: string) { 
    return await prisma.orderSlip.findMany({ 
      where: { company }, 
      include: { items: true }, 
      orderBy: { date: 'desc' }
    }); 
  }

  @Post('erp/order-slips/process')
  async processOS(@Body() data: any) {
    const os = await prisma.orderSlip.findUnique({ 
      where: { id: data.osId }, 
      include: { items: true } 
    });
    if (!os) throw new Error("OS Not Found");

    // FIX: Added ": any[]" to bypass strict TypeScript "never" warnings
    const finalItems: any[] = [];
    const shortages: any[] = [];

    // Separate verified physical units from missing shortage units
    for (const item of os.items) {
      const physicalQty = data.physicalCounts[item.productId] ?? item.requestedQty;
      const shortageQty = item.requestedQty - physicalQty;

      if (physicalQty > 0) {
        finalItems.push({ 
          productId: item.productId, 
          productName: item.productName, 
          sku: item.sku, 
          fulfilledQty: physicalQty 
        });
      }
      if (shortageQty > 0) {
        shortages.push({ 
          company: os.company, 
          orderDate: os.date, 
          orderRef: os.osNumber, 
          customerName: os.customerId, 
          productId: item.productId, 
          productName: item.productName, 
          sku: item.sku, 
          requestedQty: item.requestedQty, 
          physicalQty, 
          shortageQty 
        });
      }
    }

    // 1. Create Shortages
    if (shortages.length > 0) {
      await prisma.shortage.createMany({ data: shortages });
    }

    // 2. Create Final Order OR Cancel entire OS if physical quantities are all zero
    if (finalItems.length > 0) {
      const foNumber = `FO-${Date.now().toString().slice(-6)}`;
      await prisma.finalOrder.create({
        data: { 
          foNumber, 
          osId: os.id, 
          osNumber: os.osNumber, 
          company: os.company, 
          customerId: os.customerId, 
          items: finalItems 
        }
      });
      await prisma.orderSlip.update({ 
        where: { id: os.id }, 
        data: { status: 'PROCESSED' } 
      });
    } else {
      await prisma.orderSlip.update({ 
        where: { id: os.id }, 
        data: { status: 'CANCELLED' } 
      });
    }

    return { success: true };
  }

  // ==========================================
  // SHORTAGES & FINAL ORDERS
  // ==========================================
  @Get('erp/shortages')
  async getShortages(@Query('company') company: string) { 
    return await prisma.shortage.findMany({ 
      where: { company }, 
      orderBy: { orderDate: 'desc' }
    }); 
  }

  @Get('erp/final-orders')
  async getFinalOrders(@Query('company') company: string) { 
    return await prisma.finalOrder.findMany({ 
      where: { company }, 
      orderBy: { date: 'desc' }
    }); 
  }
}