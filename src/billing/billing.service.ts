import { BadGatewayException, BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  BillingProvider,
  BillingStatus,
  PaymentStatus,
  SubscriptionStatus,
  WorkspaceStatus,
} from '@prisma/client';
import { createHmac, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PaystackService } from './paystack.service';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  private assertBillingTransition(from: BillingStatus, to: BillingStatus) {
    const allowed: Record<BillingStatus, BillingStatus[]> = {
      ACTIVE: [BillingStatus.PAST_DUE, BillingStatus.CANCELLED],
      PAST_DUE: [BillingStatus.ACTIVE, BillingStatus.SUSPENDED, BillingStatus.CANCELLED],
      SUSPENDED: [BillingStatus.ACTIVE, BillingStatus.CANCELLED],
      CANCELLED: [BillingStatus.ACTIVE],
      PENDING_PAYMENT: [BillingStatus.ACTIVE, BillingStatus.CANCELLED],
    } as any;

    if (!allowed[from]?.includes(to)) {
      throw new BadRequestException(`Invalid billing transition: ${from} -> ${to}`);
    }
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackService,
  ) {}

  async listPlans() {
    const plans = await this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: [{ interval: 'asc' }, { amountPesewas: 'asc' }],
    });

    // Enrich with user-facing copy (kept server-side so frontend stays simple)
    const copy: Record<
      string,
      { summary: string; priceText: string; bullets: string[] }
    > = {
      Starter: {
        summary: 'For small apartment buildings',
        priceText: 'GH₵ 79 / month',
        bullets: [
          '1 property',
          'Up to 20 units',
          'Requests + residents management',
          'No Blocks (single-building setup)',
        ],
      },
      Growth: {
        summary: 'For growing apartments & small managers',
        priceText: 'GH₵ 149 / month',
        bullets: [
          'Up to 3 properties',
          'Up to 120 total units',
          'Blocks enabled (Block A / B / C)',
          'Staff assignment + basic reports',
        ],
      },
      'Toma Prime': {
        summary: 'For large apartments & premium teams',
        priceText: 'GH₵ 299 / month',
        bullets: [
          'Up to 5 properties',
          'Up to 250 total units',
          'Blocks enabled',
          'Advanced reports + exports',
          'Priority support',
          'Early access to new features',
        ],
      },
    };

    return plans.map((p) => ({
      ...p,
      ui: copy[p.name] ?? null,
    }));
  }

  async initPaystackPayment(dto: { workspaceId: string; planId: string }) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: dto.workspaceId },
      include: { owner: true },
    });

    if (!workspace) throw new BadRequestException('Workspace not found');
    if (!workspace.owner?.email) throw new BadRequestException('Owner email missing');

    if (workspace.status !== WorkspaceStatus.PENDING_PAYMENT) {
      throw new BadRequestException(
        `Workspace status must be PENDING_PAYMENT, got ${workspace.status}`,
      );
    }

    const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId } });
    if (!plan || !plan.isActive) throw new BadRequestException('Plan not found or inactive');

    const reference = `tf_${randomUUID()}`;
    const overrideCurrency = process.env.PAYSTACK_CURRENCY_OVERRIDE?.trim().toUpperCase();
    const chargeCurrency = overrideCurrency || plan.currency;
    const omitCurrency = process.env.PAYSTACK_OMIT_CURRENCY === 'true';

    // create payment row first
    await this.prisma.payment.create({
      data: {
        workspaceId: workspace.id,
        planId: plan.id,
        provider: BillingProvider.PAYSTACK,
        reference,
        amountPesewas: plan.amountPesewas,
        currency: chargeCurrency,
        status: PaymentStatus.PENDING,
      },
    });

    const callbackUrl = process.env.PAYSTACK_CALLBACK_URL;

    let data: Awaited<ReturnType<PaystackService['initializeTransaction']>>;
    try {
      data = await this.paystack.initializeTransaction({
        email: workspace.owner.email,
        amount: plan.amountPesewas,
        currency: omitCurrency ? undefined : chargeCurrency,
        reference,
        callback_url: callbackUrl,
        metadata: {
          workspaceId: workspace.id,
          planId: plan.id,
          templateType: workspace.templateType,
        },
      });
    } catch (error: any) {
      // Keep provider failure details in server logs and return a clean API error.
      this.logger.error(
        `Paystack init failed for workspace=${workspace.id} reference=${reference}: ${error?.message || error}`,
      );
      throw new BadGatewayException(this.extractPaystackMessage(error));
    }

    return {
      ok: true,
      reference,
      authorizationUrl: data.authorization_url,
      accessCode: data.access_code,
    };
  }

  private extractPaystackMessage(error: any): string {
    const fallback = 'Unable to initialize Paystack payment right now';
    const raw = String(error?.message || '');

    if (!raw) return fallback;

    if (!raw.includes('Paystack init failed:')) return raw;

    const payload = raw.replace('Paystack init failed:', '').trim();
    try {
      const parsed = JSON.parse(payload) as { message?: string };
      return parsed.message || fallback;
    } catch {
      return fallback;
    }
  }

  /**
   * DEV/Local flow: create a payment reference without calling Paystack.
   * Use this until you have real Paystack keys.
   */
  async initMockPayment(dto: { workspaceId: string; planId: string }) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: dto.workspaceId },
      include: { owner: true },
    });

    if (!workspace) throw new BadRequestException('Workspace not found');
    if (!workspace.owner?.email) throw new BadRequestException('Owner email missing');

    if (workspace.status !== WorkspaceStatus.PENDING_PAYMENT) {
      throw new BadRequestException(
        `Workspace status must be PENDING_PAYMENT, got ${workspace.status}`,
      );
    }

    const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId } });
    if (!plan || !plan.isActive) throw new BadRequestException('Plan not found or inactive');

    const reference = `mock_${randomUUID()}`;

    await this.prisma.payment.create({
      data: {
        workspaceId: workspace.id,
        planId: plan.id,
        provider: BillingProvider.PAYSTACK,
        reference,
        amountPesewas: plan.amountPesewas,
        currency: plan.currency,
        status: PaymentStatus.PENDING,
      },
    });

    return {
      ok: true,
      mode: 'MOCK',
      reference,
      next: 'CONFIRM',
      message:
        'Mock payment created. Call POST /api/billing/mock/confirm with the reference to mark as PAID.',
    };
  }

  /**
   * DEV/Local flow: confirm a mock payment reference and activate workspace.
   */
  async confirmMockPayment(dto: { reference: string }) {
    const reference = dto.reference?.trim();
    if (!reference) throw new BadRequestException('reference is required');

    const payment = await this.prisma.payment.findUnique({ where: { reference } });
    if (!payment) throw new BadRequestException('Payment not found');

    if (payment.status === PaymentStatus.PAID) {
      return { ok: true, alreadyProcessed: true, reference };
    }

    const paidAt = new Date();

    await this.finalizeSuccessfulPayment({
      reference,
      txnId: null,
      paidAt,
      rawEvent: {
        event: 'mock.charge.success',
        data: { reference },
      },
    });

    const ws = await this.prisma.workspace.findUnique({ where: { id: payment.workspaceId } });

    return {
      ok: true,
      processed: true,
      next: 'ACCESS',
      reference,
      workspaceId: payment.workspaceId,
      status: ws?.status,
    };
  }

  private async finalizeSuccessfulPayment(args: {
    reference: string;
    txnId: string | null;
    paidAt: Date;
    rawEvent: any;
  }) {
    const { reference, txnId, paidAt, rawEvent } = args;

    const payment = await this.prisma.payment.findUnique({ where: { reference } });
    if (!payment) return;

    // idempotent
    if (payment.status === PaymentStatus.PAID) return;

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { reference },
        data: {
          status: PaymentStatus.PAID,
          paidAt,
          providerTxnId: txnId,
          channel: rawEvent?.data?.channel || null,
          rawEvent,
        },
      });

      const plan = payment.planId
        ? await tx.plan.findUnique({ where: { id: payment.planId } })
        : null;

      const now = new Date();
      const end =
        plan?.interval === 'YEARLY'
          ? new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
          : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const currentWs = await tx.workspace.findUnique({ where: { id: payment.workspaceId } });
      if (!currentWs) throw new NotFoundException('Workspace not found while finalizing payment');
      this.assertBillingTransition(currentWs.billingStatus as BillingStatus, BillingStatus.ACTIVE);

      await tx.workspace.update({
        where: { id: payment.workspaceId },
        data: {
          status: WorkspaceStatus.ACTIVE,
          planName: plan?.name || 'Starter',
          billingStatus: BillingStatus.ACTIVE,
          nextRenewal: end,
        },
      });

      const existingSub = await tx.subscription.findFirst({
        where: { workspaceId: payment.workspaceId },
        orderBy: { createdAt: 'desc' },
      });

      if (existingSub) {
        await tx.subscription.update({
          where: { id: existingSub.id },
          data: {
            status: SubscriptionStatus.ACTIVE,
            planId: payment.planId,
            provider: BillingProvider.PAYSTACK,
            currentPeriodEnd: end,
          },
        });
      } else {
        await tx.subscription.create({
          data: {
            workspaceId: payment.workspaceId,
            status: SubscriptionStatus.ACTIVE,
            planId: payment.planId,
            provider: BillingProvider.PAYSTACK,
            currentPeriodEnd: end,
          },
        });
      }
    });
  }

  /**
   * Verify Paystack webhook signature and process event
   */
  async handlePaystackWebhook(rawBody: Buffer, headers: Record<string, any>, payload: any) {
    const secret = process.env.PAYSTACK_SECRET_KEY || '';
    if (!secret) throw new BadRequestException('PAYSTACK_SECRET_KEY not set');

    const signature = headers['x-paystack-signature'] as string | undefined;
    if (!signature) throw new BadRequestException('Missing x-paystack-signature');

    const hash = createHmac('sha512', secret).update(rawBody).digest('hex');
    if (hash !== signature) throw new BadRequestException('Invalid signature');

    const eventType = payload?.event as string;
    const data = payload?.data || {};
    const reference = data?.reference as string | undefined;
    const txnId = data?.id ? String(data.id) : undefined;

    const eventId = `${eventType}:${reference || 'noref'}:${txnId || 'notxn'}`;

    // store webhook event (dedupe via unique eventId)
    await this.prisma.webhookEvent.upsert({
      where: { eventId },
      update: { payload },
      create: {
        eventId,
        eventType: eventType || 'unknown',
        reference: reference || null,
        payload,
        provider: BillingProvider.PAYSTACK,
      },
    });

    // only handle successful charges for now
    if (eventType === 'charge.success' && reference) {
      const paidAt = data?.paid_at ? new Date(data.paid_at) : new Date();

      await this.finalizeSuccessfulPayment({
        reference,
        txnId: txnId || null,
        paidAt,
        rawEvent: payload,
      });

      return { ok: true, processed: true };
    }

    return { ok: true, received: true };
  }

  async workspaceBillingStatus(workspaceId: string) {
    const ws = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        payments: { orderBy: { createdAt: 'desc' }, take: 1 },
        subscriptions: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    if (!ws) throw new BadRequestException('Workspace not found');

    return {
      workspaceId: ws.id,
      status: ws.status,
      latestPayment: ws.payments[0] || null,
      latestSubscription: ws.subscriptions[0] || null,
    };
  }

  async billingOverview(workspaceId: string) {
    const ws = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        payments: { orderBy: { createdAt: 'desc' }, take: 12 },
        subscriptions: { orderBy: { createdAt: 'desc' }, take: 1, include: { plan: true } },
      },
    });

    if (!ws) throw new NotFoundException('Workspace not found');

    const webhookEvents = await this.prisma.webhookEvent.findMany({
      where: { reference: { in: ws.payments.map((p) => p.reference) } },
      orderBy: { receivedAt: 'desc' },
      take: 20,
    });

    const timeline = [
      ...ws.payments.map((p) => ({
        at: p.createdAt,
        type: 'PAYMENT',
        label: `Payment ${p.status}`,
        ref: p.reference,
      })),
      ...webhookEvents.map((e) => ({
        at: e.receivedAt,
        type: 'WEBHOOK',
        label: e.eventType,
        ref: e.reference,
      })),
    ].sort((a, b) => +new Date(b.at) - +new Date(a.at));

    return {
      workspaceId: ws.id,
      workspaceStatus: ws.status,
      billingStatus: ws.billingStatus,
      nextRenewal: ws.nextRenewal,
      planName: ws.planName,
      latestSubscription: ws.subscriptions[0] || null,
      payments: ws.payments,
      timeline,
    };
  }

  async changeWorkspacePlan(workspaceId: string, planId: string) {
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!ws) throw new NotFoundException('Workspace not found');

    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan || !plan.isActive) throw new BadRequestException('Plan not found or inactive');

    this.assertBillingTransition(ws.billingStatus as BillingStatus, BillingStatus.ACTIVE);

    await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        planName: plan.name,
        billingStatus: BillingStatus.ACTIVE,
      },
    });

    const currentSub = await this.prisma.subscription.findFirst({ where: { workspaceId } });
    const periodEnd = new Date(Date.now() + (plan.interval === 'YEARLY' ? 365 : 30) * 24 * 60 * 60 * 1000);

    if (currentSub) {
      await this.prisma.subscription.update({
        where: { id: currentSub.id },
        data: { planId: plan.id, status: SubscriptionStatus.ACTIVE, currentPeriodEnd: periodEnd },
      });
    } else {
      await this.prisma.subscription.create({
        data: {
          workspaceId,
          planId: plan.id,
          provider: BillingProvider.PAYSTACK,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: periodEnd,
        },
      });
    }

    await this.prisma.auditLog.create({
      data: {
        workspaceId,
        action: 'billing.plan_changed',
        meta: { planId: plan.id, planName: plan.name },
      },
    });

    return { ok: true, workspaceId, planName: plan.name };
  }

  async retryLatestPayment(workspaceId: string) {
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!ws) throw new NotFoundException('Workspace not found');

    const latest = await this.prisma.payment.findFirst({ where: { workspaceId }, orderBy: { createdAt: 'desc' } });
    if (!latest) throw new BadRequestException('No payment found to retry');

    if (latest.status === PaymentStatus.PAID) {
      return { ok: true, message: 'Latest payment already paid', reference: latest.reference };
    }

    await this.prisma.payment.update({ where: { id: latest.id }, data: { status: PaymentStatus.PENDING } });
    this.assertBillingTransition(ws.billingStatus as BillingStatus, BillingStatus.PAST_DUE);
    await this.prisma.workspace.update({ where: { id: workspaceId }, data: { billingStatus: BillingStatus.PAST_DUE } });

    await this.prisma.auditLog.create({
      data: {
        workspaceId,
        action: 'billing.retry_requested',
        meta: { reference: latest.reference },
      },
    });

    return { ok: true, reference: latest.reference, status: PaymentStatus.PENDING };
  }

  async setBillingStatus(workspaceId: string, to: BillingStatus) {
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!ws) throw new NotFoundException('Workspace not found');

    this.assertBillingTransition(ws.billingStatus as BillingStatus, to);

    const workspaceStatus =
      to === BillingStatus.SUSPENDED || to === BillingStatus.CANCELLED
        ? WorkspaceStatus.SUSPENDED
        : WorkspaceStatus.ACTIVE;

    await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        billingStatus: to,
        status: workspaceStatus,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        workspaceId,
        action: 'billing.status_changed',
        meta: { from: ws.billingStatus, to },
      },
    });

    return { ok: true, billingStatus: to, workspaceStatus };
  }

  async runDunningSweep() {
    const now = new Date();
    const overdueCutoff = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const suspendCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const pendingPayments = await this.prisma.payment.findMany({
      where: { status: PaymentStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });

    let pastDue = 0;
    let suspended = 0;

    for (const p of pendingPayments) {
      const ws = await this.prisma.workspace.findUnique({ where: { id: p.workspaceId } });
      if (!ws) continue;

      if (p.createdAt <= suspendCutoff && ws.billingStatus !== BillingStatus.SUSPENDED) {
        try {
          this.assertBillingTransition(ws.billingStatus as BillingStatus, BillingStatus.SUSPENDED);
          await this.setBillingStatus(ws.id, BillingStatus.SUSPENDED);
          suspended += 1;
        } catch {
          // skip invalid transitions
        }
        continue;
      }

      if (p.createdAt <= overdueCutoff && ws.billingStatus === BillingStatus.ACTIVE) {
        try {
          this.assertBillingTransition(ws.billingStatus as BillingStatus, BillingStatus.PAST_DUE);
          await this.setBillingStatus(ws.id, BillingStatus.PAST_DUE);
          pastDue += 1;
        } catch {
          // skip invalid transitions
        }
      }
    }

    return { ok: true, scanned: pendingPayments.length, movedToPastDue: pastDue, movedToSuspended: suspended };
  }
}

