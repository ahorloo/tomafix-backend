import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { MemberRole, TemplateType } from '@prisma/client';
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
    expect((result as any).devOtp).toMatch(/^\d{6}$/);
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

  it('creates an office manager when manager capacity is available', async () => {
    const prisma: any = {
      workspace: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ws-office',
          name: 'HQ Office',
          templateType: TemplateType.OFFICE,
          planName: 'Growth',
        }),
      },
      user: {
        upsert: jest.fn().mockResolvedValue({ id: 'user-2', email: 'manager@example.com', fullName: 'Office Manager' }),
      },
      workspaceMember: {
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({
          id: 'member-2',
          role: MemberRole.MANAGER,
          isActive: true,
          user: { id: 'user-2', email: 'manager@example.com', fullName: 'Office Manager' },
        }),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      },
    };

    const service = new AuthService(prisma);
    jest.spyOn(service as any, 'sendEmailWithResend').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'notifyOwnerAdmins').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'actorLabel').mockResolvedValue('Owner Admin');

    const result = await service.createWorkspaceStaff('ws-office', {
      fullName: 'Office Manager',
      email: 'manager@example.com',
      role: MemberRole.MANAGER,
    });

    expect(result.role).toBe(MemberRole.MANAGER);
    expect(prisma.workspaceMember.count).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-office', isActive: true, role: MemberRole.MANAGER },
    });
  });

  it('blocks creating another office manager when the plan limit is reached', async () => {
    const prisma: any = {
      workspace: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ws-office',
          name: 'HQ Office',
          templateType: TemplateType.OFFICE,
          planName: 'Starter',
        }),
      },
      user: {
        upsert: jest.fn().mockResolvedValue({ id: 'user-3', email: 'second-manager@example.com', fullName: 'Second Manager' }),
      },
      workspaceMember: {
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([]),
      },
      auditLog: {
        create: jest.fn(),
      },
    };

    const service = new AuthService(prisma);
    jest.spyOn(service as any, 'notifyOwnerAdmins').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'actorLabel').mockResolvedValue('Owner Admin');

    await expect(
      service.createWorkspaceStaff('ws-office', {
        fullName: 'Second Manager',
        email: 'second-manager@example.com',
        role: MemberRole.MANAGER,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('lets a manager deactivate a staff member and notifies owner admins', async () => {
    const prisma: any = {
      workspace: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ws-office',
          name: 'HQ Office',
          templateType: TemplateType.OFFICE,
          planName: 'Growth',
        }),
      },
      workspaceMember: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'member-staff',
          workspaceId: 'ws-office',
          role: MemberRole.STAFF,
          isActive: true,
          user: { id: 'staff-1', email: 'staff@example.com', fullName: 'Staff User' },
        }),
        update: jest.fn().mockResolvedValue({
          id: 'member-staff',
          role: MemberRole.STAFF,
          isActive: false,
          user: { id: 'staff-1', email: 'staff@example.com', fullName: 'Staff User' },
        }),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-2' }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'manager-1', email: 'manager@example.com', fullName: 'Ops Manager' }),
      },
    };

    const service = new AuthService(prisma);
    const notifySpy = jest.spyOn(service as any, 'notifyOwnerAdmins').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'actorLabel').mockResolvedValue('Ops Manager');

    const result = await service.updateWorkspaceMember(
      'ws-office',
      'member-staff',
      { isActive: false },
      { userId: 'manager-1', role: MemberRole.MANAGER },
    );

    expect(result.isActive).toBe(false);
    expect(notifySpy).toHaveBeenCalled();
  });

  it('blocks a manager from removing another manager', async () => {
    const prisma: any = {
      workspace: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ws-office',
          name: 'HQ Office',
          templateType: TemplateType.OFFICE,
          planName: 'Growth',
        }),
      },
      workspaceMember: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'member-manager',
          workspaceId: 'ws-office',
          role: MemberRole.MANAGER,
          isActive: true,
          user: { id: 'manager-2', email: 'manager2@example.com', fullName: 'Second Manager' },
        }),
      },
    };

    const service = new AuthService(prisma);

    await expect(
      service.updateWorkspaceMember(
        'ws-office',
        'member-manager',
        { isActive: false },
        { userId: 'manager-1', role: MemberRole.MANAGER },
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});
