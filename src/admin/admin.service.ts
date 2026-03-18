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

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

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
        include: {
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
      include: {
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
    const existing = await this.prisma.adminUser.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) throw new BadRequestException('Admin with this email already exists');

    return this.prisma.adminUser.create({
      data: {
        email: email.toLowerCase(),
        fullName,
        passwordHash: hashPassword(password),
        role: role as any,
      },
      select: { id: true, email: true, fullName: true, role: true, createdAt: true },
    });
  }

  async listAdminUsers() {
    return this.prisma.adminUser.findMany({
      select: { id: true, email: true, fullName: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
