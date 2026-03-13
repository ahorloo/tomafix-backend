import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  OfficeRequestCategory,
  OfficeCommunityChannelKey,
  Prisma,
  RequestPriority,
  RequestStatus,
  TemplateType,
  MemberRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getEntitlements, resolvePlanName } from '../billing/planConfig';
import { MailService } from '../mail/mail.service';
import { CreateAreaDto } from './dto/create-area.dto';
import { CreateOfficeRequestDto } from './dto/create-request.dto';
import { CreateWorkOrderDto } from './dto/create-work-order.dto';
import { CreateAssetDto } from './dto/create-asset.dto';
import { CreateOfficeRequestTypeDto } from './dto/create-request-type.dto';

const OFFICE_COMMUNITY_CHANNELS: Array<{
  key: OfficeCommunityChannelKey;
  name: string;
  description: string;
  postingMode: 'everyone' | 'managers';
}> = [
  {
    key: OfficeCommunityChannelKey.GENERAL_HELP,
    name: 'General Help',
    description: 'Quick office questions, shared help, and small day-to-day coordination.',
    postingMode: 'everyone',
  },
  {
    key: OfficeCommunityChannelKey.ADMIN_HELP,
    name: 'Admin Help',
    description: 'Approvals, stationery, logistics, reimbursements, and office support questions.',
    postingMode: 'everyone',
  },
  {
    key: OfficeCommunityChannelKey.COVERAGE,
    name: 'Today / Availability',
    description: 'Shift cover, front desk handoff, who is available, and quick coverage updates.',
    postingMode: 'everyone',
  },
  {
    key: OfficeCommunityChannelKey.UPDATES,
    name: 'Office Updates',
    description: 'Fast operational updates from owners and managers without creating a formal notice.',
    postingMode: 'managers',
  },
];

@Injectable()
export class OfficeService {
  private readonly logger = new Logger(OfficeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  private async assertOfficeWorkspace(workspaceId: string) {
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!ws) throw new NotFoundException('Workspace not found');
    if (ws.templateType !== TemplateType.OFFICE) {
      throw new BadRequestException('This endpoint is only available for OFFICE workspaces');
    }
    return ws;
  }

  private nextPlan(planName: 'Starter' | 'Growth' | 'TomaPrime') {
    if (planName === 'Starter') return 'Growth';
    if (planName === 'Growth') return 'TomaPrime';
    return 'TomaPrime';
  }

  private getSlaHours(category: OfficeRequestCategory, priority: RequestPriority) {
    const matrix: Record<OfficeRequestCategory, Record<RequestPriority, number>> = {
      FACILITY: { LOW: 96, NORMAL: 72, HIGH: 24, URGENT: 8 },
      IT: { LOW: 72, NORMAL: 48, HIGH: 12, URGENT: 4 },
      ADMIN: { LOW: 72, NORMAL: 48, HIGH: 16, URGENT: 8 },
      HR: { LOW: 120, NORMAL: 72, HIGH: 24, URGENT: 8 },
      PROCUREMENT: { LOW: 168, NORMAL: 96, HIGH: 48, URGENT: 24 },
      CLEANING: { LOW: 48, NORMAL: 24, HIGH: 8, URGENT: 4 },
    };
    return matrix[category]?.[priority] ?? 48;
  }

  private computeSlaDeadline(category: OfficeRequestCategory, priority: RequestPriority, from = new Date()) {
    const hours = this.getSlaHours(category, priority);
    return new Date(from.getTime() + hours * 60 * 60 * 1000);
  }

