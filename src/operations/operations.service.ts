import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InspectionStatus, NoticeAudience, ResidentStatus, TemplateType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OperationsService {
  private readonly logger = new Logger(OperationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async sendEmail(args: { to: string; subject: string; html: string }) {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM || process.env.EMAIL_FROM || 'TomaFix <onboarding@resend.dev>';

    if (!apiKey) {
      this.logger.warn(`RESEND_API_KEY not set. Skipping notice email to ${args.to}`);
      return;
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [args.to], subject: args.subject, html: args.html }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Resend send failed (${res.status}): ${body}`);
    }
  }

  private async resolveNoticeRecipients(workspaceId: string, audience: NoticeAudience) {
    const recipients = new Set<string>();

    if (audience === NoticeAudience.ALL || audience === NoticeAudience.RESIDENTS) {
      const residents = await this.prisma.resident.findMany({
        where: { workspaceId, status: ResidentStatus.ACTIVE, email: { not: null } },
        select: { email: true },
      });
      for (const r of residents) {
        const email = r.email?.trim().toLowerCase();
        if (email) recipients.add(email);
      }
    }

    if (audience === NoticeAudience.ALL || audience === NoticeAudience.STAFF) {
      const members = await this.prisma.workspaceMember.findMany({
        where: { workspaceId, isActive: true },
        include: { user: { select: { email: true } } },
      });
      for (const m of members) {
        const email = m.user?.email?.trim().toLowerCase();
        if (email) recipients.add(email);
      }
    }

    return Array.from(recipients);
  }

  private async assertWorkspace(workspaceId: string) {
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!ws) throw new NotFoundException('Workspace not found');
    if (ws.templateType !== TemplateType.APARTMENT) {
      throw new BadRequestException('Operations endpoints currently enabled for APARTMENT template');
    }
    return ws;
  }

  async listNotices(workspaceId: string) {
    await this.assertWorkspace(workspaceId);
    return this.prisma.notice.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' } });
  }

  async createNotice(workspaceId: string, dto: { title: string; body: string; audience?: NoticeAudience }) {
    const ws = await this.assertWorkspace(workspaceId);

    const notice = await this.prisma.notice.create({
      data: {
        workspaceId,
        title: dto.title.trim(),
        body: dto.body.trim(),
        audience: dto.audience ?? NoticeAudience.ALL,
        seenBy: [],
      },
    });

    try {
      const recipients = await this.resolveNoticeRecipients(workspaceId, notice.audience);
      await Promise.all(
        recipients.map((to) =>
          this.sendEmail({
            to,
            subject: `New notice • ${ws.name}`,
            html: `<p>A new notice was published.</p><p><b>${notice.title}</b></p><p>${notice.body}</p><p>Open your dashboard to view details.</p>`,
          }),
        ),
      );
    } catch (e: any) {
      this.logger.warn(`Notice email dispatch failed: ${e?.message || e}`);
    }

    return notice;
  }

  async markNoticeSeen(workspaceId: string, noticeId: string, actor: string) {
    await this.assertWorkspace(workspaceId);
    const row = await this.prisma.notice.findFirst({ where: { id: noticeId, workspaceId } });
    if (!row) throw new NotFoundException('Notice not found');
    const arr = Array.isArray(row.seenBy) ? (row.seenBy as string[]) : [];
    if (!arr.includes(actor)) arr.push(actor);
    return this.prisma.notice.update({ where: { id: noticeId }, data: { seenBy: arr } });
  }

  async deleteNotice(workspaceId: string, noticeId: string) {
    await this.assertWorkspace(workspaceId);
    const row = await this.prisma.notice.findFirst({ where: { id: noticeId, workspaceId } });
    if (!row) throw new NotFoundException('Notice not found');
    await this.prisma.notice.delete({ where: { id: noticeId } });
    return { ok: true };
  }

  async listInspections(workspaceId: string) {
    await this.assertWorkspace(workspaceId);
    return this.prisma.inspection.findMany({
      where: { workspaceId },
      orderBy: { dueDate: 'asc' },
      include: { unit: { select: { id: true, label: true } } },
    });
  }

  async createInspection(
    workspaceId: string,
    dto: { title: string; unitId?: string; dueDate: string; checklist?: string[] },
  ) {
    await this.assertWorkspace(workspaceId);
    if (dto.unitId) {
      const unit = await this.prisma.unit.findFirst({ where: { id: dto.unitId, workspaceId } });
      if (!unit) throw new BadRequestException('unitId does not belong to this workspace');
    }

    return this.prisma.inspection.create({
      data: {
        workspaceId,
        title: dto.title.trim(),
        unitId: dto.unitId || null,
        dueDate: new Date(dto.dueDate),
        checklist: dto.checklist ?? [],
      },
      include: { unit: { select: { id: true, label: true } } },
    });
  }

  async updateInspection(
    workspaceId: string,
    inspectionId: string,
    dto: { status?: InspectionStatus; result?: string },
  ) {
    await this.assertWorkspace(workspaceId);
    const row = await this.prisma.inspection.findFirst({ where: { id: inspectionId, workspaceId } });
    if (!row) throw new NotFoundException('Inspection not found');

    return this.prisma.inspection.update({
      where: { id: inspectionId },
      data: {
        status: dto.status ?? undefined,
        result: dto.result !== undefined ? dto.result : undefined,
      },
      include: { unit: { select: { id: true, label: true } } },
    });
  }
}
