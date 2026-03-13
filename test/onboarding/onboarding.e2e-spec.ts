import { Test, TestingModule } from '@nestjs/testing';
import { TemplateType, WorkspaceStatus } from '@prisma/client';
import { ValidationPipe } from '@nestjs/common';

import { AuthService } from '../../src/auth/auth.service';
import { OnboardingController } from '../../src/onboarding/onboarding.controller';
import { OnboardingService } from '../../src/onboarding/onboarding.service';
import { CreateWorkspaceDto } from '../../src/onboarding/dto/create-workspace.dto';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('OnboardingController (e2e)', () => {
  const envSnapshot = { ...process.env };
  const validationPipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
  });

  let moduleFixture: TestingModule;
  let controller: OnboardingController;
  let prisma: any;
  let tx: any;

  beforeEach(async () => {
    process.env = { ...envSnapshot };
    delete process.env.RESEND_API_KEY;
    process.env.NODE_ENV = 'test';

    tx = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
      otpCode: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'otp-1' }),
      },
    };

    prisma = {
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

    moduleFixture = await Test.createTestingModule({
      controllers: [OnboardingController],
      providers: [
        OnboardingService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuthService, useValue: {} },
      ],
    }).compile();

    controller = moduleFixture.get(OnboardingController);
  });

  afterEach(async () => {
    await moduleFixture.close();
    process.env = envSnapshot;
  });

  it('creates a workspace through the onboarding controller', async () => {
    const dto = (await validationPipe.transform(
      {
        workspaceName: 'Main Property',
        ownerFullName: 'Owner',
        ownerEmail: 'owner@example.com',
        templateType: 'APARTMENT',
      },
      { type: 'body', metatype: CreateWorkspaceDto },
    )) as CreateWorkspaceDto;

    await expect(controller.createWorkspace(dto)).resolves.toEqual({
      workspaceId: 'ws-1',
      status: WorkspaceStatus.PENDING_OTP,
      templateType: TemplateType.APARTMENT,
      ownerUserId: 'user-1',
      ownerMemberId: 'member-1',
    });
  });

  it('sends an owner OTP through the onboarding controller', async () => {
    const body = (await controller.sendOtp({
      workspaceId: 'ws-1',
      email: 'owner@example.com',
    })) as { ok?: boolean; devOtp?: string };

    expect(body.ok).toBe(true);
    expect(body.devOtp).toMatch(/^\d{6}$/);
    expect(tx.otpCode.create).toHaveBeenCalled();
  });
});
