import { Module } from '@nestjs/common';
import { AuthSessionModule } from '../auth/auth-session.module';
import { FulfillmentAuthGuard } from './fulfillment-auth.guard';
import { FulfillmentController } from './fulfillment.controller';
import { FulfillmentService } from './fulfillment.service';

@Module({
  imports: [AuthSessionModule],
  controllers: [FulfillmentController],
  providers: [FulfillmentService, FulfillmentAuthGuard],
  exports: [FulfillmentService, FulfillmentAuthGuard],
})
export class FulfillmentModule {}
