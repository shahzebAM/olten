import { Module } from '@nestjs/common';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { AuthSessionModule } from '../auth/auth-session.module';

@Module({
  imports: [AuthSessionModule],
  controllers: [EmployeesController],
  providers: [EmployeesService], 
})
export class EmployeesModule {}
