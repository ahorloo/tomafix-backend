import { BadRequestException } from '@nestjs/common';
import { BillingStatus, PaymentStatus, PlanInterval, WorkspaceStatus } from '@prisma/client';
import { createHmac } from 'crypto';
import { BillingService } from '../../src/billing/billing.service';

describe('BillingService', () => {
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...envSnapshot,
      NODE_ENV: 'test',
      PAYSTACK_MODE: 'test',
      PAYSTACK_SECRET_KEY: 'sk_test_secret',
    };
  });

  afterAll(() => {
    process.env = envSnapshot;
  });

  it('rejects a webhook with an invalid Paystack signature', async () => {
    const prisma: any = {
      webhookEvent: {},
    };
    const service = new BillingService(prisma, {} as any);

    await expect(
      service.handlePaystackWebhook(
        Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference: 'tf_1' } })),
        { 'x-paystack-signature': 'bad' },
        { event: 'charge.success', data: { reference: 'tf_1' } },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('processes a verified charge.success webhook and activates the workspace', async () => {
    const tx = {
      payment: {
        update: jest.fn().mockResolvedValue({ id: 'pay-1' }),
      },
      plan: {
        findUnique: jest.fn().mockResolvedValue({ id: 'plan-1', name: 'Growth', interval: PlanInterval.MONTHLY }),
      },
      workspace: {
        findUnique: jest.fn().mockResolvedValue({ id: 'ws-1', billingStatus: BillingStatus.PENDING_PAYMENT }),
        update: jest.fn().mockResolvedValue({ id: 'ws-1', status: WorkspaceStatus.ACTIVE }),
      },
      subscription: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'sub-1' }),
      },
    };

    const prisma: any = {
      payment: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'pay-1',
          workspaceId: 'ws-1',
          planId: 'plan-1',
          status: PaymentStatus.PENDING,
        }),
      },
      webhookEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'webhook-1', payload: { meta: {} } }),
        update: jest.fn().mockResolvedValue({ id: 'webhook-1' }),
      },
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
    };

    const payload = {
      event: 'charge.success',
      data: {
        reference: 'tf_123',
        id: 99,
        channel: 'card',
        paid_at: '2026-03-13T00:00:00.000Z',
      },
    };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const signature = createHmac('sha512', process.env.PAYSTACK_SECRET_KEY as string)
      .update(rawBody)
      .digest('hex');

    const service = new BillingService(prisma, {} as any);
    const result = await service.handlePaystackWebhook(rawBody, { 'x-paystack-signature': signature }, payload);

    expect(result).toEqual({ ok: true, processed: true });
    expect(tx.payment.update).toHaveBeenCalledWith({
      where: { reference: 'tf_123' },
      data: expect.objectContaining({
        status: PaymentStatus.PAID,
        providerTxnId: '99',
        channel: 'card',
      }),
    });
    expect(tx.workspace.update).toHaveBeenCalledWith({
      where: { id: 'ws-1' },
      data: expect.objectContaining({
        status: WorkspaceStatus.ACTIVE,
        planName: 'Growth',
        billingStatus: BillingStatus.ACTIVE,
      }),
    });
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'webhook-1' },
      data: expect.objectContaining({
        payload: expect.objectContaining({
          meta: expect.objectContaining({
            processed: true,
            lastError: null,
          }),
        }),
      }),
    });
  });

  it('verifies and finalizes a paid plan switch while the workspace is already active', async () => {
    const tx = {
      payment: {
        update: jest.fn().mockResolvedValue({ id: 'pay-1' }),
      },
      plan: {
        findUnique: jest.fn().mockResolvedValue({ id: 'plan-2', name: 'Growth', interval: PlanInterval.MONTHLY }),
      },
      workspace: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ws-1',
          status: WorkspaceStatus.ACTIVE,
          billingStatus: BillingStatus.ACTIVE,
        }),
        update: jest.fn().mockResolvedValue({ id: 'ws-1', status: WorkspaceStatus.ACTIVE }),
      },
      subscription: {
        findFirst: jest.fn().mockResolvedValue({ id: 'sub-1' }),
        update: jest.fn().mockResolvedValue({ id: 'sub-1' }),
      },
    };

    const prisma: any = {
      payment: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'pay-1',
          workspaceId: 'ws-1',
          planId: 'plan-2',
          status: PaymentStatus.PENDING,
          amountPesewas: 19900,
          currency: 'GHS',
        }),
      },
      workspace: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ws-1',
          status: WorkspaceStatus.ACTIVE,
          billingStatus: BillingStatus.ACTIVE,
          name: 'Workspace One',
          templateType: 'APARTMENT',
        }),
      },
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
    };

    const paystack: any = {
      verifyTransaction: jest.fn().mockResolvedValue({
        status: 'success',
        reference: 'tf_switch',
        amount: 19900,
        currency: 'GHS',
        paid_at: '2026-03-17T11:46:00.000Z',
      }),
    };

    const service = new BillingService(prisma, paystack);
    const result = await service.verifyAndActivatePayment('tf_switch');

    expect(result).toEqual({
      ok: true,
      alreadyActivated: false,
      workspace: {
        id: 'ws-1',
        status: WorkspaceStatus.ACTIVE,
        billingStatus: BillingStatus.ACTIVE,
        name: 'Workspace One',
        templateType: 'APARTMENT',
      },
    });
    expect(tx.workspace.update).toHaveBeenCalledWith({
      where: { id: 'ws-1' },
      data: expect.objectContaining({
        status: WorkspaceStatus.ACTIVE,
        billingStatus: BillingStatus.ACTIVE,
        planName: 'Growth',
      }),
    });
    expect(tx.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: expect.objectContaining({
        status: 'ACTIVE',
        planId: 'plan-2',
      }),
    });
  });
});
