import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { BooksService } from './books.service';
import { Phase3Access, Phase3AuthGuard } from './phase3-auth.guard';
import type { Phase3Request } from './phase3-auth.guard';
import type { ReportQuery } from './books.reports';

@Controller('phase3')
@UseGuards(Phase3AuthGuard)
@Phase3Access('books')
export class BooksController {
  constructor(private readonly books: BooksService) {}

  @Get('books')
  overview(@Headers('x-company') company: string) {
    return this.books.overview(company);
  }

  @Get('books/reports/:kind')
  report(
    @Headers('x-company') company: string,
    @Param('kind') kind: string,
    @Query() query: ReportQuery,
  ) {
    return this.books.report(company, kind, query);
  }

  @Post('books/initialize')
  initialize(
    @Headers('x-company') company: string,
    @Req() request: Phase3Request,
  ) {
    return this.books.initialize(company, request.user);
  }

  @Get('books/cash-flow/entries')
  cashEntries(
    @Headers('x-company') company: string,
    @Query() query: ReportQuery,
  ) {
    return this.books.cashFlowEntries(company, query);
  }

  @Get('books/inventory-reconciliation')
  inventoryReconciliation(
    @Headers('x-company') company: string,
    @Req() request: Phase3Request,
  ) {
    return this.books.inventoryReconciliation(company, request.user);
  }

  @Post('books/cash-flow/accounts')
  cashAccount(
    @Headers('x-company') company: string,
    @Req() request: Phase3Request,
    @Body() body: unknown,
  ) {
    return this.books.setCashAccount(company, request.user, body);
  }

  @Post('books/cash-flow/classifications')
  classifyCash(
    @Headers('x-company') company: string,
    @Req() request: Phase3Request,
    @Body() body: unknown,
  ) {
    return this.books.classifyCash(company, request.user, body);
  }

  @Get('books/ledger-entries')
  entries(
    @Headers('x-company') company: string,
    @Query('accountId') accountId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.books.unmatchedEntries(company, accountId, cursor, limit);
  }

  @Post('books/accounts')
  account(
    @Headers('x-company') company: string,
    @Req() request: Phase3Request,
    @Body() body: unknown,
  ) {
    return this.books.createAccount(company, request.user, body);
  }

  @Delete('books/accounts/:id')
  deleteAccount(
    @Headers('x-company') company: string,
    @Req() request: Phase3Request,
    @Param('id') id: string,
  ) {
    return this.books.deleteAccount(company, request.user, id);
  }

  @Post('books/accounts/:id/restore')
  restoreAccount(
    @Headers('x-company') company: string,
    @Req() request: Phase3Request,
    @Param('id') id: string,
  ) {
    return this.books.restoreAccount(company, request.user, id);
  }

  @Post('books/journals')
  journal(
    @Headers('x-company') company: string,
    @Req() request: Phase3Request,
    @Body() body: unknown,
  ) {
    return this.books.createJournal(company, request.user, body);
  }

  @Post('books/mappings')
  mapping(
    @Headers('x-company') company: string,
    @Req() request: Phase3Request,
    @Body() body: unknown,
  ) {
    return this.books.setMapping(company, request.user, body);
  }

  @Post('books/reconciliations')
  reconciliation(
    @Headers('x-company') company: string,
    @Req() request: Phase3Request,
    @Body() body: unknown,
  ) {
    return this.books.createReconciliation(company, request.user, body);
  }

  @Post('books/reconciliations/:id/match')
  match(
    @Headers('x-company') company: string,
    @Req() request: Phase3Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.books.matchStatementLine(company, request.user, id, body);
  }

  @Post('books/reconciliations/:id/complete')
  complete(
    @Headers('x-company') company: string,
    @Req() request: Phase3Request,
    @Param('id') id: string,
  ) {
    return this.books.completeReconciliation(company, request.user, id);
  }

  @Get('audit')
  audit(
    @Headers('x-company') company: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.books.auditLog(company, cursor, limit);
  }
}
