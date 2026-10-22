import { Module } from '@nestjs/common';
import { AuthSessionModule } from '../auth/auth-session.module';
import { DocumentationModule } from '../documentation/documentation.module';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { BooksController } from './books.controller';
import { BooksService } from './books.service';
import { InsightsController } from './insights.controller';
import { InsightsService } from './insights.service';
import { Phase3AuthGuard } from './phase3-auth.guard';

@Module({
  imports: [AuthSessionModule, DocumentationModule],
  controllers: [FinanceController, BooksController, InsightsController],
  providers: [FinanceService, BooksService, InsightsService, Phase3AuthGuard],
})
export class Phase3Module {}
