import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EmployeesModule } from './employees/employees.module';
import { DocumentationModule } from './documentation/documentation.module';
import { ProductsModule } from './products/products.module';
import { InventoryMovementsController } from "./inventory-movements/inventory-movements.controller";
import { PurchasingController } from './purchasing/purchasing.controller';

import { WarehousesController } from './warehouse/warehouse.controller';
import { WarehouseStockController } from './warehouse/warehouse-stock.controller'; // FIXED TYPO HERE
import { WarehouseTransfersController } from './warehouse/warehouse-transfers.controller';

@Module({
  imports: [
    EmployeesModule,
    DocumentationModule,
    ProductsModule
  ],
  controllers: [
    AppController,
    InventoryMovementsController,
    WarehousesController,
    WarehouseStockController, // FIXED TYPO HERE
    WarehouseTransfersController,
    PurchasingController
  ],
  providers: [AppService],
})
export class AppModule {}