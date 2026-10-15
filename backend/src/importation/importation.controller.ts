import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ImportationAuthGuard,
  type ImportationRequest,
} from './importation-auth.guard';
import { ImportationService } from './importation.service';

@Controller('importation')
@UseGuards(ImportationAuthGuard)
export class ImportationController {
  constructor(private readonly service: ImportationService) {}

  @Get('overview')
  overview(@Headers('x-company') company: string) {
    return this.service.overview(company);
  }

  @Post('requisitions')
  createRequisition(
    @Headers('x-company') company: string,
    @Req() req: ImportationRequest,
    @Body() body: unknown,
  ) {
    return this.service.createRequisition(
      company,
      req.importationUser.username,
      body,
    );
  }

  @Post('requisitions/:id/quotations')
  addQuotation(
    @Headers('x-company') company: string,
    @Req() req: ImportationRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.addQuotation(
      company,
      req.importationUser.username,
      id,
      body,
    );
  }

  @Post('requisitions/:id/submit')
  submit(@Headers('x-company') company: string, @Param('id') id: string) {
    return this.service.submit(company, id);
  }

  @Post('requisitions/:id/approve')
  approve(
    @Headers('x-company') company: string,
    @Req() req: ImportationRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.approve(company, req.importationUser, id, body);
  }

  @Post('requisitions/:id/reject')
  reject(
    @Headers('x-company') company: string,
    @Req() req: ImportationRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.reject(company, req.importationUser, id, body);
  }

  @Post('import-files')
  createImportFile(
    @Headers('x-company') company: string,
    @Req() req: ImportationRequest,
    @Body() body: unknown,
  ) {
    return this.service.createImportFile(
      company,
      req.importationUser.username,
      body,
    );
  }

  @Patch('import-files/:id')
  updateImportFile(
    @Headers('x-company') company: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.updateImportFile(company, id, body);
  }

  @Post('shipments')
  createShipment(
    @Headers('x-company') company: string,
    @Req() req: ImportationRequest,
    @Body() body: unknown,
  ) {
    return this.service.createShipment(
      company,
      req.importationUser.username,
      body,
    );
  }

  @Patch('shipments/:id')
  updateShipment(
    @Headers('x-company') company: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.updateShipment(company, id, body);
  }

  @Patch('shipments/:id/clearance')
  clearance(
    @Headers('x-company') company: string,
    @Req() req: ImportationRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.clearance(
      company,
      req.importationUser.username,
      id,
      body,
    );
  }

  @Post('shipments/:id/expenses')
  addExpense(
    @Headers('x-company') company: string,
    @Req() req: ImportationRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.expense(
      company,
      req.importationUser.username,
      id,
      body,
    );
  }

  @Patch('expenses/:id')
  updateExpense(
    @Headers('x-company') company: string,
    @Req() req: ImportationRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.expense(
      company,
      req.importationUser.username,
      id,
      body,
      true,
    );
  }

  @Post('shipments/:id/receipts')
  receipt(
    @Headers('x-company') company: string,
    @Req() req: ImportationRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.receipt(
      company,
      req.importationUser.username,
      id,
      body,
    );
  }

  @Patch('receipt-lines/:id/qc')
  qc(
    @Headers('x-company') company: string,
    @Req() req: ImportationRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.qc(company, req.importationUser.username, id, body);
  }
}
