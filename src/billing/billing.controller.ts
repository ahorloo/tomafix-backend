import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { BillingStatus, TemplateType } from '@prisma/client';
import { BillingService } from './billing.service';
import { AuthGuard } from '../auth/auth.guard';
import { WorkspaceAccessGuard } from '../auth/workspace-access.guard';
import { WorkspacePermission } from '../auth/workspace-permission.decorator';

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  private assertAdminKey(adminKey?: string) {
    const expected = process.env.BILLING_ADMIN_KEY?.trim();
    if (!expected || adminKey !== expected) {
      throw new UnauthorizedException('Unauthorized billing admin operation');
    }
  }

  @Get('plans')
  listPlans(@Query('templateType') templateType?: TemplateType) {
    return this.billing.listPlans(templateType);
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

  @UseGuards(AuthGuard, WorkspaceAccessGuard)
  @WorkspacePermission('dashboard:view')
  @Get('workspaces/:workspaceId/status')
  status(@Param('workspaceId') workspaceId: string) {
    return this.billing.workspaceBillingStatus(workspaceId);
  }

  @UseGuards(AuthGuard, WorkspaceAccessGuard)
  @WorkspacePermission('dashboard:view')
  @Get('workspaces/:workspaceId/overview')
  overview(@Param('workspaceId') workspaceId: string) {
    return this.billing.billingOverview(workspaceId);
  }

  @UseGuards(AuthGuard, WorkspaceAccessGuard)
  @WorkspacePermission('users:manage')
  @Patch('workspaces/:workspaceId/change-plan')
  changePlan(@Param('workspaceId') workspaceId: string, @Body() body: { planId: string }) {
    return this.billing.changeWorkspacePlan(workspaceId, body.planId);
  }

  @UseGuards(AuthGuard, WorkspaceAccessGuard)
  @WorkspacePermission('users:manage')
  @Post('workspaces/:workspaceId/retry-payment')
  retryPayment(@Param('workspaceId') workspaceId: string) {
    return this.billing.retryLatestPayment(workspaceId);
  }

  @UseGuards(AuthGuard, WorkspaceAccessGuard)
  @WorkspacePermission('users:manage')
  @Patch('workspaces/:workspaceId/billing-status')
  setBillingStatus(@Param('workspaceId') workspaceId: string, @Body() body: { status: BillingStatus }) {
    return this.billing.setBillingStatus(workspaceId, body.status);
  }

  @Post('dunning/run')
  runDunning(@Headers('x-billing-admin-key') adminKey?: string) {
    this.assertAdminKey(adminKey);
    return this.billing.runDunningSweep();
  }

  @Get('admin/template-plans')
  adminListTemplatePlans(
    @Headers('x-billing-admin-key') adminKey?: string,
    @Query('templateType') templateType?: TemplateType,
  ) {
    this.assertAdminKey(adminKey);
    return this.billing.listTemplatePlans(templateType);
  }

  @Patch('admin/template-plans')
  adminUpdateTemplatePlan(
    @Headers('x-billing-admin-key') adminKey: string | undefined,
    @Body()
    body: {
      templateType: TemplateType;
      planName: string;
      interval?: 'MONTHLY' | 'YEARLY';
      amountPesewas: number;
      currency?: string;
      isActive?: boolean;
    },
  ) {
    this.assertAdminKey(adminKey);
    return this.billing.updateTemplatePlanPrice({
      templateType: body.templateType,
      planName: body.planName,
      interval: body.interval,
      amountPesewas: Number(body.amountPesewas),
      currency: body.currency,
      isActive: body.isActive,
    });
  }

  @UseGuards(AuthGuard, WorkspaceAccessGuard)
  @WorkspacePermission('users:manage')
  @Get('workspaces/:workspaceId/webhooks/failed')
  failedWebhooks(@Param('workspaceId') workspaceId: string) {
    return this.billing.listFailedWebhookEvents(workspaceId);
  }

  @UseGuards(AuthGuard, WorkspaceAccessGuard)
  @WorkspacePermission('users:manage')
  @Post('workspaces/:workspaceId/webhooks/replay/:eventId')
  replayWebhook(@Param('eventId') eventId: string) {
    return this.billing.replayFailedWebhook(eventId);
  }

  @UseGuards(AuthGuard, WorkspaceAccessGuard)
  @WorkspacePermission('users:manage')
  @Post('workspaces/:workspaceId/reconcile')
  reconcileWorkspace(@Param('workspaceId') workspaceId: string) {
    return this.billing.reconcileWorkspaceBilling(workspaceId);
  }

  @Post('reconcile/run')
  runReconcile(@Headers('x-billing-admin-key') adminKey?: string, @Body() body?: { limit?: number }) {
    this.assertAdminKey(adminKey);
    return this.billing.reconcileAllWorkspaces(body?.limit ?? 200);
  }

  @Get('health')
  health() {
    return this.billing.health();
  }
}
