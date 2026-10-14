import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EmployeesModule } from './employees/employees.module';
import { DocumentationModule } from './documentation/documentation.module';
import { CompaniesController } from './companies/companies.controller';
import { SettingsController } from './settings/settings.controller';
import { MasterInventoryController } from './master-inventory/master-inventory.controller';
import { SalesController } from './sales/sales.controller';
import { OrderSlipsController } from './sales/order-slips.controller';
import { ProcurementController } from './sales/purchase-orders.controller';
import { AuthSessionModule } from './auth/auth-session.module';
import { PackingListsController } from './sales/packing-lists.controller';
import { QuotationsController } from './sales/quotations.controller';
import { RequisitionsController, SupplierQuotationsController } from './importation/requisitions.controller';
import { ImportFilesController, ShipmentsController } from './importation/shipments.controller';
import { CustomsController } from './importation/customs.controller';
import { GoodsReceiptController } from './importation/grn.controller';

@Module({
  imports: [
    AuthSessionModule,
    EmployeesModule,
    DocumentationModule,
  ],
  controllers: [
    AppController,
    MasterInventoryController,
    CompaniesController,
    SettingsController,
    SalesController,
    OrderSlipsController,
    ProcurementController,
    PackingListsController,
    QuotationsController,
    // Phase 1: Importation pipeline
    RequisitionsController,
    SupplierQuotationsController,
    ImportFilesController,
    ShipmentsController,
    CustomsController,
    GoodsReceiptController,
  ],
  providers: [AppService],
})
export class AppModule {}
