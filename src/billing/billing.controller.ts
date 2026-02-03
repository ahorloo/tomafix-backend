import { Body, Controller, Get, Headers, Param, Post, Req } from '@nestjs/common';
import { BillingService } from './billing.service';

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('plans')
  listPlans() {
    return this.billing.listPlans();
  }

  @Post('paystack/init')
  initPaystack(@Body() body: { workspaceId: string; planId: string }) {
    return this.billing.initPaystackPayment(body);
  }

  // DEV/Local only: create a mock payment reference (no Paystack call)
  @Post('mock/init')
  initMock(@Body() body: { workspaceId: string; planId: string }) {
    return this.billing.initMockPayment(body);
  }

  // DEV/Local only: confirm mock payment and activate workspace
  @Post('mock/confirm')
  confirmMock(@Body() body: { reference: string }) {
    return this.billing.confirmMockPayment(body);
  }

  // Paystack webhooks MUST be raw-body verified
  @Post('paystack/webhook')
  paystackWebhook(@Req() req: any, @Headers() headers: any, @Body() body: any) {
    return this.billing.handlePaystackWebhook(req.rawBody, headers, body);
  }

  @Get('workspaces/:workspaceId/status')
  status(@Param('workspaceId') workspaceId: string) {
    return this.billing.workspaceBillingStatus(workspaceId);
  }
}