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

function propertyRequestDeadline(request: {
  createdAt: Date;
  priority: RequestPriority;
  dueAt?: Date | null;
}) {
  if (request.dueAt) return request.dueAt;
  const slaHours: Record<RequestPriority, number> = {
    [RequestPriority.LOW]: 72,
    [RequestPriority.NORMAL]: 24,
    [RequestPriority.HIGH]: 12,
    [RequestPriority.URGENT]: 4,
  };
  return new Date(request.createdAt.getTime() + (slaHours[request.priority] ?? 24) * 3600000);
}

function isPropertyRequestOverdue(request: {
  status: RequestStatus;
  priority: RequestPriority;
  createdAt: Date;
  dueAt?: Date | null;
}) {
  if (request.status !== RequestStatus.PENDING && request.status !== RequestStatus.IN_PROGRESS) {
    return false;
  }
  return Date.now() > propertyRequestDeadline(request).getTime();
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveEstateScope(workspaceId: string, estateId?: string) {
    if (!estateId) return undefined;
    const normalized = String(estateId || '').trim();
    if (!normalized) return undefined;

    const estate = await this.prisma.estate.findFirst({
      where: { id: normalized, workspaceId },
      select: { id: true },
    });
    if (!estate) throw new BadRequestException('estateId does not belong to this workspace');
    return estate.id;
  }

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

  async summary(workspaceId: string, from?: string, to?: string, estateId?: string) {
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
        this.prisma.officeInspection.count({ where: baseWhere as any }),
        this.prisma.officeInspection.count({ where: { ...(baseWhere as any), status: 'COMPLETED' as any } }),
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
    const resolvedEstateId = isEstate ? await this.resolveEstateScope(workspaceId, estateId) : undefined;
    const estateScopedRelation = resolvedEstateId ? { unit: { is: { estateId: resolvedEstateId } } } : {};
    const requestWhere = isEstate
      ? { ...baseWhere, ...estateScopedRelation }
      : baseWhere;
    const inspectionWhere = isEstate
      ? { ...(baseWhere as any), ...(resolvedEstateId ? { estateId: resolvedEstateId } : {}) }
      : (baseWhere as any);

    const [
      totalRequests,
      openRequests,
      resolvedRequests,
      urgentRequests,
      totalResidents,
      totalInspections,
      completedInspections,
      estatePropertiesCount,
      estateUnitBuckets,
      assignedRequests,
    ] = await Promise.all([
      isEstate
        ? this.prisma.estateRequest.count({ where: requestWhere as any })
        : this.prisma.apartmentRequest.count({ where: requestWhere as any }),
      isEstate
        ? this.prisma.estateRequest.count({
            where: { ...(requestWhere as any), status: { in: [RequestStatus.PENDING, RequestStatus.IN_PROGRESS] } },
          })
        : this.prisma.apartmentRequest.count({
            where: { ...(requestWhere as any), status: { in: [RequestStatus.PENDING, RequestStatus.IN_PROGRESS] } },
          }),
      isEstate
        ? this.prisma.estateRequest.count({
            where: { ...(requestWhere as any), status: { in: [RequestStatus.RESOLVED, RequestStatus.CLOSED] } },
          })
        : this.prisma.apartmentRequest.count({
            where: { ...(requestWhere as any), status: { in: [RequestStatus.RESOLVED, RequestStatus.CLOSED] } },
          }),
      isEstate
        ? this.prisma.estateRequest.count({
            where: { ...(requestWhere as any), priority: { in: [RequestPriority.URGENT, RequestPriority.HIGH] } },
          })
        : this.prisma.apartmentRequest.count({
            where: { ...(requestWhere as any), priority: { in: [RequestPriority.URGENT, RequestPriority.HIGH] } },
          }),
      isEstate
        ? this.prisma.estateResident.count({
            where: {
              workspaceId,
              ...(resolvedEstateId ? { unit: { is: { estateId: resolvedEstateId } } } : {}),
            },
          })
        : this.prisma.apartmentResident.count({ where: { workspaceId } }),
      isEstate
        ? this.prisma.estateInspection.count({ where: inspectionWhere })
        : this.prisma.apartmentInspection.count({ where: inspectionWhere }),
      isEstate
        ? this.prisma.estateInspection.count({ where: { ...inspectionWhere, status: 'COMPLETED' as any } })
        : this.prisma.apartmentInspection.count({ where: { ...inspectionWhere, status: 'COMPLETED' as any } }),
      isEstate
        ? resolvedEstateId
          ? Promise.resolve(1)
          : this.prisma.estate.count({ where: { workspaceId } })
        : Promise.resolve(0),
      isEstate
        ? this.prisma.estateUnit.groupBy({
            by: ['status'],
            where: { workspaceId, ...(resolvedEstateId ? { estateId: resolvedEstateId } : {}) },
            _count: { _all: true },
          })
        : Promise.resolve([] as Array<{ status: string; _count: { _all: number } }>),
      isEstate
        ? this.prisma.estateRequest.count({
            where: { ...(requestWhere as any), assignedToUserId: { not: null } },
          })
        : Promise.resolve(0),
    ]);

    const breaches = isEstate
      ? await this.prisma.estateRequest.findMany({
          where: { ...(requestWhere as any), status: { in: [RequestStatus.PENDING, RequestStatus.IN_PROGRESS] } },
          select: { id: true, createdAt: true, priority: true, dueAt: true, status: true },
          orderBy: { createdAt: 'desc' },
          take: 500,
        })
      : await this.prisma.apartmentRequest.findMany({
          where: { ...(requestWhere as any), status: { in: [RequestStatus.PENDING, RequestStatus.IN_PROGRESS] } },
          select: { id: true, createdAt: true, priority: true, status: true },
          orderBy: { createdAt: 'desc' },
          take: 500,
        });

    const breachedCount = breaches.filter((r) => isPropertyRequestOverdue(r as any)).length;

    const estateUnits = {
      total: Array.isArray(estateUnitBuckets)
        ? estateUnitBuckets.reduce((sum, row) => sum + row._count._all, 0)
        : 0,
      occupied: Array.isArray(estateUnitBuckets)
        ? estateUnitBuckets.find((row) => row.status === 'OCCUPIED')?._count._all ?? 0
        : 0,
      vacant: Array.isArray(estateUnitBuckets)
        ? estateUnitBuckets.find((row) => row.status === 'VACANT')?._count._all ?? 0
        : 0,
      maintenance: Array.isArray(estateUnitBuckets)
        ? estateUnitBuckets.find((row) => row.status === 'MAINTENANCE')?._count._all ?? 0
        : 0,
    };

    return {
      requests: {
        total: totalRequests,
        open: openRequests,
        resolved: resolvedRequests,
        urgent: urgentRequests,
        slaBreaches: breachedCount,
        ...(isEstate ? { overdue: breachedCount, assigned: assignedRequests } : {}),
      },
      residents: {
        total: totalResidents,
      },
      inspections: {
        total: totalInspections,
        completed: completedInspections,
      },
      ...(isEstate
        ? {
            properties: {
              total: estatePropertiesCount,
            },
            units: estateUnits,
          }
        : {}),
    };
  }

  async exportRequestsCsv(workspaceId: string, estateId?: string) {
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
    const resolvedEstateId = isEstate ? await this.resolveEstateScope(workspaceId, estateId) : undefined;
    const rows = isEstate
      ? await this.prisma.estateRequest.findMany({
          where: {
            workspaceId,
            ...(resolvedEstateId ? { unit: { is: { estateId: resolvedEstateId } } } : {}),
          },
          include: {
            unit: { select: { label: true, estate: { select: { name: true, code: true } } } },
            resident: { select: { fullName: true } },
          },
          orderBy: { createdAt: 'desc' },
        })
      : await this.prisma.apartmentRequest.findMany({
          where: { workspaceId },
          include: { unit: { select: { label: true } }, resident: { select: { fullName: true } } },
          orderBy: { createdAt: 'desc' },
        });

    const header = isEstate
      ? ['id', 'property', 'title', 'category', 'status', 'priority', 'unit', 'resident', 'assignedTo', 'vendor', 'dueAt', 'estimatedCost', 'createdAt']
      : ['id', 'title', 'status', 'priority', 'unit', 'resident', 'createdAt'];
    const lines = [header.join(',')];
    rows.forEach((r) => {
      if (isEstate) {
        lines.push([
          r.id,
          (r as any).unit?.estate?.name || (r as any).unit?.estate?.code || '',
          r.title,
          (r as any).category || '',
          r.status,
          r.priority,
          r.unit?.label || '',
          r.resident?.fullName || '',
          (r as any).assignedToName || '',
          (r as any).vendorName || '',
          (r as any).dueAt ? new Date((r as any).dueAt).toISOString() : '',
          (r as any).estimatedCost ?? '',
          r.createdAt.toISOString(),
        ].map(csvEscape).join(','));
        return;
      }
      lines.push([r.id, r.title, r.status, r.priority, r.unit?.label || '', r.resident?.fullName || '', r.createdAt.toISOString()].map(csvEscape).join(','));
    });
    return lines.join('\n');
  }

  async exportResidentsCsv(workspaceId: string, estateId?: string) {
    const ws = await this.assertReportsWorkspace(workspaceId);
    if (ws.templateType === TemplateType.OFFICE) {
      throw new BadRequestException('Resident exports are not available for OFFICE workspaces');
    }
    const resolvedEstateId = ws.templateType === TemplateType.ESTATE
      ? await this.resolveEstateScope(workspaceId, estateId)
      : undefined;
    const rows = ws.templateType === TemplateType.ESTATE
      ? await this.prisma.estateResident.findMany({
          where: {
            workspaceId,
            ...(resolvedEstateId ? { unit: { is: { estateId: resolvedEstateId } } } : {}),
          },
          include: { unit: { select: { label: true, estate: { select: { name: true } } } } },
          orderBy: { createdAt: 'desc' },
        })
      : await this.prisma.apartmentResident.findMany({ where: { workspaceId }, include: { unit: { select: { label: true } } }, orderBy: { createdAt: 'desc' } });
    const header = ws.templateType === TemplateType.ESTATE
      ? ['id', 'property', 'fullName', 'email', 'phone', 'role', 'status', 'unit', 'createdAt']
      : ['id', 'fullName', 'email', 'phone', 'role', 'status', 'unit', 'createdAt'];
    const lines = [header.join(',')];
    rows.forEach((r) => {
      if (ws.templateType === TemplateType.ESTATE) {
        lines.push([r.id, (r as any).unit?.estate?.name || '', r.fullName, r.email || '', r.phone || '', r.role, r.status, r.unit?.label || '', r.createdAt.toISOString()].map(csvEscape).join(','));
        return;
      }
      lines.push([r.id, r.fullName, r.email || '', r.phone || '', r.role, r.status, r.unit?.label || '', r.createdAt.toISOString()].map(csvEscape).join(','));
    });
    return lines.join('\n');
  }

  async exportInspectionsCsv(workspaceId: string, estateId?: string) {
    const ws = await this.assertReportsWorkspace(workspaceId);
    if (ws.templateType === TemplateType.OFFICE) {
      await this.assertFeature(workspaceId, 'exports');
    }
    const resolvedEstateId = ws.templateType === TemplateType.ESTATE
      ? await this.resolveEstateScope(workspaceId, estateId)
      : undefined;
    const rows = ws.templateType === TemplateType.OFFICE
      ? await this.prisma.officeInspection.findMany({
          where: { workspaceId },
          include: { area: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
        })
      : ws.templateType === TemplateType.ESTATE
        ? await this.prisma.estateInspection.findMany({
            where: { workspaceId, ...(resolvedEstateId ? { estateId: resolvedEstateId } : {}) },
            include: {
              estate: { select: { id: true, name: true } },
              unit: { select: { id: true, label: true } },
            },
            orderBy: { createdAt: 'desc' },
          })
        : await this.prisma.apartmentInspection.findMany({
            where: { workspaceId },
            include: {
              unit: { select: { id: true, label: true } },
            },
            orderBy: { createdAt: 'desc' },
          });
    const header = ['id', 'title', 'status', 'scope', 'property', 'area', 'block', 'floor', 'unit', 'dueDate', 'result', 'createdAt'];
    const lines = [header.join(',')];
    rows.forEach((r) => {
      lines.push([
        r.id,
        r.title,
        r.status,
        r.scope,
        ws.templateType === TemplateType.ESTATE ? (r as any).estate?.name || (r as any).estateId || '' : '',
        ws.templateType === TemplateType.OFFICE ? (r as any).area?.name || '' : '',
        r.block || '',
        r.floor || '',
        (r as any).unit?.label || '',
        r.dueDate.toISOString(),
        r.result || '',
        r.createdAt.toISOString(),
      ].map(csvEscape).join(','));
    });
    return lines.join('\n');
  }

  async trends(workspaceId: string, from?: string, to?: string) {
    const ws = await this.assertReportsWorkspace(workspaceId);
    const fromDate = parseDate(from, 'start') ?? new Date(Date.now() - 30 * 86400000);
    const toDate = parseDate(to, 'end') ?? new Date();

    const isEstate = ws.templateType === TemplateType.ESTATE;
    const isOffice = ws.templateType === TemplateType.OFFICE;

    // Build daily buckets
    const days: string[] = [];
    const cursor = new Date(fromDate);
    cursor.setHours(0, 0, 0, 0);
    while (cursor <= toDate) {
      days.push(cursor.toISOString().slice(0, 10));
      cursor.setDate(cursor.getDate() + 1);
    }

    // Fetch all relevant records created in range
    const [requestRows, visitorRows] = await Promise.all([
      isEstate
        ? this.prisma.estateRequest.findMany({
            where: { workspaceId, createdAt: { gte: fromDate, lte: toDate } },
            select: { createdAt: true, status: true },
          })
        : isOffice
          ? this.prisma.officeRequest.findMany({
              where: { workspaceId, createdAt: { gte: fromDate, lte: toDate } },
              select: { createdAt: true, status: true },
            })
          : this.prisma.apartmentRequest.findMany({
              where: { workspaceId, createdAt: { gte: fromDate, lte: toDate } },
              select: { createdAt: true, status: true },
            }),
      isEstate
        ? this.prisma.estateVisitor.findMany({
            where: { workspaceId, createdAt: { gte: fromDate, lte: toDate } },
            select: { createdAt: true, status: true },
          }).catch(() => [])
        : isOffice
          ? this.prisma.officeVisitor.findMany({
              where: { workspaceId, createdAt: { gte: fromDate, lte: toDate } },
              select: { createdAt: true, status: true },
            }).catch(() => [])
          : this.prisma.apartmentVisitor.findMany({
              where: { workspaceId, createdAt: { gte: fromDate, lte: toDate } },
              select: { createdAt: true, status: true },
            }).catch(() => []),
    ]);

    const reqByDay = new Map<string, number>();
    const visitByDay = new Map<string, number>();
    for (const r of requestRows) {
      const d = r.createdAt.toISOString().slice(0, 10);
      reqByDay.set(d, (reqByDay.get(d) ?? 0) + 1);
    }
    for (const v of visitorRows as any[]) {
      const d = v.createdAt.toISOString().slice(0, 10);
      visitByDay.set(d, (visitByDay.get(d) ?? 0) + 1);
    }

    return days.map((date) => ({
      date,
      requests: reqByDay.get(date) ?? 0,
      visitors: visitByDay.get(date) ?? 0,
    }));
  }

  async exportNoticesCsv(workspaceId: string, estateId?: string) {
    const ws = await this.assertReportsWorkspace(workspaceId);
    if (ws.templateType === TemplateType.OFFICE) {
      await this.assertFeature(workspaceId, 'exports');
    }
    const resolvedEstateId = ws.templateType === TemplateType.ESTATE
      ? await this.resolveEstateScope(workspaceId, estateId)
      : undefined;
    const rows = ws.templateType === TemplateType.OFFICE
      ? await this.prisma.officeNotice.findMany({
          where: { workspaceId },
          orderBy: { createdAt: 'desc' },
        })
      : ws.templateType === TemplateType.ESTATE
        ? await this.prisma.estateNotice.findMany({
            where: { workspaceId, ...(resolvedEstateId ? { estateId: resolvedEstateId } : {}) },
            include: { estate: { select: { id: true, name: true } } },
            orderBy: { createdAt: 'desc' },
          })
        : await this.prisma.apartmentNotice.findMany({
            where: { workspaceId },
            orderBy: { createdAt: 'desc' },
          });
    const header = ['id', 'property', 'title', 'audience', 'seenCount', 'createdAt'];
    const lines = [header.join(',')];
    rows.forEach((r) => {
      const seen = Array.isArray(r.seenBy) ? r.seenBy.length : 0;
      lines.push([
        r.id,
        ws.templateType === TemplateType.ESTATE ? (r as any).estate?.name || (r as any).estateId || '' : '',
        r.title,
        r.audience,
        seen,
        r.createdAt.toISOString(),
      ].map(csvEscape).join(','));
    });
    return lines.join('\n');
  }
}