  private async getUserContact(userId?: string | null) {
    if (!userId) return null;
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, fullName: true },
    });
  }

  private async notifyWorkOrderAssignment(workspaceId: string, assignedToUserId: string | null | undefined, woTitle: string) {
    const assignee = await this.getUserContact(assignedToUserId);
    if (!assignee?.email) return;

    await this.mail.sendWoAssigned(
      assignee.email,
      assignee.fullName || assignee.email,
      woTitle,
      workspaceId,
    );
  }

  private async notifyRequestStatusChange(
    workspaceId: string,
    submitterUserId: string | null | undefined,
    requestTitle: string,
    nextStatus: RequestStatus,
  ) {
    const requester = await this.getUserContact(submitterUserId);
    if (!requester?.email) return;

    await this.mail.sendRequestStatusUpdate(
      requester.email,
      requester.fullName || requester.email,
      requestTitle,
      nextStatus,
      workspaceId,
    );
  }

  private isOfficeCommunityManager(role?: MemberRole | string | null) {
    return role === MemberRole.OWNER_ADMIN || role === MemberRole.MANAGER;
  }

  private sortCommunityChannels<T extends { key: OfficeCommunityChannelKey }>(rows: T[]) {
    const order = new Map(
      OFFICE_COMMUNITY_CHANNELS.map((channel, index) => [channel.key, index] as const),
    );
    return [...rows].sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));
  }

  private async ensureCommunityChannels(workspaceId: string) {
    await this.assertOfficeWorkspace(workspaceId);

    const existing = await this.prisma.officeCommunityChannel.findMany({
      where: { workspaceId },
      select: { key: true },
    });
    const existingKeys = new Set(existing.map((channel) => channel.key));
    const missing = OFFICE_COMMUNITY_CHANNELS.filter((channel) => !existingKeys.has(channel.key));

    if (missing.length > 0) {
      await this.prisma.officeCommunityChannel.createMany({
        data: missing.map((channel) => ({
          workspaceId,
          key: channel.key,
          name: channel.name,
          description: channel.description,
        })),
        skipDuplicates: true,
      });
    }

    const channels = await this.prisma.officeCommunityChannel.findMany({
      where: { workspaceId },
      include: {
        _count: { select: { messages: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            body: true,
            createdAt: true,
            senderName: true,
            isPinned: true,
          },
        },
      },
    });

    return this.sortCommunityChannels(channels);
  }

  private async assertOfficeAreasPlanLimit(workspaceId: string) {
    const ws = await this.assertOfficeWorkspace(workspaceId);
    const planName = resolvePlanName((ws as any).planName || 'Starter');
    const limit = getEntitlements(planName, ws.templateType).limits.units;
    const used = await this.prisma.officeArea.count({ where: { workspaceId } });

    if (used >= limit) {
      throw new ForbiddenException({
        code: 'PLAN_LIMIT_EXCEEDED',
        message: `You have reached your ${planName} office area limit (${used}/${limit}). Upgrade to continue adding areas.`,
        requiredPlan: this.nextPlan(planName),
        context: { limit: 'units', used, max: limit },
      } as any);
    }
  }

  private async assertOfficeAssetsPlanLimit(workspaceId: string) {
    const ws = await this.assertOfficeWorkspace(workspaceId);
    const planName = resolvePlanName((ws as any).planName || 'Starter');
    const limit = getEntitlements(planName, ws.templateType).limits.properties;
    const used = await this.prisma.officeAsset.count({ where: { workspaceId } });

    if (used >= limit) {
      throw new ForbiddenException({
        code: 'PLAN_LIMIT_EXCEEDED',
        message: `You have reached your ${planName} asset limit (${used}/${limit}). Upgrade to continue adding assets.`,
        requiredPlan: this.nextPlan(planName),
        context: { limit: 'properties', used, max: limit },
      } as any);
    }
  }

  // ─── Dashboard ────────────────────────────────────────────────────────────

  async getDashboard(workspaceId: string) {
    await this.assertOfficeWorkspace(workspaceId);

    const [requestBuckets, openWorkOrders, totalAreas, totalAssets, recentRequests, activeSlaRows, escalatedQueue] =
      await Promise.all([
        this.prisma.officeRequest.groupBy({
          by: ['status'],
          where: { workspaceId },
          _count: { _all: true },
        }),
        this.prisma.officeWorkOrder.count({
          where: { workspaceId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
        }),
        this.prisma.officeArea.count({ where: { workspaceId } }),
        this.prisma.officeAsset.count({ where: { workspaceId } }),
        this.prisma.officeRequest.findMany({
          where: { workspaceId },
          orderBy: { createdAt: 'desc' },
          take: 6,
          include: { area: { select: { id: true, name: true, type: true } } },
        }),
        this.prisma.officeRequest.findMany({
          where: {
            workspaceId,
            status: { in: [RequestStatus.PENDING, RequestStatus.IN_PROGRESS] },
            slaDeadline: { not: null },
          },
          select: { slaDeadline: true },
          take: 500,
        }),
        this.prisma.officeRequest.findMany({
          where: {
            workspaceId,
            status: { in: [RequestStatus.PENDING, RequestStatus.IN_PROGRESS] },
            slaDeadline: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          },
          include: { area: { select: { id: true, name: true, type: true } } },
          orderBy: { slaDeadline: 'asc' },
          take: 5,
        }),
      ]);

    const pending =
      requestBuckets.find((r) => r.status === RequestStatus.PENDING)?._count._all ?? 0;
    const inProgress =
      requestBuckets.find((r) => r.status === RequestStatus.IN_PROGRESS)?._count._all ?? 0;
    const resolved =
      requestBuckets.find((r) => r.status === RequestStatus.RESOLVED)?._count._all ?? 0;

    const now = Date.now();
    const overdue = activeSlaRows.filter((r) => r.slaDeadline && r.slaDeadline.getTime() < now).length;
    const criticalOverdue = activeSlaRows.filter((r) => r.slaDeadline && r.slaDeadline.getTime() < now - 24 * 60 * 60 * 1000).length;
    const due24h = activeSlaRows.filter((r) => {
      if (!r.slaDeadline) return false;
      const t = r.slaDeadline.getTime();
      return t >= now && t <= now + 24 * 60 * 60 * 1000;
    }).length;
    const open = pending + inProgress;
    const onTrack = Math.max(open - overdue, 0);
    const slaCompliancePct = open > 0 ? Math.round((onTrack / open) * 100) : 100;

    return {
      requests: { pending, inProgress, resolved, open, overdue, criticalOverdue, due24h, onTrack, slaCompliancePct },
      workOrders: { open: openWorkOrders },
      areas: { total: totalAreas },
      assets: { total: totalAssets },
      recentRequests,
      escalatedQueue,
    };
  }

  // ─── Areas ────────────────────────────────────────────────────────────────

  async listAreas(workspaceId: string) {
    await this.assertOfficeWorkspace(workspaceId);
    return this.prisma.officeArea.findMany({
      where: { workspaceId },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { officeRequests: true } } },
    });
  }

  async createArea(workspaceId: string, dto: CreateAreaDto) {
    await this.assertOfficeWorkspace(workspaceId);
    await this.assertOfficeAreasPlanLimit(workspaceId);

    let ownerUserId: string | null = null;
    if (dto.ownerUserId?.trim()) {
      const ownerMembership = await this.prisma.workspaceMember.findFirst({
        where: { workspaceId, userId: dto.ownerUserId.trim(), isActive: true },
        select: { userId: true },
      });
      if (!ownerMembership) throw new BadRequestException('ownerUserId is not an active member of this workspace');
      ownerUserId = ownerMembership.userId;
    }

    try {
      return await this.prisma.officeArea.create({
        data: {
          workspaceId,
          name: dto.name.trim(),
          type: dto.type ?? 'OTHER',
          floor: dto.floor?.trim() || null,
          description: dto.description?.trim() || null,
          ownerUserId,
        },
      });
    } catch (e: unknown) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('An area with this name already exists in this workspace');
      }
      throw e;
    }
  }

  async updateArea(workspaceId: string, areaId: string, dto: Partial<CreateAreaDto>) {
    await this.assertOfficeWorkspace(workspaceId);
    const area = await this.prisma.officeArea.findFirst({ where: { id: areaId, workspaceId } });
    if (!area) throw new NotFoundException('Area not found');

    let ownerUserId: string | null | undefined = undefined;
    if (dto.ownerUserId !== undefined) {
      if (!dto.ownerUserId?.trim()) {
        ownerUserId = null;
      } else {
        const ownerMembership = await this.prisma.workspaceMember.findFirst({
          where: { workspaceId, userId: dto.ownerUserId.trim(), isActive: true },
          select: { userId: true },
        });
        if (!ownerMembership) throw new BadRequestException('ownerUserId is not an active member of this workspace');
        ownerUserId = ownerMembership.userId;
      }
    }

    try {
      return await this.prisma.officeArea.update({
        where: { id: areaId },
        data: {
          name: dto.name !== undefined ? dto.name.trim() : undefined,
          type: dto.type !== undefined ? dto.type : undefined,
          floor: dto.floor !== undefined ? (dto.floor?.trim() || null) : undefined,
          description:
            dto.description !== undefined ? (dto.description?.trim() || null) : undefined,
          ownerUserId,
        },
      });
    } catch (e: unknown) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('An area with this name already exists in this workspace');
      }
      throw e;
    }
  }

  async deleteArea(workspaceId: string, areaId: string) {
    await this.assertOfficeWorkspace(workspaceId);
    const area = await this.prisma.officeArea.findFirst({ where: { id: areaId, workspaceId } });
    if (!area) throw new NotFoundException('Area not found');

    const requestCount = await this.prisma.officeRequest.count({
      where: { workspaceId, areaId },
    });
    if (requestCount > 0) {
      throw new BadRequestException('Cannot delete area: requests exist for this area');
    }

    await this.prisma.officeArea.delete({ where: { id: areaId } });
    return { ok: true };
  }

  // ─── Requests ─────────────────────────────────────────────────────────────

  async listRequestTypes(workspaceId: string) {
    await this.assertOfficeWorkspace(workspaceId);
    return this.prisma.officeRequestType.findMany({
      where: { workspaceId, isActive: true },
      orderBy: [{ createdAt: 'asc' }],
    });
  }

  async createRequestType(workspaceId: string, dto: CreateOfficeRequestTypeDto) {
    await this.assertOfficeWorkspace(workspaceId);
    const label = dto.label?.trim();
    if (!label) throw new BadRequestException('label is required');

    return this.prisma.officeRequestType.create({
      data: {
        workspaceId,
        label,
        baseCategory: dto.baseCategory ?? OfficeRequestCategory.FACILITY,
        slaHours: dto.slaHours ?? null,
      },
    });
  }

  async deactivateRequestType(workspaceId: string, requestTypeId: string) {
    await this.assertOfficeWorkspace(workspaceId);
    const row = await this.prisma.officeRequestType.findFirst({ where: { id: requestTypeId, workspaceId } });
    if (!row) throw new NotFoundException('Request type not found');

    await this.prisma.officeRequestType.update({ where: { id: requestTypeId }, data: { isActive: false } });
    return { ok: true };
  }

  async listRequests(
    workspaceId: string,
    opts?: { status?: string; category?: string; areaId?: string; escalated?: string },
  ) {
    await this.assertOfficeWorkspace(workspaceId);

    const where: Prisma.OfficeRequestWhereInput = { workspaceId };
    if (opts?.status) where.status = opts.status as RequestStatus;
    if (opts?.category) where.category = opts.category as OfficeRequestCategory;
    if (opts?.areaId) where.areaId = opts.areaId;

    const rows = await this.prisma.officeRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        area: { select: { id: true, name: true, type: true } },
        requestType: { select: { id: true, label: true, baseCategory: true } },
      },
    });

    const now = Date.now();
    const escalatedRows = rows.map((r) => ({
      ...r,
      isEscalated:
        r.status !== RequestStatus.RESOLVED &&
        r.status !== RequestStatus.CLOSED &&
        !!r.slaDeadline &&
        r.slaDeadline.getTime() < now - 24 * 60 * 60 * 1000,
    }));

    if (String(opts?.escalated || '').toLowerCase() === 'true') {
      return escalatedRows.filter((r) => r.isEscalated);
    }

    return escalatedRows;
  }

  async getRequest(workspaceId: string, requestId: string) {
    await this.assertOfficeWorkspace(workspaceId);
    const req = await this.prisma.officeRequest.findFirst({
      where: { id: requestId, workspaceId },
      include: {
        area: { select: { id: true, name: true, type: true } },
        requestType: { select: { id: true, label: true, baseCategory: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!req) throw new NotFoundException('Request not found');
    return req;
  }

  async createRequest(
    workspaceId: string,
    dto: CreateOfficeRequestDto,
    actorUserId?: string,
  ) {
    await this.assertOfficeWorkspace(workspaceId);

    const area = await this.prisma.officeArea.findFirst({
      where: { id: dto.areaId, workspaceId },
    });
    if (!area) throw new BadRequestException('areaId does not belong to this workspace');

    let submitterName = dto.submitterName?.trim();
    if (!submitterName && actorUserId) {
      const user = await this.prisma.user.findUnique({ where: { id: actorUserId } });
      submitterName = user?.fullName || user?.email || 'Staff';
    }
    if (!submitterName) submitterName = 'Staff';

    let requestTypeId: string | null = null;
    let category = dto.category ?? OfficeRequestCategory.FACILITY;

    if (dto.requestTypeId?.trim()) {
      const type = await this.prisma.officeRequestType.findFirst({
        where: { id: dto.requestTypeId.trim(), workspaceId, isActive: true },
      });
      if (!type) throw new BadRequestException('requestTypeId is invalid for this workspace');
      requestTypeId = type.id;
      category = type.baseCategory;
    }

    const priority = dto.priority ?? RequestPriority.NORMAL;
    const requestSlaDeadline = requestTypeId
      ? await (async () => {
          const t = await this.prisma.officeRequestType.findUnique({ where: { id: requestTypeId! } });
          if (t?.slaHours && t.slaHours > 0) {
            return new Date(Date.now() + t.slaHours * 60 * 60 * 1000);
          }
          return this.computeSlaDeadline(category, priority);
        })()
      : this.computeSlaDeadline(category, priority);

    const createdRequest = await this.prisma.$transaction(async (tx) => {
      const created = await tx.officeRequest.create({
        data: {
          workspaceId,
          areaId: dto.areaId,
          submitterUserId: actorUserId || null,
          submitterName,
          requestTypeId,
          category,
          title: dto.title.trim(),
          description: dto.description?.trim() || null,
          photoUrl: dto.photoUrl?.trim() || null,
          priority,
          slaDeadline: requestSlaDeadline,
          status: RequestStatus.PENDING,
        },
      });

      if (area.ownerUserId) {
        const wo = await tx.officeWorkOrder.create({
          data: {
            workspaceId,
            areaId: area.id,
            assignedToUserId: area.ownerUserId,
            category,
            title: created.title,
            description: created.description,
            priority,
            slaDeadline: requestSlaDeadline,
            status: 'OPEN',
          },
        });

        await tx.officeRequest.update({
          where: { id: created.id },
          data: { workOrderId: wo.id, status: RequestStatus.IN_PROGRESS },
        });
      }

      const out = await tx.officeRequest.findFirst({
        where: { id: created.id, workspaceId },
        include: {
          area: { select: { id: true, name: true, type: true } },
          requestType: { select: { id: true, label: true, baseCategory: true } },
        },
      });
      if (!out) throw new NotFoundException('Request not found after create');
      return out;
    });

    if (area.ownerUserId) {
      try {
        await this.notifyWorkOrderAssignment(workspaceId, area.ownerUserId, createdRequest.title);
      } catch (e: any) {
        this.logger.warn(`Work order assignment email failed after request create: ${e?.message || e}`);
      }
    }

    return createdRequest;
  }

  async updateRequest(
    workspaceId: string,
    requestId: string,
    dto: {
      status?: RequestStatus;
      priority?: RequestPriority;
      workOrderId?: string;
      slaDeadline?: string;
    },
  ) {
    await this.assertOfficeWorkspace(workspaceId);
    const req = await this.prisma.officeRequest.findFirst({
      where: { id: requestId, workspaceId },
    });
    if (!req) throw new NotFoundException('Request not found');

    const resolvedAt =
      dto.status === RequestStatus.RESOLVED && !req.resolvedAt ? new Date() : undefined;

    const updated = await this.prisma.officeRequest.update({
      where: { id: requestId },
      data: {
        status: dto.status ?? undefined,
        priority: dto.priority ?? undefined,
        workOrderId: dto.workOrderId !== undefined ? dto.workOrderId : undefined,
        slaDeadline: dto.slaDeadline !== undefined ? new Date(dto.slaDeadline) : undefined,
        resolvedAt,
      },
      include: { area: { select: { id: true, name: true, type: true } } },
    });

    if (dto.status && dto.status !== req.status) {
      try {
        await this.notifyRequestStatusChange(workspaceId, req.submitterUserId, req.title, dto.status);
      } catch (e: any) {
        this.logger.warn(`Request status email failed: ${e?.message || e}`);
      }
    }

    return updated;
  }

  // ─── Request Messages ─────────────────────────────────────────────────────

  async listRequestMessages(workspaceId: string, requestId: string) {
    await this.assertOfficeWorkspace(workspaceId);
    const req = await this.prisma.officeRequest.findFirst({
      where: { id: requestId, workspaceId },
    });
    if (!req) throw new NotFoundException('Request not found');

    return this.prisma.officeRequestMessage.findMany({
      where: { workspaceId, requestId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addRequestMessage(
    workspaceId: string,
    requestId: string,
    dto: { senderUserId?: string; senderName?: string; body: string },
  ) {
    await this.assertOfficeWorkspace(workspaceId);
    const req = await this.prisma.officeRequest.findFirst({
      where: { id: requestId, workspaceId },
    });
    if (!req) throw new NotFoundException('Request not found');

    const body = String(dto.body || '').trim();
    if (!body) throw new BadRequestException('Message body is required');

    let senderName = dto.senderName?.trim();
    if (!senderName && dto.senderUserId) {
      const user = await this.prisma.user.findUnique({ where: { id: dto.senderUserId } });
      senderName = user?.fullName || user?.email || 'User';
    }

    return this.prisma.officeRequestMessage.create({
      data: {
        workspaceId,
        requestId,
        senderUserId: dto.senderUserId || null,
        senderName: senderName || 'User',
        body,
      },
    });
  }

  // ─── Work Orders ──────────────────────────────────────────────────────────

  async listWorkOrders(workspaceId: string, opts?: { status?: string; assignedToUserId?: string }) {
    await this.assertOfficeWorkspace(workspaceId);

    const where: Prisma.OfficeWorkOrderWhereInput = { workspaceId };
    if (opts?.status) where.status = opts.status;
    if (opts?.assignedToUserId) where.assignedToUserId = opts.assignedToUserId;

    return this.prisma.officeWorkOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        area: { select: { id: true, name: true, type: true } },
        asset: { select: { id: true, name: true, category: true } },
      },
    });
  }

  async createWorkOrder(workspaceId: string, dto: CreateWorkOrderDto) {
    await this.assertOfficeWorkspace(workspaceId);

    if (dto.areaId) {
      const area = await this.prisma.officeArea.findFirst({
        where: { id: dto.areaId, workspaceId },
      });
      if (!area) throw new BadRequestException('areaId does not belong to this workspace');
    }

    if (dto.assetId) {
      const asset = await this.prisma.officeAsset.findFirst({
        where: { id: dto.assetId, workspaceId },
      });
      if (!asset) throw new BadRequestException('assetId does not belong to this workspace');
    }

    const category = dto.category ?? OfficeRequestCategory.FACILITY;
    const priority = dto.priority ?? RequestPriority.NORMAL;
    const slaDeadline = dto.slaDeadline
      ? new Date(dto.slaDeadline)
      : this.computeSlaDeadline(category, priority);

    const created = await this.prisma.officeWorkOrder.create({
      data: {
        workspaceId,
        areaId: dto.areaId || null,
        assetId: dto.assetId || null,
        assignedToUserId: dto.assignedToUserId || null,
        category,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        priority,
        slaDeadline,
        status: 'OPEN',
      },
      include: {
        area: { select: { id: true, name: true, type: true } },
        asset: { select: { id: true, name: true, category: true } },
      },
    });

    if (dto.assignedToUserId) {
      try {
        await this.notifyWorkOrderAssignment(workspaceId, dto.assignedToUserId, created.title);
      } catch (e: any) {
        this.logger.warn(`Work order assignment email failed: ${e?.message || e}`);
      }
    }

    return created;
  }

  async updateWorkOrder(
    workspaceId: string,
    workOrderId: string,
    dto: {
      status?: string;
      priority?: RequestPriority;
      assignedToUserId?: string;
      completionNote?: string;
      proofPhotoUrl?: string;
    },
  ) {
    await this.assertOfficeWorkspace(workspaceId);
    const wo = await this.prisma.officeWorkOrder.findFirst({
      where: { id: workOrderId, workspaceId },
    });
    if (!wo) throw new NotFoundException('Work order not found');

    const closedAt =
      dto.status === 'CLOSED' && !wo.closedAt ? new Date() : undefined;

    const updated = await this.prisma.officeWorkOrder.update({
      where: { id: workOrderId },
      data: {
        status: dto.status ?? undefined,
        priority: dto.priority ?? undefined,
        assignedToUserId:
          dto.assignedToUserId !== undefined ? dto.assignedToUserId || null : undefined,
        completionNote:
          dto.completionNote !== undefined ? dto.completionNote?.trim() || null : undefined,
        proofPhotoUrl:
          dto.proofPhotoUrl !== undefined ? dto.proofPhotoUrl?.trim() || null : undefined,
        closedAt,
      },
      include: {
        area: { select: { id: true, name: true, type: true } },
        asset: { select: { id: true, name: true, category: true } },
      },
    });

    if (
      dto.assignedToUserId !== undefined &&
      dto.assignedToUserId &&
      dto.assignedToUserId !== wo.assignedToUserId
    ) {
      try {
        await this.notifyWorkOrderAssignment(workspaceId, dto.assignedToUserId, updated.title);
      } catch (e: any) {
        this.logger.warn(`Work order reassignment email failed: ${e?.message || e}`);
      }
    }

    return updated;
  }

  // ─── Assets ───────────────────────────────────────────────────────────────

  async listAssets(workspaceId: string, opts?: { status?: string }) {
    await this.assertOfficeWorkspace(workspaceId);
    return this.prisma.officeAsset.findMany({
      where: { workspaceId, ...(opts?.status ? { status: opts.status } : {}) },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { officeWorkOrders: true } } },
    });
  }

  async createAsset(workspaceId: string, dto: CreateAssetDto) {
    await this.assertOfficeWorkspace(workspaceId);
    await this.assertOfficeAssetsPlanLimit(workspaceId);
    return this.prisma.officeAsset.create({
      data: {
        workspaceId,
        name: dto.name.trim(),
        category: dto.category?.trim() || null,
        serialNo: dto.serialNo?.trim() || null,
        location: dto.location?.trim() || null,
        notes: dto.notes?.trim() || null,
        lastServicedAt: dto.lastServicedAt ? new Date(dto.lastServicedAt) : null,
        nextServiceAt: dto.nextServiceAt ? new Date(dto.nextServiceAt) : null,
        status: 'ACTIVE',
        pmIntervalDays: dto.pmIntervalDays ?? null,
        pmAutoCreate: dto.pmAutoCreate ?? false,
        costPerService: dto.costPerService ?? null,
      },
    });
  }

  async updateAsset(workspaceId: string, assetId: string, dto: Partial<CreateAssetDto> & { status?: string }) {
    await this.assertOfficeWorkspace(workspaceId);
    const asset = await this.prisma.officeAsset.findFirst({
      where: { id: assetId, workspaceId },
    });
    if (!asset) throw new NotFoundException('Asset not found');

    return this.prisma.officeAsset.update({
      where: { id: assetId },
      data: {
        name: dto.name !== undefined ? dto.name.trim() : undefined,
        category: dto.category !== undefined ? dto.category?.trim() || null : undefined,
        serialNo: dto.serialNo !== undefined ? dto.serialNo?.trim() || null : undefined,
        location: dto.location !== undefined ? dto.location?.trim() || null : undefined,
        notes: dto.notes !== undefined ? dto.notes?.trim() || null : undefined,
        status: dto.status !== undefined ? dto.status : undefined,
        lastServicedAt:
          dto.lastServicedAt !== undefined
            ? dto.lastServicedAt
              ? new Date(dto.lastServicedAt)
              : null
            : undefined,
        nextServiceAt:
          dto.nextServiceAt !== undefined
            ? dto.nextServiceAt
              ? new Date(dto.nextServiceAt)
              : null
            : undefined,
        pmIntervalDays: dto.pmIntervalDays !== undefined ? dto.pmIntervalDays : undefined,
        pmAutoCreate: dto.pmAutoCreate !== undefined ? dto.pmAutoCreate : undefined,
        costPerService: dto.costPerService !== undefined ? dto.costPerService : undefined,
      },
    });
  }

  async deleteAsset(workspaceId: string, assetId: string) {
    await this.assertOfficeWorkspace(workspaceId);
    const asset = await this.prisma.officeAsset.findFirst({
      where: { id: assetId, workspaceId },
    });
    if (!asset) throw new NotFoundException('Asset not found');

    const woCount = await this.prisma.officeWorkOrder.count({
      where: { workspaceId, assetId },
    });
    if (woCount > 0) {
      throw new BadRequestException(
        'Cannot delete asset: work orders are linked to it. Archive it instead.',
      );
    }

    await this.prisma.officeAsset.delete({ where: { id: assetId } });
    return { ok: true };
  }

  // ─── Work Order Messages ──────────────────────────────────────────────────

  async listWorkOrderMessages(workspaceId: string, workOrderId: string) {
    await this.assertOfficeWorkspace(workspaceId);
    const wo = await this.prisma.officeWorkOrder.findFirst({ where: { id: workOrderId, workspaceId } });
    if (!wo) throw new NotFoundException('Work order not found');
    return this.prisma.officeWorkOrderMessage.findMany({
      where: { workspaceId, workOrderId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addWorkOrderMessage(
    workspaceId: string,
    workOrderId: string,
    dto: { senderUserId?: string; senderName?: string; body: string },
  ) {
    await this.assertOfficeWorkspace(workspaceId);
    const wo = await this.prisma.officeWorkOrder.findFirst({ where: { id: workOrderId, workspaceId } });
    if (!wo) throw new NotFoundException('Work order not found');

    const body = String(dto.body || '').trim();
    if (!body) throw new BadRequestException('Message body is required');

    let senderName = dto.senderName?.trim();
    if (!senderName && dto.senderUserId) {
      const user = await this.prisma.user.findUnique({ where: { id: dto.senderUserId } });
      senderName = user?.fullName || user?.email || 'User';
    }

    return this.prisma.officeWorkOrderMessage.create({
      data: { workspaceId, workOrderId, senderUserId: dto.senderUserId || null, senderName: senderName || 'User', body },
    });
  }

  // ─── Office Community ────────────────────────────────────────────────────

  async listCommunityChannels(workspaceId: string) {
    const channels = await this.ensureCommunityChannels(workspaceId);

    return channels.map((channel) => {
      const config = OFFICE_COMMUNITY_CHANNELS.find((item) => item.key === channel.key);
      return {
        id: channel.id,
        key: channel.key,
        name: channel.name,
        description: channel.description,
        postingMode: config?.postingMode ?? 'everyone',
        messageCount: channel._count.messages,
        latestMessage: channel.messages[0] || null,
      };
    });
  }

  async listCommunityMessages(workspaceId: string, channelId: string) {
    await this.ensureCommunityChannels(workspaceId);

    const channel = await this.prisma.officeCommunityChannel.findFirst({
      where: { id: channelId, workspaceId },
    });
    if (!channel) throw new NotFoundException('Community channel not found');

    const config = OFFICE_COMMUNITY_CHANNELS.find((item) => item.key === channel.key);
    const messages = await this.prisma.officeCommunityMessage.findMany({
      where: { workspaceId, channelId },
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'asc' }],
    });

    return {
      channel: {
        id: channel.id,
        key: channel.key,
        name: channel.name,
        description: channel.description,
        postingMode: config?.postingMode ?? 'everyone',
      },
      messages,
    };
  }

  async addCommunityMessage(
    workspaceId: string,
    channelId: string,
    dto: {
      senderUserId?: string;
      senderName?: string;
      body: string;
      isPinned?: boolean;
      actorRole?: MemberRole | string | null;
    },
  ) {
    await this.ensureCommunityChannels(workspaceId);

    const channel = await this.prisma.officeCommunityChannel.findFirst({
      where: { id: channelId, workspaceId },
    });
    if (!channel) throw new NotFoundException('Community channel not found');

    const body = String(dto.body || '').trim();
    if (!body) throw new BadRequestException('Message body is required');
    if (body.length > 1200) throw new BadRequestException('Message body is too long');

    if (
      channel.key === OfficeCommunityChannelKey.UPDATES &&
      !this.isOfficeCommunityManager(dto.actorRole)
    ) {
      throw new ForbiddenException('Only owner admins and managers can post in Office Updates');
    }

    if (dto.isPinned && !this.isOfficeCommunityManager(dto.actorRole)) {
      throw new ForbiddenException('Only owner admins and managers can pin office community messages');
    }

    let senderName = dto.senderName?.trim();
    if (!senderName && dto.senderUserId) {
      const user = await this.prisma.user.findUnique({ where: { id: dto.senderUserId } });
      senderName = user?.fullName || user?.email || 'User';
    }

    return this.prisma.officeCommunityMessage.create({
      data: {
        workspaceId,
        channelId,
        senderUserId: dto.senderUserId || null,
        senderName: senderName || 'User',
        body,
        isPinned: !!dto.isPinned,
      },
    });
  }

  // ─── Leaderboard ─────────────────────────────────────────────────────────

  async getLeaderboard(workspaceId: string) {
    await this.assertOfficeWorkspace(workspaceId);

    const closed = await this.prisma.officeWorkOrder.findMany({
      where: { workspaceId, status: 'CLOSED', assignedToUserId: { not: null } },
      select: { assignedToUserId: true, slaDeadline: true, closedAt: true, createdAt: true },
    });

    const map = new Map<string, { closed: number; onTime: number; totalMs: number }>();
    for (const wo of closed) {
      const uid = wo.assignedToUserId!;
      if (!map.has(uid)) map.set(uid, { closed: 0, onTime: 0, totalMs: 0 });
      const entry = map.get(uid)!;
      entry.closed++;
      const resolvedAt = wo.closedAt || new Date();
      entry.totalMs += resolvedAt.getTime() - wo.createdAt.getTime();
      if (wo.slaDeadline && resolvedAt <= wo.slaDeadline) entry.onTime++;
    }

    const userIds = [...map.keys()];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, fullName: true, email: true },
    });

    return users
      .map((u) => {
        const stats = map.get(u.id)!;
        const avgResolutionHours = stats.closed > 0 ? Math.round(stats.totalMs / stats.closed / 3600000) : 0;
        const slaRate = stats.closed > 0 ? Math.round((stats.onTime / stats.closed) * 100) : 0;
        return { userId: u.id, name: u.fullName || u.email || u.id, closed: stats.closed, onTime: stats.onTime, slaRate, avgResolutionHours };
      })
      .sort((a, b) => b.closed - a.closed);
  }

  // ─── Public Request Creation ──────────────────────────────────────────────

  async createPublicRequest(
    workspaceId: string,
    dto: { areaId: string; title: string; description?: string; submitterName?: string; category?: string },
  ) {
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!ws) throw new NotFoundException('Workspace not found');
    if (ws.templateType !== 'OFFICE') throw new BadRequestException('Public requests only available for OFFICE workspaces');

    const area = await this.prisma.officeArea.findFirst({ where: { id: dto.areaId, workspaceId } });
    if (!area) throw new BadRequestException('Area not found');

    const category = (dto.category as any) || 'FACILITY';
    const slaHours = 48;

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.officeRequest.create({
        data: {
          workspaceId,
          areaId: dto.areaId,
          submitterName: dto.submitterName?.trim() || 'Guest',
          category,
          title: dto.title.trim(),
          description: dto.description?.trim() || null,
          priority: 'NORMAL',
          slaDeadline: new Date(Date.now() + slaHours * 3600000),
          status: 'PENDING',
        },
      });

      if (area.ownerUserId) {
        const wo = await tx.officeWorkOrder.create({
          data: {
            workspaceId,
            areaId: area.id,
            assignedToUserId: area.ownerUserId,
            category,
            title: created.title,
            description: created.description,
            priority: 'NORMAL',
            slaDeadline: new Date(Date.now() + slaHours * 3600000),
            status: 'OPEN',
          },
        });
        await tx.officeRequest.update({ where: { id: created.id }, data: { workOrderId: wo.id, status: 'IN_PROGRESS' } });
      }

      return { id: created.id, title: created.title, status: created.status };
    });
  }

  // ─── Workspace Integrations ───────────────────────────────────────────────

  async updateIntegrations(workspaceId: string, dto: { slackWebhookUrl?: string; outboundWebhookUrl?: string }) {
    await this.assertOfficeWorkspace(workspaceId);
    return this.prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        slackWebhookUrl: dto.slackWebhookUrl !== undefined ? (dto.slackWebhookUrl?.trim() || null) : undefined,
        outboundWebhookUrl: dto.outboundWebhookUrl !== undefined ? (dto.outboundWebhookUrl?.trim() || null) : undefined,
      },
      select: { id: true, slackWebhookUrl: true, outboundWebhookUrl: true },
    });
  }

  async getIntegrations(workspaceId: string) {
    await this.assertOfficeWorkspace(workspaceId);
    return this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, slackWebhookUrl: true, outboundWebhookUrl: true },
    });
  }
}
