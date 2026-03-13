import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { RequestPriority, RequestStatus, TemplateType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getEntitlements, resolvePlanName } from '../billing/planConfig';

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

  private async assertReportsWorkspace(workspaceId: string) {
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!ws) throw new BadRequestException('Workspace not found');
    if (
      ws.templateType !== TemplateType.APARTMENT &&
      ws.templateType !== TemplateType.ESTATE &&
      ws.templateType !== TemplateType.OFFICE
    ) {
      throw new BadRequestException('Reports not enabled for this template');
    }
    return ws;
  }

  private async assertFeature(workspaceId: string, feature: 'advancedReports' | 'exports') {
    const ws = await this.assertReportsWorkspace(workspaceId);
    if (ws.templateType !== TemplateType.OFFICE) return ws;

    const planName = resolvePlanName((ws as any).planName || 'Starter');
    const entitlements = getEntitlements(planName, ws.templateType);
    if (entitlements.features[feature]) return ws;

    throw new ForbiddenException({
      code: 'FEATURE_LOCKED',
      requiredPlan: planName === 'Starter' ? 'Growth' : 'TomaPrime',
      message:
        feature === 'advancedReports'
          ? 'Advanced office reports are available on Growth and above.'
          : 'Office exports are available on Growth and above.',
      context: { feature },
    } as any);
  }

  async summary(workspaceId: string, from?: string, to?: string) {
    const ws = await this.assertReportsWorkspace(workspaceId);
    if (ws.templateType === TemplateType.OFFICE) {
      await this.assertFeature(workspaceId, 'advancedReports');

      const fromDate = parseDate(from, 'start');
      const toDate = parseDate(to, 'end');
      const createdAtFilter = fromDate || toDate
        ? { gte: fromDate ?? undefined, lte: toDate ?? undefined }
        : undefined;
      const baseWhere = { workspaceId, ...(createdAtFilter ? { createdAt: createdAtFilter } : {}) };

      const [
        totalRequests,
        openRequests,
        resolvedRequests,
        urgentRequests,
        totalAssets,
        totalInspections,
        completedInspections,
        openWorkOrders,
      ] = await Promise.all([
        this.prisma.officeRequest.count({ where: baseWhere }),
        this.prisma.officeRequest.count({
          where: { ...baseWhere, status: { in: [RequestStatus.PENDING, RequestStatus.IN_PROGRESS] } },
        }),
        this.prisma.officeRequest.count({
          where: { ...baseWhere, status: { in: [RequestStatus.RESOLVED, RequestStatus.CLOSED] } },
        }),
        this.prisma.officeRequest.count({
          where: { ...baseWhere, priority: { in: [RequestPriority.URGENT, RequestPriority.HIGH] } },
        }),
        this.prisma.officeAsset.count({ where: { workspaceId } }),
        this.prisma.inspection.count({ where: baseWhere as any }),
        this.prisma.inspection.count({ where: { ...(baseWhere as any), status: 'COMPLETED' as any } }),
        this.prisma.officeWorkOrder.count({
          where: { ...baseWhere, status: { in: ['OPEN', 'IN_PROGRESS'] as any } },
        }),
      ]);

      const breaches = await this.prisma.officeRequest.findMany({
        where: { workspaceId, status: { in: [RequestStatus.PENDING, RequestStatus.IN_PROGRESS] } },
        select: { id: true, slaDeadline: true },
        orderBy: { createdAt: 'desc' },
        take: 500,
      });
      const breachedCount = breaches.filter((r) => r.slaDeadline && Date.now() > r.slaDeadline.getTime()).length;

      return {
        requests: {
          total: totalRequests,
          open: openRequests,
          resolved: resolvedRequests,
          urgent: urgentRequests,
          slaBreaches: breachedCount,
        },
        residents: {
          total: totalAssets,
        },
        inspections: {
          total: totalInspections,
          completed: completedInspections,
        },
        workOrders: {
          open: openWorkOrders,
        },
      };
    }
    const fromDate = parseDate(from, 'start');
    const toDate = parseDate(to, 'end');

    const createdAtFilter = fromDate || toDate
      ? { gte: fromDate ?? undefined, lte: toDate ?? undefined }
      : undefined;

    const baseWhere = { workspaceId, ...(createdAtFilter ? { createdAt: createdAtFilter } : {}) };

    const isEstate = ws.templateType === TemplateType.ESTATE;

    const [totalRequests, openRequests, resolvedRequests, urgentRequests, totalResidents, totalInspections, completedInspections] = await Promise.all([
      isEstate
        ? this.prisma.estateRequest.count({ where: baseWhere })
        : this.prisma.apartmentRequest.count({ where: baseWhere }),
      isEstate
        ? this.prisma.estateRequest.count({ where: { ...baseWhere, status: { in: [RequestStatus.PENDING, RequestStatus.IN_PROGRESS] } } })
        : this.prisma.apartmentRequest.count({ where: { ...baseWhere, status: { in: [RequestStatus.PENDING, RequestStatus.IN_PROGRESS] } } }),
      isEstate
        ? this.prisma.estateRequest.count({ where: { ...baseWhere, status: { in: [RequestStatus.RESOLVED, RequestStatus.CLOSED] } } })
        : this.prisma.apartmentRequest.count({ where: { ...baseWhere, status: { in: [RequestStatus.RESOLVED, RequestStatus.CLOSED] } } }),
      isEstate
        ? this.prisma.estateRequest.count({ where: { ...baseWhere, priority: { in: [RequestPriority.URGENT, RequestPriority.HIGH] } } })
        : this.prisma.apartmentRequest.count({ where: { ...baseWhere, priority: { in: [RequestPriority.URGENT, RequestPriority.HIGH] } } }),
      isEstate
        ? this.prisma.estateResident.count({ where: { workspaceId } })
        : this.prisma.apartmentResident.count({ where: { workspaceId } }),
      this.prisma.inspection.count({ where: baseWhere as any }),
      this.prisma.inspection.count({ where: { ...(baseWhere as any), status: 'COMPLETED' as any } }),
    ]);

    const breaches = isEstate
      ? await this.prisma.estateRequest.findMany({
          where: { workspaceId, status: { in: [RequestStatus.PENDING, RequestStatus.IN_PROGRESS] } },
          select: { id: true, createdAt: true, priority: true },
          orderBy: { createdAt: 'desc' },
          take: 500,
        })
      : await this.prisma.apartmentRequest.findMany({
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
    const ws = await this.assertReportsWorkspace(workspaceId);
    if (ws.templateType === TemplateType.OFFICE) {
      await this.assertFeature(workspaceId, 'exports');
      const rows = await this.prisma.officeRequest.findMany({
        where: { workspaceId },
        include: { area: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      });
      const header = ['id', 'title', 'status', 'priority', 'area', 'submitter', 'createdAt'];
      const lines = [header.join(',')];
      rows.forEach((r) => {
        lines.push([
          r.id,
          r.title,
          r.status,
          r.priority,
          r.area?.name || '',
          r.submitterName || '',
          r.createdAt.toISOString(),
        ].map(csvEscape).join(','));
      });
      return lines.join('\n');
    }
    const isEstate = ws.templateType === TemplateType.ESTATE;
    const rows = isEstate
      ? await this.prisma.estateRequest.findMany({
          where: { workspaceId },
          include: { unit: { select: { label: true } }, resident: { select: { fullName: true } } },
          orderBy: { createdAt: 'desc' },
        })
      : await this.prisma.apartmentRequest.findMany({
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
    const ws = await this.assertReportsWorkspace(workspaceId);
    if (ws.templateType === TemplateType.OFFICE) {
      throw new BadRequestException('Resident exports are not available for OFFICE workspaces');
    }
    const rows = ws.templateType === TemplateType.ESTATE
      ? await this.prisma.estateResident.findMany({ where: { workspaceId }, include: { unit: { select: { label: true } } }, orderBy: { createdAt: 'desc' } })
      : await this.prisma.apartmentResident.findMany({ where: { workspaceId }, include: { unit: { select: { label: true } } }, orderBy: { createdAt: 'desc' } });
    const header = ['id', 'fullName', 'email', 'phone', 'role', 'status', 'unit', 'createdAt'];
    const lines = [header.join(',')];
    rows.forEach((r) => {
      lines.push([r.id, r.fullName, r.email || '', r.phone || '', r.role, r.status, r.unit?.label || '', r.createdAt.toISOString()].map(csvEscape).join(','));
    });
    return lines.join('\n');
  }

  async exportInspectionsCsv(workspaceId: string) {
    const ws = await this.assertReportsWorkspace(workspaceId);
    if (ws.templateType === TemplateType.OFFICE) {
      await this.assertFeature(workspaceId, 'exports');
    }
    const rows = await this.prisma.inspection.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' } });
    const header = ['id', 'title', 'status', 'scope', 'block', 'floor', 'unit', 'dueDate', 'result', 'createdAt'];
    const lines = [header.join(',')];
    rows.forEach((r) => {
      lines.push([r.id, r.title, r.status, r.scope, r.block || '', r.floor || '', '', r.dueDate.toISOString(), r.result || '', r.createdAt.toISOString()].map(csvEscape).join(','));
    });
    return lines.join('\n');
  }

  async exportNoticesCsv(workspaceId: string) {
    const ws = await this.assertReportsWorkspace(workspaceId);
    if (ws.templateType === TemplateType.OFFICE) {
      await this.assertFeature(workspaceId, 'exports');
    }
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
