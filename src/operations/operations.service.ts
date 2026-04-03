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

  private async resolveEstateIdForWorkspace(workspaceId: string, estateId?: string | null) {
    const ws = await this.assertPropertyWorkspace(workspaceId);
    if (ws.templateType !== TemplateType.ESTATE) return null;

    if (estateId) {
      const estate = await this.prisma.estate.findFirst({ where: { id: estateId, workspaceId } });
      if (!estate) throw new BadRequestException('estateId does not belong to this workspace');
      return estate.id;
    }

    const existing = await this.prisma.estate.findFirst({ where: { workspaceId }, orderBy: { createdAt: 'asc' } });
    return existing?.id ?? null;
  }

  private async resolveNoticeRecipients(
    workspaceId: string,
    audience: NoticeAudience,
    templateType: TemplateType,
    estateId?: string | null,
  ) {
    const recipients = new Set<string>();

    // OFFICE: all recipients are workspace members (employees/staff)
    if (templateType === TemplateType.OFFICE) {
      const members = await this.prisma.workspaceMember.findMany({
        where: { workspaceId, isActive: true },
        include: { user: { select: { email: true } } },
      });
      for (const m of members) {
        const email = m.user?.email?.trim().toLowerCase();
        if (email) recipients.add(email);
      }
      return Array.from(recipients);
    }

    if (audience === NoticeAudience.ALL || audience === NoticeAudience.RESIDENTS) {
      const residents =
        templateType === TemplateType.ESTATE
          ? await this.prisma.estateResident.findMany({
              where: {
                workspaceId,
                status: ResidentStatus.ACTIVE,
                email: { not: null },
                ...(estateId ? { unit: { estateId } } : {}),
              },
              select: { email: true },
            })
          : await this.prisma.apartmentResident.findMany({
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

  private noticeDelegate(templateType: TemplateType) {
    switch (templateType) {
      case TemplateType.ESTATE:
        return this.prisma.estateNotice as any;
      case TemplateType.OFFICE:
        return this.prisma.officeNotice as any;
      default:
        return this.prisma.apartmentNotice as any;
    }
  }

  private inspectionDelegate(templateType: TemplateType) {
    switch (templateType) {
      case TemplateType.ESTATE:
        return this.prisma.estateInspection as any;
      case TemplateType.OFFICE:
        return this.prisma.officeInspection as any;
      default:
        return this.prisma.apartmentInspection as any;
    }
  }

  private async assertOperationsWorkspace(workspaceId: string) {
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!ws) throw new NotFoundException('Workspace not found');
    if (
      ws.templateType !== TemplateType.APARTMENT &&
      ws.templateType !== TemplateType.ESTATE &&
      ws.templateType !== TemplateType.OFFICE
    ) {
      throw new BadRequestException('Workspace template not supported');
    }
    return ws;
  }

  private async assertPropertyWorkspace(workspaceId: string) {
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!ws) throw new NotFoundException('Workspace not found');
    if (ws.templateType !== TemplateType.APARTMENT && ws.templateType !== TemplateType.ESTATE && ws.templateType !== TemplateType.OFFICE) {
      throw new BadRequestException('Operations endpoints currently enabled for APARTMENT/ESTATE/OFFICE templates');
    }
    return ws;
  }

  private async assertApartmentWorkspace(workspaceId: string) {
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!ws) throw new NotFoundException('Workspace not found');
    if (ws.templateType !== TemplateType.APARTMENT) {
      throw new BadRequestException('This endpoint is currently enabled for APARTMENT template only');
    }
    return ws;
  }

  async listNotices(workspaceId: string, estateId?: string) {
    const ws = await this.assertOperationsWorkspace(workspaceId);
    const resolvedEstateId = ws.templateType !== TemplateType.OFFICE
      ? await this.resolveEstateIdForWorkspace(workspaceId, estateId)
      : null;

    return this.noticeDelegate(ws.templateType).findMany({
      where:
        ws.templateType === TemplateType.ESTATE
          ? { workspaceId, ...(resolvedEstateId ? { estateId: resolvedEstateId } : {}) }
          : { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createNotice(workspaceId: string, dto: { title: string; body: string; audience?: NoticeAudience; estateId?: string }) {
    const ws = await this.assertOperationsWorkspace(workspaceId);
    const resolvedEstateId = ws.templateType !== TemplateType.OFFICE
      ? await this.resolveEstateIdForWorkspace(workspaceId, dto.estateId)
      : null;

    const notice = await this.noticeDelegate(ws.templateType).create({
      data:
        ws.templateType === TemplateType.ESTATE
          ? {
              workspaceId,
              estateId: resolvedEstateId,
              title: dto.title.trim(),
              body: dto.body.trim(),
              audience: dto.audience ?? NoticeAudience.ALL,
              seenBy: [],
            }
          : {
              workspaceId,
              title: dto.title.trim(),
              body: dto.body.trim(),
              audience: dto.audience ?? NoticeAudience.ALL,
              seenBy: [],
            },
    });

    try {
      const recipients = await this.resolveNoticeRecipients(workspaceId, notice.audience, ws.templateType, resolvedEstateId);
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
    const ws = await this.assertOperationsWorkspace(workspaceId);
    const repo = this.noticeDelegate(ws.templateType);
    const row = await repo.findFirst({ where: { id: noticeId, workspaceId } });
    if (!row) throw new NotFoundException('Notice not found');
    const arr = Array.isArray(row.seenBy) ? (row.seenBy as string[]) : [];
    if (!arr.includes(actor)) arr.push(actor);
    return repo.update({ where: { id: noticeId }, data: { seenBy: arr } });
  }

  async deleteNotice(workspaceId: string, noticeId: string) {
    const ws = await this.assertOperationsWorkspace(workspaceId);
    const repo = this.noticeDelegate(ws.templateType);
    const row = await repo.findFirst({ where: { id: noticeId, workspaceId } });
    if (!row) throw new NotFoundException('Notice not found');
    await repo.delete({ where: { id: noticeId } });
    return { ok: true };
  }

  async listInspections(workspaceId: string, actorUserId?: string, estateId?: string) {
    const ws = await this.assertOperationsWorkspace(workspaceId);
    const resolvedEstateId = await this.resolveEstateIdForWorkspace(workspaceId, estateId);

    let where: any =
      ws.templateType === TemplateType.ESTATE
        ? { workspaceId, ...(resolvedEstateId ? { estateId: resolvedEstateId } : {}) }
        : { workspaceId };

    if (actorUserId && ws.templateType !== TemplateType.OFFICE) {
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
          const unitsInAllowedBlocks = ws.templateType === TemplateType.ESTATE
            ? await this.prisma.estateUnit.findMany({
                where: { workspaceId, block: { in: allowed } },
                select: { id: true },
              })
            : await this.prisma.apartmentUnit.findMany({
                where: { workspaceId, block: { in: allowed } },
                select: { id: true },
              });
          const unitIds = unitsInAllowedBlocks.map((u) => u.id);

          where = {
            ...where,
            OR: [
              { block: { in: allowed } },
              ...(unitIds.length ? [{ unitId: { in: unitIds } }] : []),
            ],
          };
        }
      }
    }

    if (ws.templateType === TemplateType.ESTATE) {
      return this.prisma.estateInspection.findMany({
        where,
        include: { unit: { select: { id: true, label: true, block: true, floor: true } } },
        orderBy: { dueDate: 'asc' },
      });
    }

    if (ws.templateType === TemplateType.APARTMENT) {
      return this.prisma.apartmentInspection.findMany({
        where,
        include: { unit: { select: { id: true, label: true, block: true, floor: true } } },
        orderBy: { dueDate: 'asc' },
      });
    }

    return this.prisma.officeInspection.findMany({
      where,
      orderBy: { dueDate: 'asc' },
    });
  }

  async createInspection(
    workspaceId: string,
    dto: { title: string; scope?: InspectionScope; unitId?: string; block?: string; floor?: string; dueDate: string; checklist?: string[]; estateId?: string },
  ) {
    const ws = await this.assertOperationsWorkspace(workspaceId);
    const resolvedEstateId = ws.templateType !== TemplateType.OFFICE
      ? await this.resolveEstateIdForWorkspace(workspaceId, dto.estateId)
      : null;

    const scope = dto.scope || InspectionScope.UNIT;
    const block = dto.block?.trim() || null;
    const floor = dto.floor?.trim() || null;

    let unitId: string | null = null;
    if (scope === InspectionScope.UNIT) {
      if (ws.templateType === TemplateType.OFFICE) {
        throw new BadRequestException('UNIT inspections are not supported for OFFICE workspaces yet');
      }
      if (!dto.unitId) throw new BadRequestException('unitId is required for UNIT inspections');
      const unit = ws.templateType === TemplateType.ESTATE
        ? await this.prisma.estateUnit.findFirst({ where: { id: dto.unitId, workspaceId, ...(resolvedEstateId ? { estateId: resolvedEstateId } : {}) } })
        : await this.prisma.apartmentUnit.findFirst({ where: { id: dto.unitId, workspaceId } });
      if (!unit) throw new BadRequestException('unitId does not belong to this workspace');
      unitId = unit.id;
    }

    if (scope === InspectionScope.BLOCK && !block) {
      throw new BadRequestException('block is required for BLOCK inspections');
    }

    if (scope === InspectionScope.FLOOR && (!block || !floor)) {
      throw new BadRequestException('block and floor are required for FLOOR inspections');
    }

    if (ws.templateType === TemplateType.ESTATE) {
      return this.prisma.estateInspection.create({
        data: {
          workspaceId,
          estateId: resolvedEstateId,
          title: dto.title.trim(),
          scope,
          unitId,
          block,
          floor,
          dueDate: new Date(dto.dueDate),
          checklist: dto.checklist ?? [],
        },
      });
    }

    if (ws.templateType === TemplateType.APARTMENT) {
      return this.prisma.apartmentInspection.create({
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
      });
    }

    return this.prisma.officeInspection.create({
      data: {
        workspaceId,
        title: dto.title.trim(),
        scope,
        block,
        floor,
        dueDate: new Date(dto.dueDate),
        checklist: dto.checklist ?? [],
      },
    });
  }

  async updateInspection(
    workspaceId: string,
    inspectionId: string,
    dto: { status?: InspectionStatus; result?: string },
  ) {
    const ws = await this.assertOperationsWorkspace(workspaceId);
    const repo = this.inspectionDelegate(ws.templateType);
    const row = await repo.findFirst({ where: { id: inspectionId, workspaceId } });
    if (!row) throw new NotFoundException('Inspection not found');

    return repo.update({
      where: { id: inspectionId },
      data: {
        status: dto.status ?? undefined,
        result: dto.result !== undefined ? dto.result : undefined,
      },
    });
  }
}
