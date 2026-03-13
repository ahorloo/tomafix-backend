import { TemplateType, WorkspaceStatus } from '@prisma/client';
import { OnboardingService } from '../../src/onboarding/onboarding.service';

describe('OnboardingService', () => {
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    process.env = { ...envSnapshot };
    delete process.env.RESEND_API_KEY;
    process.env.NODE_ENV = 'test';
    delete process.env.LOCAL_BYPASS_PAYMENT;
    delete process.env.PAYSTACK_MODE;
    delete process.env.PAYSTACK_SECRET_KEY;
    delete process.env.PAYSTACK_PUBLIC_KEY;
  });

  afterAll(() => {
    process.env = envSnapshot;
  });

  it('creates a workspace in pending OTP state', async () => {
    const prisma: any = {
      user: {
        upsert: jest.fn().mockResolvedValue({ id: 'user-1', email: 'owner@example.com' }),
      },
      template: {
        upsert: jest.fn().mockResolvedValue({ id: 'tpl-1' }),
      },
      workspace: {
        create: jest.fn().mockResolvedValue({
          id: 'ws-1',
          status: WorkspaceStatus.PENDING_OTP,
          templateType: TemplateType.APARTMENT,
          members: [{ id: 'member-1' }],
          template: { id: 'tpl-1' },
        }),
      },
    };

    const service = new OnboardingService(prisma, {} as any);
    const result = await service.createWorkspace({
      workspaceName: 'Main Property',
      ownerFullName: 'Owner',
      ownerEmail: 'owner@example.com',
      templateType: TemplateType.APARTMENT,
    });

    expect(result).toEqual({
      workspaceId: 'ws-1',
      status: WorkspaceStatus.PENDING_OTP,
      templateType: TemplateType.APARTMENT,
      ownerUserId: 'user-1',
      ownerMemberId: 'member-1',
    });
  });

  it('sends an owner OTP and exposes devOtp when email delivery is disabled', async () => {
    const tx = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
      otpCode: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'otp-1' }),
      },
    };
    const prisma: any = {
      workspace: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ws-1',
          ownerUserId: 'user-1',
          owner: { email: 'owner@example.com' },
          status: WorkspaceStatus.PENDING_OTP,
        }),
      },
      otpCode: {
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
    };

    const service = new OnboardingService(prisma, {} as any);
    const result = await service.sendOwnerEmailOtp('ws-1', 'owner@example.com');

    expect(result.ok).toBe(true);
    expect(result.devOtp).toMatch(/^\d{6}$/);
    expect(tx.otpCode.create).toHaveBeenCalled();
  });

  it('verifies an owner OTP and activates the workspace when local payment bypass is enabled', async () => {
    process.env.LOCAL_BYPASS_PAYMENT = 'true';

    const prisma: any = {
      workspace: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ws-1',
          ownerUserId: 'user-1',
          owner: { email: 'owner@example.com' },
          status: WorkspaceStatus.PENDING_OTP,
        }),
        update: jest.fn().mockReturnValue({ id: 'ws-1' }),
      },
      otpCode: {
        findFirst: jest.fn(),
        update: jest.fn().mockReturnValue({ id: 'otp-1' }),
      },
      user: {
        update: jest.fn().mockReturnValue({ id: 'user-1' }),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };

    const service = new OnboardingService(prisma, {} as any);
    const codeHash = (service as any).hashOtp('123456');
    prisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      codeHash,
      createdAt: new Date(),
    });

    const result = await service.verifyOwnerEmailOtp('ws-1', 'owner@example.com', '123456');

    expect(result).toEqual({
      ok: true,
      next: 'APP',
      workspaceId: 'ws-1',
      status: WorkspaceStatus.ACTIVE,
    });
    expect(prisma.workspace.update).toHaveBeenCalledWith({
      where: { id: 'ws-1' },
      data: expect.objectContaining({
        status: WorkspaceStatus.ACTIVE,
        billingStatus: 'ACTIVE',
      }),
    });
  });

  it('keeps the workspace pending payment when Paystack test mode is configured locally', async () => {
    process.env.LOCAL_BYPASS_PAYMENT = 'true';
    process.env.PAYSTACK_MODE = 'test';
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_configured';

    const prisma: any = {
      workspace: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ws-1',
          ownerUserId: 'user-1',
          owner: { email: 'owner@example.com' },
          status: WorkspaceStatus.PENDING_OTP,
        }),
        update: jest.fn().mockReturnValue({ id: 'ws-1' }),
      },
      otpCode: {
        findFirst: jest.fn(),
        update: jest.fn().mockReturnValue({ id: 'otp-1' }),
      },
      user: {
        update: jest.fn().mockReturnValue({ id: 'user-1' }),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };

    const service = new OnboardingService(prisma, {} as any);
    const codeHash = (service as any).hashOtp('123456');
    prisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      codeHash,
      createdAt: new Date(),
    });

    const result = await service.verifyOwnerEmailOtp('ws-1', 'owner@example.com', '123456');

    expect(result).toEqual({
      ok: true,
      next: 'PAYMENT',
      workspaceId: 'ws-1',
      status: WorkspaceStatus.PENDING_PAYMENT,
    });
    expect(prisma.workspace.update).toHaveBeenCalledWith({
      where: { id: 'ws-1' },
      data: expect.objectContaining({
        status: WorkspaceStatus.PENDING_PAYMENT,
        billingStatus: 'PENDING_PAYMENT',
      }),
    });
  });
});
