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
  FulfillmentAccess,
  FulfillmentAuthGuard,
  type FulfillmentRequest,
} from './fulfillment-auth.guard';
import { FulfillmentService } from './fulfillment.service';
import * as v from '../importation/importation.validation';

@Controller('fulfillment')
@UseGuards(FulfillmentAuthGuard)
@FulfillmentAccess('delivery')
export class FulfillmentController {
  constructor(private readonly service: FulfillmentService) {}
  @Get('overview') overview(@Headers('x-company') company: string) {
    return this.service.overview(company);
  }
  @FulfillmentAccess('warehouse')
  @Post('bins')
  bin(@Headers('x-company') company: string, @Body() body: unknown) {
    return this.service.createBin(company, body);
  }
  @FulfillmentAccess('warehouse')
  @Patch('products/:id/controls')
  controls(
    @Headers('x-company') company: string,
    @Req() request: FulfillmentRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.controls(
      company,
      request.user,
      v.integer(Number(id), 'Product', 1),
      body,
    );
  }
  @FulfillmentAccess('warehouse')
  @Post('lots/register')
  register(
    @Headers('x-company') company: string,
    @Req() request: FulfillmentRequest,
    @Body() body: unknown,
  ) {
    return this.service.registerLot(company, request.user.username, body);
  }
  @FulfillmentAccess('warehouse')
  @Post('lots/:id/status')
  status(
    @Headers('x-company') company: string,
    @Req() request: FulfillmentRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.lotStatus(company, request.user.username, id, body);
  }
  @FulfillmentAccess('warehouse')
  @Post('transfers')
  transfer(
    @Headers('x-company') company: string,
    @Req() request: FulfillmentRequest,
    @Body() body: unknown,
  ) {
    return this.service.transfer(company, request.user.username, body);
  }
  @FulfillmentAccess('warehouse')
  @Post('cycle-counts')
  count(
    @Headers('x-company') company: string,
    @Req() request: FulfillmentRequest,
    @Body() body: unknown,
  ) {
    return this.service.createCount(company, request.user.username, body);
  }
  @FulfillmentAccess('warehouse')
  @Patch('cycle-counts/:id/lines/:lineId')
  countLine(
    @Headers('x-company') company: string,
    @Req() request: FulfillmentRequest,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() body: unknown,
  ) {
    return this.service.countLine(
      company,
      request.user.username,
      id,
      lineId,
      body,
    );
  }
  @FulfillmentAccess('warehouse')
  @Post('cycle-counts/:id/submit')
  submit(@Headers('x-company') company: string, @Param('id') id: string) {
    return this.service.submitCount(company, id);
  }
  @FulfillmentAccess('warehouse')
  @Post('cycle-counts/:id/recount')
  recount(
    @Headers('x-company') company: string,
    @Req() request: FulfillmentRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.recount(company, request.user, id, body);
  }
  @FulfillmentAccess('warehouse')
  @Post('cycle-counts/:id/approve')
  approveCount(
    @Headers('x-company') company: string,
    @Req() request: FulfillmentRequest,
    @Param('id') id: string,
  ) {
    return this.service.approveCount(company, request.user, id);
  }
  @FulfillmentAccess('sales')
  @Post('orders')
  order() {
    return this.service.createOrder();
  }
  @FulfillmentAccess('sales')
  @Post('orders/from-os/:id')
  fromOs(
    @Headers('x-company') company: string,
    @Req() request: FulfillmentRequest,
    @Param('id') id: string,
  ) {
    return this.service.approveFromOs(company, request.user, id);
  }
  @FulfillmentAccess('sales')
  @Post('order-slips/:id/approve')
  approveOs(
    @Headers('x-company') company: string,
    @Req() request: FulfillmentRequest,
    @Param('id') id: string,
  ) {
    return this.service.approveFromOs(company, request.user, id);
  }
  @FulfillmentAccess('sales')
  @Post('orders/:id/reserve')
  reserve(
    @Headers('x-company') company: string,
    @Req() request: FulfillmentRequest,
    @Param('id') id: string,
  ) {
    return this.service.reserve(company, request.user, id);
  }
  @FulfillmentAccess('sales')
  @Post('orders/:id/cancel')
  cancelOrder(
    @Headers('x-company') company: string,
    @Req() request: FulfillmentRequest,
    @Param('id') id: string,
  ) {
    return this.service.cancelOrder(company, request.user.username, id);
  }
  @FulfillmentAccess('sales')
  @Post('orders/:id/incoming')
  incoming(
    @Headers('x-company') company: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.incoming(company, id, body);
  }
  @Post('deliveries') delivery(
    @Headers('x-company') company: string,
    @Req() request: FulfillmentRequest,
    @Body() body: unknown,
  ) {
    return this.service.createDelivery(company, request.user.username, body);
  }
  @Post('deliveries/:id/pick-list') pickList(
    @Headers('x-company') company: string,
    @Req() request: FulfillmentRequest,
    @Param('id') id: string,
  ) {
    return this.service.pickList(company, request.user.username, id);
  }
  @Post('deliveries/:id/picks/:pickId/verify') verify(
    @Headers('x-company') company: string,
    @Req() request: FulfillmentRequest,
    @Param('id') id: string,
    @Param('pickId') pickId: string,
    @Body() body: unknown,
  ) {
    return this.service.verifyPick(
      company,
      request.user.username,
      id,
      pickId,
      body,
    );
  }
  @Patch('deliveries/:id/schedule') schedule(
    @Headers('x-company') company: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.schedule(company, id, body);
  }
  @Post('deliveries/:id/dispatch') dispatch(
    @Headers('x-company') company: string,
    @Req() request: FulfillmentRequest,
    @Param('id') id: string,
  ) {
    return this.service.dispatch(company, request.user.username, id);
  }
  @Post('deliveries/:id/pod') pod(
    @Headers('x-company') company: string,
    @Req() request: FulfillmentRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.pod(company, request.user.username, id, body);
  }
  @Post('deliveries/:id/cancel') cancelDelivery(
    @Headers('x-company') company: string,
    @Param('id') id: string,
  ) {
    return this.service.cancelDelivery(company, id);
  }
}
