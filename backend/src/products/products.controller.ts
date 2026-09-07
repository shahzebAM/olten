import { Controller, Get, Post, Body, Patch, Param, Query, Delete, Header } from '@nestjs/common';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  create(@Body() createProductDto: any) {
    return this.productsService.create(createProductDto);
  }

  @Get()
  findAll(@Query('company') company: string) {
    return this.productsService.findAll(company);
  }

  @Get('export/backup')
  @Header('Content-Type', 'application/json')
  @Header('Content-Disposition', 'attachment; filename="master_products_backup.json"')
  async downloadBackup() {
    const allProducts = await this.productsService.exportFullBackup();
    return JSON.stringify(allProducts, null, 2);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateProductDto: any) {
    return this.productsService.update(+id, updateProductDto);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string, 
    @Body() statusData: { isActive: boolean; deletedAt: string | null }
  ) {
    return this.productsService.updateStatus(+id, statusData.isActive, statusData.deletedAt);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.productsService.remove(+id);
  }
}