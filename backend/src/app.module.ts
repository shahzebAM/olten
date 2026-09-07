import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EmployeesModule } from './employees/employees.module';
import { DocumentationModule } from './documentation/documentation.module';
import { ProductsModule } from './products/products.module';
import { InventoryMovementsController } from "./inventory-movements/inventory-movements.controller";

@Module({
  imports: [
    EmployeesModule,
    DocumentationModule,
    ProductsModule
    // InventoryMovementsController removed from here
  ],
  controllers: [
    AppController,
    InventoryMovementsController // Added here
  ],
  providers: [AppService],
})
export class AppModule {}