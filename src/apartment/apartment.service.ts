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
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { getEntitlements, resolvePlanName } from '../billing/planConfig';
import { cacheGet, cacheSet } from '../billing/cache';
import { CreateUnitDto } from './dto/create-unit.dto';
import { CreateResidentDto } from './dto/create-resident.dto';
import { CreateRequestDto } from './dto/create-request.dto';
import { CreateEstateDto } from './dto/create-estate.dto';

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
      this.logger.warn(`RESEND_API_KEY not set. Skipping email to ${args.to}`);
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

  private async assertPropertyWorkspace(workspaceId: string) {
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!ws) throw new NotFoundException('Workspace not found');
    if (ws.templateType !== TemplateType.APARTMENT && ws.templateType !== TemplateType.ESTATE) {
      throw new BadRequestException('Workspace is not a property template');
    }
    return ws;
  }

  private async assertEstateWorkspace(workspaceId: string) {
    const ws = await this.assertPropertyWorkspace(workspaceId);
    if (ws.templateType !== TemplateType.ESTATE) {
      throw new BadRequestException('Workspace is not an ESTATE template');
    }
    return ws;
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
    if (existing) return existing.id;

    return null;
  }

  private nextPlan(planName: 'Starter' | 'Growth' | 'TomaPrime') {
    if (planName === 'Starter') return 'Growth';
    if (planName === 'Growth') return 'TomaPrime';
    return 'TomaPrime';
  }

  private async assertPropertiesPlanLimit(workspaceId: string) {
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!ws) throw new NotFoundException('Workspace not found');

    const planName = resolvePlanName((ws as any).planName || 'Starter');
    const limit = getEntitlements(planName, ws.templateType).limits.properties;
    const used = ws.templateType === TemplateType.ESTATE
      ? await this.prisma.estate.count({ where: { workspaceId } })
      : await this.prisma.property.count({ where: { workspaceId } });

    if (used >= limit) {
      throw new ForbiddenException({
        code: 'PLAN_LIMIT_EXCEEDED',
        message: `You have reached your ${planName} property limit (${used}/${limit}). Pay and upgrade to continue adding properties.`,
        requiredPlan: this.nextPlan(planName),
        context: { limit: 'properties', used, max: limit },
      } as any);
    }
  }

  private async assertUnitsPlanLimit(workspaceId: string) {
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!ws) throw new NotFoundException('Workspace not found');

    const planName = resolvePlanName((ws as any).planName || 'Starter');
    const limit = getEntitlements(planName, ws.templateType).limits.units;
    const used = ws.templateType === TemplateType.ESTATE
      ? await this.prisma.estateUnit.count({ where: { workspaceId } })
      : await this.prisma.apartmentUnit.count({ where: { workspaceId } });

    if (used >= limit) {
      throw new ForbiddenException({
        code: 'PLAN_LIMIT_EXCEEDED',
        message: `You have reached your ${planName} unit limit (${used}/${limit}). Pay and upgrade to continue adding units.`,
        requiredPlan: this.nextPlan(planName),
        context: { limit: 'units', used, max: limit },
      } as any);
    }
  }

  async getDashboard(workspaceId: string, estateId?: string) {
    const cacheKey = `apartment:dashboard:${workspaceId}:${estateId || 'all'}`;
    const cached = cacheGet<any>(cacheKey);
    if (cached) return cached;

    const ws = await this.assertPropertyWorkspace(workspaceId);
    const resolvedEstateId = await this.resolveEstateIdForWorkspace(workspaceId, estateId);

    const [unitBuckets, requestBuckets] = ws.templateType === TemplateType.ESTATE
      ? await Promise.all([
          this.prisma.estateUnit.groupBy({
            by: ['status'],
            where: { workspaceId, ...(resolvedEstateId ? { estateId: resolvedEstateId } : {}) },
            _count: { _all: true },
          }),
          this.prisma.estateRequest.groupBy({
            by: ['status'],
            where: { workspaceId, status: { in: [RequestStatus.PENDING, RequestStatus.IN_PROGRESS] }, ...(resolvedEstateId ? { unit: { estateId: resolvedEstateId } } : {}) },
            _count: { _all: true },
          }),
        ])
      : await Promise.all([
          this.prisma.apartmentUnit.groupBy({
            by: ['status'],
            where: { workspaceId },
            _count: { _all: true },
          }),
          this.prisma.apartmentRequest.groupBy({
            by: ['status'],
            where: { workspaceId, status: { in: [RequestStatus.PENDING, RequestStatus.IN_PROGRESS] } },
            _count: { _all: true },
          }),
        ]);

    const totalUnits = unitBuckets.reduce((sum, row) => sum + row._count._all, 0);
    const occupiedUnits = unitBuckets.find((row) => row.status === UnitStatus.OCCUPIED)?._count._all ?? 0;
    const vacantUnits = unitBuckets.find((row) => row.status === UnitStatus.VACANT)?._count._all ?? 0;
    const maintenanceUnits = unitBuckets.find((row) => row.status === UnitStatus.MAINTENANCE)?._count._all ?? 0;

    const pendingRequests = requestBuckets.find((row) => row.status === RequestStatus.PENDING)?._count._all ?? 0;
    const inProgressRequests = requestBuckets.find((row) => row.status === RequestStatus.IN_PROGRESS)?._count._all ?? 0;

    const recentRequests = ws.templateType === TemplateType.ESTATE
      ? await this.prisma.estateRequest.findMany({
          where: { workspaceId, ...(resolvedEstateId ? { unit: { estateId: resolvedEstateId } } : {}) },
          orderBy: { createdAt: 'desc' },
          take: 6,
          include: {
            unit: { select: { id: true, label: true, block: true, floor: true } },
            resident: { select: { id: true, fullName: true } },
          },
        })
      : await this.prisma.apartmentRequest.findMany({
          where: { workspaceId },
          orderBy: { createdAt: 'desc' },
          take: 6,
          include: {
            unit: { select: { id: true, label: true, block: true, floor: true } },
            resident: { select: { id: true, fullName: true } },
          },
        });

    const payload = {
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

    cacheSet(cacheKey, payload, 15000);
    return payload;
  }

  async listEstates(workspaceId: string) {
    await this.assertEstateWorkspace(workspaceId);

    const estates = await this.prisma.estate.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: 'asc' }],
      include: {
        _count: {
          select: { estateUnits: true },
        },
      },
    });

    return estates;
  }

  async createEstate(workspaceId: string, dto: CreateEstateDto) {
    await this.assertEstateWorkspace(workspaceId);
    await this.assertPropertiesPlanLimit(workspaceId);

    try {
      return await this.prisma.estate.create({
        data: {
          workspaceId,
          name: dto.name.trim(),
          code: dto.code?.trim() || null,
          location: dto.location?.trim() || null,
        },
      });
    } catch (e: unknown) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Estate name/code already exists in this workspace');
      }
      throw e;
    }
  }

  async updateEstate(workspaceId: string, estateId: string, dto: Partial<CreateEstateDto>) {
    await this.assertEstateWorkspace(workspaceId);

    const estate = await this.prisma.estate.findFirst({ where: { id: estateId, workspaceId } });
    if (!estate) throw new NotFoundException('Estate not found');

    try {
      return await this.prisma.estate.update({
        where: { id: estateId },
        data: {
          name: dto.name !== undefined ? dto.name.trim() : undefined,
          code: dto.code !== undefined ? (dto.code?.trim() || null) : undefined,
          location: dto.location !== undefined ? (dto.location?.trim() || null) : undefined,
        },
      });
    } catch (e: unknown) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Estate name/code already exists in this workspace');
      }
      throw e;
    }
  }

  async deleteEstate(workspaceId: string, estateId: string) {
    await this.assertEstateWorkspace(workspaceId);

    const estate = await this.prisma.estate.findFirst({ where: { id: estateId, workspaceId } });
    if (!estate) throw new NotFoundException('Estate not found');

    const unitCount = await this.prisma.estateUnit.count({ where: { workspaceId, estateId } });
    if (unitCount > 0) {
      throw new BadRequestException('Cannot delete estate: units are assigned to it');
    }

    await this.prisma.estate.delete({ where: { id: estateId } });
    return { ok: true };
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

  async listUnits(workspaceId: string, actorUserId?: string, estateId?: string) {
    const ws = await this.assertPropertyWorkspace(workspaceId);
    const staffBlocks = await this.getStaffBlockScope(workspaceId, actorUserId);
    const resolvedEstateId = await this.resolveEstateIdForWorkspace(workspaceId, estateId);

    if (ws.templateType === TemplateType.ESTATE) {
      return this.prisma.estateUnit.findMany({
        where: {
          workspaceId,
          ...(resolvedEstateId ? { estateId: resolvedEstateId } : {}),
          ...(staffBlocks ? { block: { in: staffBlocks } } : {}),
        },
        include: {
          estate: { select: { id: true, name: true, code: true } },
        },
        orderBy: [{ block: 'asc' }, { floor: 'asc' }, { label: 'asc' }],
      });
    }

    return this.prisma.apartmentUnit.findMany({
      where: {
        workspaceId,
        ...(staffBlocks ? { block: { in: staffBlocks } } : {}),
      },
      orderBy: [{ block: 'asc' }, { floor: 'asc' }, { label: 'asc' }],
    });
  }

  async createUnit(workspaceId: string, dto: CreateUnitDto) {
    const ws = await this.assertPropertyWorkspace(workspaceId);
    await this.assertUnitsPlanLimit(workspaceId);

    const label = dto.label.trim();
    const block = dto.block?.trim() || null;
    const floor = dto.floor?.trim() || null;
    const estateId = await this.resolveEstateIdForWorkspace(workspaceId, dto.estateId);
    if (ws.templateType === TemplateType.ESTATE && !estateId) {
      throw new BadRequestException('Create/select a property (estate) before adding units');
    }

    try {
      if (ws.templateType === TemplateType.ESTATE) {
        return await this.prisma.estateUnit.create({
          data: {
            id: randomUUID(),
            workspaceId,
            estateId,
            label,
            block,
            floor,
            status: dto.status ?? UnitStatus.VACANT,
          },
          include: {
            estate: { select: { id: true, name: true, code: true } },
          },
        });
      }

      return await this.prisma.apartmentUnit.create({
        data: {
          id: randomUUID(),
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
          ws.templateType === TemplateType.ESTATE
            ? `Unit "${label}" already exists in this property${where}. Try a different label.`
            : `Unit "${label}" already exists in this workspace${where}. Try a different label.`,
        );
      }
      throw e;
    }
  }

  async updateUnit(workspaceId: string, unitId: string, dto: Partial<CreateUnitDto>) {
    const ws = await this.assertPropertyWorkspace(workspaceId);

    const unit = ws.templateType === TemplateType.ESTATE
      ? await this.prisma.estateUnit.findFirst({ where: { id: unitId, workspaceId } })
      : await this.prisma.apartmentUnit.findFirst({ where: { id: unitId, workspaceId } });
    if (!unit) throw new NotFoundException('Unit not found');

    if (dto.label !== undefined && !dto.label.trim()) {
      throw new BadRequestException('label cannot be empty');
    }

    const estateId = dto.estateId !== undefined
      ? await this.resolveEstateIdForWorkspace(workspaceId, dto.estateId || null)
      : undefined;

    try {
      if (ws.templateType === TemplateType.ESTATE) {
        return await this.prisma.estateUnit.update({
          where: { id: unitId },
          data: {
            estateId,
            label: dto.label !== undefined ? dto.label.trim() : undefined,
            block: dto.block !== undefined ? (dto.block.trim() ? dto.block.trim() : null) : undefined,
            floor: dto.floor !== undefined ? (dto.floor.trim() ? dto.floor.trim() : null) : undefined,
            status: dto.status !== undefined ? dto.status : undefined,
          },
          include: {
            estate: { select: { id: true, name: true, code: true } },
          },
        });
      }

      return await this.prisma.apartmentUnit.update({
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
        throw new ConflictException(
          ws.templateType === TemplateType.ESTATE
            ? 'A unit with this label already exists in this property. Try a different label.'
            : 'A unit with this label already exists in this workspace. Try a different label.',
        );
      }
      throw e;
    }
  }

  async deleteUnit(workspaceId: string, unitId: string) {
    const ws = await this.assertPropertyWorkspace(workspaceId);

    const unit = ws.templateType === TemplateType.ESTATE
      ? await this.prisma.estateUnit.findFirst({ where: { id: unitId, workspaceId } })
      : await this.prisma.apartmentUnit.findFirst({ where: { id: unitId, workspaceId } });
    if (!unit) throw new NotFoundException('Unit not found');

    const [residentCount, requestCount] = ws.templateType === TemplateType.ESTATE
      ? await Promise.all([
          this.prisma.estateResident.count({ where: { workspaceId, unitId } }),
          this.prisma.estateRequest.count({ where: { workspaceId, unitId } }),
        ])
      : await Promise.all([
          this.prisma.apartmentResident.count({ where: { workspaceId, unitId } }),
          this.prisma.apartmentRequest.count({ where: { workspaceId, unitId } }),
        ]);

    if (residentCount > 0) throw new BadRequestException('Cannot delete unit: residents are assigned to this unit');
    if (requestCount > 0) throw new BadRequestException('Cannot delete unit: requests exist for this unit');

    if (ws.templateType === TemplateType.ESTATE) {
      await this.prisma.estateUnit.delete({ where: { id: unitId } });
    } else {
      await this.prisma.apartmentUnit.delete({ where: { id: unitId } });
    }
    return { ok: true };
  }

  async listResidents(workspaceId: string, actorUserId?: string, estateId?: string) {
    const ws = await this.assertPropertyWorkspace(workspaceId);
    const staffBlocks = await this.getStaffBlockScope(workspaceId, actorUserId);

    if (ws.templateType === TemplateType.ESTATE) {
      const resolvedEstateId = await this.resolveEstateIdForWorkspace(workspaceId, estateId);
      return this.prisma.estateResident.findMany({
        where: {
          workspaceId,
          ...(staffBlocks ? { unit: { block: { in: staffBlocks } } } : {}),
          ...(resolvedEstateId ? { unit: { estateId: resolvedEstateId, ...(staffBlocks ? { block: { in: staffBlocks } } : {}) } } : {}),
        },
        orderBy: [{ fullName: 'asc' }],
        include: { unit: { select: { id: true, label: true, block: true, floor: true } } },
      });
    }

    return this.prisma.apartmentResident.findMany({
      where: {
        workspaceId,
        ...(staffBlocks ? { unit: { block: { in: staffBlocks } } } : {}),
      },
      orderBy: [{ fullName: 'asc' }],
      include: { unit: { select: { id: true, label: true, block: true, floor: true } } },
    });
  }

  private async syncUnitOccupancy(workspaceId: string, unitId: string) {
    const ws = await this.assertPropertyWorkspace(workspaceId);
    const [unit, activeResidents] = await Promise.all([
      ws.templateType === TemplateType.ESTATE
        ? this.prisma.estateUnit.findFirst({ where: { id: unitId, workspaceId } })
        : this.prisma.apartmentUnit.findFirst({ where: { id: unitId, workspaceId } }),
      ws.templateType === TemplateType.ESTATE
        ? this.prisma.estateResident.count({ where: { workspaceId, unitId, status: ResidentStatus.ACTIVE } })
        : this.prisma.apartmentResident.count({ where: { workspaceId, unitId, status: ResidentStatus.ACTIVE } }),
    ]);

    if (!unit) return;

    const nextStatus = activeResidents > 0 ? UnitStatus.OCCUPIED : UnitStatus.VACANT;
    if (unit.status !== nextStatus) {
      if (ws.templateType === TemplateType.ESTATE) {
        await this.prisma.estateUnit.updateMany({ where: { id: unitId }, data: { status: nextStatus } });
      } else {
        await this.prisma.apartmentUnit.updateMany({ where: { id: unitId }, data: { status: nextStatus } });
      }
    }
  }

  async createResident(workspaceId: string, dto: CreateResidentDto) {
    const ws = await this.assertPropertyWorkspace(workspaceId);

    if (dto.unitId) {
      const unit = ws.templateType === TemplateType.ESTATE
        ? await this.prisma.estateUnit.findFirst({ where: { id: dto.unitId, workspaceId } })
        : await this.prisma.apartmentUnit.findFirst({ where: { id: dto.unitId, workspaceId } });
      if (!unit) throw new BadRequestException('unitId does not belong to this workspace');

      const existingActive = ws.templateType === TemplateType.ESTATE
        ? await this.prisma.estateResident.findFirst({
            where: { workspaceId, unitId: dto.unitId, status: ResidentStatus.ACTIVE },
            select: { id: true, fullName: true },
          })
        : await this.prisma.apartmentResident.findFirst({
            where: { workspaceId, unitId: dto.unitId, status: ResidentStatus.ACTIVE },
            select: { id: true, fullName: true },
          });
      if (existingActive) {
        throw new ConflictException(`Unit is already assigned to active resident: ${existingActive.fullName}`);
      }
    }

    const resident = ws.templateType === TemplateType.ESTATE
      ? await this.prisma.estateResident.create({
          data: {
            id: randomUUID(),
            workspaceId,
            unitId: dto.unitId ?? null,
            fullName: dto.fullName.trim(),
            phone: dto.phone?.trim() || null,
            email: dto.email?.trim().toLowerCase() || null,
            role: dto.role ?? ResidentRole.TENANT,
            status: dto.status ?? ResidentStatus.ACTIVE,
          },
        })
      : await this.prisma.apartmentResident.create({
          data: {
            id: randomUUID(),
            workspaceId,
            unitId: dto.unitId ?? null,
            fullName: dto.fullName.trim(),
            phone: dto.phone?.trim() || null,
            email: dto.email?.trim().toLowerCase() || null,
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
    const ws = await this.assertPropertyWorkspace(workspaceId);

    const resident = ws.templateType === TemplateType.ESTATE
      ? await this.prisma.estateResident.findFirst({ where: { id: residentId, workspaceId } })
      : await this.prisma.apartmentResident.findFirst({ where: { id: residentId, workspaceId } });
    if (!resident) throw new NotFoundException('Resident not found');

    if (dto.fullName !== undefined && !dto.fullName.trim()) {
      throw new BadRequestException('fullName cannot be empty');
    }

    if (dto.unitId !== undefined && dto.unitId !== null && dto.unitId !== '') {
      const unit = ws.templateType === TemplateType.ESTATE
        ? await this.prisma.estateUnit.findFirst({ where: { id: dto.unitId, workspaceId } })
        : await this.prisma.apartmentUnit.findFirst({ where: { id: dto.unitId, workspaceId } });
      if (!unit) throw new BadRequestException('unitId does not belong to this workspace');

      const existingActive = ws.templateType === TemplateType.ESTATE
        ? await this.prisma.estateResident.findFirst({
            where: {
              workspaceId,
              unitId: dto.unitId,
              status: ResidentStatus.ACTIVE,
              id: { not: residentId },
            },
            select: { id: true, fullName: true },
          })
        : await this.prisma.apartmentResident.findFirst({
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

    const updated = ws.templateType === TemplateType.ESTATE
      ? await this.prisma.estateResident.update({
      where: { id: residentId },
      data: {
        fullName: dto.fullName !== undefined ? dto.fullName.trim() : undefined,
        email: dto.email !== undefined ? (dto.email?.trim().toLowerCase() || null) : undefined,
        phone: dto.phone !== undefined ? (dto.phone?.trim() || null) : undefined,
        unitId: dto.unitId !== undefined ? (dto.unitId || null) : undefined,
        role: dto.role !== undefined ? dto.role : undefined,
        status: dto.status !== undefined ? dto.status : undefined,
      },
      include: { unit: { select: { id: true, label: true, block: true, floor: true } } },
      })
      : await this.prisma.apartmentResident.update({
          where: { id: residentId },
          data: {
            fullName: dto.fullName !== undefined ? dto.fullName.trim() : undefined,
            email: dto.email !== undefined ? (dto.email?.trim().toLowerCase() || null) : undefined,
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
    const ws = await this.assertPropertyWorkspace(workspaceId);

    const resident = ws.templateType === TemplateType.ESTATE
      ? await this.prisma.estateResident.findFirst({ where: { id: residentId, workspaceId } })
      : await this.prisma.apartmentResident.findFirst({ where: { id: residentId, workspaceId } });
    if (!resident) throw new NotFoundException('Resident not found');

    const requestCount = ws.templateType === TemplateType.ESTATE
      ? await this.prisma.estateRequest.count({ where: { workspaceId, residentId } })
      : await this.prisma.apartmentRequest.count({ where: { workspaceId, residentId } });

    // Keep request history intact: archive resident instead of hard delete.
    if (requestCount > 0) {
      const archived = ws.templateType === TemplateType.ESTATE
        ? await this.prisma.estateResident.update({
        where: { id: residentId },
        data: {
          status: ResidentStatus.INACTIVE,
          unitId: null,
        },
      })
        : await this.prisma.apartmentResident.update({ where: { id: residentId }, data: { status: ResidentStatus.INACTIVE, unitId: null } });
      if (resident.unitId) await this.syncUnitOccupancy(workspaceId, resident.unitId);
      return { ok: true, mode: 'archived', resident: archived };
    }

    if (ws.templateType === TemplateType.ESTATE) {
      await this.prisma.estateResident.delete({ where: { id: residentId } });
    } else {
      await this.prisma.apartmentResident.delete({ where: { id: residentId } });
    }
    if (resident.unitId) await this.syncUnitOccupancy(workspaceId, resident.unitId);
    return { ok: true, mode: 'deleted' };
  }

  async forceDeleteResident(workspaceId: string, residentId: string) {
    const ws = await this.assertPropertyWorkspace(workspaceId);

    const resident = ws.templateType === TemplateType.ESTATE
      ? await this.prisma.estateResident.findFirst({ where: { id: residentId, workspaceId } })
      : await this.prisma.apartmentResident.findFirst({ where: { id: residentId, workspaceId } });
    if (!resident) throw new NotFoundException('Resident not found');

    // Delete all requests first, then the resident — leaves no trace.
    if (ws.templateType === TemplateType.ESTATE) {
      await this.prisma.estateRequest.deleteMany({ where: { workspaceId, residentId } });
      await this.prisma.estateResident.delete({ where: { id: residentId } });
    } else {
      await this.prisma.apartmentRequest.deleteMany({ where: { workspaceId, residentId } });
      await this.prisma.apartmentResident.delete({ where: { id: residentId } });
    }
    if (resident.unitId) await this.syncUnitOccupancy(workspaceId, resident.unitId);
    return { ok: true, mode: 'force_deleted' };
  }

  async listRequests(workspaceId: string, status?: string, actorUserId?: string, estateId?: string) {
    const ws = await this.assertPropertyWorkspace(workspaceId);

    const where: any = { workspaceId };
    const staffBlocks = await this.getStaffBlockScope(workspaceId, actorUserId);
    if (staffBlocks) where.unit = { block: { in: staffBlocks } };
    if (status) where.status = status as RequestStatus;

    if (ws.templateType === TemplateType.ESTATE) {
      const resolvedEstateId = await this.resolveEstateIdForWorkspace(workspaceId, estateId);
      if (resolvedEstateId) {
        where.unit = {
          ...(where.unit || {}),
          estateId: resolvedEstateId,
        };
      }

      return this.prisma.estateRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          unit: { select: { id: true, label: true, block: true, floor: true } },
          resident: { select: { id: true, fullName: true } },
        },
      });
    }

    return this.prisma.apartmentRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        unit: { select: { id: true, label: true, block: true, floor: true } },
        resident: { select: { id: true, fullName: true } },
      },
    });
  }

  async createRequest(workspaceId: string, dto: CreateRequestDto, actorUserId?: string) {
    const ws = await this.assertPropertyWorkspace(workspaceId);

    const unit = ws.templateType === TemplateType.ESTATE
        ? await this.prisma.estateUnit.findFirst({ where: { id: dto.unitId, workspaceId } })
        : await this.prisma.apartmentUnit.findFirst({ where: { id: dto.unitId, workspaceId } });
    if (!unit) throw new BadRequestException('unitId does not belong to this workspace');

    const staffBlocks = await this.getStaffBlockScope(workspaceId, actorUserId);
    if (staffBlocks && !staffBlocks.includes(unit.block || '')) {
      throw new ForbiddenException('You can only create requests for your assigned blocks');
    }

    let resident: { id: string; fullName: string; email: string | null } | null = null;
    if (dto.residentId) {
      resident = ws.templateType === TemplateType.ESTATE
        ? await this.prisma.estateResident.findFirst({
            where: { id: dto.residentId, workspaceId },
            select: { id: true, fullName: true, email: true },
          })
        : await this.prisma.apartmentResident.findFirst({
            where: { id: dto.residentId, workspaceId },
            select: { id: true, fullName: true, email: true },
          });
      if (!resident) throw new BadRequestException('residentId does not belong to this workspace');
    }

    const created = ws.templateType === TemplateType.ESTATE
      ? await this.prisma.estateRequest.create({
      data: {
        id: randomUUID(),
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
      })
      : await this.prisma.apartmentRequest.create({
          data: {
            id: randomUUID(),
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
          html: `<p>Your request has been created.</p><p><b>Title:</b> ${created.title}</p><p><b>Unit:</b> ${unit.label || '-'}</p><p>Status: Pending</p>`,
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
    const ws = await this.assertPropertyWorkspace(workspaceId);

    const req = ws.templateType === TemplateType.ESTATE
      ? await this.prisma.estateRequest.findFirst({ where: { id: requestId, workspaceId } })
      : await this.prisma.apartmentRequest.findFirst({ where: { id: requestId, workspaceId } });
    if (!req) throw new NotFoundException('Request not found');

    const updated = ws.templateType === TemplateType.ESTATE
      ? await this.prisma.estateRequest.update({
      where: { id: requestId },
      data: {
        status: dto.status ?? undefined,
        priority: dto.priority ?? undefined,
      },
      include: {
        unit: { select: { id: true, label: true, block: true, floor: true } },
        resident: { select: { id: true, fullName: true } },
      },
          })
      : await this.prisma.apartmentRequest.update({
          where: { id: requestId },
          data: { status: dto.status ?? undefined, priority: dto.priority ?? undefined },
          include: { unit: { select: { id: true, label: true, block: true, floor: true } }, resident: { select: { id: true, fullName: true } } },
        });

    return updated;
  }

  async listRequestMessages(workspaceId: string, requestId: string) {
    const ws = await this.assertPropertyWorkspace(workspaceId);
    const req = ws.templateType === TemplateType.ESTATE
      ? await this.prisma.estateRequest.findFirst({ where: { id: requestId, workspaceId } })
      : await this.prisma.apartmentRequest.findFirst({ where: { id: requestId, workspaceId } });
    if (!req) throw new NotFoundException('Request not found');

    return ws.templateType === TemplateType.ESTATE
      ? this.prisma.estateRequestMessage.findMany({ where: { workspaceId, requestId }, orderBy: { createdAt: 'asc' } })
      : this.prisma.apartmentRequestMessage.findMany({ where: { workspaceId, requestId }, orderBy: { createdAt: 'asc' } });
  }

  async addRequestMessage(
    workspaceId: string,
    requestId: string,
    dto: { senderUserId?: string; senderName?: string; body: string },
  ) {
    const ws = await this.assertPropertyWorkspace(workspaceId);
    const req = ws.templateType === TemplateType.ESTATE
      ? await this.prisma.estateRequest.findFirst({ where: { id: requestId, workspaceId } })
      : await this.prisma.apartmentRequest.findFirst({ where: { id: requestId, workspaceId } });
    if (!req) throw new NotFoundException('Request not found');

    const body = String(dto.body || '').trim();
    if (!body) throw new BadRequestException('Message body is required');

    let senderName = dto.senderName?.trim();
    if (!senderName && dto.senderUserId) {
      const user = await this.prisma.user.findUnique({ where: { id: dto.senderUserId } });
      senderName = user?.fullName || user?.email || 'User';
    }

    const msg = ws.templateType === TemplateType.ESTATE
      ? await this.prisma.estateRequestMessage.create({
          data: {
            id: randomUUID(),
            workspaceId,
            requestId,
            senderUserId: dto.senderUserId || null,
            senderName: senderName || 'User',
            body,
          },
        })
      : await this.prisma.apartmentRequestMessage.create({
          data: {
            id: randomUUID(),
            workspaceId,
            requestId,
            senderUserId: dto.senderUserId || null,
            senderName: senderName || 'User',
            body,
          },
        });

    if (req.residentId) {
      try {
        const resident = ws.templateType === TemplateType.ESTATE
          ? await this.prisma.estateResident.findFirst({ where: { id: req.residentId, workspaceId }, select: { email: true } })
          : await this.prisma.apartmentResident.findFirst({ where: { id: req.residentId, workspaceId }, select: { email: true } });
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