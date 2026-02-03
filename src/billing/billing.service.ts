import { BadRequestException, Injectable } from '@nestjs/common';
import {
  BillingProvider,
  PaymentStatus,
  SubscriptionStatus,
  WorkspaceStatus,
} from '@prisma/client';
import { createHmac, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PaystackService } from './paystack.service';

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackService,
  ) {}

  async listPlans() {
    return this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: [{ interval: 'asc' }, { amountPesewas: 'asc' }],
    });
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

    // create payment row first
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

    const callbackUrl = process.env.PAYSTACK_CALLBACK_URL;

    const data = await this.paystack.initializeTransaction({
      email: workspace.owner.email,
      amount: plan.amountPesewas,
      currency: plan.currency,
      reference,
      callback_url: callbackUrl,
      metadata: {
        workspaceId: workspace.id,
        planId: plan.id,
        templateType: workspace.templateType,
      },
    });

    return {
      ok: true,
      reference,
      authorizationUrl: data.authorization_url,
      accessCode: data.access_code,
    };
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

      await tx.workspace.update({
        where: { id: payment.workspaceId },
        data: { status: WorkspaceStatus.ACTIVE },
      });

      const plan = payment.planId
        ? await tx.plan.findUnique({ where: { id: payment.planId } })
        : null;

      const now = new Date();
      const end =
        plan?.interval === 'YEARLY'
          ? new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
          : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

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
}