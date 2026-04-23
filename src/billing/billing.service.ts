import { BadGatewayException, BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  BillingProvider,
  BillingStatus,
  PaymentStatus,
  PlanInterval,
  SubscriptionStatus,
  TemplateType,
  WorkspaceStatus,
} from '@prisma/client';
import { createHmac, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PaystackService } from './paystack.service';
import { getPaystackConfig } from './paystack.config';

@Injectable()
export class BillingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BillingService.name);
  private dunningTimer: NodeJS.Timeout | null = null;

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

  onModuleInit() {
    const mins = Number(process.env.BILLING_DUNNING_INTERVAL_MIN || 0);
    if (!mins || mins < 1) return;

    this.logger.log(`Billing dunning scheduler enabled: every ${mins} minute(s)`);
    this.dunningTimer = setInterval(async () => {
      try {
        const result = await this.runDunningSweep();
        this.logger.log(`Dunning sweep: scanned=${result.scanned} pastDue=${result.movedToPastDue} suspended=${result.movedToSuspended}`);
      } catch (e: any) {
        this.logger.error(`Dunning sweep failed: ${e?.message || e}`);
      }
    }, mins * 60 * 1000);
  }

  onModuleDestroy() {
    if (this.dunningTimer) clearInterval(this.dunningTimer);
    this.dunningTimer = null;
  }

  async listPlansForRequest(templateType?: TemplateType, workspaceId?: string) {
    // When workspaceId is provided, always resolve templateType from the DB —
    // this is the source of truth and overrides any stale param from the client.
    if (workspaceId) {
      const ws = await this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { templateType: true },
      });
      if (ws?.templateType) templateType = ws.templateType;
    }
    return this.listPlans(templateType);
  }

  async listPlans(templateType?: TemplateType) {
    const normalizePlanKey = (raw?: string) =>
      String(raw || '')
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, '');

    const templateCopy: Record<TemplateType, Record<string, { summary: string; priceText: string; bullets: string[]; amountPesewas: number }>> = {
      APARTMENT: {
        starter: {
          summary: 'For small apartment buildings',
          priceText: 'GH₵ 99 / month',
          bullets: ['1 building', 'Up to 20 units', 'Requests + residents management'],
          amountPesewas: 9900,
        },
        growth: {
          summary: 'For growing apartments',
          priceText: 'GH₵ 199 / month',
          bullets: ['Up to 3 blocks/properties', 'Up to 120 units', 'Staff + basic reports'],
          amountPesewas: 19900,
        },
        tomaprime: {
          summary: 'For large apartment operations',
          priceText: 'GH₵ 399 / month',
          bullets: ['Up to 5 properties', 'Up to 250 units', 'Advanced reports + exports'],
          amountPesewas: 39900,
        },
      },
      ESTATE: {
        starter: {
          summary: 'For small residential estate operations',
          priceText: 'GH₵ 199 / month',
          bullets: ['Up to 2 properties', 'Up to 60 units', 'Core requests + occupancy tracking'],
          amountPesewas: 19900,
        },
        growth: {
          summary: 'For growing multi-property residential estates',
          priceText: 'GH₵ 349 / month',
          bullets: ['Up to 6 properties', 'Up to 220 units', 'Managers per property + reports'],
          amountPesewas: 34900,
        },
        tomaprime: {
          summary: 'For premium estate operations at scale',
          priceText: 'GH₵ 699 / month',
          bullets: ['Up to 15 properties', 'Up to 600 units', 'Advanced analytics + priority support'],
          amountPesewas: 69900,
        },
      },
      OFFICE: {
        starter: {
          summary: 'For essential office operations',
          priceText: 'GH₵ 199 / month',
          bullets: [
            'Up to 10 areas',
            'Up to 25 assets',
            '1 manager seat',
            'Requests, work orders, notices, inspections, and office community',
          ],
          amountPesewas: 19900,
        },
        growth: {
          summary: 'For teams that need accountability and speed',
          priceText: 'GH₵ 349 / month',
          bullets: [
            'Up to 35 areas',
            'Up to 150 assets',
            'Up to 3 manager seats',
            'PM schedules, request types, leaderboard, QR/public requests, exports',
          ],
          amountPesewas: 34900,
        },
        tomaprime: {
          summary: 'For large office operations with premium controls',
          priceText: 'GH₵ 699 / month',
          bullets: [
            'Up to 120 areas',
            'Up to 500 assets',
            'Up to 10 manager seats',
            'Integrations, advanced reports, and priority support',
          ],
          amountPesewas: 69900,
        },
      },
    };

    const templates = await this.prisma.template.findMany({
      where: templateType ? { key: templateType } : { isActive: true },
      select: { id: true, key: true },
    });

    if (!templates.length) return [];

    // Auto-bootstrap per-template plans if missing
    for (const t of templates) {
      const defaults =
        t.key === 'APARTMENT'
          ? [
              { name: 'Starter', amountPesewas: 9900 },
              { name: 'Growth', amountPesewas: 19900 },
              { name: 'Toma Prime', amountPesewas: 39900 },
            ]
          : t.key === 'ESTATE'
            ? [
                { name: 'Starter', amountPesewas: 19900 },
                { name: 'Growth', amountPesewas: 34900 },
                { name: 'Toma Prime', amountPesewas: 69900 },
              ]
            : [
                { name: 'Starter', amountPesewas: 19900 },
                { name: 'Growth', amountPesewas: 34900 },
                { name: 'Toma Prime', amountPesewas: 69900 },
              ];

      const legacyDefaults =
        t.key === 'OFFICE'
          ? new Map<string, number[]>([
              ['Starter', [9900, 14900]],
              ['Growth', [19900]],
              ['Toma Prime', [39900]],
            ])
          : null;

      for (const p of defaults) {
        const existing = await this.prisma.plan.findUnique({
          where: { templateId_name_interval: { templateId: t.id, name: p.name, interval: PlanInterval.MONTHLY } },
        });

        if (existing && legacyDefaults?.get(p.name)?.includes(existing.amountPesewas)) {
          await this.prisma.plan.update({
            where: { id: existing.id },
            data: { amountPesewas: p.amountPesewas, currency: 'GHS', isActive: true },
          });
          continue;
        }

        if (existing) continue;

        await this.prisma.plan.upsert({
          where: { templateId_name_interval: { templateId: t.id, name: p.name, interval: PlanInterval.MONTHLY } },
          update: { amountPesewas: p.amountPesewas, currency: 'GHS', isActive: true },
          create: {
            templateId: t.id,
            name: p.name,
            interval: PlanInterval.MONTHLY,
            amountPesewas: p.amountPesewas,
            currency: 'GHS',
            isActive: true,
          },
        });
      }
    }

    const plans = await this.prisma.plan.findMany({
      where: {
        isActive: true,
        template: templateType ? { key: templateType } : undefined,
      },
      include: { template: { select: { key: true } } },
      orderBy: [{ amountPesewas: 'asc' }],
    });

    return plans.map((p) => {
      const key = normalizePlanKey(p.name);
      const catalog = templateCopy[p.template.key]?.[key] ?? null;

      return {
        ...p,
        amountPesewas: p.amountPesewas > 0 ? p.amountPesewas : catalog?.amountPesewas ?? p.amountPesewas,
        ui: catalog
          ? {
              summary: catalog.summary,
              priceText: catalog.priceText,
              bullets: catalog.bullets,
            }
          : null,
      };
    });
  }

  async initPaystackPayment(dto: { workspaceId: string; planId: string }) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: dto.workspaceId },
      include: { owner: true, template: true },
    });

    if (!workspace) throw new BadRequestException('Workspace not found');
    if (!workspace.owner?.email) throw new BadRequestException('Owner email missing');

    const canStartCheckout =
      workspace.status === WorkspaceStatus.PENDING_PAYMENT || workspace.status === WorkspaceStatus.ACTIVE;

    if (!canStartCheckout) {
      throw new BadRequestException(
        `Workspace status must allow billing checkout, got ${workspace.status}`,
      );
    }

    const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId }, include: { template: true } });
    if (!plan || !plan.isActive) throw new BadRequestException('Plan not found or inactive');

    const workspaceTemplate = workspace.template?.key || workspace.templateType;
    if (plan.template.key !== workspaceTemplate) {
      throw new BadRequestException(`Selected plan does not belong to workspace template ${workspaceTemplate}`);
    }

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

    const frontendBase = process.env.FRONTEND_URL?.trim()?.replace(/\/$/, '');
    const callbackUrl =
      process.env.PAYSTACK_CALLBACK_URL?.trim() ||
      (frontendBase ? `${frontendBase}/onboarding/payment-success` : undefined) ||
      'https://www.tomafix.com/onboarding/payment-success';

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
      include: { owner: true, template: true },
    });

    if (!workspace) throw new BadRequestException('Workspace not found');
    if (!workspace.owner?.email) throw new BadRequestException('Owner email missing');

    if (workspace.status !== WorkspaceStatus.PENDING_PAYMENT) {
      throw new BadRequestException(
        `Workspace status must be PENDING_PAYMENT, got ${workspace.status}`,
      );
    }

    const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId }, include: { template: true } });
    if (!plan || !plan.isActive) throw new BadRequestException('Plan not found or inactive');

    const workspaceTemplate = workspace.template?.key || workspace.templateType;
    if (plan.template.key !== workspaceTemplate) {
      throw new BadRequestException(`Selected plan does not belong to workspace template ${workspaceTemplate}`);
    }

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
      // Renewals and plan switches can succeed while the workspace is already active.
      if (currentWs.billingStatus !== BillingStatus.ACTIVE) {
        this.assertBillingTransition(currentWs.billingStatus as BillingStatus, BillingStatus.ACTIVE);
      }

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
    const { secret } = getPaystackConfig(process.env);

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
    const forensicPayload: any = {
      event: payload,
      meta: {
        signatureVerified: true,
        receivedAt: new Date().toISOString(),
        providerTxnId: txnId || null,
        processed: false,
        attempts: 0,
        lastError: null,
      },
    };

    const existing = await this.prisma.webhookEvent.findUnique({ where: { eventId } });
    const prevAttempts = Number((existing as any)?.payload?.meta?.attempts || 0);
    forensicPayload.meta.attempts = prevAttempts + 1;

    const stored = await this.prisma.webhookEvent.upsert({
      where: { eventId },
      update: { payload: forensicPayload },
      create: {
        eventId,
        eventType: eventType || 'unknown',
        reference: reference || null,
        payload: forensicPayload,
        provider: BillingProvider.PAYSTACK,
      },
    });

    try {
      // only handle successful charges for now
      if (eventType === 'charge.success' && reference) {
        const paidAt = data?.paid_at ? new Date(data.paid_at) : new Date();

        await this.finalizeSuccessfulPayment({
          reference,
          txnId: txnId || null,
          paidAt,
          rawEvent: payload,
        });
      }

      await this.prisma.webhookEvent.update({
        where: { id: stored.id },
        data: {
          payload: {
            ...(stored.payload as any),
            meta: {
              ...((stored.payload as any)?.meta || {}),
              processed: true,
              lastError: null,
            },
          },
        },
      });

      return { ok: true, processed: true };
    } catch (e: any) {
      await this.prisma.webhookEvent.update({
        where: { id: stored.id },
        data: {
          payload: {
            ...(stored.payload as any),
            meta: {
              ...((stored.payload as any)?.meta || {}),
              processed: false,
              lastError: e?.message || 'unknown webhook processing error',
            },
          },
        },
      });
      throw e;
    }
  }

  async workspaceBillingStatus(workspaceId: string) {
    const ws = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        payments: { orderBy: { createdAt: 'desc' }, take: 1 },
        subscriptions: { orderBy: { createdAt: 'desc' }, take: 1, include: { plan: true } },
      },
    });

    if (!ws) throw new BadRequestException('Workspace not found');

    const latestSub = ws.subscriptions[0] || null;

    return {
      workspaceId: ws.id,
      id: ws.id,
      name: ws.name,
      templateType: ws.templateType,
      status: ws.status,
      planName: latestSub?.plan?.name || ws.planName,
      nextRenewal: ws.nextRenewal ?? latestSub?.currentPeriodEnd ?? null,
      latestPayment: ws.payments[0] || null,
      latestSubscription: latestSub,
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
        label: `${e.eventType}${(e as any)?.payload?.meta?.signatureVerified ? ' (verified)' : ''}`,
        ref: e.reference,
      })),
    ].sort((a, b) => +new Date(b.at) - +new Date(a.at));

    const latestPending =
      ws.billingStatus === BillingStatus.ACTIVE
        ? null
        : ws.payments.find((p) => p.status === PaymentStatus.PENDING) || null;

    const dunning = latestPending
      ? {
          pendingReference: latestPending.reference,
          pendingSince: latestPending.createdAt,
          retryRecommendedAt: new Date(latestPending.createdAt.getTime() + 3 * 24 * 60 * 60 * 1000),
          suspendAt: new Date(latestPending.createdAt.getTime() + 7 * 24 * 60 * 60 * 1000),
          ageHours: Math.floor((Date.now() - latestPending.createdAt.getTime()) / (60 * 60 * 1000)),
        }
      : null;

    const latestSubscription = ws.subscriptions[0] || null;

    const GRACE_PERIOD_DAYS = 5;
    const nowMs = Date.now();
    const nextRenewalDate = ws.nextRenewal ?? latestSubscription?.currentPeriodEnd ?? null;
    let billingWarning: { daysLeft: number; gracePeriodEndsAt: Date } | null = null;

    if (nextRenewalDate && ws.status === 'ACTIVE') {
      const renewalMs = new Date(nextRenewalDate).getTime();
      if (renewalMs <= nowMs) {
        const daysOverdue = (nowMs - renewalMs) / (1000 * 60 * 60 * 24);
        if (daysOverdue <= GRACE_PERIOD_DAYS) {
          billingWarning = {
            daysLeft: Math.max(1, Math.ceil(GRACE_PERIOD_DAYS - daysOverdue)),
            gracePeriodEndsAt: new Date(renewalMs + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000),
          };
        }
      }
    }

    return {
      workspaceId: ws.id,
      id: ws.id,
      name: ws.name,
      templateType: ws.templateType,
      workspaceStatus: ws.status,
      billingStatus: ws.billingStatus,
      nextRenewal: nextRenewalDate,
      planName: latestSubscription?.plan?.name || ws.planName,
      latestSubscription,
      payments: ws.payments,
      timeline,
      dunning,
      billingWarning,
    };
  }

  async changeWorkspacePlan(workspaceId: string, planId: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId }, include: { template: true } });
    if (!plan || !plan.isActive) throw new BadRequestException('Plan not found or inactive');

    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, include: { template: true } });
    if (!ws) throw new NotFoundException('Workspace not found');
    const workspaceTemplate = ws.template?.key || ws.templateType;
    if (plan.template.key !== workspaceTemplate) {
      throw new BadRequestException(`Plan does not belong to workspace template ${workspaceTemplate}`);
    }

    await this.prisma.auditLog.create({
      data: {
        workspaceId,
        action: 'billing.plan_switch_checkout_started',
        meta: { planId: plan.id, planName: plan.name },
      },
    });

    const checkout = await this.initPaystackPayment({ workspaceId, planId });

    return {
      workspaceId,
      planId,
      planName: plan.name,
      requiresPayment: true,
      ...checkout,
    };
  }

  async listTemplatePlans(templateType?: TemplateType) {
    return this.listPlans(templateType);
  }

  async updateTemplatePlanPrice(input: {
    templateType: TemplateType;
    planName: string;
    interval?: PlanInterval;
    amountPesewas: number;
    currency?: string;
    isActive?: boolean;
  }) {
    const template = await this.prisma.template.findUnique({ where: { key: input.templateType } });
    if (!template) throw new NotFoundException('Template not found');

    const interval = input.interval ?? PlanInterval.MONTHLY;
    const planName = input.planName.trim();
    if (!planName) throw new BadRequestException('planName is required');
    if (!Number.isFinite(input.amountPesewas) || input.amountPesewas <= 0) {
      throw new BadRequestException('amountPesewas must be a positive number');
    }

    const plan = await this.prisma.plan.upsert({
      where: {
        templateId_name_interval: {
          templateId: template.id,
          name: planName,
          interval,
        },
      },
      update: {
        amountPesewas: Math.round(input.amountPesewas),
        currency: (input.currency || 'GHS').toUpperCase(),
        isActive: input.isActive ?? true,
      },
      create: {
        templateId: template.id,
        name: planName,
        interval,
        amountPesewas: Math.round(input.amountPesewas),
        currency: (input.currency || 'GHS').toUpperCase(),
        isActive: input.isActive ?? true,
      },
      include: { template: { select: { key: true } } },
    });

    return { ok: true, plan };
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

    if (to === BillingStatus.PAST_DUE || to === BillingStatus.SUSPENDED) {
      try {
        const data = {
          workspaceId,
          title: to === BillingStatus.PAST_DUE ? 'Billing past due' : 'Workspace suspended for billing',
          body:
            to === BillingStatus.PAST_DUE
              ? 'Payment is overdue. Retry payment to avoid suspension.'
              : 'Workspace access is limited due to unpaid billing. Reactivate after payment.',
          audience: 'STAFF' as any,
          seenBy: [],
        };

        if (ws.templateType === TemplateType.ESTATE) {
          await this.prisma.estateNotice.create({ data: { ...data, estateId: null } });
        } else if (ws.templateType === TemplateType.OFFICE) {
          await this.prisma.officeNotice.create({ data });
        } else {
          await this.prisma.apartmentNotice.create({ data });
        }
      } catch {
        // notice module may not be enabled for all templates
      }
    }

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

  async health() {
    const webhook = await this.prisma.webhookEvent.findFirst({
      where: { provider: BillingProvider.PAYSTACK },
      orderBy: { receivedAt: 'desc' },
      select: { receivedAt: true },
    });
    const paystack = this.paystack.getConfigSummary();

    return {
      ok: true,
      webhookLastSeenAt: webhook?.receivedAt ?? null,
      paystack,
      callbackUrl: process.env.PAYSTACK_CALLBACK_URL || null,
    };
  }

  async listFailedWebhookEvents(workspaceId?: string) {
    let refs: string[] | undefined;
    if (workspaceId) {
      const payments = await this.prisma.payment.findMany({ where: { workspaceId }, select: { reference: true } });
      refs = payments.map((p) => p.reference);
      if (!refs.length) return [];
    }

    const events = await this.prisma.webhookEvent.findMany({
      where: refs
        ? {
            reference: { in: refs },
          }
        : undefined,
      orderBy: { receivedAt: 'desc' },
      take: 100,
    });

    return events.filter((e: any) => (e?.payload?.meta?.processed === false));
  }

  async reconcileWorkspaceBilling(workspaceId: string) {
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!ws) throw new NotFoundException('Workspace not found');

    const [latestPayment, latestSub] = await Promise.all([
      this.prisma.payment.findFirst({
        where: { workspaceId },
        orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.subscription.findFirst({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
        include: { plan: true },
      }),
    ]);

    let billingStatus = ws.billingStatus;
    let workspaceStatus = ws.status;
    let nextRenewal = ws.nextRenewal;
    let planName = ws.planName;

    if (latestSub?.plan?.name) planName = latestSub.plan.name;
    if (latestSub?.currentPeriodEnd) nextRenewal = latestSub.currentPeriodEnd;

    if (latestPayment?.status === PaymentStatus.PAID) {
      billingStatus = BillingStatus.ACTIVE;
      workspaceStatus = WorkspaceStatus.ACTIVE;
      if (!nextRenewal) {
        const days = latestSub?.plan?.interval === PlanInterval.YEARLY ? 365 : 30;
        nextRenewal = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      }
    } else if (latestPayment?.status === PaymentStatus.PENDING) {
      if (billingStatus === BillingStatus.ACTIVE) billingStatus = BillingStatus.PAST_DUE;
      if (workspaceStatus === WorkspaceStatus.ACTIVE) workspaceStatus = WorkspaceStatus.PENDING_PAYMENT;
    }

    if (nextRenewal && nextRenewal.getTime() <= Date.now()) {
      billingStatus = billingStatus === BillingStatus.CANCELLED ? BillingStatus.CANCELLED : BillingStatus.PAST_DUE;
      workspaceStatus = WorkspaceStatus.PENDING_PAYMENT;
    }

    const updated = await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        billingStatus,
        status: workspaceStatus,
        nextRenewal,
        planName,
      },
      select: { id: true, status: true, billingStatus: true, nextRenewal: true, planName: true },
    });

    return {
      ok: true,
      workspaceId,
      before: {
        status: ws.status,
        billingStatus: ws.billingStatus,
        nextRenewal: ws.nextRenewal,
        planName: ws.planName,
      },
      after: updated,
      latestPayment: latestPayment
        ? { reference: latestPayment.reference, status: latestPayment.status, paidAt: latestPayment.paidAt }
        : null,
      latestSubscription: latestSub
        ? { id: latestSub.id, status: latestSub.status, planName: latestSub.plan?.name, currentPeriodEnd: latestSub.currentPeriodEnd }
        : null,
    };
  }

  async reconcileAllWorkspaces(limit = 200) {
    const rows = await this.prisma.workspace.findMany({
      select: { id: true },
      orderBy: { createdAt: 'desc' },
      take: Math.max(1, Math.min(limit, 2000)),
    });

    let ok = 0;
    let failed = 0;
    const failures: Array<{ workspaceId: string; error: string }> = [];

    for (const row of rows) {
      try {
        await this.reconcileWorkspaceBilling(row.id);
        ok += 1;
      } catch (e: any) {
        failed += 1;
        failures.push({ workspaceId: row.id, error: e?.message || 'Unknown error' });
      }
    }

    return {
      ok: true,
      scanned: rows.length,
      reconciled: ok,
      failed,
      failures: failures.slice(0, 20),
    };
  }

  async replayFailedWebhook(eventId: string) {
    const evt = await this.prisma.webhookEvent.findUnique({ where: { eventId } });
    if (!evt) throw new NotFoundException('Webhook event not found');

    const payload: any = (evt.payload as any)?.event || evt.payload;
    const eventType = payload?.event;
    const data = payload?.data || {};

    if (eventType === 'charge.success' && data?.reference) {
      const paidAt = data?.paid_at ? new Date(data.paid_at) : new Date();
      await this.finalizeSuccessfulPayment({
        reference: data.reference,
        txnId: data?.id ? String(data.id) : null,
        paidAt,
        rawEvent: payload,
      });

      await this.prisma.webhookEvent.update({
        where: { eventId },
        data: {
          payload: {
            ...(evt.payload as any),
            meta: {
              ...((evt.payload as any)?.meta || {}),
              processed: true,
              replayedAt: new Date().toISOString(),
              lastError: null,
            },
          },
        },
      });

      return { ok: true, replayed: true, eventId };
    }

    throw new BadRequestException('Unsupported webhook event type for replay');
  }

  /**
   * Called by the frontend on the payment-success callback page.
   * Verifies the reference directly with Paystack and activates the workspace
   * immediately — no webhook dependency.
   */

  async cancelWorkspaceSubscription(workspaceId: string, actorUserId: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { workspaceId } });
    if (!sub) throw new NotFoundException('Subscription not found');

    await this.prisma.subscription.update({
      where: { workspaceId },
      data: {
        status: SubscriptionStatus.CANCELED,
      },
    });

    const ws = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, name: true, billingStatus: true, nextRenewal: true },
    });

    return { ok: true, workspace: ws, message: 'Subscription cancelled. Access remains until current period ends.' };
  }
  async verifyAndActivatePayment(reference: string) {
    const payment = await this.prisma.payment.findUnique({ where: { reference } });
    if (!payment) throw new NotFoundException('Payment reference not found');

    // Already activated — idempotent
    if (payment.status === PaymentStatus.PAID) {
      const ws = await this.prisma.workspace.findUnique({
        where: { id: payment.workspaceId },
        select: { id: true, status: true, billingStatus: true, name: true, templateType: true },
      });
      return { ok: true, alreadyActivated: true, workspace: ws };
    }

    // Hit Paystack directly to confirm the transaction (retry a few times for eventual consistency)
    let txn: Awaited<ReturnType<PaystackService['verifyTransaction']>> | undefined;
    let lastErr: any;
    for (let i = 0; i < 3; i++) {
      try {
        txn = await this.paystack.verifyTransaction(reference);
        if (txn?.status === 'success') break;
      } catch (err: any) {
        lastErr = err;
      }
      if (i < 2) await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
    }

    // Fallback: if webhook already saw a successful charge, trust that and finalize.
    if (!txn || txn.status !== 'success') {
      const webhookSuccess = await this.prisma.webhookEvent.findFirst({
        where: {
          provider: BillingProvider.PAYSTACK,
          eventType: 'charge.success',
          reference,
        },
        orderBy: { receivedAt: 'desc' },
      });

      if (webhookSuccess) {
        const raw: any = (webhookSuccess as any)?.payload?.event || {};
        const eventAmount = Number(raw?.data?.amount || 0);
        const eventCurrency = String(raw?.data?.currency || '').toUpperCase();
        const expectedCurrency = String(payment.currency || '').toUpperCase();
        if (eventAmount !== Number(payment.amountPesewas) || (expectedCurrency && eventCurrency && eventCurrency !== expectedCurrency)) {
          this.logger.warn(`verifyAndActivate: webhook amount/currency mismatch ref=${reference} expected=${payment.amountPesewas}/${expectedCurrency} got=${eventAmount}/${eventCurrency}`);
          return { ok: false, paystackStatus: 'mismatch', paystackError: 'Payment mismatch detected. Contact support.' };
        }

        await this.finalizeSuccessfulPayment({
          reference,
          txnId: raw?.data?.id ? String(raw.data.id) : null,
          paidAt: raw?.data?.paid_at ? new Date(raw.data.paid_at) : new Date(),
          rawEvent: raw,
        });
      } else {
        const errMsg = lastErr?.message || String(lastErr || '');
        this.logger.warn(`verifyAndActivate: Paystack verify retry exhausted ref=${reference}: ${errMsg}`);
        return {
          ok: false,
          paystackStatus: txn?.status ?? 'unknown',
          paystackError: errMsg || undefined,
        };
      }
    } else {
      const txnAmount = Number(txn?.amount || 0);
      const txnCurrency = String(txn?.currency || '').toUpperCase();
      const expectedCurrency = String(payment.currency || '').toUpperCase();

      if (txnAmount !== Number(payment.amountPesewas) || (expectedCurrency && txnCurrency && txnCurrency !== expectedCurrency)) {
        this.logger.warn(`verifyAndActivate: verify amount/currency mismatch ref=${reference} expected=${payment.amountPesewas}/${expectedCurrency} got=${txnAmount}/${txnCurrency}`);
        return { ok: false, paystackStatus: 'mismatch', paystackError: 'Payment mismatch detected. Contact support.' };
      }

      await this.finalizeSuccessfulPayment({
        reference,
        txnId: txn?.reference || null,
        paidAt: txn?.paid_at ? new Date(txn.paid_at) : new Date(),
        rawEvent: { data: txn },
      });
    }

    const ws = await this.prisma.workspace.findUnique({
      where: { id: payment.workspaceId },
      select: { id: true, status: true, billingStatus: true, name: true, templateType: true },
    });

    this.logger.log(`verifyAndActivate: workspace ${ws?.id} activated via callback verify (ref=${reference})`);
    return { ok: true, alreadyActivated: false, workspace: ws };
  }
}
