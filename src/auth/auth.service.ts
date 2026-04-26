import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { MemberRole, OtpChannel, OtpPurpose, TemplateType } from '@prisma/client';
import { defaultPolicyFor, PermissionPolicy } from './permissions';
import { createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { cacheBust } from '../billing/cache';
import { getEntitlements, resolvePlanName } from '../billing/planConfig';

type TokenPayload = {
  uid: string;
  exp: number;
  iat: number;
};

type WorkspaceActor = {
  userId?: string | null;
  role?: MemberRole | null;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async syncUserPhoneFromResidentRecords(userId: string, emailInput: string) {
    const email = String(emailInput || '').trim().toLowerCase();
    if (!userId || !email) return null;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, phone: true },
    });
    if (!user || user.phone) return user;

    const [estateResident, apartmentResident] = await Promise.all([
      this.prisma.estateResident.findFirst({
        where: { email },
        select: { phone: true },
      }),
      this.prisma.apartmentResident.findFirst({
        where: { email },
        select: { phone: true },
      }),
    ]);

    const phone = String(estateResident?.phone || apartmentResident?.phone || '').trim();
    if (!phone) return user;

    const conflictingUser = await this.prisma.user.findFirst({
      where: {
        phone,
        id: { not: userId },
      },
      select: { id: true },
    });
    if (conflictingUser) return user;

    return this.prisma.user.update({
      where: { id: userId },
      data: { phone },
    });
  }

  async sendLoginOtp(emailInput: string) {
    const email = String(emailInput || '').trim().toLowerCase();
    if (!email) throw new BadRequestException('email is required');

    const user = await this.prisma.user.upsert({
      where: { email },
      update: {},
      create: { email },
    });

    await this.syncUserPhoneFromResidentRecords(user.id, email);

    const latest = await this.prisma.otpCode.findFirst({
      where: {
        userId: user.id,
        purpose: OtpPurpose.LOGIN,
        channel: OtpChannel.EMAIL,
        target: email,
        consumedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (latest) {
      const secondsSince = (Date.now() - latest.createdAt.getTime()) / 1000;
      if (secondsSince < 30) {
        return {
          ok: false,
          message: `Please wait ${Math.max(1, Math.ceil(30 - secondsSince))}s before requesting another code`,
          retryAfterSeconds: Math.max(1, Math.ceil(30 - secondsSince)),
        };
      }
    }

    const code = this.makeOtp();
    const codeHash = this.hashOtp(code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production';

    await this.prisma.otpCode.create({
      data: {
        userId: user.id,
        purpose: OtpPurpose.LOGIN,
        channel: OtpChannel.EMAIL,
        target: email,
        codeHash,
        expiresAt,
      },
    });

    const hasResend = !!process.env.RESEND_API_KEY;
    if (!hasResend) this.logger.warn(`[DEV LOGIN OTP] ${email} -> ${code}`);

    try {
      await this.sendEmailWithResend({
        to: email,
        subject: `Your TomaFix login code: ${code}`,
        html: this.otpEmailHtml(code),
      });
    } catch (err) {
      if (isProd) throw err;
      this.logger.warn(
        `Login OTP email failed in dev; returning code so auth flow stays usable. To: ${email}. Reason: ${(err as Error).message}`,
      );
    }

    return {
      ok: true,
      message: 'OTP sent',
      ...(!hasResend && !isProd ? { devOtp: code } : {}),
      ...(hasResend && !isProd ? { devOtp: code } : {}),
    };
  }

  async verifyLoginOtp(emailInput: string, codeInput: string) {
    const email = String(emailInput || '').trim().toLowerCase();
    const code = String(codeInput || '').trim();
    if (!email || !code) throw new BadRequestException('email and code are required');

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid login');

    await this.syncUserPhoneFromResidentRecords(user.id, email);

    const otp = await this.prisma.otpCode.findFirst({
      where: {
        userId: user.id,
        purpose: OtpPurpose.LOGIN,
        channel: OtpChannel.EMAIL,
        target: email,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) throw new BadRequestException('Invalid or expired code');

    // Burn the OTP after 5 wrong guesses — forces the user to request a new one
    const MAX_ATTEMPTS = 5;
    if (otp.attempts >= MAX_ATTEMPTS) {
      await this.prisma.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
      throw new BadRequestException('Too many incorrect attempts. Please request a new code.');
    }

    const ok = this.verifyOtpHash(code, otp.codeHash);
    if (!ok) {
      await this.prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      const remaining = MAX_ATTEMPTS - (otp.attempts + 1);
      throw new BadRequestException(
        remaining > 0 ? `Invalid code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.` : 'Too many incorrect attempts. Please request a new code.',
      );
    }

    await this.prisma.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });

    const memberships = await this.getMembershipsForUser(user.id);

    const nowSec = Math.floor(Date.now() / 1000);
    const token = this.signToken({ uid: user.id, iat: nowSec, exp: nowSec + 60 * 60 * 24 * 7 });

    return {
      ok: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
      },
      memberships,
      defaultWorkspaceId: memberships[0]?.workspaceId ?? null,
    };
  }

  async createSessionForUser(userId: string, preferredWorkspaceId?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    await this.syncUserPhoneFromResidentRecords(user.id, user.email || '');

    const memberships = await this.getMembershipsForUser(userId);
    const defaultWorkspaceId =
      preferredWorkspaceId && memberships.some((m) => m.workspaceId === preferredWorkspaceId)
        ? preferredWorkspaceId
        : memberships[0]?.workspaceId ?? null;

    const nowSec = Math.floor(Date.now() / 1000);
    const token = this.signToken({ uid: user.id, iat: nowSec, exp: nowSec + 60 * 60 * 24 * 7 });

    return {
      ok: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
      },
      memberships,
      defaultWorkspaceId,
    };
  }

  verifyBearerToken(authHeader?: string) {
    const raw = String(authHeader || '');
    if (!raw.toLowerCase().startsWith('bearer ')) throw new UnauthorizedException('Missing bearer token');
    const token = raw.slice(7).trim();
    const payload = this.verifyToken(token);
    return payload;
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    const memberships = await this.getMembershipsForUser(userId);
    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
      },
      memberships,
    };
  }

  async listWorkspaceMembers(workspaceId: string) {
    return this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, email: true, fullName: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createWorkspaceStaff(
    workspaceId: string,
    dto: { fullName: string; email: string; role?: MemberRole },
    actor?: WorkspaceActor,
  ) {
    const fullName = String(dto.fullName || '').trim();
    const email = String(dto.email || '').trim().toLowerCase();
    if (!fullName) throw new BadRequestException('fullName is required');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Valid email is required');
    }

    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!ws) throw new BadRequestException('Workspace not found');
    const actorRole = actor?.role as MemberRole | undefined;
    const requestedRole =
      dto.role === MemberRole.TECHNICIAN
        ? MemberRole.TECHNICIAN
        : dto.role === MemberRole.MANAGER
          ? MemberRole.MANAGER
          : dto.role === MemberRole.GUARD
          ? MemberRole.GUARD
          : MemberRole.STAFF;

    // Managers can only create Staff, Guard, or Technician accounts, not other Managers.
    if (actorRole === MemberRole.MANAGER && requestedRole === MemberRole.MANAGER) {
      throw new BadRequestException('Managers can only add Staff, Guard, or Technician members.');
    }

    const existingMembership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: (await this.prisma.user.findUnique({ where: { email }, select: { id: true } }))?.id || '' } },
      select: { role: true, isActive: true },
    });

    if (existingMembership?.role === MemberRole.OWNER_ADMIN) {
      throw new BadRequestException('That email already belongs to the workspace owner. Use a different email.');
    }

    if (existingMembership?.role === MemberRole.RESIDENT) {
      throw new BadRequestException(
        'That email already belongs to a resident in this workspace. Use a different email for guard/staff access.',
      );
    }

    const user = await this.prisma.user.upsert({
      where: { email },
      update: { fullName },
      create: { email, fullName },
    });

    const workspaceMembership = existingMembership?.role ? existingMembership : await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: user.id } },
      select: { role: true, isActive: true },
    });

    if (requestedRole === MemberRole.MANAGER && workspaceMembership?.role !== MemberRole.MANAGER) {
      await this.assertManagerCapacity(workspaceId, (ws as any).planName || 'Starter', ws.templateType);
    }

    const member = await this.prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId, userId: user.id } },
      update: { role: requestedRole, isActive: true },
      create: { workspaceId, userId: user.id, role: requestedRole, isActive: true },
      include: { user: { select: { id: true, email: true, fullName: true } } },
    });

    await this.prisma.auditLog.create({
      data: {
        workspaceId,
        actorUserId: actor?.userId ?? null,
        action: 'workspace.member.created',
        meta: {
          email,
          fullName,
          userId: user.id,
          role: requestedRole,
          actorRole: actor?.role ?? null,
        },
      },
    });

    try {
      const appUrl = (process.env.APP_BASE_URL || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
      const roleLabel =
        requestedRole === MemberRole.GUARD
          ? 'Guard'
          : requestedRole === MemberRole.TECHNICIAN
            ? 'Technician'
            : requestedRole === MemberRole.MANAGER
              ? 'Manager'
              : 'Staff';
      await this.sendEmailWithResend({
        to: email,
        subject: `You've been added as ${roleLabel.toLowerCase()} on TomaFix`,
        html: `
          <p>Hi ${fullName || 'there'},</p>
          <p>You have been added as a <strong>${roleLabel}</strong> member for <strong>${ws.name}</strong> on TomaFix.</p>
          <p>Use this email to sign in and verify with OTP:</p>
          <p><a href="${appUrl}/login" target="_blank" rel="noreferrer">Go to login</a></p>
          <p>If this wasn’t expected, ignore this email.</p>
        `,
      });
    } catch (e: any) {
      this.logger.warn(`Staff invite email failed (${email}): ${e?.message || e}`);
    }

    await this.notifyOwnerAdmins(
      workspaceId,
      `Team member added to ${ws.name}`,
      `
        <p>A team member was added to <strong>${ws.name}</strong>.</p>
        <p><strong>${fullName}</strong> (${email}) was added as <strong>${this.roleLabel(requestedRole)}</strong>.</p>
        <p>Added by: <strong>${await this.actorLabel(actor?.userId)}</strong></p>
        <p><a href="${this.appUrl()}/app/${workspaceId}/users" target="_blank" rel="noreferrer">Open Users & Roles</a></p>
      `,
    );

    cacheBust(`billing:entitlements:${workspaceId}`);
    return member;
  }

  async updateWorkspaceMember(
    workspaceId: string,
    memberId: string,
    dto: { role?: MemberRole; isActive?: boolean },
    actor?: WorkspaceActor,
  ) {
    const [row, ws] = await Promise.all([
      this.prisma.workspaceMember.findFirst({
        where: { id: memberId, workspaceId },
        include: { user: { select: { id: true, email: true, fullName: true } } },
      }),
      this.prisma.workspace.findUnique({ where: { id: workspaceId } }),
    ]);
    if (!row) throw new BadRequestException('Member not found in this workspace');
    if (!ws) throw new BadRequestException('Workspace not found');
    if (row.role === MemberRole.OWNER_ADMIN) {
      throw new ForbiddenException('Owner admins cannot be modified from this page');
    }

    const actorRole = actor?.role ?? null;
    const targetRole = row.role;
    const requestedRoleChange = dto.role !== undefined && dto.role !== row.role;
    const requestedStatusChange = dto.isActive !== undefined && dto.isActive !== row.isActive;

    if (!requestedRoleChange && !requestedStatusChange) {
      return row;
    }

    if (actorRole === MemberRole.MANAGER) {
      if (!(targetRole === MemberRole.STAFF || targetRole === MemberRole.GUARD || targetRole === MemberRole.TECHNICIAN)) {
        throw new ForbiddenException('Managers can only remove or restore staff, guards, and technicians');
      }
      if (requestedRoleChange) {
        throw new ForbiddenException('Managers cannot change roles. They can only remove or restore staff, guards, and technicians');
      }
      if (!requestedStatusChange) {
        throw new ForbiddenException('Managers can only remove or restore staff, guards, and technicians');
      }
    }

    const nextRole = dto.role ?? row.role;
    if (nextRole === MemberRole.MANAGER && row.role !== MemberRole.MANAGER) {
      await this.assertManagerCapacity(workspaceId, (ws as any).planName || 'Starter', ws.templateType);
    }

    const updated = await this.prisma.workspaceMember.update({
      where: { id: memberId },
      data: {
        role: nextRole ?? undefined,
        isActive: dto.isActive ?? undefined,
      },
      include: { user: { select: { id: true, email: true, fullName: true } } },
    });

    await this.prisma.auditLog.create({
      data: {
        workspaceId,
        actorUserId: actor?.userId ?? null,
        action: 'workspace.member.updated',
        meta: {
          memberId,
          targetUserId: row.user.id,
          before: { role: row.role, isActive: row.isActive },
          after: { role: updated.role, isActive: updated.isActive },
          actorRole,
        },
      },
    });

    if (actorRole === MemberRole.MANAGER && requestedStatusChange) {
      const statusVerb = updated.isActive ? 'restored' : 'removed';
      await this.notifyOwnerAdmins(
        workspaceId,
        `Manager ${statusVerb} a team member in ${ws.name}`,
        `
          <p>A manager updated a team member in <strong>${ws.name}</strong>.</p>
          <p><strong>${await this.actorLabel(actor?.userId)}</strong> ${statusVerb} <strong>${row.user.fullName || row.user.email || row.user.id}</strong> (${this.roleLabel(targetRole)}).</p>
          <p>New status: <strong>${updated.isActive ? 'Active' : 'Inactive'}</strong></p>
          <p><a href="${this.appUrl()}/app/${workspaceId}/users" target="_blank" rel="noreferrer">Review Users & Roles</a></p>
        `,
      );
    }

    cacheBust(`billing:entitlements:${workspaceId}`);
    return updated;
  }

  async removeWorkspaceMember(workspaceId: string, memberId: string, actor?: WorkspaceActor) {
    const row = await this.prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId },
      include: { user: { select: { id: true, email: true, fullName: true } } },
    });
    if (!row) throw new BadRequestException('Member not found in this workspace');
    if (row.role === MemberRole.OWNER_ADMIN) {
      throw new ForbiddenException('Owner admins cannot be removed');
    }

    await this.prisma.workspaceMember.delete({ where: { id: memberId } });

    await this.prisma.auditLog.create({
      data: {
        workspaceId,
        actorUserId: actor?.userId ?? null,
        action: 'workspace.member.removed',
        meta: { memberId, targetUserId: row.user.id, role: row.role },
      },
    });

    cacheBust(`billing:entitlements:${workspaceId}`);
    return { success: true };
  }

  private async assertManagerCapacity(workspaceId: string, rawPlanName: string, templateType: TemplateType) {
    if (templateType !== TemplateType.OFFICE) return;

    const planName = resolvePlanName(rawPlanName || 'Starter');
    const limit = getEntitlements(planName, templateType).limits.managers;
    const used = await this.prisma.workspaceMember.count({
      where: { workspaceId, isActive: true, role: MemberRole.MANAGER },
    });

    if (used >= limit) {
      throw new ForbiddenException({
        code: 'LIMIT_EXCEEDED',
        message: `This office workspace already has ${used}/${limit} manager seat(s) in use on ${planName}. Upgrade to add more managers.`,
        requiredPlan: planName === 'Starter' ? 'Growth' : 'TomaPrime',
        context: { limit: 'managers' },
      } as any);
    }
  }

  async getWorkspacePermissionPolicy(workspaceId: string) {
    const ws = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, templateType: true, permissionPolicy: true },
    });
    if (!ws) throw new BadRequestException('Workspace not found');

    const policy = (ws.permissionPolicy as PermissionPolicy | null) ?? defaultPolicyFor(ws.templateType);
    return { workspaceId: ws.id, templateType: ws.templateType, policy };
  }

  async updateWorkspacePermissionPolicy(workspaceId: string, policy: PermissionPolicy) {
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } });
    if (!ws) throw new BadRequestException('Workspace not found');

    await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { permissionPolicy: policy as any },
    });

    return { ok: true };
  }

  async listStaffBlocks(workspaceId: string, staffUserId: string) {
    return this.prisma.staffBlockAssignment.findMany({
      where: { workspaceId, staffUserId },
      orderBy: { block: 'asc' },
      select: { id: true, block: true, createdAt: true },
    });
  }

  async setStaffBlocks(workspaceId: string, staffUserId: string, blocks: string[]) {
    const member = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId, userId: staffUserId, isActive: true },
    });
    if (!member) throw new BadRequestException('Staff member not found in workspace');
    if (!(member.role === MemberRole.STAFF || member.role === MemberRole.GUARD || member.role === MemberRole.MANAGER)) {
      throw new BadRequestException('Only staff and guards can be assigned to blocks');
    }

    const normalized = Array.from(
      new Set(
        (blocks || [])
          .map((b) => String(b || '').trim())
          .filter(Boolean),
      ),
    );

    await this.prisma.staffBlockAssignment.deleteMany({ where: { workspaceId, staffUserId } });
    if (normalized.length) {
      await this.prisma.staffBlockAssignment.createMany({
        data: normalized.map((block) => ({ workspaceId, staffUserId, block })),
        skipDuplicates: true,
      });
    }

    await this.prisma.auditLog.create({
      data: {
        workspaceId,
        actorUserId: null,
        action: 'staff.blocks_updated',
        meta: { staffUserId, blocks: normalized },
      },
    });

    return this.listStaffBlocks(workspaceId, staffUserId);
  }

  async listWorkspaceAuditLogs(workspaceId: string, limit = 100) {
    const take = Math.max(1, Math.min(limit, 500));
    return this.prisma.auditLog.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take,
      include: { actor: { select: { id: true, email: true, fullName: true } } },
    });
  }

  async assertWorkspaceAccess(userId: string, workspaceId: string, allowedRoles?: MemberRole[]) {
    const membership = await this.prisma.workspaceMember.findFirst({
      where: { userId, workspaceId, isActive: true },
      include: {
        workspace: {
          select: {
            id: true,
            templateType: true,
            status: true,
            name: true,
            permissionPolicy: true,
            billingStatus: true,
            nextRenewal: true,
            planName: true,
          },
        },
      },
    });

    if (!membership) throw new UnauthorizedException('No access to this workspace');

    if (allowedRoles?.length && !allowedRoles.includes(membership.role)) {
      throw new UnauthorizedException('Insufficient role for this action');
    }

    return membership;
  }

  private async getMembershipsForUser(userId: string) {
    const rows = await this.prisma.workspaceMember.findMany({
      where: { userId, isActive: true },
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
            templateType: true,
            status: true,
            planName: true,
            permissionPolicy: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return rows.map((row) => ({
      workspaceId: row.workspaceId,
      role: row.role,
      workspace: row.workspace,
    }));
  }

  private tokenSecret() {
    return process.env.AUTH_TOKEN_SECRET || 'tomafix-dev-secret-change-me';
  }

  private signToken(payload: TokenPayload) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac('sha256', this.tokenSecret()).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  private verifyToken(token: string): TokenPayload {
    const [body, sig] = token.split('.');
    if (!body || !sig) throw new UnauthorizedException('Invalid token');

    const expected = createHmac('sha256', this.tokenSecret()).update(body).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException('Invalid token signature');

    let payload: TokenPayload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    } catch {
      throw new UnauthorizedException('Invalid token payload');
    }

    if (!payload?.uid || !payload?.exp) throw new UnauthorizedException('Invalid token payload');
    if (payload.exp < Math.floor(Date.now() / 1000)) throw new UnauthorizedException('Token expired');

    // Backward compatibility for older tokens minted before iat field rollout.
    if (!payload.iat) payload.iat = payload.exp - 60 * 60 * 24 * 7;

    return payload;
  }

  async revokeAllSessions(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    // Bump updatedAt — this invalidates all existing bearer tokens (assertTokenNotRevoked check)
    await this.prisma.user.update({
      where: { id: userId },
      data: { fullName: user.fullName ?? null },
    });

    // Delete ALL trusted device tokens so no remembered device can bypass the revoke
    await this.prisma.trustedDevice.deleteMany({ where: { userId } });

    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId, isActive: true },
      select: { workspaceId: true },
      take: 20,
    });

    await Promise.all(
      memberships.map((m) =>
        this.prisma.auditLog.create({
          data: {
            workspaceId: m.workspaceId,
            actorUserId: userId,
            action: 'security.sessions_revoke_all',
            meta: { source: 'settings' },
          },
        }),
      ),
    );

    return { ok: true, revokedAt: new Date().toISOString() };
  }

  async assertTokenNotRevoked(userId: string, tokenIat: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { updatedAt: true } });
    if (!user) throw new UnauthorizedException('User not found');

    const updatedAtSec = Math.floor(user.updatedAt.getTime() / 1000);
    if (updatedAtSec > tokenIat + 1) {
      throw new UnauthorizedException('Session revoked. Please log in again.');
    }
  }

  private makeOtp(): string {
    return String(randomInt(100000, 1000000));
  }

  private hashOtp(code: string): string {
    const salt = randomBytes(16).toString('hex');
    const derived = scryptSync(code, salt, 32).toString('hex');
    return `${salt}:${derived}`;
  }

  private verifyOtpHash(code: string, stored: string): boolean {
    const [salt, hash] = (stored ?? '').split(':');
    if (!salt || !hash) return false;
    const derived = scryptSync(code, salt, 32);
    const expected = Buffer.from(hash, 'hex');
    if (expected.length !== derived.length) return false;
    return timingSafeEqual(expected, derived);
  }

  private otpEmailHtml(code: string): string {
    return `
      <div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5;color:#e6edf6;">
        <h2 style="margin:0 0 12px;font-size:28px;line-height:1.2;color:#f8fbff;">TomaFix login verification</h2>
        <p style="margin:0 0 14px;color:#d7e2ee;">Use this code to sign in:</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-spacing:0;">
          <tr>
            <td style="padding:14px 18px;border-radius:14px;background:#ffffff;border:1px solid #d8e0ea;color:#08101f;font-size:34px;font-weight:900;letter-spacing:8px;font-family:SFMono-Regular,Menlo,Monaco,Consolas,monospace;box-shadow:inset 0 0 0 1px rgba(8,16,31,0.02);">
              ${code}
            </td>
          </tr>
        </table>
        <p style="margin:14px 0 0;color:#aebdcb;font-size:13px;">This code expires in 10 minutes.</p>
      </div>
    `;
  }

  private async sendEmailWithResend(args: { to: string; subject: string; html: string }) {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM || process.env.EMAIL_FROM || 'TomaFix <onboarding@resend.dev>';
    const logoUrl = process.env.EMAIL_LOGO_URL || 'https://www.tomafix.com/bimi-logo-preview.jpg';
    const brandedHtml = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;background:linear-gradient(180deg,#08101f 0%,#0c162a 100%);padding:24px 14px;">
        <div style="max-width:640px;margin:0 auto;background:#101a2f;border:1px solid rgba(230,237,246,0.12);border-radius:16px;overflow:hidden;color:#e6edf6;box-shadow:0 10px 30px rgba(0,0,0,0.25);">
          <div style="padding:16px 18px;border-bottom:1px solid rgba(230,237,246,0.08);background:rgba(56,189,248,0.08);">
            <img src="${logoUrl}" alt="TomaFix" style="max-width:170px;height:auto;display:block;" />
          </div>
          <div style="padding:18px;color:#e6edf6;line-height:1.55;font-size:14px;">
            ${args.html}
          </div>
          <div style="padding:12px 18px;border-top:1px solid rgba(230,237,246,0.08);font-size:11px;color:rgba(230,237,246,0.65);">
            TomaFix • Property operations made simple
          </div>
        </div>
      </div>
    `;

    if (!apiKey) {
      this.logger.warn(`RESEND_API_KEY not set. Skipping email send. To: ${args.to}`);
      return;
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: args.to, subject: args.subject, html: brandedHtml }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new BadRequestException(`Email send failed: ${res.status} ${text || res.statusText}`);
    }
  }

  private appUrl() {
    return (process.env.APP_BASE_URL || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
  }

  private roleLabel(role: MemberRole) {
    switch (role) {
      case MemberRole.OWNER_ADMIN:
        return 'Owner Admin';
      case MemberRole.MANAGER:
        return 'Manager';
      case MemberRole.TECHNICIAN:
        return 'Technician';
      case MemberRole.GUARD:
        return 'Guard';
      case MemberRole.STAFF:
        return 'Staff';
      case MemberRole.RESIDENT:
        return 'Resident';
      default:
        return String(role);
    }
  }

  private async actorLabel(actorUserId?: string | null) {
    if (!actorUserId) return 'TomaFix';
    const actor = await this.prisma.user.findUnique({
      where: { id: actorUserId },
      select: { fullName: true, email: true },
    });
    return actor?.fullName || actor?.email || 'Workspace admin';
  }

  private async notifyOwnerAdmins(workspaceId: string, subject: string, html: string) {
    const owners = await this.prisma.workspaceMember.findMany({
      where: { workspaceId, role: MemberRole.OWNER_ADMIN, isActive: true },
      include: { user: { select: { email: true } } },
    });

    const emails = Array.from(
      new Set(
        owners
          .map((owner) => String(owner.user?.email || '').trim().toLowerCase())
          .filter(Boolean),
      ),
    );

    if (!emails.length) return;

    await Promise.allSettled(
      emails.map((email) => this.sendEmailWithResend({ to: email, subject, html })),
    );
  }
}
