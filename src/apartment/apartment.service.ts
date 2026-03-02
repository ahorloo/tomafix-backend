import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  MemberRole,
  RequestPriority,
  RequestStatus,
  ResidentRole,
  ResidentStatus,
  TemplateType,
  UnitStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { getEntitlements, resolvePlanName } from '../billing/planConfig';
import { CreateUnitDto } from './dto/create-unit.dto';
import { CreateResidentDto } from './dto/create-resident.dto';
import { CreateRequestDto } from './dto/create-request.dto';

@Injectable()
export class ApartmentService {
  private readonly logger = new Logger(ApartmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly onboarding: OnboardingService,
  ) {}

  private async sendEmail(args: { to: string; subject: string; html: string }) {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM || process.env.EMAIL_FROM || 'TomaFix <onboarding@resend.dev>';

    if (!apiKey) {
      this.logger.warn(`RESEND_API_KEY not set. Skipping email to ${args.to}`);
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

  private async assertApartmentWorkspace(workspaceId: string) {
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!ws) throw new NotFoundException('Workspace not found');
    if (ws.templateType !== TemplateType.APARTMENT) {
      throw new BadRequestException('Workspace is not an APARTMENT template');
    }
    return ws;
  }

  private async assertUnitsPlanLimit(workspaceId: string) {
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!ws) throw new NotFoundException('Workspace not found');

    const planName = resolvePlanName((ws as any).planName || 'Starter');
    const limit = getEntitlements(planName).limits.units;
    const used = await this.prisma.unit.count({ where: { workspaceId } });

    if (used >= limit) {
      throw new ForbiddenException({
        code: 'PLAN_LIMIT_EXCEEDED',
        message: `You have reached your ${planName} unit limit (${used}/${limit}). Upgrade plan to add more units.`,
        requiredPlan: planName === 'Starter' ? 'Growth' : 'TomaPrime',
        context: { limit: 'units', used, max: limit },
      } as any);
    }
  }

