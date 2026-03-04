import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InspectionScope, InspectionStatus, MemberRole, NoticeAudience, ResidentStatus, TemplateType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OperationsService {
  private readonly logger = new Logger(OperationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async sendEmail(args: { to: string; subject: string; html: string }) {
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
      this.logger.warn(`RESEND_API_KEY not set. Skipping notice email to ${args.to}`);
      return;
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [args.to], subject: args.subject, html: brandedHtml }),
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

  async listInspections(workspaceId: string, actorUserId?: string) {
    await this.assertWorkspace(workspaceId);

    let where: any = { workspaceId };
    if (actorUserId) {
      const member = await this.prisma.workspaceMember.findFirst({
        where: { workspaceId, userId: actorUserId, isActive: true },
        select: { role: true },
      });
      if (member?.role === MemberRole.STAFF) {
        const blocks = await this.prisma.staffBlockAssignment.findMany({
          where: { workspaceId, staffUserId: actorUserId },
          select: { block: true },
        });
        const allowed = blocks.map((b) => b.block).filter(Boolean);
        if (allowed.length) {
          where = {
            ...where,
            OR: [
              { block: { in: allowed } },
              { unit: { block: { in: allowed } } },
            ],
          };
        }
      }
    }

    return this.prisma.inspection.findMany({
      where,
      orderBy: { dueDate: 'asc' },
      include: { unit: { select: { id: true, label: true, block: true, floor: true } } },
    });
  }

  async createInspection(
    workspaceId: string,
    dto: { title: string; scope?: InspectionScope; unitId?: string; block?: string; floor?: string; dueDate: string; checklist?: string[] },
  ) {
    await this.assertWorkspace(workspaceId);

    const scope = dto.scope || InspectionScope.UNIT;
    const block = dto.block?.trim() || null;
    const floor = dto.floor?.trim() || null;

    let unitId: string | null = null;
    if (scope === InspectionScope.UNIT) {
      if (!dto.unitId) throw new BadRequestException('unitId is required for UNIT inspections');
      const unit = await this.prisma.unit.findFirst({ where: { id: dto.unitId, workspaceId } });
      if (!unit) throw new BadRequestException('unitId does not belong to this workspace');
      unitId = unit.id;
    }

    if (scope === InspectionScope.BLOCK && !block) {
      throw new BadRequestException('block is required for BLOCK inspections');
    }

    if (scope === InspectionScope.FLOOR && (!block || !floor)) {
      throw new BadRequestException('block and floor are required for FLOOR inspections');
    }

    return this.prisma.inspection.create({
      data: {
        workspaceId,
        title: dto.title.trim(),
        scope,
        unitId,
        block,
        floor,
        dueDate: new Date(dto.dueDate),
        checklist: dto.checklist ?? [],
      },
      include: { unit: { select: { id: true, label: true, block: true, floor: true } } },
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
