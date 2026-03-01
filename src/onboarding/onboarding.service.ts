import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'crypto';
import { MemberRole, OtpChannel, OtpPurpose, WorkspaceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  /**
   * Step 1 (Strict): Create workspace + owner member.
   * Workspace must start at PENDING_OTP.
   */
  async createWorkspace(dto: CreateWorkspaceDto) {
    const email = dto.ownerEmail.trim().toLowerCase();

    const user = await this.prisma.user.upsert({
      where: { email },
      update: { fullName: dto.ownerFullName },
      create: { email, fullName: dto.ownerFullName },
    });

    const workspace = await this.prisma.workspace.create({
      data: {
        name: dto.workspaceName.trim(),
        templateType: dto.templateType,
        status: WorkspaceStatus.PENDING_OTP,
        ownerUserId: user.id,
        members: {
          create: {
            userId: user.id,
            role: 'OWNER_ADMIN',
            isActive: true,
          },
        },
      },
      include: { members: true },
    });

    return {
      workspaceId: workspace.id,
      status: workspace.status,
      templateType: workspace.templateType,
      ownerUserId: user.id,
      ownerMemberId: workspace.members[0]?.id,
    };
  }

  // Controller-friendly wrappers (DTO-based)
  // These match the controller calls: onboarding.sendOtpEmail(dto) / onboarding.verifyOtpEmail(dto)
  async sendOtpEmail(dto: { workspaceId: string; email: string }) {
    return this.sendOwnerEmailOtp(dto.workspaceId, dto.email);
  }

  async verifyOtpEmail(dto: { workspaceId: string; email: string; code: string }) {
    return this.verifyOwnerEmailOtp(dto.workspaceId, dto.email, dto.code);
  }

  async createTenantInvite(input: { workspaceId: string; email: string; residentName?: string }) {
    const workspaceId = String(input.workspaceId || '').trim();
    const email = String(input.email || '').trim().toLowerCase();
    if (!workspaceId || !email) throw new BadRequestException('workspaceId and email are required');

    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!ws) throw new BadRequestException('Workspace not found');

    // Invalidate older open invites for same workspace/email to avoid confusion at scale.
    await this.prisma.invite.updateMany({
      where: {
        workspaceId,
        email,
        role: MemberRole.RESIDENT,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { expiresAt: new Date() },
    });

    const rawToken = randomBytes(24).toString('base64url');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.invite.create({
      data: {
        workspaceId,
        email,
        role: MemberRole.RESIDENT,
        tokenHash,
        expiresAt,
      },
    });

    const appUrl = (process.env.APP_BASE_URL || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
    const inviteUrl = `${appUrl}/join?token=${encodeURIComponent(rawToken)}`;

    await this.sendEmailWithResend({
      to: email,
      subject: `You're invited to join TomaFix`,
      html: this.inviteEmailHtml({ inviteUrl, residentName: input.residentName }),
    });

    return { ok: true, inviteUrl, expiresAt, status: 'SENT' };
  }

  async acceptTenantInvite(input: { token: string; email: string; fullName?: string }) {
    const token = String(input.token || '').trim();
    const providedEmail = String(input.email || '').trim().toLowerCase();
    if (!token || !providedEmail) throw new BadRequestException('token and email are required');

    const tokenHash = createHash('sha256').update(token).digest('hex');
    const invite = await this.prisma.invite.findUnique({ where: { tokenHash } });

    if (!invite || invite.acceptedAt || invite.expiresAt <= new Date()) {
      throw new BadRequestException('Invite is invalid, expired, or already used');
    }

    const email = String(invite.email || '').trim().toLowerCase();
    if (!email) throw new BadRequestException('Invite email is missing');
    if (email !== providedEmail) {
      throw new UnauthorizedException('Invite email mismatch');
    }

    const user = await this.prisma.user.upsert({
      where: { email },
      update: { fullName: input.fullName?.trim() || undefined },
      create: { email, fullName: input.fullName?.trim() || null },
    });

    await this.prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId: user.id } },
      update: { role: invite.role, isActive: true },
      create: {
        workspaceId: invite.workspaceId,
        userId: user.id,
        role: invite.role,
        isActive: true,
      },
    });

    await this.prisma.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });

    return this.auth.createSessionForUser(user.id, invite.workspaceId);
  }

  /**
   * Step 2 (Strict): Send OTP to verify the owner email.
   * Uses Resend if RESEND_API_KEY is present; otherwise logs OTP to console.
   */
  async sendOwnerEmailOtp(workspaceId: string, email: string) {
    const wsId = (workspaceId ?? '').trim();
    const target = (email ?? '').trim().toLowerCase();

    if (!wsId || !target) {
      throw new BadRequestException('workspaceId and email are required');
    }

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: wsId },
      include: { owner: true },
    });

    if (!workspace || !workspace.ownerUserId) {
      throw new BadRequestException('Workspace not found');
    }

    const ownerUserId = workspace.ownerUserId as string;

    const ownerEmail = workspace.owner?.email?.toLowerCase();
    if (!ownerEmail || ownerEmail !== target) {
      throw new UnauthorizedException('Email does not match workspace owner');
    }

    if (workspace.status !== WorkspaceStatus.PENDING_OTP) {
      throw new BadRequestException('Workspace is not pending OTP verification');
    }

    const code = this.makeOtp();
    const codeHash = this.hashOtp(code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // Serialize concurrent sends for the same workspace/user to avoid duplicate emails.
    let txResult: { tooSoon: boolean; waitSeconds: number };
    try {
      txResult = await this.prisma.$transaction(async (tx) => {
        // Advisory lock keyed by workspace + user
        await tx.$executeRawUnsafe(
          'SELECT pg_advisory_xact_lock(hashtext($1 || \':\' || $2))',
          wsId,
          ownerUserId,
        );

        const latest = await tx.otpCode.findFirst({
          where: {
            workspaceId: wsId,
            userId: ownerUserId,
            purpose: OtpPurpose.OWNER_VERIFY,
            channel: OtpChannel.EMAIL,
            target,
            consumedAt: null,
          },
          orderBy: { createdAt: 'desc' },
        });

        if (latest) {
          const secondsSince = (Date.now() - latest.createdAt.getTime()) / 1000;
          if (secondsSince < 30) {
            return { tooSoon: true, waitSeconds: Math.max(1, Math.ceil(30 - secondsSince)) };
          }
        }

        await tx.otpCode.create({
          data: {
            workspaceId: wsId,
            userId: ownerUserId,
            purpose: OtpPurpose.OWNER_VERIFY,
            channel: OtpChannel.EMAIL,
            target,
            codeHash,
            expiresAt,
          },
        });

        return { tooSoon: false, waitSeconds: 0 };
      });
    } catch (err) {
      // Handle concurrent write conflicts gracefully instead of surfacing 500s
      if ((err as any)?.code === 'P2034') {
        return {
          ok: false,
          message: 'Please wait a moment and try again (in-flight request).',
          retryAfterSeconds: 5,
        };
      }
      throw err;
    }

    if (txResult.tooSoon) {
      return {
        ok: false,
        message: `Please wait ${txResult.waitSeconds}s before requesting another code`,
        retryAfterSeconds: txResult.waitSeconds,
      };
    }

    // DEV fallback: if Resend isn't configured yet, log the OTP so you can test verify.
    const hasResend = !!process.env.RESEND_API_KEY;
    if (!hasResend) {
      this.logger.warn(`[DEV OTP] ${target} -> ${code}`);
    }

    await this.sendEmailWithResend({
      to: target,
      subject: 'Your TomaFix verification code',
      html: this.otpEmailHtml(code),
    });

    const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production';
    const shouldExposeDevOtp = !hasResend && !isProd;

    return {
      ok: true,
      message: 'OTP sent',
      ...(shouldExposeDevOtp ? { devOtp: code } : {}),
    };
  }

  /**
   * Step 2 (Strict): Verify OTP → move workspace to PENDING_PAYMENT.
   */
  async verifyOwnerEmailOtp(workspaceId: string, email: string, code: string) {
    const wsId = (workspaceId ?? '').trim();
    const target = (email ?? '').trim().toLowerCase();
    const rawCode = (code ?? '').trim();

    if (!wsId || !target || !rawCode) {
      throw new BadRequestException('workspaceId, email and code are required');
    }

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: wsId },
      include: { owner: true },
    });

    if (!workspace || !workspace.ownerUserId) {
      throw new BadRequestException('Workspace not found');
    }

    const ownerEmail = workspace.owner?.email?.toLowerCase();
    if (!ownerEmail || ownerEmail !== target) {
      throw new UnauthorizedException('Email does not match workspace owner');
    }

    if (workspace.status !== WorkspaceStatus.PENDING_OTP) {
      throw new BadRequestException('Workspace is not pending OTP verification');
    }

    const otp = await this.prisma.otpCode.findFirst({
      where: {
        workspaceId: wsId,
        userId: workspace.ownerUserId,
        purpose: OtpPurpose.OWNER_VERIFY,
        channel: OtpChannel.EMAIL,
        target,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) throw new BadRequestException('Invalid or expired code');

    const ok = this.verifyOtpHash(rawCode, otp.codeHash);
    if (!ok) throw new BadRequestException('Invalid code');

    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.otpCode.update({ where: { id: otp.id }, data: { consumedAt: now } }),
      this.prisma.user.update({
        where: { id: workspace.ownerUserId },
        data: { emailVerifiedAt: now },
      }),
      this.prisma.workspace.update({
        where: { id: wsId },
        data: { ownerVerifiedAt: now, status: WorkspaceStatus.PENDING_PAYMENT },
      }),
    ]);

    return { ok: true, next: 'PAYMENT', workspaceId: wsId, status: WorkspaceStatus.PENDING_PAYMENT };
  }

  // -------- helpers --------

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
        <h2 style="margin: 0 0 12px;">Verify your TomaFix owner account</h2>
        <p style="margin: 0 0 12px;">Use this code to verify your email:</p>
        <div style="font-size: 28px; font-weight: 800; letter-spacing: 6px; padding: 10px 14px; border-radius: 10px; background: #f3f4f6; display: inline-block;">${code}</div>
        <p style="margin: 12px 0 0; color: #6b7280;">This code expires in 10 minutes.</p>
      </div>
    `;
  }

  private inviteEmailHtml(args: { inviteUrl: string; residentName?: string }): string {
    const name = args.residentName ? `<p style="margin:0 0 12px;">Hi ${args.residentName},</p>` : '';
    return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif; line-height: 1.5;">
        ${name}
        <h2 style="margin: 0 0 12px;">You’ve been invited to TomaFix</h2>
        <p style="margin: 0 0 12px;">Click the button below to join your tenant dashboard.</p>
        <p style="margin: 14px 0;">
          <a href="${args.inviteUrl}" style="display:inline-block;padding:10px 14px;border-radius:10px;background:#0ea5e9;color:white;text-decoration:none;font-weight:700;">Open Tenant Dashboard</a>
        </p>
        <p style="margin: 0; color:#6b7280; font-size:12px;">If the button doesn't work, copy this link: ${args.inviteUrl}</p>
      </div>
    `;
  }

  private async sendEmailWithResend(args: { to: string; subject: string; html: string }) {
    const apiKey = process.env.RESEND_API_KEY;
    const from =
      process.env.RESEND_FROM || process.env.EMAIL_FROM || 'TomaFix <onboarding@resend.dev>';

    if (!apiKey) {
      this.logger.warn(`RESEND_API_KEY not set. Skipping email send. To: ${args.to}`);
      return;
    }

    const payload = { from, to: args.to, subject: args.subject, html: args.html };

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const text = await res.text().catch(() => '');

      if (!res.ok) {
        const msg = `Resend email failed: ${res.status} ${text || res.statusText}`;
        this.logger.error(msg);
        throw new HttpException(msg, HttpStatus.BAD_GATEWAY);
      }

      // Log message id for observability; ignore parsing errors.
      try {
        const parsed = JSON.parse(text);
        if (parsed?.id) this.logger.log(`Resend email queued id=${parsed.id}`);
      } catch {
        this.logger.log(`Resend email accepted (${res.status}); response not JSON`);
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      const msg = `Resend request threw: ${(err as Error).message}`;
      this.logger.error(msg);
      throw new HttpException(msg, HttpStatus.BAD_GATEWAY);
    }
  }
}