  async getDashboard(workspaceId: string) {
    await this.assertApartmentWorkspace(workspaceId);

    const [totalUnits, occupiedUnits, vacantUnits, maintenanceUnits] = await Promise.all([
      this.prisma.unit.count({ where: { workspaceId } }),
      this.prisma.unit.count({ where: { workspaceId, status: UnitStatus.OCCUPIED } }),
      this.prisma.unit.count({ where: { workspaceId, status: UnitStatus.VACANT } }),
      this.prisma.unit.count({ where: { workspaceId, status: UnitStatus.MAINTENANCE } }),
    ]);

    const [pendingRequests, inProgressRequests] = await Promise.all([
      this.prisma.request.count({ where: { workspaceId, status: RequestStatus.PENDING } }),
      this.prisma.request.count({ where: { workspaceId, status: RequestStatus.IN_PROGRESS } }),
    ]);

    const recentRequests = await this.prisma.request.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 6,
      include: {
        unit: { select: { id: true, label: true, block: true, floor: true } },
        resident: { select: { id: true, fullName: true } },
      },
    });

    return {
      units: {
        total: totalUnits,
        occupied: occupiedUnits,
        vacant: vacantUnits,
        maintenance: maintenanceUnits,
      },
      requests: {
        pending: pendingRequests,
        inProgress: inProgressRequests,
        open: pendingRequests + inProgressRequests,
      },
      recentRequests,
    };
  }

  private async getStaffBlockScope(workspaceId: string, actorUserId?: string) {
    if (!actorUserId) return null;

    const member = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId, userId: actorUserId, isActive: true },
      select: { role: true },
    });
    if (!member) return null;
    if (member.role !== MemberRole.STAFF) return null;

    const blocks = await this.prisma.staffBlockAssignment.findMany({
      where: { workspaceId, staffUserId: actorUserId },
      select: { block: true },
    });

    const normalized = blocks.map((b) => b.block).filter(Boolean);
    return normalized;
  }

  async listUnits(workspaceId: string, actorUserId?: string) {
    await this.assertApartmentWorkspace(workspaceId);
    const staffBlocks = await this.getStaffBlockScope(workspaceId, actorUserId);
    return this.prisma.unit.findMany({
      where: {
        workspaceId,
        ...(staffBlocks ? { block: { in: staffBlocks } } : {}),
      },
      orderBy: [{ block: 'asc' }, { floor: 'asc' }, { label: 'asc' }],
    });
  }

  async createUnit(workspaceId: string, dto: CreateUnitDto) {
    await this.assertApartmentWorkspace(workspaceId);
    await this.assertUnitsPlanLimit(workspaceId);

    const label = dto.label.trim();
    const block = dto.block?.trim() || null;
    const floor = dto.floor?.trim() || null;

    try {
      return await this.prisma.unit.create({
        data: {
          workspaceId,
          label,
          block,
          floor,
          status: dto.status ?? UnitStatus.VACANT,
        },
      });
    } catch (e: unknown) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const parts = [block ? `Block ${block}` : null, floor ? `Floor ${floor}` : null]
          .filter(Boolean)
          .join(' • ');
        const where = parts ? ` (${parts})` : '';
        throw new ConflictException(
          `Unit "${label}" already exists in this workspace${where}. Try a different label.`,
        );
      }
      throw e;
    }
  }

  async updateUnit(workspaceId: string, unitId: string, dto: Partial<CreateUnitDto>) {
    await this.assertApartmentWorkspace(workspaceId);

    const unit = await this.prisma.unit.findFirst({ where: { id: unitId, workspaceId } });
    if (!unit) throw new NotFoundException('Unit not found');

    if (dto.label !== undefined && !dto.label.trim()) {
      throw new BadRequestException('label cannot be empty');
    }

    try {
      return await this.prisma.unit.update({
        where: { id: unitId },
        data: {
          label: dto.label !== undefined ? dto.label.trim() : undefined,
          block: dto.block !== undefined ? (dto.block.trim() ? dto.block.trim() : null) : undefined,
          floor: dto.floor !== undefined ? (dto.floor.trim() ? dto.floor.trim() : null) : undefined,
          status: dto.status !== undefined ? dto.status : undefined,
        },
      });
    } catch (e: unknown) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A unit with this label already exists in this workspace. Try a different label.');
      }
      throw e;
    }
  }

  async deleteUnit(workspaceId: string, unitId: string) {
    await this.assertApartmentWorkspace(workspaceId);

    const unit = await this.prisma.unit.findFirst({ where: { id: unitId, workspaceId } });
    if (!unit) throw new NotFoundException('Unit not found');

    const [residentCount, requestCount] = await Promise.all([
      this.prisma.resident.count({ where: { workspaceId, unitId } }),
      this.prisma.request.count({ where: { workspaceId, unitId } }),
    ]);

    if (residentCount > 0) throw new BadRequestException('Cannot delete unit: residents are assigned to this unit');
    if (requestCount > 0) throw new BadRequestException('Cannot delete unit: requests exist for this unit');

    await this.prisma.unit.delete({ where: { id: unitId } });
    return { ok: true };
  }

  async listResidents(workspaceId: string, actorUserId?: string) {
    await this.assertApartmentWorkspace(workspaceId);
    const staffBlocks = await this.getStaffBlockScope(workspaceId, actorUserId);
    return this.prisma.resident.findMany({
      where: {
        workspaceId,
        ...(staffBlocks ? { unit: { block: { in: staffBlocks } } } : {}),
      },
      orderBy: [{ fullName: 'asc' }],
      include: { unit: { select: { id: true, label: true, block: true, floor: true } } },
    });
  }

  private async syncUnitOccupancy(workspaceId: string, unitId: string) {
    const [unit, activeResidents] = await Promise.all([
      this.prisma.unit.findFirst({ where: { id: unitId, workspaceId } }),
      this.prisma.resident.count({ where: { workspaceId, unitId, status: ResidentStatus.ACTIVE } }),
    ]);

    if (!unit) return;

    if (activeResidents > 0 && unit.status !== UnitStatus.OCCUPIED) {
      await this.prisma.unit.update({ where: { id: unitId }, data: { status: UnitStatus.OCCUPIED } });
      return;
    }

    if (activeResidents === 0 && unit.status === UnitStatus.OCCUPIED) {
      await this.prisma.unit.update({ where: { id: unitId }, data: { status: UnitStatus.VACANT } });
    }
  }

  async createResident(workspaceId: string, dto: CreateResidentDto) {
    await this.assertApartmentWorkspace(workspaceId);

    if (dto.unitId) {
      const unit = await this.prisma.unit.findFirst({ where: { id: dto.unitId, workspaceId } });
      if (!unit) throw new BadRequestException('unitId does not belong to this workspace');

      const existingActive = await this.prisma.resident.findFirst({
        where: { workspaceId, unitId: dto.unitId, status: ResidentStatus.ACTIVE },
        select: { id: true, fullName: true },
      });
      if (existingActive) {
        throw new ConflictException(`Unit is already assigned to active resident: ${existingActive.fullName}`);
      }
    }

    const resident = await this.prisma.resident.create({
      data: {
        workspaceId,
        unitId: dto.unitId ?? null,
        fullName: dto.fullName.trim(),
        phone: dto.phone?.trim() || null,
        email: dto.email?.trim() || null,
        role: dto.role ?? ResidentRole.TENANT,
        status: dto.status ?? ResidentStatus.ACTIVE,
      },
    });

    let inviteSent = false;
    let inviteUrl: string | null = null;
    if (resident.email) {
      const invite = await this.onboarding.createTenantInvite({
        workspaceId,
        email: resident.email,
        residentName: resident.fullName,
      });
      inviteSent = true;
      inviteUrl = invite?.inviteUrl || null;
    }

    if (resident.unitId) {
      await this.syncUnitOccupancy(workspaceId, resident.unitId);
    }

    return { ...resident, inviteSent, inviteUrl };
  }

  async updateResident(workspaceId: string, residentId: string, dto: Partial<CreateResidentDto>) {
    await this.assertApartmentWorkspace(workspaceId);

    const resident = await this.prisma.resident.findFirst({ where: { id: residentId, workspaceId } });
    if (!resident) throw new NotFoundException('Resident not found');

    if (dto.fullName !== undefined && !dto.fullName.trim()) {
      throw new BadRequestException('fullName cannot be empty');
    }

    if (dto.unitId !== undefined && dto.unitId !== null && dto.unitId !== '') {
      const unit = await this.prisma.unit.findFirst({ where: { id: dto.unitId, workspaceId } });
      if (!unit) throw new BadRequestException('unitId does not belong to this workspace');

      const existingActive = await this.prisma.resident.findFirst({
        where: {
          workspaceId,
          unitId: dto.unitId,
          status: ResidentStatus.ACTIVE,
          id: { not: residentId },
        },
        select: { id: true, fullName: true },
      });
      if (existingActive) {
        throw new ConflictException(`Unit is already assigned to active resident: ${existingActive.fullName}`);
      }
    }

    const updated = await this.prisma.resident.update({
      where: { id: residentId },
      data: {
        fullName: dto.fullName !== undefined ? dto.fullName.trim() : undefined,
        email: dto.email !== undefined ? (dto.email?.trim() || null) : undefined,
        phone: dto.phone !== undefined ? (dto.phone?.trim() || null) : undefined,
        unitId: dto.unitId !== undefined ? (dto.unitId || null) : undefined,
        role: dto.role !== undefined ? dto.role : undefined,
        status: dto.status !== undefined ? dto.status : undefined,
      },
      include: { unit: { select: { id: true, label: true, block: true, floor: true } } },
    });

    if (resident.unitId) await this.syncUnitOccupancy(workspaceId, resident.unitId);
    if (updated.unitId && updated.unitId !== resident.unitId) await this.syncUnitOccupancy(workspaceId, updated.unitId);

    return updated;
  }

  async deleteResident(workspaceId: string, residentId: string) {
    await this.assertApartmentWorkspace(workspaceId);

    const resident = await this.prisma.resident.findFirst({ where: { id: residentId, workspaceId } });
    if (!resident) throw new NotFoundException('Resident not found');

    const requestCount = await this.prisma.request.count({ where: { workspaceId, residentId } });
    if (requestCount > 0) {
      throw new BadRequestException('Cannot delete resident: request history exists for this resident');
    }

    await this.prisma.resident.delete({ where: { id: residentId } });
    if (resident.unitId) await this.syncUnitOccupancy(workspaceId, resident.unitId);
    return { ok: true };
  }

  async listRequests(workspaceId: string, status?: string, actorUserId?: string) {
    await this.assertApartmentWorkspace(workspaceId);

    const where: any = { workspaceId };
    const staffBlocks = await this.getStaffBlockScope(workspaceId, actorUserId);
    if (staffBlocks) where.unit = { block: { in: staffBlocks } };
    if (status) where.status = status as RequestStatus;

    return this.prisma.request.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        unit: { select: { id: true, label: true, block: true, floor: true } },
        resident: { select: { id: true, fullName: true } },
      },
    });
  }

  async createRequest(workspaceId: string, dto: CreateRequestDto, actorUserId?: string) {
    await this.assertApartmentWorkspace(workspaceId);

    const unit = await this.prisma.unit.findFirst({ where: { id: dto.unitId, workspaceId } });
    if (!unit) throw new BadRequestException('unitId does not belong to this workspace');

    const staffBlocks = await this.getStaffBlockScope(workspaceId, actorUserId);
    if (staffBlocks && !staffBlocks.includes(unit.block || '')) {
      throw new ForbiddenException('You can only create requests for your assigned blocks');
    }

    let resident: { id: string; fullName: string; email: string | null } | null = null;
    if (dto.residentId) {
      resident = await this.prisma.resident.findFirst({
        where: { id: dto.residentId, workspaceId },
        select: { id: true, fullName: true, email: true },
      });
      if (!resident) throw new BadRequestException('residentId does not belong to this workspace');
    }

    const created = await this.prisma.request.create({
      data: {
        workspaceId,
        unitId: dto.unitId,
        residentId: dto.residentId ?? null,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        photoUrl: dto.photoUrl?.trim() || null,
        priority: dto.priority ?? RequestPriority.NORMAL,
        status: dto.status ?? RequestStatus.PENDING,
      },
      include: {
        unit: { select: { id: true, label: true, block: true, floor: true } },
        resident: { select: { id: true, fullName: true } },
      },
    });

    if (resident?.email) {
      try {
        await this.sendEmail({
          to: resident.email,
          subject: `Request created • ${dto.title.trim()}`,
          html: `<p>Your request has been created.</p><p><b>Title:</b> ${created.title}</p><p><b>Unit:</b> ${created.unit?.label || '-'}</p><p>Status: Pending</p>`,
        });
      } catch (e: any) {
        this.logger.warn(`Tenant request-create notification failed: ${e?.message || e}`);
      }
    }

    return created;
  }

  async updateRequest(
    workspaceId: string,
    requestId: string,
    dto: { status?: RequestStatus; priority?: RequestPriority },
  ) {
    await this.assertApartmentWorkspace(workspaceId);

    const req = await this.prisma.request.findFirst({ where: { id: requestId, workspaceId } });
    if (!req) throw new NotFoundException('Request not found');

    return this.prisma.request.update({
      where: { id: requestId },
      data: {
        status: dto.status ?? undefined,
        priority: dto.priority ?? undefined,
      },
      include: {
        unit: { select: { id: true, label: true, block: true, floor: true } },
        resident: { select: { id: true, fullName: true } },
      },
    });
  }

  async listRequestMessages(workspaceId: string, requestId: string) {
    await this.assertApartmentWorkspace(workspaceId);
    const req = await this.prisma.request.findFirst({ where: { id: requestId, workspaceId } });
    if (!req) throw new NotFoundException('Request not found');

    return this.prisma.requestMessage.findMany({
      where: { workspaceId, requestId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addRequestMessage(
    workspaceId: string,
    requestId: string,
    dto: { senderUserId?: string; senderName?: string; body: string },
  ) {
    await this.assertApartmentWorkspace(workspaceId);
    const req = await this.prisma.request.findFirst({ where: { id: requestId, workspaceId } });
    if (!req) throw new NotFoundException('Request not found');

    const body = String(dto.body || '').trim();
    if (!body) throw new BadRequestException('Message body is required');

    let senderName = dto.senderName?.trim();
    if (!senderName && dto.senderUserId) {
      const user = await this.prisma.user.findUnique({ where: { id: dto.senderUserId } });
      senderName = user?.fullName || user?.email || 'User';
    }

    const msg = await this.prisma.requestMessage.create({
      data: {
        workspaceId,
        requestId,
        senderUserId: dto.senderUserId || null,
        senderName: senderName || 'User',
        body,
      },
    });

    if (req.residentId) {
      try {
        const resident = await this.prisma.resident.findFirst({
          where: { id: req.residentId, workspaceId },
          select: { email: true },
        });
        if (resident?.email) {
          await this.sendEmail({
            to: resident.email,
            subject: `Update on your request • ${req.title}`,
            html: `<p>You have a new update on your request.</p><p><b>From:</b> ${msg.senderName}</p><p>Go to your dashboard and view.</p>`,
          });
        }
      } catch (e: any) {
        this.logger.warn(`Tenant request-message notification failed: ${e?.message || e}`);
      }
    }

    return msg;
  }
}