import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  EstateChargeStatus,
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
import { UpdateRequestDto } from './dto/update-request.dto';
import { CreateEstateChargeDto } from './dto/create-estate-charge.dto';
import { RecordEstateChargePaymentDto } from './dto/record-estate-charge-payment.dto';
import { UpdateEstateChargeDto } from './dto/update-estate-charge.dto';

type ListPropertyRequestsOpts = {
  status?: string;
  actorUserId?: string;
  estateId?: string;
  category?: string;
  assignedToUserId?: string;
  overdue?: string;
};

type EstateLocationSnapshot = {
  location: string | null;
  locationMapsUrl: string | null;
  locationLatitude: number | null;
  locationLongitude: number | null;
  locationVerifiedAt: Date | null;
};

function isGoogleMapsUrl(url: string): boolean {
  return /^https?:\/\/.+/i.test(url) && /(google\.|maps\.app\.goo\.gl|goo\.gl)/i.test(url);
}

@Injectable()
export class ApartmentService {
  private readonly logger = new Logger(ApartmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly onboarding: OnboardingService,
  ) {}

  private async syncUserContactFromResident(input: { email?: string | null; fullName?: string | null; phone?: string | null }) {
    const email = String(input.email || '').trim().toLowerCase();
    if (!email) return null;

    const fullName = String(input.fullName || '').trim();
    const phone = String(input.phone || '').trim();

    const data: { fullName?: string; phone?: string } = {};
    if (fullName) data.fullName = fullName;

    if (phone) {
      const conflictingUser = await this.prisma.user.findFirst({
        where: {
          phone,
          email: { not: email },
        },
        select: { id: true },
      });
      if (!conflictingUser) {
        data.phone = phone;
      }
    }

    if (!Object.keys(data).length) return null;

    return this.prisma.user.upsert({
      where: { email },
      update: data,
      create: { email, ...data },
    });
  }

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
      : 1;

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

    const locationData = this.normalizeEstateLocationInput(dto);

