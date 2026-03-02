import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { MemberRole, OtpChannel, OtpPurpose } from '@prisma/client';
import { defaultPolicyFor, PermissionPolicy } from './permissions';
import { createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

type TokenPayload = {
  uid: string;
  exp: number;
  iat: number;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async sendLoginOtp(emailInput: string) {
    const email = String(emailInput || '').trim().toLowerCase();
    if (!email) throw new BadRequestException('email is required');

    const user = await this.prisma.user.upsert({
      where: { email },
      update: {},
      create: { email },
    });

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

    await this.sendEmailWithResend({
      to: email,
      subject: 'Your TomaFix login code',
      html: this.otpEmailHtml(code),
    });

    const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production';
    return {
      ok: true,
      message: 'OTP sent',
      ...(!hasResend && !isProd ? { devOtp: code } : {}),
    };
  }

  async verifyLoginOtp(emailInput: string, codeInput: string) {
    const email = String(emailInput || '').trim().toLowerCase();
    const code = String(codeInput || '').trim();
    if (!email || !code) throw new BadRequestException('email and code are required');

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid login');

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

    const ok = this.verifyOtpHash(code, otp.codeHash);
    if (!ok) throw new BadRequestException('Invalid code');

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

  async createWorkspaceStaff(workspaceId: string, dto: { fullName: string; email: string }) {
    const fullName = String(dto.fullName || '').trim();
    const email = String(dto.email || '').trim().toLowerCase();
    if (!fullName) throw new BadRequestException('fullName is required');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Valid email is required');
    }

    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!ws) throw new BadRequestException('Workspace not found');

    const user = await this.prisma.user.upsert({
      where: { email },
      update: { fullName },
      create: { email, fullName },
    });

    const member = await this.prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId, userId: user.id } },
      update: { role: MemberRole.STAFF, isActive: true },
      create: { workspaceId, userId: user.id, role: MemberRole.STAFF, isActive: true },
      include: { user: { select: { id: true, email: true, fullName: true } } },
    });

    await this.prisma.auditLog.create({
      data: {
        workspaceId,
        actorUserId: null,
        action: 'staff.created',
        meta: { email, fullName, userId: user.id },
      },
    });

    return member;
  }

  async updateWorkspaceMember(workspaceId: string, memberId: string, dto: { role?: MemberRole; isActive?: boolean }) {
    const row = await this.prisma.workspaceMember.findFirst({ where: { id: memberId, workspaceId } });
    if (!row) throw new BadRequestException('Member not found in this workspace');

    const normalizedRole = dto.role === MemberRole.MANAGER ? MemberRole.STAFF : dto.role;

    return this.prisma.workspaceMember.update({
      where: { id: memberId },
      data: {
        role: normalizedRole ?? undefined,
        isActive: dto.isActive ?? undefined,
      },
      include: { user: { select: { id: true, email: true, fullName: true } } },
    });
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
    if (!(member.role === MemberRole.STAFF || member.role === MemberRole.MANAGER)) {
      throw new BadRequestException('Only staff can be assigned to blocks');
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

    await this.prisma.user.update({
      where: { id: userId },
      data: { fullName: user.fullName ?? null },
    });

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
      <div style="font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif; line-height: 1.4;">
        <h2 style="margin: 0 0 12px;">TomaFix login verification</h2>
        <p style="margin: 0 0 12px;">Use this code to sign in:</p>
        <div style="font-size: 28px; font-weight: 800; letter-spacing: 6px; padding: 10px 14px; border-radius: 10px; background: #f3f4f6; display: inline-block;">${code}</div>
        <p style="margin: 12px 0 0; color: #6b7280;">This code expires in 10 minutes.</p>
      </div>
    `;
  }

  private async sendEmailWithResend(args: { to: string; subject: string; html: string }) {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM || process.env.EMAIL_FROM || 'TomaFix <onboarding@resend.dev>';

    if (!apiKey) {
      this.logger.warn(`RESEND_API_KEY not set. Skipping email send. To: ${args.to}`);
      return;
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: args.to, subject: args.subject, html: args.html }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new BadRequestException(`Email send failed: ${res.status} ${text || res.statusText}`);
    }
  }
}
