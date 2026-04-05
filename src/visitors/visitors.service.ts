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

  async createVisitor(workspaceId: string, userId: string, userName: string, dto: CreateVisitorDto) {
    const workspace = await this.getWorkspace(workspaceId);
    const repo = this.visitorDelegate(workspace.templateType);

    const visitor = await repo.create({
      data: {
        workspaceId,
        invitedByUserId: userId,
        invitedByName: userName,
        name: dto.name,
        phone: dto.phone,
        email: dto.email,
        purpose: dto.purpose,
        unitId: workspace.templateType === TemplateType.OFFICE ? null : dto.unitId,
        unitLabel: workspace.templateType === TemplateType.OFFICE ? null : dto.unitLabel,
        areaId: workspace.templateType === TemplateType.OFFICE ? dto.areaId : null,
        areaName: workspace.templateType === TemplateType.OFFICE ? dto.areaName : null,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : null,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
        notes: dto.notes,
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

  async scanVisitor(workspaceId: string, scannerName: string, dto: ScanVisitorDto) {
    const workspace = await this.getWorkspace(workspaceId);
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
      return { action: 'CHECKED_OUT', visitor: updated };
    }

    if (visitor.status === VisitorStatus.CHECKED_OUT) {
      throw new BadRequestException(`${visitor.name} has already checked out`);
    }

    throw new BadRequestException('Cannot process this visitor pass');
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
