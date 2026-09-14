import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EmployeesModule } from './employees/employees.module';
import { DocumentationModule } from './documentation/documentation.module';
import { CompaniesController } from './companies/companies.controller';
import { SettingsController } from './settings/settings.controller';
import { MasterInventoryController } from './master-inventory/master-inventory.controller';

@Module({
  imports: [
    EmployeesModule,
    DocumentationModule,
  ],
  controllers: [
    AppController,
    MasterInventoryController,
    CompaniesController,
    SettingsController
  ],
  providers: [AppService],
})
export class AppModule {}