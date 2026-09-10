import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios'; // 1. Import the HttpModule
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { SentryIntegrationService } from './sentry.service';

@Module({
  imports: [HttpModule], // 2. Add HttpModule to the imports array
  controllers: [EmployeesController],
  providers: [EmployeesService, SentryIntegrationService], // Ensure Sentry service is listed here
})
export class EmployeesModule {}