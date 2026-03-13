import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';

import { AuthService } from '../../src/auth/auth.service';
import { AuthGuard } from '../../src/auth/auth.guard';
import { WorkspaceAccessGuard } from '../../src/auth/workspace-access.guard';
import { BillingController } from '../../src/billing/billing.controller';
import { BillingService } from '../../src/billing/billing.service';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('BillingController admin auth (e2e)', () => {
  const envSnapshot = { ...process.env };

  let moduleFixture: TestingModule;
  let controller: BillingController;
  let billing: any;

  beforeEach(async () => {
    process.env = { ...envSnapshot, BILLING_ADMIN_KEY: 'expected-admin-key' };

    billing = {
      listTemplatePlans: jest.fn().mockResolvedValue([{ templateType: 'APARTMENT', planName: 'Starter' }]),
      updateTemplatePlanPrice: jest.fn().mockResolvedValue({ ok: true }),
      runDunningSweep: jest.fn().mockResolvedValue({ scanned: 10, movedToPastDue: 1, movedToSuspended: 0 }),
      reconcileAllWorkspaces: jest.fn().mockResolvedValue({ ok: true, processed: 2 }),
      listPlans: jest.fn(),
      initPaystackPayment: jest.fn(),
      initMockPayment: jest.fn(),
      confirmMockPayment: jest.fn(),
      handlePaystackWebhook: jest.fn(),
      workspaceBillingStatus: jest.fn(),
      billingOverview: jest.fn(),
      changeWorkspacePlan: jest.fn(),
      retryLatestPayment: jest.fn(),
      setBillingStatus: jest.fn(),
      listFailedWebhookEvents: jest.fn(),
      replayFailedWebhook: jest.fn(),
      reconcileWorkspaceBilling: jest.fn(),
      health: jest.fn(),
    };

    moduleFixture = await Test.createTestingModule({
      controllers: [BillingController],
      providers: [
        { provide: BillingService, useValue: billing },
        AuthGuard,
        WorkspaceAccessGuard,
        { provide: AuthService, useValue: {} },
        {
          provide: PrismaService,
          useValue: {
            workspace: {
              findUnique: jest.fn(),
              update: jest.fn(),
            },
          },
        },
        Reflector,
      ],
    }).compile();

    controller = moduleFixture.get(BillingController);
  });

  afterEach(async () => {
    if (moduleFixture) await moduleFixture.close();
    process.env = envSnapshot;
  });

  it('rejects billing admin endpoints without the configured admin key', async () => {
    expect(() => controller.adminListTemplatePlans(undefined, undefined)).toThrow(
      UnauthorizedException,
    );
    expect(billing.listTemplatePlans).not.toHaveBeenCalled();
  });

  it('allows billing admin endpoints with the configured admin key', async () => {
    await expect(
      controller.adminListTemplatePlans('expected-admin-key', undefined),
    ).resolves.toEqual([{ templateType: 'APARTMENT', planName: 'Starter' }]);
    expect(billing.listTemplatePlans).toHaveBeenCalled();
  });

  it('protects dunning and reconcile triggers with the same admin key', async () => {
    await expect(controller.runDunning('expected-admin-key')).resolves.toEqual({
      scanned: 10,
      movedToPastDue: 1,
      movedToSuspended: 0,
    });
    await expect(
      controller.runReconcile('expected-admin-key', { limit: 5 }),
    ).resolves.toEqual({ ok: true, processed: 2 });
    expect(billing.runDunningSweep).toHaveBeenCalled();
    expect(billing.reconcileAllWorkspaces).toHaveBeenCalledWith(5);
  });
});
