import { Injectable, UnauthorizedException, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TemplateType } from '@prisma/client';
import * as crypto from 'crypto';
import { MailService } from '../mail/mail.service';
import { isAdminEmailAllowed } from './admin-auth.util';
import { cacheBust } from '../billing/cache';

// Simple password hashing using Node's built-in crypto (no bcrypt dep needed)
function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password + (process.env.ADMIN_SECRET || 'tf-admin-salt')).digest('hex');
}

function generateToken(): string {
  return crypto.randomBytes(48).toString('hex');
}

function hashToken(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

const VALID_ADMIN_ROLES = ['SUPER_ADMIN', 'OPS_ADMIN', 'BILLING_ADMIN', 'REVIEW_ADMIN', 'CONTENT_ADMIN'] as const;
type ValidAdminRole = (typeof VALID_ADMIN_ROLES)[number];

function assertAdminRole(role: string): asserts role is ValidAdminRole {
  if (!VALID_ADMIN_ROLES.includes(role as ValidAdminRole)) {
    throw new BadRequestException('Invalid admin role');
  }
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  private getAdminAppUrl() {
    return (
      process.env.ADMIN_APP_URL ||
      (process.env.NODE_ENV === 'production' ? 'https://yonick.tomafix.com' : 'http://localhost:5175')
    );
  }

  private normalizeWorkspaceCounts(workspace: any) {
    const counts = workspace?._count || {};
    const requestCount =
      workspace?.templateType === TemplateType.ESTATE
        ? counts.estateRequests ?? 0
        : workspace?.templateType === TemplateType.OFFICE
          ? counts.officeRequests ?? 0
          : counts.apartmentRequests ?? 0;
    const noticeCount =
      workspace?.templateType === TemplateType.ESTATE
        ? counts.estateNotices ?? 0
        : workspace?.templateType === TemplateType.OFFICE
          ? counts.officeNotices ?? 0
          : counts.apartmentNotices ?? 0;
    const inspectionCount =
      workspace?.templateType === TemplateType.ESTATE
        ? counts.estateInspections ?? 0
        : workspace?.templateType === TemplateType.OFFICE
          ? counts.officeInspections ?? 0
          : counts.apartmentInspections ?? 0;

    return {
      ...workspace,
      _count: {
        ...counts,
        requests: requestCount,
        notices: noticeCount,
        inspections: inspectionCount,
      },
    };
  }

  private buildDailySeries(rows: Array<{ createdAt: Date }>, days = 14) {
    const today = startOfDay(new Date());
    const start = addDays(today, -(days - 1));
    const bucket = new Map<string, number>();

    for (let i = 0; i < days; i += 1) {
      const day = addDays(start, i).toISOString().slice(0, 10);
      bucket.set(day, 0);
    }

    for (const row of rows) {
      const key = startOfDay(new Date(row.createdAt)).toISOString().slice(0, 10);
      if (bucket.has(key)) {
        bucket.set(key, (bucket.get(key) || 0) + 1);
      }
    }

    return Array.from(bucket.entries()).map(([date, value]) => ({ date, value }));
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  async login(email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const admin = await this.prisma.adminUser.findUnique({ where: { email: normalizedEmail } });
    if (!admin || !admin.isActive) throw new UnauthorizedException('Invalid credentials');
    if (!isAdminEmailAllowed(normalizedEmail)) throw new UnauthorizedException('Admin email is not allowed');

    const hash = hashPassword(password);
    if (hash !== admin.passwordHash) throw new UnauthorizedException('Invalid credentials');

    // Generate 6-digit OTP
    const code = String(crypto.randomInt(100000, 999999));
    const otpHash = this.hashAdminOtp(code);
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    // Create PENDING session (twoFactorVerified: false)
    const token = generateToken();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12); // 12h

    await this.prisma.adminSession.create({
      data: { adminUserId: admin.id, token, expiresAt, twoFactorVerified: false, otpHash, otpExpiresAt },
    });

    // Send OTP email
    await this.sendAdminOtpEmail(admin.email, admin.fullName, code);

    return {
      step: 'otp',
      token,
      ...(process.env.NODE_ENV !== 'production' ? { devOtp: code } : {}),
    };
  }

  async requestPasswordReset(email: string) {
    const normalized = email.trim().toLowerCase();
    const admin = await this.prisma.adminUser.findUnique({ where: { email: normalized } });

    if (!admin || !admin.isActive) {
      return {
        ok: true,
        ...(process.env.NODE_ENV !== 'production' ? { devResetToken: null } : {}),
      };
    }

    await this.prisma.adminPasswordResetToken.deleteMany({
      where: {
        adminUserId: admin.id,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    const token = generateToken();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await this.prisma.adminPasswordResetToken.create({
      data: {
        adminUserId: admin.id,
        tokenHash: hashToken(token),
        expiresAt,
      },
    });

    await this.sendAdminPasswordResetEmail(admin.email, admin.fullName, token);

    return {
      ok: true,
      ...(process.env.NODE_ENV !== 'production' ? { devResetToken: token } : {}),
    };
  }

  async resetAdminPassword(token: string, password: string) {
    const tokenHash = hashToken(token.trim());
    const resetToken = await this.prisma.adminPasswordResetToken.findUnique({
      where: { tokenHash },
      include: { admin: true },
    });

    if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Reset link is invalid or expired');
    }

    if (!resetToken.admin.isActive) {
      throw new UnauthorizedException('Admin account is inactive');
    }

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.adminUser.update({
        where: { id: resetToken.admin.id },
        data: { passwordHash: hashPassword(password) },
      }),
      this.prisma.adminSession.deleteMany({ where: { adminUserId: resetToken.admin.id } }),
      this.prisma.adminPasswordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: now },
      }),
    ]);

    await this.audit(resetToken.admin.id, resetToken.admin.email, 'admin.password_reset', 'AdminUser', resetToken.admin.id);

    return { ok: true };
  }

  async verifyAdminOtp(token: string, code: string) {
    const session = await this.prisma.adminSession.findUnique({
      where: { token },
      include: { admin: true },
    });

    if (!session || session.twoFactorVerified) throw new UnauthorizedException('Invalid or expired session');
    if (!session.otpHash || !session.otpExpiresAt) throw new UnauthorizedException('No OTP pending');
    if (session.otpExpiresAt < new Date()) throw new UnauthorizedException('OTP has expired. Please sign in again.');
    if (!session.admin.isActive) throw new UnauthorizedException('Admin account is inactive');
    if (!isAdminEmailAllowed(session.admin.email)) throw new UnauthorizedException('Admin email is not allowed');

    const valid = this.verifyAdminOtpHash(code.trim(), session.otpHash);
    if (!valid) throw new UnauthorizedException('Incorrect verification code');

    // Mark session as fully verified
    await this.prisma.adminSession.update({
      where: { token },
      data: { twoFactorVerified: true, otpHash: null, otpExpiresAt: null },
    });

    await this.prisma.adminUser.update({
      where: { id: session.admin.id },
      data: { lastLoginAt: new Date() },
    });

    return {
      token,
      admin: { id: session.admin.id, email: session.admin.email, fullName: session.admin.fullName, role: session.admin.role },
    };
  }

  async logout(token: string) {
    await this.prisma.adminSession.deleteMany({ where: { token } });
    return { ok: true };
  }

  async me(adminId: string) {
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: adminId },
      select: { id: true, email: true, fullName: true, role: true, lastLoginAt: true },
    });
    return admin;
  }

  // ── Audit ─────────────────────────────────────────────────────────────────

  async audit(adminId: string, adminEmail: string, action: string, targetType: string, targetId?: string, meta?: any) {
    return this.prisma.adminAuditLog.create({
      data: { adminUserId: adminId, adminEmail, action, targetType, targetId: targetId ?? null, meta: meta ?? undefined },
    });
  }

  async listAuditLogs(page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const [logs, total] = await Promise.all([
      this.prisma.adminAuditLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { admin: { select: { fullName: true, email: true, role: true } } },
      }),
      this.prisma.adminAuditLog.count(),
    ]);
    return { logs, total, page, limit };
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────

  async getDashboard() {
    const [
      totalUsers,
      totalWorkspaces,
      activeWorkspaces,
      pendingPaymentWorkspaces,
      pendingOtpWorkspaces,
      totalTechApplications,
      pendingTechApplications,
      approvedTechApplications,
      totalPayments,
      failedPayments,
      recentWorkspaces,
      recentUsers,
      recentTechApplications,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.workspace.count(),
      this.prisma.workspace.count({ where: { status: 'ACTIVE' } }),
      this.prisma.workspace.count({ where: { status: 'PENDING_PAYMENT' } }),
      this.prisma.workspace.count({ where: { status: 'PENDING_OTP' } }),
      this.prisma.technicianApplication.count(),
      this.prisma.technicianApplication.count({ where: { status: 'PENDING' } }),
      this.prisma.technicianApplication.count({ where: { status: 'APPROVED' } }),
      this.prisma.payment.count(),
      this.prisma.payment.count({ where: { status: 'FAILED' } }),
      this.prisma.workspace.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { id: true, name: true, templateType: true, status: true, planName: true, createdAt: true },
      }),
      this.prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: { id: true, email: true, fullName: true, createdAt: true },
      }),
      this.prisma.technicianApplication.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, businessName: true, categories: true, businessAddress: true, createdAt: true },
      }),
    ]);

    return {
      stats: {
        totalUsers,
        totalWorkspaces,
        activeWorkspaces,
        pendingPaymentWorkspaces,
        pendingOtpWorkspaces,
        totalTechApplications,
        pendingTechApplications,
        approvedTechApplications,
        totalPayments,
        failedPayments,
      },
      recentWorkspaces,
      recentUsers,
      recentTechApplications,
    };
  }

  async getAnalyticsOverview() {
    const now = new Date();
    const last14Days = addDays(startOfDay(now), -13);
    const last30Days = addDays(startOfDay(now), -29);

    const [
      workspaceTemplates,
      workspaceStatuses,
      paymentStatuses,
      applicationStatuses,
      paidPaymentsLast30Days,
      recentPaymentsLast14Days,
      recentUsers,
      recentWorkspaces,
      recentApplications,
    ] = await Promise.all([
      this.prisma.workspace.groupBy({
        by: ['templateType'],
        _count: { _all: true },
      }),
      this.prisma.workspace.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.payment.groupBy({
        by: ['status'],
        _count: { _all: true },
        _sum: { amountPesewas: true },
      }),
      this.prisma.technicianApplication.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.payment.findMany({
        where: { status: 'PAID', createdAt: { gte: last30Days } },
        select: { createdAt: true, amountPesewas: true },
      }),
      this.prisma.payment.findMany({
        where: { createdAt: { gte: last14Days } },
        select: { createdAt: true },
      }),
      this.prisma.user.findMany({
        where: { createdAt: { gte: last14Days } },
        select: { createdAt: true },
      }),
      this.prisma.workspace.findMany({
        where: { createdAt: { gte: last14Days } },
        select: { createdAt: true },
      }),
      this.prisma.technicianApplication.findMany({
        where: { createdAt: { gte: last14Days } },
        select: { createdAt: true },
      }),
    ]);

    const paidRevenuePesewas = paymentStatuses
      .filter((row) => row.status === 'PAID')
      .reduce((sum, row) => sum + (row._sum.amountPesewas || 0), 0);

    const failedRevenuePesewas = paymentStatuses
      .filter((row) => row.status === 'FAILED')
      .reduce((sum, row) => sum + (row._sum.amountPesewas || 0), 0);

    const revenueByDayMap = new Map<string, number>();
    for (let i = 0; i < 30; i += 1) {
      const key = addDays(last30Days, i).toISOString().slice(0, 10);
      revenueByDayMap.set(key, 0);
    }
    for (const payment of paidPaymentsLast30Days) {
      const key = startOfDay(new Date(payment.createdAt)).toISOString().slice(0, 10);
      revenueByDayMap.set(key, (revenueByDayMap.get(key) || 0) + payment.amountPesewas);
    }

    return {
      headline: {
        paidRevenuePesewas,
        failedRevenuePesewas,
        revenueLast30DaysPesewas: paidPaymentsLast30Days.reduce((sum, payment) => sum + payment.amountPesewas, 0),
        newUsersLast14Days: recentUsers.length,
        newWorkspacesLast14Days: recentWorkspaces.length,
        newTechnicianApplicationsLast14Days: recentApplications.length,
      },
      distributions: {
        workspaceTemplates: workspaceTemplates.map((row) => ({ key: row.templateType, value: row._count._all })),
        workspaceStatuses: workspaceStatuses.map((row) => ({ key: row.status, value: row._count._all })),
        paymentStatuses: paymentStatuses.map((row) => ({ key: row.status, value: row._count._all, amountPesewas: row._sum.amountPesewas || 0 })),
        technicianStatuses: applicationStatuses.map((row) => ({ key: row.status, value: row._count._all })),
      },
      trends: {
        payments: this.buildDailySeries(recentPaymentsLast14Days, 14),
        users: this.buildDailySeries(recentUsers, 14),
        workspaces: this.buildDailySeries(recentWorkspaces, 14),
        technicians: this.buildDailySeries(recentApplications, 14),
        revenue: Array.from(revenueByDayMap.entries()).map(([date, amountPesewas]) => ({ date, amountPesewas })),
      },
    };
  }

  async getRiskCenter() {
    const now = new Date();
    const stalePendingCutoff = addDays(now, -2);
    const recentCutoff = addDays(now, -7);

    const [
      suspendedWorkspaces,
      pendingPaymentWorkspaces,
      recentFailedPayments,
      staleTechApplications,
      approvedTechWithoutWebsite,
      recentOtps,
      expiredInvites,
    ] = await Promise.all([
      this.prisma.workspace.findMany({
        where: { status: 'SUSPENDED' },
        take: 8,
        orderBy: { updatedAt: 'desc' },
        select: { id: true, name: true, templateType: true, owner: { select: { email: true, fullName: true } } },
      }),
      this.prisma.workspace.findMany({
        where: { status: 'PENDING_PAYMENT' },
        take: 8,
        orderBy: { updatedAt: 'desc' },
        select: { id: true, name: true, templateType: true, owner: { select: { email: true, fullName: true } } },
      }),
      this.prisma.payment.findMany({
        where: { status: 'FAILED', createdAt: { gte: recentCutoff } },
        take: 12,
        orderBy: { createdAt: 'desc' },
        select: { id: true, reference: true, amountPesewas: true, createdAt: true, workspace: { select: { id: true, name: true } } },
      }),
      this.prisma.technicianApplication.findMany({
        where: { status: 'PENDING', createdAt: { lte: stalePendingCutoff } },
        take: 12,
        orderBy: { createdAt: 'asc' },
        select: { id: true, businessName: true, businessAddress: true, createdAt: true, website: true, serviceAreas: true },
      }),
      this.prisma.technicianApplication.findMany({
        where: { status: 'APPROVED', OR: [{ website: null }, { website: '' }] },
        take: 12,
        orderBy: { createdAt: 'desc' },
        select: { id: true, businessName: true, businessAddress: true, createdAt: true, serviceAreas: true },
      }),
      this.prisma.otpCode.findMany({
        where: { createdAt: { gte: recentCutoff } },
        select: { target: true, createdAt: true, purpose: true },
      }),
      this.prisma.invite.findMany({
        where: { acceptedAt: null, expiresAt: { lt: now } },
        take: 12,
        orderBy: { expiresAt: 'desc' },
        select: { id: true, email: true, phone: true, expiresAt: true, workspace: { select: { id: true, name: true } } },
      }),
    ]);

    const otpByTarget = new Map<string, number>();
    for (const otp of recentOtps) {
      otpByTarget.set(otp.target, (otpByTarget.get(otp.target) || 0) + 1);
    }
    const repeatedOtpTargets = Array.from(otpByTarget.entries())
      .filter(([, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([target, count]) => ({ target, count }));

    return {
      summary: {
        suspendedWorkspaces: suspendedWorkspaces.length,
        pendingPaymentWorkspaces: pendingPaymentWorkspaces.length,
        recentFailedPayments: recentFailedPayments.length,
        staleTechApplications: staleTechApplications.length,
        approvedTechWithoutWebsite: approvedTechWithoutWebsite.length,
        repeatedOtpTargets: repeatedOtpTargets.length,
        expiredInvites: expiredInvites.length,
      },
      queues: {
        suspendedWorkspaces,
        pendingPaymentWorkspaces,
        recentFailedPayments,
        staleTechApplications,
        approvedTechWithoutWebsite,
        repeatedOtpTargets,
        expiredInvites,
      },
    };
  }

  async getSystemHealth() {
    const now = new Date();
    const [totalAdmins, activeSessions, liveOtps, openInvites, recentWebhookEvents, totalCounts] = await Promise.all([
      this.prisma.adminUser.count(),
      this.prisma.adminSession.count({ where: { expiresAt: { gt: now } } }),
      this.prisma.otpCode.count({ where: { consumedAt: null, expiresAt: { gt: now } } }),
      this.prisma.invite.count({ where: { acceptedAt: null, expiresAt: { gt: now } } }),
      this.prisma.webhookEvent.findMany({
        orderBy: { receivedAt: 'desc' },
        take: 10,
        select: { id: true, eventType: true, reference: true, receivedAt: true, workspace: { select: { id: true, name: true } } },
      }),
      Promise.all([
        this.prisma.user.count(),
        this.prisma.workspace.count(),
        this.prisma.payment.count(),
        this.prisma.technicianApplication.count(),
      ]),
    ]);

    const [users, workspaces, payments, technicianApplications] = totalCounts;

    return {
      service: {
        api: 'healthy',
        timestamp: now.toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        nodeVersion: process.version,
        environment: process.env.NODE_ENV || 'development',
      },
      counts: {
        admins: totalAdmins,
        activeAdminSessions: activeSessions,
        liveOtps,
        openInvites,
        users,
        workspaces,
        payments,
        technicianApplications,
      },
      recentWebhookEvents,
    };
  }

  // ── Workspaces ────────────────────────────────────────────────────────────

  async listWorkspaces(page = 1, limit = 30, status?: string, templateType?: string, search?: string) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (status) where.status = status;
    if (templateType) where.templateType = templateType;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { owner: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [workspaces, total] = await Promise.all([
      this.prisma.workspace.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          name: true,
          templateType: true,
          status: true,
          planName: true,
          billingStatus: true,
          createdAt: true,
          updatedAt: true,
          owner: { select: { id: true, email: true, fullName: true, phone: true } },
          _count: {
            select: {
              members: true,
              apartmentRequests: true,
              estateRequests: true,
              officeRequests: true,
              apartmentNotices: true,
              estateNotices: true,
              officeNotices: true,
              apartmentInspections: true,
              estateInspections: true,
              officeInspections: true,
            },
          },
          payments: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, amountPesewas: true, createdAt: true } },
        },
      }),
      this.prisma.workspace.count({ where }),
    ]);

    return { workspaces: workspaces.map((workspace) => this.normalizeWorkspaceCounts(workspace)), total, page, limit };
  }

  async getWorkspace(id: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        templateType: true,
        status: true,
        planName: true,
        billingStatus: true,
        adminNotes: true,
        createdAt: true,
        updatedAt: true,
        owner: { select: { id: true, email: true, fullName: true, phone: true } },
        members: {
          include: { user: { select: { id: true, email: true, fullName: true } } },
          take: 20,
        },
        payments: { orderBy: { createdAt: 'desc' }, take: 10 },
        _count: {
          select: {
            members: true,
            apartmentRequests: true,
            estateRequests: true,
            officeRequests: true,
            apartmentNotices: true,
            estateNotices: true,
            officeNotices: true,
            apartmentInspections: true,
            estateInspections: true,
            officeInspections: true,
          },
        },
      },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    return this.normalizeWorkspaceCounts(workspace);
  }

  async activateWorkspace(id: string, adminId: string, adminEmail: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id },
      include: { owner: { select: { email: true, fullName: true } } },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');

    // Only use a subscription's currentPeriodEnd if it is in the future.
    // Using a past date would cause WorkspaceAccessGuard to immediately
    // flip the workspace back to PENDING_PAYMENT on the next request.
    const activeSub = await this.prisma.subscription.findFirst({
      where: { workspaceId: id, status: { in: ['ACTIVE', 'TRIAL'] } },
      orderBy: { currentPeriodEnd: 'desc' },
    });
    const now = new Date();
    const nextRenewal =
      activeSub?.currentPeriodEnd && activeSub.currentPeriodEnd > now
        ? activeSub.currentPeriodEnd
        : null;

    const updated = await this.prisma.workspace.update({
      where: { id },
      data: { status: 'ACTIVE', billingStatus: 'ACTIVE', nextRenewal },
    });

    // Bust the entitlements cache so the next request picks up the new status
    cacheBust(`billing:entitlements:${id}`);

    await this.audit(adminId, adminEmail, 'workspace.activate', 'Workspace', id, { previous: workspace.status });

    // Notify the workspace owner by email
    const ownerEmail = (workspace as any).owner?.email;
    const ownerName = (workspace as any).owner?.fullName || 'there';
    const workspaceName = (workspace as any).name || 'your workspace';
    if (ownerEmail) {
      this.mail.sendWorkspaceActivated(ownerEmail, ownerName, workspaceName, id).catch(() => {});
    }

    return updated;
  }

  async suspendWorkspace(id: string, adminId: string, adminEmail: string) {
    const workspace = await this.prisma.workspace.findUnique({ where: { id } });
    if (!workspace) throw new NotFoundException('Workspace not found');

    const updated = await this.prisma.workspace.update({
      where: { id },
      data: { status: 'SUSPENDED', billingStatus: 'SUSPENDED' },
    });

    await this.audit(adminId, adminEmail, 'workspace.suspend', 'Workspace', id, { previous: workspace.status });
    return updated;
  }

  async updateWorkspaceNotes(id: string, adminId: string, adminEmail: string, notes: string) {
    const workspace = await this.prisma.workspace.findUnique({ where: { id } });
    if (!workspace) throw new NotFoundException('Workspace not found');
    const updated = await this.prisma.workspace.update({
      where: { id },
      data: { adminNotes: notes ?? null },
    });
    await this.audit(adminId, adminEmail, 'workspace.update_notes', 'Workspace', id);
    return updated;
  }

  async updateWorkspaceOwnerPhone(id: string, adminId: string, adminEmail: string, phone: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id },
      select: { id: true, ownerUserId: true, owner: { select: { id: true, phone: true, fullName: true, email: true } } },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    if (!workspace.ownerUserId) throw new BadRequestException('Workspace owner not linked');

    const normalizedPhone = String(phone || '').trim() || null;

    // If the phone is already assigned to a different user, strip it from them first
    if (normalizedPhone) {
      const conflicting = await this.prisma.user.findUnique({
        where: { phone: normalizedPhone },
        select: { id: true },
      });
      if (conflicting && conflicting.id !== workspace.ownerUserId) {
        await this.prisma.user.update({
          where: { id: conflicting.id },
          data: { phone: null },
        });
      }
    }

    const updated = await this.prisma.user.update({
      where: { id: workspace.ownerUserId },
      data: { phone: normalizedPhone },
      select: { id: true, email: true, fullName: true, phone: true },
    });

    await this.audit(adminId, adminEmail, 'workspace.update_owner_phone', 'Workspace', id, {
      previousPhone: workspace.owner?.phone ?? null,
      nextPhone: updated.phone ?? null,
    });

    return updated;
  }

  private isUniqueConstraintError(error: unknown) {
    return typeof error === 'object' && error !== null && 'code' in error && (error as any).code === 'P2002';
  }

  private async backfillMissingUserPhonesFromOwnedWorkspaces() {
    const users = await this.prisma.user.findMany({
      where: {
        phone: null,
        ownedWorkspaces: { some: {} },
      },
      select: {
        id: true,
        ownedWorkspaces: {
          orderBy: { createdAt: 'desc' },
          select: {
            owner: { select: { phone: true } },
          },
        },
      },
    });

    for (const user of users) {
      const nextPhone = user.ownedWorkspaces
        .map((workspace) => String(workspace.owner?.phone || '').trim())
        .find((value) => !!value);

      if (!nextPhone) continue;

      try {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { phone: nextPhone },
        });
      } catch (error) {
        if (!this.isUniqueConstraintError(error)) throw error;
      }
    }
  }

  async fixWorkspacePayment(id: string, adminId: string, adminEmail: string) {
    const workspace = await this.prisma.workspace.findUnique({ where: { id } });
    if (!workspace) throw new NotFoundException('Workspace not found');

    // Find the most recent subscription so we can set a valid renewal date.
    const latestSub = await this.prisma.subscription.findFirst({
      where: { workspaceId: id },
      orderBy: { currentPeriodEnd: 'desc' },
    });

    // Extend renewal: use the subscription period end if available,
    // otherwise grant 30 days from now as a manual grace period.
    const now = new Date();
    const nextRenewal =
      latestSub?.currentPeriodEnd && latestSub.currentPeriodEnd > now
        ? latestSub.currentPeriodEnd
        : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    await this.prisma.$transaction(async (tx) => {
      // Mark pending/failed payments as PAID
      await tx.payment.updateMany({
        where: { workspaceId: id, status: { in: ['PENDING', 'FAILED'] } },
        data: { status: 'PAID', paidAt: now },
      });

      // Activate the workspace and clear billing issues
      await tx.workspace.update({
        where: { id },
        data: { status: 'ACTIVE', billingStatus: 'ACTIVE', nextRenewal },
      });

      // Also mark the subscription as ACTIVE if it was PAST_DUE or CANCELED
      if (latestSub && latestSub.status !== 'ACTIVE' && latestSub.status !== 'TRIAL') {
        await tx.subscription.update({
          where: { id: latestSub.id },
          data: { status: 'ACTIVE', currentPeriodEnd: nextRenewal },
        });
      }
    });

    await this.audit(adminId, adminEmail, 'workspace.fix_payment', 'Workspace', id);
    return { ok: true };
  }

  // ── Users ─────────────────────────────────────────────────────────────────

  async listUsers(page = 1, limit = 30, search?: string) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { fullName: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    await this.backfillMissingUserPhonesFromOwnedWorkspaces();

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          _count: { select: { memberships: true } },
          memberships: {
            take: 3,
            include: { workspace: { select: { id: true, name: true, templateType: true } } },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { users, total, page, limit };
  }

  async updateUserPhone(id: string, adminId: string, adminEmail: string, phone: string) {
    const existing = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, fullName: true, phone: true },
    });
    if (!existing) throw new NotFoundException('User not found');

    const normalizedPhone = String(phone || '').trim();

    try {
      const updated = await this.prisma.user.update({
        where: { id },
        data: { phone: normalizedPhone || null },
        select: { id: true, email: true, fullName: true, phone: true, createdAt: true, updatedAt: true },
      });

      await this.audit(adminId, adminEmail, 'user.update_phone', 'User', id, {
        previousPhone: existing.phone ?? null,
        nextPhone: updated.phone ?? null,
      });

      return updated;
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new BadRequestException('Phone already belongs to another user');
      }
      throw error;
    }
  }

  // ── Technician Applications ───────────────────────────────────────────────

  async listTechApplications(page = 1, limit = 30, status?: string) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (status) where.status = status;

    const [applications, total] = await Promise.all([
      this.prisma.technicianApplication.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.technicianApplication.count({ where }),
    ]);

    return { applications, total, page, limit };
  }

  async getTechApplication(id: string) {
    const app = await this.prisma.technicianApplication.findUnique({ where: { id } });
    if (!app) throw new NotFoundException('Application not found');
    return app;
  }

  async approveTechApplication(id: string, adminId: string, adminEmail: string, note?: string) {
    const app = await this.prisma.technicianApplication.findUnique({ where: { id } });
    if (!app) throw new NotFoundException('Application not found');
    // Allow re-approving a rejected application (mistake recovery)

    const updated = await this.prisma.technicianApplication.update({
      where: { id },
      data: { status: 'APPROVED', reviewNote: note ?? null },
    });

    await this.audit(adminId, adminEmail, 'technician.approve', 'TechnicianApplication', id, { businessName: app.businessName });
    await this.sendTechnicianStatusEmail(app.email, app.businessName, app.contactPerson, 'approved', note);
    return updated;
  }

  async rejectTechApplication(id: string, adminId: string, adminEmail: string, note?: string) {
    const app = await this.prisma.technicianApplication.findUnique({ where: { id } });
    if (!app) throw new NotFoundException('Application not found');

    const updated = await this.prisma.technicianApplication.update({
      where: { id },
      data: { status: 'REJECTED', reviewNote: note ?? null },
    });

    await this.audit(adminId, adminEmail, 'technician.reject', 'TechnicianApplication', id, { businessName: app.businessName });
    await this.sendTechnicianStatusEmail(app.email, app.businessName, app.contactPerson, 'rejected', note);
    return updated;
  }

  async suspendTechApplication(id: string, adminId: string, adminEmail: string) {
    const app = await this.prisma.technicianApplication.findUnique({ where: { id } });
    if (!app) throw new NotFoundException('Application not found');

    const updated = await this.prisma.technicianApplication.update({
      where: { id },
      data: { status: 'REJECTED', reviewNote: 'Suspended by admin' },
    });
    await this.audit(adminId, adminEmail, 'technician.suspend', 'TechnicianApplication', id);
    await this.sendTechnicianStatusEmail(app.email, app.businessName, app.contactPerson, 'suspended');
    return updated;
  }

  private async sendTechnicianStatusEmail(
    to: string,
    businessName: string,
    contactPerson: string,
    action: 'approved' | 'rejected' | 'suspended',
    note?: string | null,
  ): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM || process.env.EMAIL_FROM || 'TomaFix <onboarding@resend.dev>';
    const logoUrl = process.env.EMAIL_LOGO_URL || 'https://www.tomafix.com/bimi-logo-preview.jpg';
    const appUrl = process.env.APP_URL || 'https://www.tomafix.com';

    const config = {
      approved: {
        subject: `🎉 Your business listing is approved — ${businessName}`,
        headline: 'Your business is now live on TomaFix',
        color: '#E8943A',
        badge: 'APPROVED',
        badgeBg: 'rgba(232,148,58,0.15)',
        body: `
          <p style="margin:0 0 14px;">Hi <strong>${contactPerson}</strong>,</p>
          <p style="margin:0 0 14px;">Great news — <strong>${businessName}</strong> has been reviewed and approved by the TomaFix team. Your business is now live in the public technician directory.</p>
          <p style="margin:0 0 14px;">Property owners, apartment managers, and facility teams can now search and contact you directly by service type and location.</p>
          ${note ? `<div style="margin:16px 0;padding:14px 16px;border-radius:12px;background:rgba(232,148,58,0.10);border:1px solid rgba(232,148,58,0.25);color:#E8943A;font-size:13px;"><strong>Note from reviewer:</strong> ${note}</div>` : ''}
          <p style="margin:0 0 20px;">You can view your live listing on the directory below.</p>
          <a href="${appUrl}/find-technician" style="display:inline-block;padding:13px 24px;border-radius:12px;background:linear-gradient(120deg,#E8943A,#F5B668);color:#080E1C;font-weight:800;font-size:14px;text-decoration:none;">View the directory</a>
        `,
      },
      rejected: {
        subject: `TomaFix application update — ${businessName}`,
        headline: 'Your listing application was not approved',
        color: '#E07070',
        badge: 'NOT APPROVED',
        badgeBg: 'rgba(224,112,112,0.12)',
        body: `
          <p style="margin:0 0 14px;">Hi <strong>${contactPerson}</strong>,</p>
          <p style="margin:0 0 14px;">After reviewing your application for <strong>${businessName}</strong>, we were unable to approve your listing at this time.</p>
          ${note ? `<div style="margin:16px 0;padding:14px 16px;border-radius:12px;background:rgba(224,112,112,0.10);border:1px solid rgba(224,112,112,0.25);color:#E07070;font-size:13px;"><strong>Reason:</strong> ${note}</div>` : '<p style="margin:0 0 14px;color:#8899aa;font-size:13px;">Our team will reach out if we need additional information.</p>'}
          <p style="margin:0 0 14px;">You are welcome to reapply with updated or more complete business details. Make sure your operating address, contact information, and service coverage are accurate and verifiable.</p>
          <a href="${appUrl}/join-technician" style="display:inline-block;padding:13px 24px;border-radius:12px;background:rgba(255,255,255,0.08);color:#e6edf6;font-weight:700;font-size:14px;text-decoration:none;border:1px solid rgba(255,255,255,0.14);">Reapply now</a>
        `,
      },
      suspended: {
        subject: `Important: Your TomaFix listing has been suspended — ${businessName}`,
        headline: 'Your listing has been suspended',
        color: '#E07070',
        badge: 'SUSPENDED',
        badgeBg: 'rgba(224,112,112,0.12)',
        body: `
          <p style="margin:0 0 14px;">Hi <strong>${contactPerson}</strong>,</p>
          <p style="margin:0 0 14px;">Your listing for <strong>${businessName}</strong> has been suspended by the TomaFix team and is no longer visible in the public directory.</p>
          <p style="margin:0 0 14px;">This may be due to a trust concern, outdated contact details, or a policy issue. If you believe this was done in error or would like to discuss reinstatement, please reach out to us directly.</p>
          <a href="mailto:support@tomafix.com" style="display:inline-block;padding:13px 24px;border-radius:12px;background:rgba(255,255,255,0.08);color:#e6edf6;font-weight:700;font-size:14px;text-decoration:none;border:1px solid rgba(255,255,255,0.14);">Contact support</a>
        `,
      },
    }[action];

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;background:#080E1C;padding:24px 14px;">
        <div style="max-width:600px;margin:0 auto;background:#0F1829;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;color:#e6edf6;">
          <div style="padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.07);background:rgba(232,148,58,0.05);">
            <img src="${logoUrl}" alt="TomaFix" style="max-width:150px;height:auto;display:block;" />
          </div>
          <div style="padding:24px 22px;">
            <div style="display:inline-block;padding:5px 12px;border-radius:999px;background:${config.badgeBg};color:${config.color};font-size:11px;font-weight:800;letter-spacing:0.12em;margin-bottom:14px;">${config.badge}</div>
            <h2 style="margin:0 0 18px;font-size:22px;font-weight:900;color:#f1f5f9;line-height:1.2;">${config.headline}</h2>
            <div style="font-size:14px;line-height:1.7;color:#c4d0da;">
              ${config.body}
            </div>
          </div>
          <div style="padding:14px 22px;border-top:1px solid rgba(255,255,255,0.06);font-size:11px;color:rgba(230,237,246,0.40);">
            TomaFix · Technician Marketplace · <a href="${appUrl}" style="color:rgba(232,148,58,0.7);text-decoration:none;">tomafix.com</a>
          </div>
        </div>
      </div>
    `;

    if (!apiKey) {
      console.warn(`[TECHNICIAN EMAIL] ${action.toUpperCase()} → ${to}`);
      return;
    }

    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject: config.subject, html }),
      });
    } catch (err) {
      console.error(`[TECHNICIAN EMAIL] Failed to send ${action} email to ${to}:`, err);
    }
  }

  // ── Admin Users (SUPER_ADMIN only) ────────────────────────────────────────

  async createAdminUser(email: string, fullName: string, password: string, role: string) {
    assertAdminRole(role);
    const normalizedEmail = email.trim().toLowerCase();
    if (!isAdminEmailAllowed(normalizedEmail)) {
      throw new BadRequestException('Email is not in the allowed admin email list');
    }
    const existing = await this.prisma.adminUser.findUnique({ where: { email: normalizedEmail } });
    if (existing) throw new BadRequestException('Admin with this email already exists');

    return this.prisma.adminUser.create({
      data: {
        email: normalizedEmail,
        fullName,
        passwordHash: hashPassword(password),
        role,
      },
      select: { id: true, email: true, fullName: true, role: true, createdAt: true },
    });
  }

  async updateAdminUser(
    id: string,
    adminId: string,
    adminEmail: string,
    input: { role?: string; isActive?: boolean },
  ) {
    const existing = await this.prisma.adminUser.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Admin not found');

    if (input.role) assertAdminRole(input.role);

    if (existing.id === adminId) {
      if (input.isActive === false) {
        throw new BadRequestException('You cannot deactivate your current super admin account');
      }
      if (input.role && input.role !== 'SUPER_ADMIN') {
        throw new BadRequestException('You cannot demote your current super admin account');
      }
    }

    const updated = await this.prisma.adminUser.update({
      where: { id },
      data: {
        ...(input.role ? { role: input.role as ValidAdminRole } : {}),
        ...(typeof input.isActive === 'boolean' ? { isActive: input.isActive } : {}),
      },
      select: { id: true, email: true, fullName: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
    });

    await this.audit(adminId, adminEmail, 'admin.update', 'AdminUser', id, {
      previousRole: existing.role,
      nextRole: updated.role,
      previousActive: existing.isActive,
      nextActive: updated.isActive,
    });

    return updated;
  }

  async listAdminUsers() {
    return this.prisma.adminUser.findMany({
      select: { id: true, email: true, fullName: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  private hashAdminOtp(code: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(code, salt, 32).toString('hex');
    return `${salt}:${hash}`;
  }

  private verifyAdminOtpHash(code: string, stored: string): boolean {
    const [salt, hash] = (stored ?? '').split(':');
    if (!salt || !hash) return false;
    try {
      const derived = crypto.scryptSync(code, salt, 32);
      const expected = Buffer.from(hash, 'hex');
      if (expected.length !== derived.length) return false;
      return crypto.timingSafeEqual(expected, derived);
    } catch {
      return false;
    }
  }

  private async sendAdminOtpEmail(email: string, fullName: string, code: string): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM || process.env.EMAIL_FROM || 'TomaFix <onboarding@resend.dev>';
    const logoUrl = process.env.EMAIL_LOGO_URL || 'https://www.tomafix.com/bimi-logo-preview.jpg';

    const bodyHtml = `
      <h2 style="margin:0 0 12px;font-size:20px;">Admin verification code</h2>
      <p style="margin:0 0 16px;color:#c4d0da;">Hi ${fullName}, use this code to complete your sign-in to the TomaFix admin panel:</p>
      <div style="font-size:32px;font-weight:900;letter-spacing:10px;padding:14px 20px;border-radius:12px;background:rgba(232,148,58,0.12);border:1px solid rgba(232,148,58,0.28);color:#E8943A;display:inline-block;margin-bottom:16px;">${code}</div>
      <p style="margin:0;color:#8899aa;font-size:13px;">This code expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
    `;

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;background:#080E1C;padding:24px 14px;">
        <div style="max-width:580px;margin:0 auto;background:#0F1829;border:1px solid rgba(232,148,58,0.18);border-radius:16px;overflow:hidden;color:#e6edf6;">
          <div style="padding:16px 20px;border-bottom:1px solid rgba(232,148,58,0.12);background:rgba(232,148,58,0.06);">
            <img src="${logoUrl}" alt="TomaFix" style="max-width:150px;height:auto;display:block;" />
          </div>
          <div style="padding:24px 20px;line-height:1.6;font-size:14px;">${bodyHtml}</div>
          <div style="padding:12px 20px;border-top:1px solid rgba(255,255,255,0.06);font-size:11px;color:rgba(230,237,246,0.45);">
            TomaFix Admin Panel · Restricted access
          </div>
        </div>
      </div>
    `;

    if (!apiKey) {
      console.warn(`[ADMIN 2FA OTP] ${email} → ${code}`);
      return;
    }

    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [email], subject: 'Your TomaFix admin verification code', html }),
      });
    } catch (err) {
      console.error('[ADMIN 2FA] Email send failed:', err);
      // Don't throw – OTP is in DB, admin can retry
    }
  }

  private async sendAdminPasswordResetEmail(email: string, fullName: string, token: string): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM || process.env.EMAIL_FROM || 'TomaFix <onboarding@resend.dev>';
    const logoUrl = process.env.EMAIL_LOGO_URL || 'https://www.tomafix.com/bimi-logo-preview.jpg';
    const resetUrl = `${this.getAdminAppUrl()}/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;background:#080E1C;padding:24px 14px;">
        <div style="max-width:580px;margin:0 auto;background:#0F1829;border:1px solid rgba(232,148,58,0.18);border-radius:16px;overflow:hidden;color:#e6edf6;">
          <div style="padding:16px 20px;border-bottom:1px solid rgba(232,148,58,0.12);background:rgba(232,148,58,0.06);">
            <img src="${logoUrl}" alt="TomaFix" style="max-width:150px;height:auto;display:block;" />
          </div>
          <div style="padding:24px 20px;line-height:1.6;font-size:14px;">
            <h2 style="margin:0 0 12px;font-size:20px;">Reset your admin password</h2>
            <p style="margin:0 0 14px;color:#c4d0da;">Hi ${fullName}, we received a request to reset your TomaFix admin password.</p>
            <p style="margin:0 0 18px;color:#c4d0da;">Use the secure link below to choose a new password. This link expires in 30 minutes.</p>
            <a href="${resetUrl}" style="display:inline-block;padding:13px 24px;border-radius:12px;background:linear-gradient(120deg,#E8943A,#F5B668);color:#080E1C;font-weight:800;font-size:14px;text-decoration:none;">Reset password</a>
            <p style="margin:18px 0 0;color:#8899aa;font-size:12px;word-break:break-all;">If the button does not open, paste this link into your browser:<br />${resetUrl}</p>
          </div>
          <div style="padding:12px 20px;border-top:1px solid rgba(255,255,255,0.06);font-size:11px;color:rgba(230,237,246,0.45);">
            TomaFix Admin Panel · Restricted access
          </div>
        </div>
      </div>
    `;

    if (!apiKey) {
      console.warn(`[ADMIN RESET] ${email} → ${resetUrl}`);
      return;
    }

    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [email], subject: 'Reset your TomaFix admin password', html }),
      });
    } catch (err) {
      console.error('[ADMIN RESET] Email send failed:', err);
    }
  }

  // ── Broadcasts ────────────────────────────────────────────────────────────

  async listBroadcasts() {
    return this.prisma.adminBroadcast.findMany({
      orderBy: { sentAt: 'desc' },
      take: 50,
    });
  }

  async sendBroadcast(senderId: string, dto: {
    subject: string;
    body: string;
    audience: 'WORKSPACE_OWNERS' | 'ALL_USERS' | 'TEST';
    testEmail?: string;
  }) {
    const { subject, body, audience, testEmail } = dto;
    if (!subject?.trim()) throw new BadRequestException('Subject is required');
    if (!body?.trim()) throw new BadRequestException('Body is required');

    let recipients: Array<{ email: string; name: string }> = [];

    if (audience === 'TEST') {
      if (!testEmail?.trim()) throw new BadRequestException('Test email is required for TEST audience');
      recipients = [{ email: testEmail.trim(), name: 'Test Recipient' }];
    } else if (audience === 'WORKSPACE_OWNERS') {
      const members = await this.prisma.workspaceMember.findMany({
        where: { role: 'OWNER_ADMIN' },
        include: { user: { select: { email: true, fullName: true } } },
        distinct: ['userId'],
      });
      recipients = members
        .filter((m) => m.user?.email)
        .map((m) => ({ email: m.user.email!, name: m.user.fullName || m.user.email! }));
    } else {
      // ALL_USERS
      const users = await this.prisma.user.findMany({
        where: { email: { not: null } },
        select: { email: true, fullName: true },
        take: 1000,
      });
      recipients = users
        .filter((u) => u.email)
        .map((u) => ({ email: u.email!, name: u.fullName || u.email! }));
    }

    if (recipients.length === 0) {
      throw new BadRequestException('No recipients found for this audience');
    }

    // Send emails (fire-and-forget per recipient)
    let sent = 0;
    let failed = 0;
    for (const r of recipients) {
      try {
        await this.mail.send(
          r.email,
          subject,
          `<p>Hi ${r.name},</p>${body}<p style="margin-top:24px;font-size:12px;color:rgba(230,237,246,0.5);">This is a platform message from the TomaFix team.</p>`,
        );
        sent++;
      } catch {
        failed++;
      }
    }

    // Store broadcast record
    await this.prisma.adminBroadcast.create({
      data: {
        subject,
        body,
        audience,
        sentByAdminId: senderId,
        recipientCount: recipients.length,
        sentCount: sent,
        failedCount: failed,
      },
    });

    return { ok: true, recipientCount: recipients.length, sent, failed };
  }
}
