import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../../src/auth/auth.service';

describe('AuthService', () => {
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    process.env = { ...envSnapshot };
    delete process.env.RESEND_API_KEY;
    process.env.NODE_ENV = 'test';
  });

  afterAll(() => {
    process.env = envSnapshot;
  });

  it('returns a dev OTP when login OTP is requested without Resend configured', async () => {
    const prisma: any = {
      user: {
        upsert: jest.fn().mockResolvedValue({ id: 'user-1', email: 'owner@example.com' }),
      },
      otpCode: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'otp-1' }),
      },
    };

    const service = new AuthService(prisma);
    const result = await service.sendLoginOtp('Owner@Example.com');

    expect(result.ok).toBe(true);
    expect(result.devOtp).toMatch(/^\d{6}$/);
    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: 'owner@example.com' },
      }),
    );
    expect(prisma.otpCode.create).toHaveBeenCalled();
  });

  it('verifies a valid login OTP and returns a session token', async () => {
    const prisma: any = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ id: 'user-1', email: 'owner@example.com', fullName: 'Owner' })
          .mockResolvedValueOnce({ id: 'user-1', email: 'owner@example.com', fullName: 'Owner' }),
      },
      otpCode: {
        findFirst: jest.fn(),
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

    const service = new AuthService(prisma);
    const codeHash = (service as any).hashOtp('123456');
    prisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      codeHash,
      createdAt: new Date(),
    });

    const result = await service.verifyLoginOtp('owner@example.com', '123456');

    expect(result.ok).toBe(true);
    expect(result.token).toContain('.');
    expect(result.defaultWorkspaceId).toBe('ws-1');
    expect(prisma.otpCode.update).toHaveBeenCalledWith({
      where: { id: 'otp-1' },
      data: { consumedAt: expect.any(Date) },
    });
  });

  it('rejects a token with a bad signature', () => {
    const service = new AuthService({} as any);
    expect(() => service.verifyBearerToken('Bearer bad.token')).toThrow(UnauthorizedException);
  });
});
