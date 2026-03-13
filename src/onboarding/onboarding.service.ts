import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from 'crypto';
import { BillingStatus, MemberRole, OtpChannel, OtpPurpose, ResidentRole, ResidentStatus, TemplateType, UnitStatus, WorkspaceStatus } from '@prisma/client';
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

    const template = await this.prisma.template.upsert({
      where: { key: dto.templateType },
      update: { isActive: true },
      create: {
        key: dto.templateType,
        name:
          dto.templateType === 'APARTMENT'
            ? 'Apartment Building'
            : dto.templateType === 'OFFICE'
              ? 'Office / Company Facility'
              : 'Estate / Multi-property',
        description:
          dto.templateType === 'APARTMENT'
            ? 'Owners + tenants, requests, notices, inspections'
            : dto.templateType === 'OFFICE'
              ? 'Facilities workflow, assets, inspections'
              : 'Multi-property admin workflow in one workspace',
      },
    });

    const workspace = await this.prisma.workspace.create({
      data: {
        name: dto.workspaceName.trim(),
        templateType: dto.templateType,
        templateId: template.id,
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
      include: { members: true, template: true },
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

  private async assertInviteManager(workspaceId: string, actorUserId?: string) {
    if (!actorUserId) return;
    const m = await this.prisma.workspaceMember.findFirst({
      where: {
        workspaceId,
        userId: actorUserId,
        isActive: true,
        role: { in: [MemberRole.OWNER_ADMIN, MemberRole.STAFF] },
      },
    });
    if (!m) throw new ForbiddenException('Forbidden resource');
  }

  async createTenantInvite(input: { workspaceId: string; email: string; residentName?: string }, actorUserId?: string) {
    const workspaceId = String(input.workspaceId || '').trim();
    const email = String(input.email || '').trim().toLowerCase();
    if (!workspaceId || !email) throw new BadRequestException('workspaceId and email are required');

    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!ws) throw new BadRequestException('Workspace not found');
    await this.assertInviteManager(workspaceId, actorUserId);

    const sentLastHour = await this.prisma.invite.count({
      where: {
        workspaceId,
        role: MemberRole.RESIDENT,
        createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) },
      },
    });
    if (sentLastHour >= 250) {
      throw new HttpException('Invite rate limit reached for this workspace. Try again shortly.', HttpStatus.TOO_MANY_REQUESTS);
    }

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

    await this.prisma.auditLog.create({
      data: {
        workspaceId,
        actorUserId: actorUserId || null,
        action: 'invite.sent',
        meta: { email, expiresAt },
      },
    });

    return { ok: true, inviteUrl, expiresAt, status: 'SENT' };
  }

  async listTenantInvites(workspaceId: string, actorUserId?: string) {
    const wsId = String(workspaceId || '').trim();
    if (!wsId) throw new BadRequestException('workspaceId is required');
    await this.assertInviteManager(wsId, actorUserId);

    const invites = await this.prisma.invite.findMany({
      where: { workspaceId: wsId, role: MemberRole.RESIDENT },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });

    return invites.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      createdAt: i.createdAt,
      expiresAt: i.expiresAt,
      acceptedAt: i.acceptedAt,
      status: i.acceptedAt ? 'ACCEPTED' : i.expiresAt <= new Date() ? 'EXPIRED' : 'SENT',
    }));
  }

  async resendTenantInvite(input: { workspaceId: string; inviteId: string; residentName?: string }, actorUserId?: string) {
    const workspaceId = String(input.workspaceId || '').trim();
    const inviteId = String(input.inviteId || '').trim();
    if (!workspaceId || !inviteId) throw new BadRequestException('workspaceId and inviteId are required');
    await this.assertInviteManager(workspaceId, actorUserId);

    const invite = await this.prisma.invite.findFirst({ where: { id: inviteId, workspaceId } });
    if (!invite || !invite.email) throw new BadRequestException('Invite not found');
    if (invite.acceptedAt) throw new BadRequestException('Invite already accepted');

    return this.createTenantInvite(
      {
        workspaceId,
        email: invite.email,
        residentName: input.residentName,
      },
      actorUserId,
    );
  }

  async revokeTenantInvite(input: { workspaceId: string; inviteId: string }, actorUserId?: string) {
    const workspaceId = String(input.workspaceId || '').trim();
    const inviteId = String(input.inviteId || '').trim();
    if (!workspaceId || !inviteId) throw new BadRequestException('workspaceId and inviteId are required');
    await this.assertInviteManager(workspaceId, actorUserId);

    const invite = await this.prisma.invite.findFirst({ where: { id: inviteId, workspaceId } });
    if (!invite) throw new BadRequestException('Invite not found');
    if (invite.acceptedAt) throw new BadRequestException('Accepted invite cannot be revoked');

    await this.prisma.invite.update({ where: { id: inviteId }, data: { expiresAt: new Date() } });
    await this.prisma.auditLog.create({
      data: {
        workspaceId,
        actorUserId: actorUserId || null,
        action: 'invite.revoked',
        meta: { inviteId, email: invite.email },
      },
    });
    return { ok: true, inviteId, status: 'REVOKED' };
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

  async previewBulkTenantInvites(
    input: {
      workspaceId: string;
      rows: Array<{
        fullName?: string;
        email?: string;
        phone?: string;
        unitLabel?: string;
        block?: string;
        floor?: string;
      }>;
    },
    actorUserId?: string,
  ) {
    const workspaceId = String(input.workspaceId || '').trim();
    const rows = Array.isArray(input.rows) ? input.rows : [];
    if (!workspaceId) throw new BadRequestException('workspaceId is required');
    await this.assertInviteManager(workspaceId, actorUserId);

    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!ws) throw new BadRequestException('Workspace not found');

    const units = ws.templateType === TemplateType.ESTATE
      ? await this.prisma.estateUnit.findMany({ where: { workspaceId }, select: { id: true, label: true, block: true, floor: true } })
      : await this.prisma.apartmentUnit.findMany({ where: { workspaceId }, select: { id: true, label: true, block: true, floor: true } });

    const residents = ws.templateType === TemplateType.ESTATE
      ? await this.prisma.estateResident.findMany({ where: { workspaceId }, select: { email: true, unitId: true, status: true } })
      : await this.prisma.apartmentResident.findMany({ where: { workspaceId }, select: { email: true, unitId: true, status: true } });

    const unitByKey = new Map<string, (typeof units)[number]>();
    for (const u of units) {
      const key = `${u.label.toLowerCase()}|${(u.block || '').toLowerCase()}|${(u.floor || '').toLowerCase()}`;
      unitByKey.set(key, u);
      unitByKey.set(`${u.label.toLowerCase()}||`, u);
    }

    const existingEmails = new Set(
      residents.map((r) => String(r.email || '').trim().toLowerCase()).filter(Boolean),
    );
    const occupiedUnits = new Set(
      residents.filter((r) => r.status === 'ACTIVE' && !!r.unitId).map((r) => r.unitId as string),
    );

    const seenEmails = new Set<string>();
    const validRows: any[] = [];
    const invalidRows: any[] = [];

    rows.forEach((raw, idx) => {
      const rowNo = idx + 1;
      const fullName = String(raw.fullName || '').trim();
      const email = String(raw.email || '').trim().toLowerCase();
      const phone = String(raw.phone || '').trim();
      const unitLabel = String(raw.unitLabel || '').trim();
      const block = String(raw.block || '').trim();
      const floor = String(raw.floor || '').trim();
      const issues: string[] = [];

      if (!fullName) issues.push('Missing fullName');
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) issues.push('Invalid email');
      if (!unitLabel) issues.push('Missing unitLabel');

      if (email && seenEmails.has(email)) issues.push('Duplicate email in upload');
      if (email && existingEmails.has(email)) issues.push('Email already exists in workspace');

      const unitKey = `${unitLabel.toLowerCase()}|${block.toLowerCase()}|${floor.toLowerCase()}`;
      const unit = unitByKey.get(unitKey) || unitByKey.get(`${unitLabel.toLowerCase()}||`);
      if (!unit) issues.push('Unit not found');
      if (unit && occupiedUnits.has(unit.id)) issues.push('Unit already assigned to active resident');

      if (issues.length) {
        invalidRows.push({ rowNo, fullName, email, unitLabel, block, floor, issues });
      } else {
        seenEmails.add(email);
        validRows.push({ rowNo, fullName, email, phone: phone || null, unitId: unit!.id, unitLabel: unit!.label });
      }
    });

    return {
      workspaceId,
      summary: {
        total: rows.length,
        valid: validRows.length,
        invalid: invalidRows.length,
      },
      validRows,
      invalidRows,
    };
  }

  async commitBulkTenantInvites(
    input: {
      workspaceId: string;
      rows: Array<{
        fullName?: string;
        email?: string;
        phone?: string;
        unitLabel?: string;
        block?: string;
        floor?: string;
      }>;
    },
    actorUserId?: string,
  ) {
    const preview = await this.previewBulkTenantInvites(input, actorUserId);

    const ws = await this.prisma.workspace.findUnique({ where: { id: preview.workspaceId } });
    if (!ws) throw new BadRequestException('Workspace not found');

    const sent: any[] = [];
    for (const row of preview.validRows as any[]) {
      const resident = ws.templateType === TemplateType.ESTATE
        ? await this.prisma.estateResident.create({
            data: {
              id: randomUUID(),
              workspaceId: preview.workspaceId,
              fullName: row.fullName,
              email: row.email,
              phone: row.phone,
              unitId: row.unitId,
              role: ResidentRole.TENANT,
              status: ResidentStatus.ACTIVE,
            },
          })
        : await this.prisma.apartmentResident.create({
            data: {
              id: randomUUID(),
              workspaceId: preview.workspaceId,
              fullName: row.fullName,
              email: row.email,
              phone: row.phone,
              unitId: row.unitId,
              role: ResidentRole.TENANT,
              status: ResidentStatus.ACTIVE,
            },
          });

      if (row.unitId) {
        if (ws.templateType === TemplateType.ESTATE) {
          await this.prisma.estateUnit.updateMany({ where: { id: row.unitId }, data: { status: UnitStatus.OCCUPIED } });
        } else {
          await this.prisma.apartmentUnit.updateMany({ where: { id: row.unitId }, data: { status: UnitStatus.OCCUPIED } });
        }
      }

      const invite = await this.createTenantInvite({
        workspaceId: preview.workspaceId,
        email: row.email,
        residentName: row.fullName,
      });

      sent.push({ rowNo: row.rowNo, residentId: resident.id, email: row.email, inviteUrl: invite.inviteUrl });
    }

    return {
      workspaceId: preview.workspaceId,
      summary: {
        total: input.rows?.length || 0,
        sent: sent.length,
        skipped: preview.invalidRows.length,
      },
      sent,
      invalidRows: preview.invalidRows,
    };
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

    const attemptsLastHour = await this.prisma.otpCode.count({
      where: {
        workspaceId: wsId,
        userId: ownerUserId,
        purpose: OtpPurpose.OWNER_VERIFY,
        channel: OtpChannel.EMAIL,
        createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) },
      },
    });
    if (attemptsLastHour >= 8) {
      throw new HttpException('Too many OTP requests. Please wait and try again.', HttpStatus.TOO_MANY_REQUESTS);
    }

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
   *
   * Local/dev override: when LOCAL_BYPASS_PAYMENT=true and Paystack keys are not configured,
   * and never in production, workspace is auto-activated for easier mock-only testing.
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
    const nodeEnv = (process.env.NODE_ENV || '').toLowerCase();
    const localBypassRaw = String(process.env.LOCAL_BYPASS_PAYMENT || '').toLowerCase();
    const hasPaystackSecret = Boolean(String(process.env.PAYSTACK_SECRET_KEY || '').trim());
    const bypassPaymentForLocal =
      nodeEnv !== 'production' && localBypassRaw === 'true' && !hasPaystackSecret;

    const targetStatus = bypassPaymentForLocal ? WorkspaceStatus.ACTIVE : WorkspaceStatus.PENDING_PAYMENT;

    await this.prisma.$transaction([
      this.prisma.otpCode.update({ where: { id: otp.id }, data: { consumedAt: now } }),
      this.prisma.user.update({
        where: { id: workspace.ownerUserId },
        data: { emailVerifiedAt: now },
      }),
      this.prisma.workspace.update({
        where: { id: wsId },
        data: {
          ownerVerifiedAt: now,
          status: targetStatus,
          billingStatus: bypassPaymentForLocal ? BillingStatus.ACTIVE : BillingStatus.PENDING_PAYMENT,
        },
      }),
    ]);

    return {
      ok: true,
      next: bypassPaymentForLocal ? 'APP' : 'PAYMENT',
      workspaceId: wsId,
      status: targetStatus,
    };
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

    const payload = { from, to: args.to, subject: args.subject, html: brandedHtml };

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
