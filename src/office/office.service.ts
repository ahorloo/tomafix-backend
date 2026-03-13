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
  Prisma,
  RequestPriority,
  RequestStatus,
  TemplateType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getEntitlements, resolvePlanName } from '../billing/planConfig';
import { CreateAreaDto } from './dto/create-area.dto';
import { CreateOfficeRequestDto } from './dto/create-request.dto';
import { CreateWorkOrderDto } from './dto/create-work-order.dto';
import { CreateAssetDto } from './dto/create-asset.dto';

@Injectable()
export class OfficeService {
  private readonly logger = new Logger(OfficeService.name);

  constructor(private readonly prisma: PrismaService) {}

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

    const [requestBuckets, openWorkOrders, totalAreas, totalAssets, recentRequests] =
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
      ]);

    const pending =
      requestBuckets.find((r) => r.status === RequestStatus.PENDING)?._count._all ?? 0;
    const inProgress =
      requestBuckets.find((r) => r.status === RequestStatus.IN_PROGRESS)?._count._all ?? 0;
    const resolved =
      requestBuckets.find((r) => r.status === RequestStatus.RESOLVED)?._count._all ?? 0;

    return {
      requests: { pending, inProgress, resolved, open: pending + inProgress },
      workOrders: { open: openWorkOrders },
      areas: { total: totalAreas },
      assets: { total: totalAssets },
      recentRequests,
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

  async listRequests(
    workspaceId: string,
    opts?: { status?: string; category?: string; areaId?: string },
  ) {
    await this.assertOfficeWorkspace(workspaceId);

    const where: Prisma.OfficeRequestWhereInput = { workspaceId };
    if (opts?.status) where.status = opts.status as RequestStatus;
    if (opts?.category) where.category = opts.category as OfficeRequestCategory;
    if (opts?.areaId) where.areaId = opts.areaId;

    return this.prisma.officeRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { area: { select: { id: true, name: true, type: true } } },
    });
  }

  async getRequest(workspaceId: string, requestId: string) {
    await this.assertOfficeWorkspace(workspaceId);
    const req = await this.prisma.officeRequest.findFirst({
      where: { id: requestId, workspaceId },
      include: {
        area: { select: { id: true, name: true, type: true } },
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

    const category = dto.category ?? OfficeRequestCategory.FACILITY;
    const priority = dto.priority ?? RequestPriority.NORMAL;
    const requestSlaDeadline = this.computeSlaDeadline(category, priority);

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.officeRequest.create({
        data: {
          workspaceId,
          areaId: dto.areaId,
          submitterUserId: actorUserId || null,
          submitterName,
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
        include: { area: { select: { id: true, name: true, type: true } } },
      });
      if (!out) throw new NotFoundException('Request not found after create');
      return out;
    });
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

    return this.prisma.officeRequest.update({
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

    return this.prisma.officeWorkOrder.create({
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

    return this.prisma.officeWorkOrder.update({
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
}
