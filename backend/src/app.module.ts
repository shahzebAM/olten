import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EmployeesModule } from './employees/employees.module';
import { DocumentationModule } from './documentation/documentation.module';
import { ProductsModule } from './products/products.module';

@Module({
  imports: [
    EmployeesModule,
    DocumentationModule,
    ProductsModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}