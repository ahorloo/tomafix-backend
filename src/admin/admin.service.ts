import { Injectable, UnauthorizedException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';

// Simple password hashing using Node's built-in crypto (no bcrypt dep needed)
function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password + (process.env.ADMIN_SECRET || 'tf-admin-salt')).digest('hex');
}

function generateToken(): string {
  return crypto.randomBytes(48).toString('hex');
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
  constructor(private readonly prisma: PrismaService) {}

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
    const admin = await this.prisma.adminUser.findUnique({ where: { email: email.toLowerCase() } });
    if (!admin || !admin.isActive) throw new UnauthorizedException('Invalid credentials');

    const hash = hashPassword(password);
    if (hash !== admin.passwordHash) throw new UnauthorizedException('Invalid credentials');

    const token = generateToken();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12); // 12h

    await this.prisma.adminSession.create({
      data: { adminUserId: admin.id, token, expiresAt },
    });

    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });

    return {
      token,
      admin: { id: admin.id, email: admin.email, fullName: admin.fullName, role: admin.role },
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
          _count: { select: { members: true, apartmentRequests: true } },
          payments: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, amountPesewas: true, createdAt: true } },
        },
      }),
      this.prisma.workspace.count({ where }),
    ]);

    return { workspaces, total, page, limit };
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
        _count: { select: { members: true, apartmentRequests: true, notices: true, inspections: true } },
      },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    return workspace;
  }

  async activateWorkspace(id: string, adminId: string, adminEmail: string) {
    const workspace = await this.prisma.workspace.findUnique({ where: { id } });
    if (!workspace) throw new NotFoundException('Workspace not found');

    const updated = await this.prisma.workspace.update({
      where: { id },
      data: { status: 'ACTIVE' },
    });

    await this.audit(adminId, adminEmail, 'workspace.activate', 'Workspace', id, { previous: workspace.status });
    return updated;
  }

  async suspendWorkspace(id: string, adminId: string, adminEmail: string) {
    const workspace = await this.prisma.workspace.findUnique({ where: { id } });
    if (!workspace) throw new NotFoundException('Workspace not found');

    const updated = await this.prisma.workspace.update({
      where: { id },
      data: { status: 'SUSPENDED' },
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

  async fixWorkspacePayment(id: string, adminId: string, adminEmail: string) {
    const workspace = await this.prisma.workspace.findUnique({ where: { id } });
    if (!workspace) throw new NotFoundException('Workspace not found');

    // Mark most recent PENDING/FAILED payment as PAID and activate workspace
    await this.prisma.$transaction([
      this.prisma.payment.updateMany({
        where: { workspaceId: id, status: { in: ['PENDING', 'FAILED'] } },
        data: { status: 'PAID', paidAt: new Date() },
      }),
      this.prisma.workspace.update({
        where: { id },
        data: { status: 'ACTIVE' },
      }),
    ]);

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
    if (app.status === 'APPROVED') throw new BadRequestException('Already approved');

    const updated = await this.prisma.technicianApplication.update({
      where: { id },
      data: { status: 'APPROVED', reviewNote: note ?? null },
    });

    await this.audit(adminId, adminEmail, 'technician.approve', 'TechnicianApplication', id, { businessName: app.businessName });
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
    return updated;
  }

  async suspendTechApplication(id: string, adminId: string, adminEmail: string) {
    const updated = await this.prisma.technicianApplication.update({
      where: { id },
      data: { status: 'REJECTED', reviewNote: 'Suspended by admin' },
    });
    await this.audit(adminId, adminEmail, 'technician.suspend', 'TechnicianApplication', id);
    return updated;
  }

  // ── Admin Users (SUPER_ADMIN only) ────────────────────────────────────────

  async createAdminUser(email: string, fullName: string, password: string, role: string) {
    assertAdminRole(role);
    const existing = await this.prisma.adminUser.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) throw new BadRequestException('Admin with this email already exists');

    return this.prisma.adminUser.create({
      data: {
        email: email.toLowerCase(),
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
}
