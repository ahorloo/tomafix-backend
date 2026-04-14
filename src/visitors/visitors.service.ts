import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVisitorDto } from './dto/create-visitor.dto';
import { ScanVisitorDto } from './dto/scan-visitor.dto';
import { TemplateType, VisitorStatus } from '@prisma/client';
import { MailService } from '../mail/mail.service';
import { SmsService } from '../sms/sms.service';

@Injectable()
export class VisitorsService {
  private readonly logger = new Logger(VisitorsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly sms: SmsService,
  ) {}

  private async getWorkspace(workspaceId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, name: true, templateType: true },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    return workspace;
  }

  private visitorDelegate(templateType: TemplateType) {
    switch (templateType) {
      case TemplateType.ESTATE:
        return this.prisma.estateVisitor as any;
      case TemplateType.OFFICE:
        return this.prisma.officeVisitor as any;
      default:
        return this.prisma.apartmentVisitor as any;
    }
  }

  async createVisitor(workspaceId: string, userId: string, dto: CreateVisitorDto) {
    const [workspace, inviter] = await Promise.all([
      this.getWorkspace(workspaceId),
      userId ? this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true, email: true } }) : null,
    ]);
    const repo = this.visitorDelegate(workspace.templateType);
    const invitedByName = inviter?.fullName || inviter?.email || null;

    const isOffice = workspace.templateType === TemplateType.OFFICE;
    const locationFields = isOffice
      ? { areaId: dto.areaId || null, areaName: dto.areaName || null }
      : { unitId: dto.unitId || null, unitLabel: dto.unitLabel || null };

    const visitor = await repo.create({
      data: {
        workspaceId,
        invitedByUserId: userId || null,
        invitedByName,
        name: dto.name,
        phone: dto.phone || null,
        email: dto.email,
        purpose: dto.purpose || null,
        ...locationFields,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : null,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
        notes: dto.notes || null,
        status: VisitorStatus.EXPECTED,
      },
    });

    const workspaceName = workspace?.name || 'TomaFix property';

    if (visitor.email) {
      this.mail.sendVisitorInviteEmail({
        to: visitor.email,
        visitorName: visitor.name,
        workspaceName,
        unitLabel: visitor.unitLabel,
        validUntil: visitor.validUntil,
        qrToken: visitor.qrToken,
      }).catch((e) => this.logger.warn(`Visitor invite email failed: ${e?.message || e}`));
    }

    if (String(process.env.NOTIFICATION_SMS_ENABLED || 'false').toLowerCase() === 'true' && visitor.phone) {
      this.sms.sendVisitorInviteSms({
        to: visitor.phone,
        visitorName: visitor.name,
        workspaceName,
        unitLabel: visitor.unitLabel,
        validUntil: visitor.validUntil,
      }).catch((e) => this.logger.warn(`Visitor invite SMS failed: ${e?.message || e}`));
    }

    return visitor;
  }

  async listVisitors(workspaceId: string, status?: string, limit = 50) {
    const workspace = await this.getWorkspace(workspaceId);
    const repo = this.visitorDelegate(workspace.templateType);
    const where: any = { workspaceId };
    if (status) where.status = status as VisitorStatus;

    const visitors = await repo.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return visitors;
  }

  async getVisitor(workspaceId: string, visitorId: string) {
    const workspace = await this.getWorkspace(workspaceId);
    const repo = this.visitorDelegate(workspace.templateType);
    const visitor = await repo.findFirst({
      where: { id: visitorId, workspaceId },
    });
    if (!visitor) throw new NotFoundException('Visitor not found');
    return visitor;
  }

  async getVisitorByToken(qrToken: string) {
    for (const repo of [this.prisma.apartmentVisitor as any, this.prisma.estateVisitor as any, this.prisma.officeVisitor as any]) {
      const visitor = await repo.findUnique({ where: { qrToken } });
      if (visitor) return visitor;
    }
    throw new NotFoundException('Invalid or expired visitor pass');
  }

  async scanVisitor(workspaceId: string, scannerId: string, dto: ScanVisitorDto) {
    // Accept full pass URL or raw token — strip URL prefix if present
    const rawToken = String(dto.qrToken || '').trim();
    const qrToken = rawToken.includes('/visitor-pass/')
      ? rawToken.split('/visitor-pass/').pop()!.split('?')[0].split('#')[0]
      : rawToken;
    dto = { ...dto, qrToken };

    const [workspace, scanner] = await Promise.all([
      this.getWorkspace(workspaceId),
      scannerId ? this.prisma.user.findUnique({ where: { id: scannerId }, select: { fullName: true, email: true } }) : null,
    ]);
    const scannerName = scanner?.fullName || scanner?.email || 'Guard';
    const repo = this.visitorDelegate(workspace.templateType);
    const visitor = await repo.findUnique({ where: { qrToken: dto.qrToken } });
    if (!visitor) throw new NotFoundException('Invalid QR code — no visitor found');
    if (visitor.workspaceId !== workspaceId) throw new BadRequestException('This visitor pass is not for this property');
    if (visitor.status === VisitorStatus.CANCELLED) throw new BadRequestException('This visitor pass has been cancelled');
    if (visitor.status === VisitorStatus.EXPIRED) throw new BadRequestException('This visitor pass has expired');

    // Check validity window
    const now = new Date();
    if (visitor.validFrom && now < visitor.validFrom) {
      throw new BadRequestException(`This pass is only valid from ${visitor.validFrom.toLocaleDateString()}`);
    }
    if (visitor.validUntil && now > visitor.validUntil) {
      await repo.update({ where: { id: visitor.id }, data: { status: VisitorStatus.EXPIRED } });
      throw new BadRequestException('This visitor pass has expired');
    }

    if (visitor.status === VisitorStatus.EXPECTED) {
      // Check in
      const updated = await repo.update({
        where: { id: visitor.id },
        data: {
          status: VisitorStatus.CHECKED_IN,
          checkedInAt: now,
          checkedInByName: scannerName,
        },
      });
      // Notify the resident who invited this visitor
      this.notifyInviterCheckedIn(workspace, updated).catch(() => {});
      return { action: 'CHECKED_IN', visitor: updated };
    }

    if (visitor.status === VisitorStatus.CHECKED_IN) {
      // Check out
      const updated = await repo.update({
        where: { id: visitor.id },
        data: {
          status: VisitorStatus.CHECKED_OUT,
          checkedOutAt: now,
          checkedOutByName: scannerName,
        },
      });
      // Notify the resident who invited this visitor
      this.notifyInviterCheckedOut(workspace, updated).catch(() => {});
      return { action: 'CHECKED_OUT', visitor: updated };
    }

    if (visitor.status === VisitorStatus.CHECKED_OUT) {
      throw new BadRequestException(`${visitor.name} has already checked out`);
    }

    throw new BadRequestException('Cannot process this visitor pass');
  }

  async updateVisitor(
    workspaceId: string,
    visitorId: string,
    requesterId: string,
    requesterRole: string,
    dto: { purpose?: string; phone?: string; validUntil?: string | null; notes?: string },
  ) {
    const workspace = await this.getWorkspace(workspaceId);
    const repo = this.visitorDelegate(workspace.templateType);
    const visitor = await repo.findFirst({ where: { id: visitorId, workspaceId } });
    if (!visitor) throw new NotFoundException('Visitor not found');

    // Only the inviter or an owner/manager can edit
    const isAdmin = requesterRole === 'OWNER_ADMIN' || requesterRole === 'MANAGER';
    const isOwner = visitor.invitedByUserId && visitor.invitedByUserId === requesterId;
    if (!isAdmin && !isOwner) {
      throw new BadRequestException('You can only edit visitor passes you created.');
    }

    if (visitor.status !== VisitorStatus.EXPECTED) {
      throw new BadRequestException('Only passes with Expected status can be edited.');
    }

    const updated = await repo.update({
      where: { id: visitorId },
      data: {
        ...(dto.purpose !== undefined && { purpose: dto.purpose || null }),
        ...(dto.phone !== undefined && { phone: dto.phone || null }),
        ...(dto.notes !== undefined && { notes: dto.notes || null }),
        ...(dto.validUntil !== undefined && {
          validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
        }),
      },
    });

    // Notify the visitor that their pass has been updated
    if (updated.email) {
      this.mail.sendVisitorPassUpdatedEmail({
        to: updated.email,
        visitorName: updated.name,
        workspaceName: workspace.name,
        unitLabel: updated.unitLabel ?? null,
        purpose: updated.purpose ?? null,
        validUntil: updated.validUntil ?? null,
        qrToken: updated.qrToken,
      }).catch((e) => this.logger.warn(`Visitor pass update email failed: ${e?.message || e}`));
    }

    return updated;
  }

  async cancelVisitor(workspaceId: string, visitorId: string) {
    const workspace = await this.getWorkspace(workspaceId);
    const repo = this.visitorDelegate(workspace.templateType);
    const visitor = await repo.findFirst({ where: { id: visitorId, workspaceId } });
    if (!visitor) throw new NotFoundException('Visitor not found');
    if (visitor.status === VisitorStatus.CHECKED_IN) {
      throw new BadRequestException('Cannot cancel a visitor who is currently checked in');
    }
    return repo.update({
      where: { id: visitorId },
      data: { status: VisitorStatus.CANCELLED },
    });
  }

  async createWalkIn(workspaceId: string, scannerId: string, dto: { name: string; phone?: string; purpose?: string; unitId?: string; unitLabel?: string; areaId?: string; areaName?: string }) {
    const [workspace, scanner] = await Promise.all([
      this.getWorkspace(workspaceId),
      scannerId ? this.prisma.user.findUnique({ where: { id: scannerId }, select: { fullName: true, email: true } }) : null,
    ]);
    const repo = this.visitorDelegate(workspace.templateType);
    const scannerName = scanner?.fullName || scanner?.email || 'Guard';
    const now = new Date();

    const isOffice = workspace.templateType === 'OFFICE';
    const locationFields = isOffice
      ? { areaId: dto.areaId || null, areaName: dto.areaName || null }
      : { unitId: dto.unitId || null, unitLabel: dto.unitLabel || null };

    const visitor = await repo.create({
      data: {
        workspaceId,
        invitedByUserId: null,
        invitedByName: null,
        name: dto.name,
        phone: dto.phone || null,
        email: null,
        purpose: dto.purpose || 'Walk-in',
        ...locationFields,
        validFrom: now,
        validUntil: new Date(now.getTime() + 8 * 60 * 60 * 1000), // 8 hours from now
        status: VisitorStatus.CHECKED_IN,
        checkedInAt: now,
        checkedInByName: scannerName,
      },
    });

    return { action: 'WALK_IN_CHECKED_IN', visitor };
  }

  async extendVisitor(workspaceId: string, visitorId: string, validUntil: string) {
    const workspace = await this.getWorkspace(workspaceId);
    const repo = this.visitorDelegate(workspace.templateType);
    const visitor = await repo.findFirst({ where: { id: visitorId, workspaceId } });
    if (!visitor) throw new NotFoundException('Visitor not found');
    if (visitor.status === VisitorStatus.CANCELLED || visitor.status === VisitorStatus.EXPIRED) {
      throw new BadRequestException('Cannot extend a cancelled or expired pass');
    }
    const newDate = new Date(validUntil);
    if (isNaN(newDate.getTime())) throw new BadRequestException('Invalid date');
    return repo.update({ where: { id: visitorId }, data: { validUntil: newDate } });
  }

  async manualCheckIn(workspaceId: string, visitorId: string, userId: string, role: string) {
    const canAct = role === 'OWNER_ADMIN' || role === 'MANAGER' || role === 'GUARD';
    if (!canAct) throw new BadRequestException('Only admins and guards can manually check in visitors');
    const workspace = await this.getWorkspace(workspaceId);
    const repo = this.visitorDelegate(workspace.templateType);
    const visitor = await repo.findFirst({ where: { id: visitorId, workspaceId } });
    if (!visitor) throw new NotFoundException('Visitor not found');
    if (visitor.status !== VisitorStatus.EXPECTED) {
      throw new BadRequestException('Only expected visitors can be checked in');
    }
    const user = userId ? await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true, email: true } }) : null;
    const checkerName = user?.fullName || user?.email || 'Guard';
    const updated = await repo.update({
      where: { id: visitorId },
      data: { status: VisitorStatus.CHECKED_IN, checkedInAt: new Date(), checkedInByName: checkerName },
    });
    this.notifyInviterCheckedIn(workspace, updated).catch(() => {});
    return { action: 'CHECKED_IN', visitor: updated };
  }

  async manualCheckOut(workspaceId: string, visitorId: string, userId: string) {
    const workspace = await this.getWorkspace(workspaceId);
    const repo = this.visitorDelegate(workspace.templateType);
    const visitor = await repo.findFirst({ where: { id: visitorId, workspaceId } });
    if (!visitor) throw new NotFoundException('Visitor not found');
    if (visitor.status !== VisitorStatus.CHECKED_IN) {
      throw new BadRequestException('Only checked-in visitors can be checked out');
    }
    const user = userId ? await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true, email: true } }) : null;
    const checkerName = user?.fullName || user?.email || 'Guard';
    const updated = await repo.update({
      where: { id: visitorId },
      data: { status: VisitorStatus.CHECKED_OUT, checkedOutAt: new Date(), checkedOutByName: checkerName },
    });
    this.notifyInviterCheckedOut(workspace, updated).catch(() => {});
    return { action: 'CHECKED_OUT', visitor: updated };
  }

  private async notifyInviterCheckedIn(workspace: { id: string; name: string }, visitor: any) {
    if (!visitor.invitedByUserId) return;
    const inviter = await this.prisma.user.findUnique({
      where: { id: visitor.invitedByUserId },
      select: { email: true, fullName: true },
    });
    if (!inviter?.email) return;
    this.mail.sendVisitorCheckedInEmail({
      to: inviter.email,
      inviterName: inviter.fullName || inviter.email,
      visitorName: visitor.name,
      purpose: visitor.purpose,
      unitLabel: visitor.unitLabel ?? visitor.areaName ?? null,
      checkedInAt: visitor.checkedInAt || new Date(),
      workspaceId: workspace.id,
      workspaceName: workspace.name,
    }).catch((e) => this.logger.warn(`Check-in notification failed: ${e?.message}`));
  }

  private async notifyInviterCheckedOut(workspace: { id: string; name: string }, visitor: any) {
    if (!visitor.invitedByUserId) return;
    const inviter = await this.prisma.user.findUnique({
      where: { id: visitor.invitedByUserId },
      select: { email: true, fullName: true },
    });
    if (!inviter?.email) return;
    this.mail.sendVisitorCheckedOutEmail({
      to: inviter.email,
      inviterName: inviter.fullName || inviter.email,
      visitorName: visitor.name,
      checkedInAt: visitor.checkedInAt,
      checkedOutAt: visitor.checkedOutAt || new Date(),
      workspaceId: workspace.id,
      workspaceName: workspace.name,
    }).catch((e) => this.logger.warn(`Check-out notification failed: ${e?.message}`));
  }

  async resendPass(workspaceId: string, visitorId: string) {
    const workspace = await this.getWorkspace(workspaceId);
    const repo = this.visitorDelegate(workspace.templateType);
    const visitor = await repo.findFirst({ where: { id: visitorId, workspaceId } });
    if (!visitor) throw new NotFoundException('Visitor not found');
    if (!visitor.email) throw new BadRequestException('This visitor has no email address');
    await this.mail.sendVisitorInviteEmail({
      to: visitor.email,
      visitorName: visitor.name,
      workspaceName: workspace.name,
      unitLabel: visitor.unitLabel ?? null,
      validUntil: visitor.validUntil ?? null,
      qrToken: visitor.qrToken,
    });
    return { ok: true };
  }

  async getStats(workspaceId: string) {
    const workspace = await this.getWorkspace(workspaceId);
    const repo = this.visitorDelegate(workspace.templateType);
    const [expected, checkedIn, checkedOut, todayTotal] = await Promise.all([
      repo.count({ where: { workspaceId, status: VisitorStatus.EXPECTED } }),
      repo.count({ where: { workspaceId, status: VisitorStatus.CHECKED_IN } }),
      repo.count({ where: { workspaceId, status: VisitorStatus.CHECKED_OUT } }),
      repo.count({
        where: {
          workspaceId,
          createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
      }),
    ]);
    return { expected, checkedIn, checkedOut, todayTotal };
  }
}