    try {
      return await this.prisma.estate.create({
        data: {
          workspaceId,
          name: dto.name.trim(),
          code: dto.code?.trim() || null,
          ...locationData,
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

    const estate = await this.prisma.estate.findFirst({
      where: { id: estateId, workspaceId },
      select: {
        id: true,
        name: true,
        location: true,
        locationMapsUrl: true,
        locationLatitude: true,
        locationLongitude: true,
        locationVerifiedAt: true,
      },
    });
    if (!estate) throw new NotFoundException('Estate not found');

    const locationData = this.normalizeEstateLocationInput(dto, {
      location: estate.location,
      locationMapsUrl: estate.locationMapsUrl,
      locationLatitude: estate.locationLatitude,
      locationLongitude: estate.locationLongitude,
      locationVerifiedAt: estate.locationVerifiedAt,
    });

    try {
      return await this.prisma.estate.update({
        where: { id: estateId },
        data: {
          name: dto.name !== undefined ? dto.name.trim() : undefined,
          code: dto.code !== undefined ? (dto.code?.trim() || null) : undefined,
          ...locationData,
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

  private normalizeEstateLocationInput(dto: Partial<CreateEstateDto>, current?: EstateLocationSnapshot) {
    const locationTouched = dto.location !== undefined;
    const verificationTouched =
      dto.locationMapsUrl !== undefined || dto.locationLatitude !== undefined || dto.locationLongitude !== undefined;

    if (!locationTouched && !verificationTouched) {
      return {
        location: current?.location ?? null,
        locationMapsUrl: current?.locationMapsUrl ?? null,
        locationLatitude: current?.locationLatitude ?? null,
        locationLongitude: current?.locationLongitude ?? null,
        locationVerifiedAt: current?.locationVerifiedAt ?? null,
      };
    }

    const trimmedLocation = dto.location !== undefined ? dto.location?.trim() || null : current?.location ?? null;
    const locationChanged = locationTouched && trimmedLocation !== (current?.location ?? null);

    if (!trimmedLocation) {
      return {
        location: null,
        locationMapsUrl: null,
        locationLatitude: null,
        locationLongitude: null,
        locationVerifiedAt: null,
      };
    }

    let locationMapsUrl = verificationTouched ? dto.locationMapsUrl?.trim() || null : current?.locationMapsUrl ?? null;
    let locationLatitude =
      verificationTouched ? dto.locationLatitude ?? null : current?.locationLatitude ?? null;
    let locationLongitude =
      verificationTouched ? dto.locationLongitude ?? null : current?.locationLongitude ?? null;

    if (locationChanged && !verificationTouched) {
      locationMapsUrl = null;
      locationLatitude = null;
      locationLongitude = null;
    }

    const hasVerification =
      locationMapsUrl !== null || locationLatitude !== null || locationLongitude !== null;

    if (!hasVerification) {
      return {
        location: trimmedLocation,
        locationMapsUrl: null,
        locationLatitude: null,
        locationLongitude: null,
        locationVerifiedAt: null,
      };
    }

    if (!locationMapsUrl || locationLatitude == null || locationLongitude == null) {
      throw new BadRequestException('Verified location needs a Google Maps URL and coordinates');
    }
    if (!isGoogleMapsUrl(locationMapsUrl)) {
      throw new BadRequestException('Location map must be a valid Google Maps URL');
    }
    if (!Number.isFinite(locationLatitude) || locationLatitude < -90 || locationLatitude > 90) {
      throw new BadRequestException('Location latitude is invalid');
    }
    if (!Number.isFinite(locationLongitude) || locationLongitude < -180 || locationLongitude > 180) {
      throw new BadRequestException('Location longitude is invalid');
    }

    return {
      location: trimmedLocation,
      locationMapsUrl,
      locationLatitude,
      locationLongitude,
      locationVerifiedAt: new Date(),
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

    await this.syncUserContactFromResident({
      email: resident.email,
      fullName: resident.fullName,
      phone: resident.phone,
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

    await this.syncUserContactFromResident({
      email: updated.email ?? resident.email,
      fullName: updated.fullName,
      phone: updated.phone,
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

    if (ws.templateType === TemplateType.ESTATE) {
      await this.prisma.estateRequest.deleteMany({ where: { workspaceId, residentId } });
      await this.prisma.estateResident.delete({ where: { id: residentId } });
    } else {
      await this.prisma.apartmentRequest.deleteMany({ where: { workspaceId, residentId } });
      await this.prisma.apartmentResident.delete({ where: { id: residentId } });
    }
    if (resident.unitId) await this.syncUnitOccupancy(workspaceId, resident.unitId);

    if (resident.email) {
      const user = await this.prisma.user.findFirst({
        where: { email: { equals: resident.email.trim(), mode: 'insensitive' } },
      });
      if (user) {
        await this.prisma.workspaceMember.deleteMany({ where: { workspaceId, userId: user.id } });
      }
    }

    return { ok: true, mode: 'force_deleted' };
  }

  async listRequests(workspaceId: string, opts: ListPropertyRequestsOpts = {}) {
    const ws = await this.assertPropertyWorkspace(workspaceId);

    const where: any = { workspaceId };
    const staffBlocks = await this.getStaffBlockScope(workspaceId, opts.actorUserId);
    if (staffBlocks) where.unit = { block: { in: staffBlocks } };
    if (opts.status) where.status = opts.status as RequestStatus;

    if (ws.templateType === TemplateType.ESTATE) {
      const resolvedEstateId = await this.resolveEstateIdForWorkspace(workspaceId, opts.estateId);
      if (resolvedEstateId) {
        where.unit = {
          ...(where.unit || {}),
          estateId: resolvedEstateId,
        };
      }

      if (opts.category?.trim()) {
        where.category = { equals: opts.category.trim(), mode: 'insensitive' };
      }
      if (opts.assignedToUserId?.trim()) {
        where.assignedToUserId = opts.assignedToUserId.trim();
      }

      const rows = await this.prisma.estateRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          unit: {
            select: {
              id: true,
              label: true,
              block: true,
              floor: true,
              estate: { select: { id: true, name: true, code: true } },
            },
          },
          resident: { select: { id: true, fullName: true } },
        },
      });

      const hydrated = rows.map((row) => ({
        ...row,
        isOverdue: this.isEstateRequestOverdue(row),
      }));

      if (String(opts.overdue || '').toLowerCase() === 'true') {
        return hydrated.filter((row) => row.isOverdue);
      }

      return hydrated;
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

  async getRequest(workspaceId: string, requestId: string) {
    const ws = await this.assertPropertyWorkspace(workspaceId);

    if (ws.templateType === TemplateType.ESTATE) {
      const request = await this.prisma.estateRequest.findFirst({
        where: { id: requestId, workspaceId },
        include: {
          unit: {
            select: {
              id: true,
              label: true,
              block: true,
              floor: true,
              estate: { select: { id: true, name: true, code: true } },
            },
          },
          resident: { select: { id: true, fullName: true } },
        },
      });
      if (!request) throw new NotFoundException('Request not found');
      return {
        ...request,
        isOverdue: this.isEstateRequestOverdue(request),
      };
    }

    const request = await this.prisma.apartmentRequest.findFirst({
      where: { id: requestId, workspaceId },
      include: {
        unit: { select: { id: true, label: true, block: true, floor: true } },
        resident: { select: { id: true, fullName: true } },
      },
    });
    if (!request) throw new NotFoundException('Request not found');
    return request;
  }

  private normalizeRequestText(v?: string | null) {
    return String(v || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  private normalizeOptionalText(v?: string | null) {
    const trimmed = String(v || '').trim();
    return trimmed || null;
  }

  private propertyRequestSlaDeadline(createdAt: Date, priority: RequestPriority) {
    const slaHours: Record<RequestPriority, number> = {
      [RequestPriority.LOW]: 72,
      [RequestPriority.NORMAL]: 24,
      [RequestPriority.HIGH]: 12,
      [RequestPriority.URGENT]: 4,
    };
    return new Date(createdAt.getTime() + (slaHours[priority] ?? 24) * 3600000);
  }

  private isOpenRequestStatus(status: RequestStatus) {
    return status === RequestStatus.PENDING || status === RequestStatus.IN_PROGRESS;
  }

  private isEstateRequestOverdue(request: {
    status: RequestStatus;
    priority: RequestPriority;
    createdAt: Date;
    dueAt?: Date | null;
  }) {
    if (!this.isOpenRequestStatus(request.status)) return false;
    const deadline = request.dueAt || this.propertyRequestSlaDeadline(request.createdAt, request.priority);
    return Date.now() > deadline.getTime();
  }

  private async resolveEstateRequestAssignment(workspaceId: string, assignedToUserId?: string | null) {
    if (assignedToUserId === undefined) return undefined;

    const normalizedUserId = String(assignedToUserId || '').trim();
    if (!normalizedUserId) {
      return { assignedToUserId: null, assignedToName: null };
    }

    const member = await this.prisma.workspaceMember.findFirst({
      where: {
        workspaceId,
        userId: normalizedUserId,
        isActive: true,
        role: { in: [MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF, MemberRole.TECHNICIAN] },
      },
      select: {
        userId: true,
        user: {
          select: {
            fullName: true,
            email: true,
          },
        },
      },
    });

    if (!member) {
      throw new BadRequestException('assignedToUserId must belong to an active workspace team member');
    }

    return {
      assignedToUserId: member.userId,
      assignedToName: member.user.fullName || member.user.email || 'Team member',
    };
  }

  async createRequest(workspaceId: string, dto: CreateRequestDto, actorUserId?: string) {
    const ws = await this.assertPropertyWorkspace(workspaceId);
    const dedupeWindowMs = 30 * 1000;
    const normalizedTitle = this.normalizeRequestText(dto.title);
    const normalizedDescription = this.normalizeRequestText(dto.description);

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

    const existingRecentDuplicate = ws.templateType === TemplateType.ESTATE
      ? await this.prisma.estateRequest.findFirst({
          where: {
            workspaceId,
            unitId: dto.unitId,
            residentId: dto.residentId ?? null,
            createdAt: { gte: new Date(Date.now() - dedupeWindowMs) },
          },
          orderBy: { createdAt: 'desc' },
          include: {
            unit: { select: { id: true, label: true, block: true, floor: true } },
            resident: { select: { id: true, fullName: true } },
          },
        })
      : await this.prisma.apartmentRequest.findFirst({
          where: {
            workspaceId,
            unitId: dto.unitId,
            residentId: dto.residentId ?? null,
            createdAt: { gte: new Date(Date.now() - dedupeWindowMs) },
          },
          orderBy: { createdAt: 'desc' },
          include: {
            unit: { select: { id: true, label: true, block: true, floor: true } },
            resident: { select: { id: true, fullName: true } },
          },
        });

    if (existingRecentDuplicate) {
      const recentTitle = this.normalizeRequestText(existingRecentDuplicate.title);
      const recentDescription = this.normalizeRequestText(existingRecentDuplicate.description);
      if (recentTitle === normalizedTitle && recentDescription === normalizedDescription) {
        if (ws.templateType === TemplateType.ESTATE) {
          return {
            ...(existingRecentDuplicate as any),
            isOverdue: this.isEstateRequestOverdue(existingRecentDuplicate as any),
          };
        }
        return existingRecentDuplicate as any;
      }
    }

    const created = ws.templateType === TemplateType.ESTATE
      ? await (async () => {
          const assignment = await this.resolveEstateRequestAssignment(workspaceId, dto.assignedToUserId);
          const status = dto.status ?? RequestStatus.PENDING;
          const createdRequest = await this.prisma.estateRequest.create({
            data: {
              id: randomUUID(),
              workspaceId,
              unitId: dto.unitId,
              residentId: dto.residentId ?? null,
              title: dto.title.trim(),
              description: dto.description?.trim() || null,
              photoUrl: dto.photoUrl?.trim() || null,
              category: this.normalizeOptionalText(dto.category),
              assignedToUserId: assignment?.assignedToUserId ?? null,
              assignedToName: assignment?.assignedToName ?? null,
              vendorName: this.normalizeOptionalText(dto.vendorName),
              dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
              resolvedAt:
                status === RequestStatus.RESOLVED || status === RequestStatus.CLOSED ? new Date() : null,
              estimatedCost:
                dto.estimatedCost !== undefined && dto.estimatedCost !== null && Number.isFinite(Number(dto.estimatedCost))
                  ? Number(dto.estimatedCost)
                  : null,
              priority: dto.priority ?? RequestPriority.NORMAL,
              status,
            },
            include: {
              unit: {
                select: {
                  id: true,
                  label: true,
                  block: true,
                  floor: true,
                  estate: { select: { id: true, name: true, code: true } },
                },
              },
              resident: { select: { id: true, fullName: true } },
            },
          });
          return {
            ...createdRequest,
            isOverdue: this.isEstateRequestOverdue(createdRequest),
          };
        })()
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
    dto: UpdateRequestDto,
  ) {
    const ws = await this.assertPropertyWorkspace(workspaceId);

    const req = ws.templateType === TemplateType.ESTATE
      ? await this.prisma.estateRequest.findFirst({ where: { id: requestId, workspaceId } })
      : await this.prisma.apartmentRequest.findFirst({ where: { id: requestId, workspaceId } });
    if (!req) throw new NotFoundException('Request not found');

    if (ws.templateType === TemplateType.ESTATE) {
      const estateReq = req as any;
      const assignment = await this.resolveEstateRequestAssignment(workspaceId, dto.assignedToUserId);
      const nextStatus = dto.status ?? estateReq.status;
      const resolvedAt =
        dto.status !== undefined
          ? nextStatus === RequestStatus.RESOLVED || nextStatus === RequestStatus.CLOSED
            ? estateReq.resolvedAt || new Date()
            : null
          : undefined;

      const updated = await this.prisma.estateRequest.update({
        where: { id: requestId },
        data: {
          status: dto.status ?? undefined,
          priority: dto.priority ?? undefined,
          category:
            dto.category !== undefined ? this.normalizeOptionalText(dto.category) : undefined,
          assignedToUserId:
            assignment !== undefined ? assignment.assignedToUserId : undefined,
          assignedToName:
            assignment !== undefined ? assignment.assignedToName : undefined,
          vendorName:
            dto.vendorName !== undefined ? this.normalizeOptionalText(dto.vendorName) : undefined,
          dueAt:
            dto.dueAt !== undefined ? (dto.dueAt ? new Date(dto.dueAt) : null) : undefined,
          estimatedCost:
            dto.estimatedCost !== undefined
              ? dto.estimatedCost === null || dto.estimatedCost === ('' as any)
                ? null
                : Number(dto.estimatedCost)
              : undefined,
          resolvedAt,
        },
        include: {
          unit: {
            select: {
              id: true,
              label: true,
              block: true,
              floor: true,
              estate: { select: { id: true, name: true, code: true } },
            },
          },
          resident: { select: { id: true, fullName: true } },
        },
      });

      return {
        ...updated,
        isOverdue: this.isEstateRequestOverdue(updated),
      };
    }

    return this.prisma.apartmentRequest.update({
      where: { id: requestId },
      data: { status: dto.status ?? undefined, priority: dto.priority ?? undefined },
      include: {
        unit: { select: { id: true, label: true, block: true, floor: true } },
        resident: { select: { id: true, fullName: true } },
      },
    });
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

  private normalizeCurrencyAmount(value: number) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Amount must be greater than 0');
    }
    return Math.round(amount * 100) / 100;
  }

  private deriveEstateChargeStatus(args: {
    amount: number;
    paidAmount: number;
    dueDate: Date;
    forcedStatus?: EstateChargeStatus | null;
  }) {
    if (args.forcedStatus === EstateChargeStatus.VOID) {
      return EstateChargeStatus.VOID;
    }

    const safeAmount = Math.max(args.amount, 0);
    const safePaidAmount = Math.max(args.paidAmount, 0);
    if (safePaidAmount >= safeAmount - 0.009) {
      return EstateChargeStatus.PAID;
    }
    if (args.dueDate.getTime() < Date.now()) {
      return EstateChargeStatus.OVERDUE;
    }
    if (safePaidAmount > 0) {
      return EstateChargeStatus.PARTIALLY_PAID;
    }
    return EstateChargeStatus.POSTED;
  }

  private decorateEstateCharge(charge: any) {
    const paidAmount = Math.round(
      ((charge.payments || []) as Array<{ amount: number }>).reduce((sum, payment) => sum + Number(payment.amount || 0), 0) *
        100,
    ) / 100;
    const outstandingAmount = Math.max(Math.round((Number(charge.amount || 0) - paidAmount) * 100) / 100, 0);
    const status = this.deriveEstateChargeStatus({
      amount: Number(charge.amount || 0),
      paidAmount,
      dueDate: new Date(charge.dueDate),
      forcedStatus: charge.status,
    });

    return {
      ...charge,
      status,
      paidAmount,
      outstandingAmount,
      isInArrears:
        status === EstateChargeStatus.OVERDUE && outstandingAmount > 0,
    };
  }

  async getFinanceSummary(workspaceId: string, estateId?: string) {
    await this.assertEstateWorkspace(workspaceId);
    const resolvedEstateId = await this.resolveEstateIdForWorkspace(workspaceId, estateId);

    const charges = await this.prisma.estateCharge.findMany({
      where: { workspaceId, ...(resolvedEstateId ? { estateId: resolvedEstateId } : {}) },
      include: {
        estate: { select: { id: true, name: true, code: true } },
        unit: { select: { id: true, label: true, block: true, floor: true } },
        resident: { select: { id: true, fullName: true, email: true } },
        payments: { orderBy: { paidAt: 'desc' } },
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    });

    const decoratedCharges = charges.map((charge) => this.decorateEstateCharge(charge));
    const activeCharges = decoratedCharges.filter((charge) => charge.status !== EstateChargeStatus.VOID);

    const allPayments = activeCharges
      .flatMap((charge) =>
        (charge.payments || []).map((payment: any) => ({
          ...payment,
          chargeId: charge.id,
          chargeTitle: charge.title,
          resident: charge.resident,
          unit: charge.unit,
          estate: charge.estate,
        })),
      )
      .sort((a, b) => +new Date(b.paidAt) - +new Date(a.paidAt));

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const totals = activeCharges.reduce(
      (acc, charge) => {
        acc.billed += Number(charge.amount || 0);
        acc.paid += Number(charge.paidAmount || 0);
        acc.outstanding += Number(charge.outstandingAmount || 0);
        if (charge.isInArrears) {
          acc.overdue += Number(charge.outstandingAmount || 0);
          if (charge.resident?.id) acc.arrearsResidents.add(charge.resident.id);
        }
        return acc;
      },
      {
        billed: 0,
        paid: 0,
        outstanding: 0,
        overdue: 0,
        arrearsResidents: new Set<string>(),
      },
    );

    const collectedThisMonth = allPayments
      .filter((payment) => new Date(payment.paidAt).getTime() >= monthStart.getTime())
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

    const balanceMap = new Map<
      string,
      {
        residentId: string | null;
        residentName: string;
        unitLabel: string;
        propertyName: string;
        billedAmount: number;
        paidAmount: number;
        outstandingAmount: number;
        overdueAmount: number;
        chargeCount: number;
      }
    >();

    activeCharges.forEach((charge) => {
      const key = charge.resident?.id || `charge:${charge.id}`;
      const current = balanceMap.get(key) || {
        residentId: charge.resident?.id || null,
        residentName: charge.resident?.fullName || 'Unassigned resident',
        unitLabel: charge.unit?.label || 'No unit',
        propertyName: charge.estate?.name || 'No property',
        billedAmount: 0,
        paidAmount: 0,
        outstandingAmount: 0,
        overdueAmount: 0,
        chargeCount: 0,
      };

      current.billedAmount += Number(charge.amount || 0);
      current.paidAmount += Number(charge.paidAmount || 0);
      current.outstandingAmount += Number(charge.outstandingAmount || 0);
      current.chargeCount += 1;
      if (charge.isInArrears) current.overdueAmount += Number(charge.outstandingAmount || 0);
      balanceMap.set(key, current);
    });

    const balances = [...balanceMap.values()]
      .map((balance) => ({
        ...balance,
        billedAmount: Math.round(balance.billedAmount * 100) / 100,
        paidAmount: Math.round(balance.paidAmount * 100) / 100,
        outstandingAmount: Math.round(balance.outstandingAmount * 100) / 100,
        overdueAmount: Math.round(balance.overdueAmount * 100) / 100,
      }))
      .sort((a, b) => b.outstandingAmount - a.outstandingAmount || a.residentName.localeCompare(b.residentName));

    return {
      totals: {
        billed: Math.round(totals.billed * 100) / 100,
        paid: Math.round(totals.paid * 100) / 100,
        outstanding: Math.round(totals.outstanding * 100) / 100,
        overdue: Math.round(totals.overdue * 100) / 100,
        collectedThisMonth: Math.round(collectedThisMonth * 100) / 100,
        residentsInArrears: totals.arrearsResidents.size,
        activeCharges: activeCharges.length,
      },
      balances,
      recentCharges: decoratedCharges
        .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
        .slice(0, 8),
      recentPayments: allPayments.slice(0, 8),
    };
  }

  async listFinanceCharges(workspaceId: string, estateId?: string, status?: string) {
    await this.assertEstateWorkspace(workspaceId);
    const resolvedEstateId = await this.resolveEstateIdForWorkspace(workspaceId, estateId);

    const charges = await this.prisma.estateCharge.findMany({
      where: { workspaceId, ...(resolvedEstateId ? { estateId: resolvedEstateId } : {}) },
      include: {
        estate: { select: { id: true, name: true, code: true } },
        unit: { select: { id: true, label: true, block: true, floor: true } },
        resident: { select: { id: true, fullName: true, email: true } },
        payments: { orderBy: { paidAt: 'desc' } },
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    });

    const rows = charges.map((charge) => this.decorateEstateCharge(charge));
    if (status) {
      return rows.filter((charge) => charge.status === (status as EstateChargeStatus));
    }
    return rows;
  }

  async createFinanceCharge(workspaceId: string, dto: CreateEstateChargeDto) {
    await this.assertEstateWorkspace(workspaceId);

    const resident = await this.prisma.estateResident.findFirst({
      where: { id: dto.residentId, workspaceId },
      include: {
        unit: {
          select: {
            id: true,
            label: true,
            estateId: true,
            estate: { select: { id: true, name: true, code: true } },
          },
        },
      },
    });
    if (!resident) throw new BadRequestException('residentId does not belong to this workspace');
    if (!resident.unit?.estateId || !resident.unitId) {
      throw new BadRequestException('Resident must be assigned to a property unit before posting a charge');
    }

    const dueDate = new Date(dto.dueDate);
    if (Number.isNaN(dueDate.getTime())) throw new BadRequestException('Invalid dueDate');

    const amount = this.normalizeCurrencyAmount(dto.amount);
    const initialStatus = this.deriveEstateChargeStatus({
      amount,
      paidAmount: 0,
      dueDate,
    });

    const created = await this.prisma.estateCharge.create({
      data: {
        workspaceId,
        estateId: resident.unit?.estateId || null,
        unitId: resident.unitId,
        residentId: resident.id,
        title: dto.title.trim(),
        category: this.normalizeOptionalText(dto.category),
        notes: this.normalizeOptionalText(dto.notes),
        amount,
        dueDate,
        status: initialStatus,
      },
      include: {
        estate: { select: { id: true, name: true, code: true } },
        unit: { select: { id: true, label: true, block: true, floor: true } },
        resident: { select: { id: true, fullName: true, email: true } },
        payments: { orderBy: { paidAt: 'desc' } },
      },
    });

    return this.decorateEstateCharge(created);
  }

  async updateFinanceCharge(workspaceId: string, chargeId: string, dto: UpdateEstateChargeDto) {
    await this.assertEstateWorkspace(workspaceId);

    const charge = await this.prisma.estateCharge.findFirst({
      where: { id: chargeId, workspaceId },
      include: { payments: true },
    });
    if (!charge) throw new NotFoundException('Charge not found');

    const paidAmount = (charge.payments || []).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const nextAmount = dto.amount !== undefined ? this.normalizeCurrencyAmount(dto.amount) : Number(charge.amount || 0);
    if (nextAmount + 0.009 < paidAmount) {
      throw new BadRequestException('Charge amount cannot be less than the amount already paid');
    }

    const nextDueDate = dto.dueDate !== undefined ? new Date(dto.dueDate) : new Date(charge.dueDate);
    if (Number.isNaN(nextDueDate.getTime())) throw new BadRequestException('Invalid dueDate');

    const forcedStatus = dto.status === EstateChargeStatus.VOID ? EstateChargeStatus.VOID : charge.status;
    const nextStatus = this.deriveEstateChargeStatus({
      amount: nextAmount,
      paidAmount,
      dueDate: nextDueDate,
      forcedStatus,
    });

    const updated = await this.prisma.estateCharge.update({
      where: { id: chargeId },
      data: {
        title: dto.title !== undefined ? dto.title.trim() : undefined,
        category: dto.category !== undefined ? this.normalizeOptionalText(dto.category) : undefined,
        notes: dto.notes !== undefined ? this.normalizeOptionalText(dto.notes) : undefined,
        amount: dto.amount !== undefined ? nextAmount : undefined,
        dueDate: dto.dueDate !== undefined ? nextDueDate : undefined,
        status: nextStatus,
      },
      include: {
        estate: { select: { id: true, name: true, code: true } },
        unit: { select: { id: true, label: true, block: true, floor: true } },
        resident: { select: { id: true, fullName: true, email: true } },
        payments: { orderBy: { paidAt: 'desc' } },
      },
    });

    return this.decorateEstateCharge(updated);
  }

  async listFinancePayments(workspaceId: string, estateId?: string) {
    await this.assertEstateWorkspace(workspaceId);
    const resolvedEstateId = await this.resolveEstateIdForWorkspace(workspaceId, estateId);

    return this.prisma.estateChargePayment.findMany({
      where: {
        workspaceId,
        ...(resolvedEstateId ? { charge: { is: { estateId: resolvedEstateId } } } : {}),
      },
      include: {
        charge: {
          select: {
            id: true,
            title: true,
            amount: true,
            currency: true,
            resident: { select: { id: true, fullName: true } },
            unit: { select: { id: true, label: true } },
            estate: { select: { id: true, name: true, code: true } },
          },
        },
      },
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async recordFinancePayment(workspaceId: string, dto: RecordEstateChargePaymentDto) {
    await this.assertEstateWorkspace(workspaceId);

    const charge = await this.prisma.estateCharge.findFirst({
      where: { id: dto.chargeId, workspaceId },
      include: {
        payments: true,
        resident: { select: { id: true, fullName: true } },
        unit: { select: { id: true, label: true } },
        estate: { select: { id: true, name: true, code: true } },
      },
    });
    if (!charge) throw new BadRequestException('chargeId does not belong to this workspace');
    if (charge.status === EstateChargeStatus.VOID) {
      throw new BadRequestException('Cannot record payment against a void charge');
    }

    const amount = this.normalizeCurrencyAmount(dto.amount);
    const paidSoFar = (charge.payments || []).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const outstanding = Math.max(Number(charge.amount || 0) - paidSoFar, 0);
    if (amount > outstanding + 0.009) {
      throw new BadRequestException('Payment amount exceeds the remaining outstanding balance');
    }

    const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();
    if (Number.isNaN(paidAt.getTime())) throw new BadRequestException('Invalid paidAt date');

    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.estateChargePayment.create({
        data: {
          workspaceId,
          chargeId: charge.id,
          amount,
          paidAt,
          method: this.normalizeOptionalText(dto.method),
          reference: this.normalizeOptionalText(dto.reference),
          notes: this.normalizeOptionalText(dto.notes),
        },
        include: {
          charge: {
            select: {
              id: true,
              title: true,
              amount: true,
              currency: true,
              resident: { select: { id: true, fullName: true } },
              unit: { select: { id: true, label: true } },
              estate: { select: { id: true, name: true, code: true } },
            },
          },
        },
      });

      const totalPaid = paidSoFar + amount;
      const nextStatus = this.deriveEstateChargeStatus({
        amount: Number(charge.amount || 0),
        paidAmount: totalPaid,
        dueDate: new Date(charge.dueDate),
        forcedStatus: charge.status,
      });

      await tx.estateCharge.update({
        where: { id: charge.id },
        data: { status: nextStatus },
      });

      return payment;
    });

    return result;
  }

  // ── Recurring Charges ──────────────────────────────────────────────────────

  async listRecurringCharges(workspaceId: string, estateId?: string) {
    await this.assertEstateWorkspace(workspaceId);
    return this.prisma.estateRecurringCharge.findMany({
      where: {
        workspaceId,
        ...(estateId ? { estateId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createRecurringCharge(workspaceId: string, dto: any) {
    await this.assertEstateWorkspace(workspaceId);
    const { title, category, amount, currency, frequency, dayOfMonth, estateId, notes } = dto;

    const now = new Date();
    const nextRun = new Date(now);
    if (frequency === 'MONTHLY' || frequency === 'QUARTERLY') {
      nextRun.setMonth(nextRun.getMonth() + (frequency === 'QUARTERLY' ? 3 : 1));
      if (dayOfMonth) nextRun.setDate(parseInt(dayOfMonth, 10));
      nextRun.setHours(0, 0, 0, 0);
    } else if (frequency === 'WEEKLY') {
      nextRun.setDate(nextRun.getDate() + 7);
      nextRun.setHours(0, 0, 0, 0);
    } else if (frequency === 'YEARLY') {
      nextRun.setFullYear(nextRun.getFullYear() + 1);
      nextRun.setHours(0, 0, 0, 0);
    } else {
      nextRun.setDate(nextRun.getDate() + 1);
      nextRun.setHours(0, 0, 0, 0);
    }

    return this.prisma.estateRecurringCharge.create({
      data: {
        workspaceId,
        estateId: estateId || null,
        title,
        category: category || null,
        amount: parseFloat(String(amount)),
        currency: currency || 'GHS',
        frequency,
        dayOfMonth: dayOfMonth ? parseInt(String(dayOfMonth), 10) : null,
        notes: notes || null,
        isActive: true,
        nextRunAt: nextRun,
      },
    });
  }

  async updateRecurringCharge(workspaceId: string, scheduleId: string, dto: any) {
    await this.assertEstateWorkspace(workspaceId);
    const existing = await this.prisma.estateRecurringCharge.findFirst({ where: { id: scheduleId, workspaceId } });
    if (!existing) throw new Error('Recurring charge not found');
    return this.prisma.estateRecurringCharge.update({
      where: { id: scheduleId },
      data: {
        title: dto.title !== undefined ? dto.title : existing.title,
        category: dto.category !== undefined ? dto.category : existing.category,
        amount: dto.amount !== undefined ? parseFloat(String(dto.amount)) : existing.amount,
        isActive: dto.isActive !== undefined ? Boolean(dto.isActive) : existing.isActive,
        notes: dto.notes !== undefined ? dto.notes : existing.notes,
      },
    });
  }

  async deleteRecurringCharge(workspaceId: string, scheduleId: string) {
    await this.assertEstateWorkspace(workspaceId);
    const existing = await this.prisma.estateRecurringCharge.findFirst({ where: { id: scheduleId, workspaceId } });
    if (!existing) throw new Error('Recurring charge not found');
    await this.prisma.estateRecurringCharge.delete({ where: { id: scheduleId } });
    return { success: true };
  }
}
