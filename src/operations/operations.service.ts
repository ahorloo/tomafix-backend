import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InspectionStatus, NoticeAudience, TemplateType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OperationsService {
  constructor(private readonly prisma: PrismaService) {}

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
    await this.assertWorkspace(workspaceId);
    return this.prisma.notice.create({
      data: {
        workspaceId,
        title: dto.title.trim(),
        body: dto.body.trim(),
        audience: dto.audience ?? NoticeAudience.ALL,
        seenBy: [],
      },
    });
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
