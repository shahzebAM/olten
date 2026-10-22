import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  Phase3Access,
  Phase3AuthGuard,
  Phase3ReadOnly,
  type Phase3Request,
} from './phase3-auth.guard';
import { InsightsService } from './insights.service';

@Controller('phase3')
@UseGuards(Phase3AuthGuard)
export class InsightsController {
  constructor(private readonly service: InsightsService) {}

  @Get('executive')
  @Phase3Access('executive')
  executive(
    @Headers('x-company') company: string,
    @Req() request: Phase3Request,
  ) {
    return this.service.executive(company, request.user);
  }

  @Get('reports/:id')
  @Phase3Access('executive')
  report(
    @Headers('x-company') company: string,
    @Req() request: Phase3Request,
    @Param('id') id: string,
  ) {
    return this.service.report(company, request.user, id);
  }

  @Get('service')
  @Phase3Access('service')
  overview(
    @Headers('x-company') company: string,
    @Req() request: Phase3Request,
  ) {
    return this.service.serviceOverview(company, request.user);
  }

  @Post('service/assets')
  @Phase3Access('service')
  asset(
    @Headers('x-company') company: string,
    @Req() request: Phase3Request,
    @Body() body: unknown,
  ) {
    return this.service.registerAsset(company, request.user, body);
  }

  @Post('service/visits')
  @Phase3Access('service')
  visit(
    @Headers('x-company') company: string,
    @Req() request: Phase3Request,
    @Body() body: unknown,
  ) {
    return this.service.createVisit(company, request.user, body);
  }

  @Post('service/visits/:id/status')
  @Phase3Access('service')
  status(
    @Headers('x-company') company: string,
    @Req() request: Phase3Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.updateVisit(company, request.user, id, body);
  }

  @Post('ai/query')
  @Phase3Access('ai')
  @Phase3ReadOnly()
  query(
    @Headers('x-company') company: string,
    @Req() request: Phase3Request,
    @Body() body: unknown,
  ) {
    return this.service.query(company, request.user, body);
  }

  @Post('ai/ocr')
  @Phase3Access('ai')
  @Phase3ReadOnly()
  ocr(
    @Headers('x-company') company: string,
    @Req() request: Phase3Request,
    @Body() body: unknown,
  ) {
    return this.service.ocr(company, request.user, body);
  }

  @Get('ai/documents')
  @Phase3Access('ai')
  documents(
    @Headers('x-company') company: string,
    @Req() request: Phase3Request,
  ) {
    return this.service.ocrDocuments(company, request.user);
  }
}
