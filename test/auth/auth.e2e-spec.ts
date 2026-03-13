import { UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { AuthController } from '../../src/auth/auth.controller';
import { AuthService } from '../../src/auth/auth.service';
import { SendLoginOtpDto } from '../../src/auth/dto/send-login-otp.dto';
import { VerifyLoginOtpDto } from '../../src/auth/dto/verify-login-otp.dto';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('AuthController (e2e)', () => {
  const envSnapshot = { ...process.env };
  const validationPipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
  });

  let moduleFixture: TestingModule;
  let controller: AuthController;
  let prisma: any;

  beforeEach(async () => {
    process.env = { ...envSnapshot };
    delete process.env.RESEND_API_KEY;
    process.env.NODE_ENV = 'test';
    process.env.AUTH_TOKEN_SECRET = 'test-auth-secret';

    prisma = {
      user: {
        upsert: jest.fn().mockResolvedValue({ id: 'user-1', email: 'owner@example.com' }),
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ id: 'user-1', email: 'owner@example.com', fullName: 'Owner' })
          .mockResolvedValueOnce({ id: 'user-1', email: 'owner@example.com', fullName: 'Owner' }),
      },
      otpCode: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'otp-1' }),
        update: jest.fn().mockResolvedValue({ id: 'otp-1' }),
      },
      workspaceMember: {
        findMany: jest.fn().mockResolvedValue([
          {
            workspaceId: 'ws-1',
            role: 'OWNER_ADMIN',
            workspace: {
              id: 'ws-1',
              name: 'Main Workspace',
              templateType: 'APARTMENT',
              status: 'ACTIVE',
              planName: 'Starter',
              permissionPolicy: null,
            },
          },
        ]),
      },
    };

    moduleFixture = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [AuthService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    controller = moduleFixture.get(AuthController);
  });

  afterEach(async () => {
    await moduleFixture.close();
    process.env = envSnapshot;
  });

  it('validates login OTP request bodies', async () => {
    await expect(
      validationPipe.transform({ email: 'not-an-email' }, { type: 'body', metatype: SendLoginOtpDto }),
    ).rejects.toBeInstanceOf(Error);
  });

  it('sends and verifies a login OTP through the controller + service stack', async () => {
    const sendDto = (await validationPipe.transform(
      { email: 'owner@example.com' },
      { type: 'body', metatype: SendLoginOtpDto },
    )) as SendLoginOtpDto;
    const sendBody = (await controller.sendLoginOtp(sendDto)) as { devOtp?: string; ok?: boolean };

    expect(sendBody.ok).toBe(true);
    expect(sendBody.devOtp).toMatch(/^\d{6}$/);

    const authService = moduleFixture.get(AuthService);
    prisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      codeHash: (authService as any).hashOtp(sendBody.devOtp),
      createdAt: new Date(),
    });

    const verifyDto = (await validationPipe.transform(
      { email: 'owner@example.com', code: sendBody.devOtp },
      { type: 'body', metatype: VerifyLoginOtpDto },
    )) as VerifyLoginOtpDto;
    const verifyBody = (await controller.verifyLoginOtp(verifyDto)) as { ok?: boolean; token?: string };

    expect(verifyBody.ok).toBe(true);
    expect(verifyBody.token).toContain('.');
  });

  it('rejects /auth/me without a bearer token', async () => {
    await expect(controller.me(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
