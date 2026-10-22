import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { FinanceService } from './finance.service';
import { Phase3Access, Phase3AuthGuard } from './phase3-auth.guard';
import type { Phase3Request } from './phase3-auth.guard';

@Controller('phase3')
@UseGuards(Phase3AuthGuard)
@Phase3Access('finance')
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get('finance/overview')
  @Phase3Access('finance', 'landed')
  overview(
    @Headers('x-company') company: string,
    @Req() request: Phase3Request,
  ) {
    return this.finance.overview(company, request.user);
  }

  @Post('landed-costs')
  @Phase3Access('landed')
  landed(
    @Headers('x-company') company: string,
    @Req() request: Phase3Request,
    @Body() body: unknown,
  ) {
    return this.finance.createLandedCost(company, request.user, body);
  }

  @Post('landed-costs/:id/finalize')
  @Phase3Access('landed')
  finalize(
    @Headers('x-company') company: string,
    @Req() request: Phase3Request,
    @Param('id') id: string,
  ) {
    return this.finance.finalizeLandedCost(company, request.user, id);
  }

  @Get('products/:id/cost-history')
  @Phase3Access('landed')
  costs(
    @Headers('x-company') company: string,
    @Req() request: Phase3Request,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.finance.costHistory(company, request.user, id);
  }

  @Post('invoices/from-delivery')
  invoice(
    @Headers('x-company') company: string,
    @Req() request: Phase3Request,
    @Body() body: unknown,
  ) {
    return this.finance.invoiceFromDelivery(company, request.user, body);
  }

  @Post('bills')
  bill(
    @Headers('x-company') company: string,
    @Req() request: Phase3Request,
    @Body() body: unknown,
  ) {
    return this.finance.createBill(company, request.user, body);
  }

  @Post('documents/:id/post')
  post(
    @Headers('x-company') company: string,
    @Req() request: Phase3Request,
    @Param('id') id: string,
  ) {
    return this.finance.postDocument(company, request.user, id);
  }

  @Post('memos')
  memo(
    @Headers('x-company') company: string,
    @Req() request: Phase3Request,
    @Body() body: unknown,
  ) {
    return this.finance.createMemo(company, request.user, body);
  }

  @Post('payments')
  payment(
    @Headers('x-company') company: string,
    @Req() request: Phase3Request,
    @Body() body: unknown,
  ) {
    return this.finance.createPayment(company, request.user, body);
  }

  @Post('payment-requests')
  paymentRequest(
    @Headers('x-company') company: string,
    @Req() request: Phase3Request,
    @Body() body: unknown,
  ) {
    return this.finance.createPaymentRequest(company, request.user, body);
  }

  @Post('payment-requests/:id/decision')
  decision(
    @Headers('x-company') company: string,
    @Req() request: Phase3Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.finance.decidePaymentRequest(company, request.user, id, body);
  }

  @Get('balances')
  balances(
    @Headers('x-company') company: string,
    @Req() request: Phase3Request,
    @Query('direction') direction: 'AR' | 'AP',
    @Query('partyId') partyId?: string,
  ) {
    return this.finance.balances(company, request.user, direction, partyId);
  }
}
