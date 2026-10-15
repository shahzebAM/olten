import { Module } from '@nestjs/common';
import { AuthSessionModule } from '../auth/auth-session.module';
import { ImportationAuthGuard } from './importation-auth.guard';
import { ImportationController } from './importation.controller';
import { ImportationService } from './importation.service';
import {
  ImportReceivingController,
  ReceivingAuthGuard,
} from './receiving.controller';

@Module({
  imports: [AuthSessionModule],
  controllers: [ImportationController, ImportReceivingController],
  providers: [ImportationService, ImportationAuthGuard, ReceivingAuthGuard],
})
export class ImportationModule {}
