import { BadRequestException, Injectable } from '@nestjs/common';
import { RequestPriority, RequestStatus, TemplateType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

function parseDate(value?: string, mode: 'start' | 'end' = 'start') {
  if (!value) return undefined;
  const raw = String(value).trim();
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return undefined;

  // If caller passed date-only (YYYY-MM-DD), normalize to day bounds.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    if (mode === 'start') d.setHours(0, 0, 0, 0);
    else d.setHours(23, 59, 59, 999);
  }

  return d;
}

function csvEscape(value: unknown) {
  const s = String(value ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertApartmentWorkspace(workspaceId: string) {
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!ws) throw new BadRequestException('Workspace not found');
    if (ws.templateType !== TemplateType.APARTMENT) {
      throw new BadRequestException('Reports currently enabled for APARTMENT');
    }
    return ws;
  }

  async summary(workspaceId: string, from?: string, to?: string) {
    await this.assertApartmentWorkspace(workspaceId);
    const fromDate = parseDate(from, 'start');
    const toDate = parseDate(to, 'end');

    const createdAtFilter = fromDate || toDate
      ? { gte: fromDate ?? undefined, lte: toDate ?? undefined }
      : undefined;

    const baseWhere = { workspaceId, ...(createdAtFilter ? { createdAt: createdAtFilter } : {}) };

    const [totalRequests, openRequests, resolvedRequests, urgentRequests, totalResidents, totalInspections, completedInspections] = await Promise.all([
      this.prisma.apartmentRequest.count({ where: baseWhere }),
      this.prisma.apartmentRequest.count({ where: { ...baseWhere, status: { in: [RequestStatus.PENDING, RequestStatus.IN_PROGRESS] } } }),
      this.prisma.apartmentRequest.count({ where: { ...baseWhere, status: { in: [RequestStatus.RESOLVED, RequestStatus.CLOSED] } } }),
      this.prisma.apartmentRequest.count({ where: { ...baseWhere, priority: { in: [RequestPriority.URGENT, RequestPriority.HIGH] } } }),
      this.prisma.apartmentResident.count({ where: { workspaceId } }),
      this.prisma.inspection.count({ where: baseWhere as any }),
      this.prisma.inspection.count({ where: { ...(baseWhere as any), status: 'COMPLETED' as any } }),
    ]);

    const breaches = await this.prisma.apartmentRequest.findMany({
      where: { workspaceId, status: { in: [RequestStatus.PENDING, RequestStatus.IN_PROGRESS] } },
      select: { id: true, createdAt: true, priority: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const slaHours: Record<string, number> = { URGENT: 4, HIGH: 12, NORMAL: 24, LOW: 72 };
    const breachedCount = breaches.filter((r) => Date.now() > r.createdAt.getTime() + (slaHours[r.priority] ?? 24) * 3600000).length;

    return {
      requests: {
        total: totalRequests,
        open: openRequests,
        resolved: resolvedRequests,
        urgent: urgentRequests,
        slaBreaches: breachedCount,
      },
      residents: {
        total: totalResidents,
      },
      inspections: {
        total: totalInspections,
        completed: completedInspections,
      },
    };
  }

  async exportRequestsCsv(workspaceId: string) {
    await this.assertApartmentWorkspace(workspaceId);
    const rows = await this.prisma.apartmentRequest.findMany({
      where: { workspaceId },
      include: { unit: { select: { label: true } }, resident: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const header = ['id', 'title', 'status', 'priority', 'unit', 'resident', 'createdAt'];
    const lines = [header.join(',')];
    rows.forEach((r) => {
      lines.push([
        r.id,
        r.title,
        r.status,
        r.priority,
        r.unit?.label || '',
        r.resident?.fullName || '',
        r.createdAt.toISOString(),
      ].map(csvEscape).join(','));
    });
    return lines.join('\n');
  }

  async exportResidentsCsv(workspaceId: string) {
    await this.assertApartmentWorkspace(workspaceId);
    const rows = await this.prisma.apartmentResident.findMany({ where: { workspaceId }, include: { unit: { select: { label: true } } }, orderBy: { createdAt: 'desc' } });
    const header = ['id', 'fullName', 'email', 'phone', 'role', 'status', 'unit', 'createdAt'];
    const lines = [header.join(',')];
    rows.forEach((r) => {
      lines.push([r.id, r.fullName, r.email || '', r.phone || '', r.role, r.status, r.unit?.label || '', r.createdAt.toISOString()].map(csvEscape).join(','));
    });
    return lines.join('\n');
  }

  async exportInspectionsCsv(workspaceId: string) {
    await this.assertApartmentWorkspace(workspaceId);
    const rows = await this.prisma.inspection.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' } });
    const header = ['id', 'title', 'status', 'scope', 'block', 'floor', 'unit', 'dueDate', 'result', 'createdAt'];
    const lines = [header.join(',')];
    rows.forEach((r) => {
      lines.push([r.id, r.title, r.status, r.scope, r.block || '', r.floor || '', '', r.dueDate.toISOString(), r.result || '', r.createdAt.toISOString()].map(csvEscape).join(','));
    });
    return lines.join('\n');
  }

  async exportNoticesCsv(workspaceId: string) {
    await this.assertApartmentWorkspace(workspaceId);
    const rows = await this.prisma.notice.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' } });
    const header = ['id', 'title', 'audience', 'seenCount', 'createdAt'];
    const lines = [header.join(',')];
    rows.forEach((r) => {
      const seen = Array.isArray(r.seenBy) ? r.seenBy.length : 0;
      lines.push([r.id, r.title, r.audience, seen, r.createdAt.toISOString()].map(csvEscape).join(','));
    });
    return lines.join('\n');
  }
}
