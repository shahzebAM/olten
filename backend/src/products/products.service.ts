import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class ProductsService {
  // Initialize PrismaClient directly
  private prisma = new PrismaClient();

  async create(data: any) {
    const productData = { ...data };
    if (productData.createdAt) {
      productData.createdAt = new Date(productData.createdAt);
    }
    
    return this.prisma.product.create({
      data: productData,
    });
  }

  async findAll(company: string) {
    if (!company) return [];
    return this.prisma.product.findMany({
      where: { company },
      orderBy: { id: 'desc' }
    });
  }

  async update(id: number, data: any) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Product not found');

    const updateData = { ...data };
    if (updateData.createdAt) updateData.createdAt = new Date(updateData.createdAt);
    if (updateData.deletedAt) updateData.deletedAt = new Date(updateData.deletedAt);

    return this.prisma.product.update({
      where: { id },
      data: updateData,
    });
  }

  async updateStatus(id: number, isActive: boolean, deletedAt: string | null) {
    return this.prisma.product.update({
      where: { id },
      data: { 
        isActive, 
        deletedAt: deletedAt ? new Date(deletedAt) : null 
      },
    });
  }
}