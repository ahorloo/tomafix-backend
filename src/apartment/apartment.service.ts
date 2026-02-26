import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  RequestPriority,
  RequestStatus,
  ResidentRole,
  ResidentStatus,
  TemplateType,
  UnitStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { CreateUnitDto } from './dto/create-unit.dto';
import { CreateResidentDto } from './dto/create-resident.dto';
import { CreateRequestDto } from './dto/create-request.dto';

@Injectable()
export class ApartmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly onboarding: OnboardingService,
  ) {}

  private async assertApartmentWorkspace(workspaceId: string) {
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!ws) throw new NotFoundException('Workspace not found');
    if (ws.templateType !== TemplateType.APARTMENT) {
      throw new BadRequestException('Workspace is not an APARTMENT template');
    }
    return ws;
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

  async listUnits(workspaceId: string) {
    await this.assertApartmentWorkspace(workspaceId);
    return this.prisma.unit.findMany({
      where: { workspaceId },
      orderBy: [{ block: 'asc' }, { floor: 'asc' }, { label: 'asc' }],
    });
  }

  async createUnit(workspaceId: string, dto: CreateUnitDto) {
    await this.assertApartmentWorkspace(workspaceId);

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

  async listResidents(workspaceId: string) {
    await this.assertApartmentWorkspace(workspaceId);
    return this.prisma.resident.findMany({
      where: { workspaceId },
      orderBy: [{ fullName: 'asc' }],
      include: { unit: { select: { id: true, label: true, block: true, floor: true } } },
    });
  }

  async createResident(workspaceId: string, dto: CreateResidentDto) {
    await this.assertApartmentWorkspace(workspaceId);

    if (dto.unitId) {
      const unit = await this.prisma.unit.findFirst({ where: { id: dto.unitId, workspaceId } });
      if (!unit) throw new BadRequestException('unitId does not belong to this workspace');
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
    }

    return this.prisma.resident.update({
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
    return { ok: true };
  }

  async listRequests(workspaceId: string, status?: string) {
    await this.assertApartmentWorkspace(workspaceId);

    const where: any = { workspaceId };
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

  async createRequest(workspaceId: string, dto: CreateRequestDto) {
    await this.assertApartmentWorkspace(workspaceId);

    const unit = await this.prisma.unit.findFirst({ where: { id: dto.unitId, workspaceId } });
    if (!unit) throw new BadRequestException('unitId does not belong to this workspace');

    if (dto.residentId) {
      const resident = await this.prisma.resident.findFirst({ where: { id: dto.residentId, workspaceId } });
      if (!resident) throw new BadRequestException('residentId does not belong to this workspace');
    }

    return this.prisma.request.create({
      data: {
        workspaceId,
        unitId: dto.unitId,
        residentId: dto.residentId ?? null,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        priority: dto.priority ?? RequestPriority.NORMAL,
        status: dto.status ?? RequestStatus.PENDING,
      },
      include: {
        unit: { select: { id: true, label: true, block: true, floor: true } },
        resident: { select: { id: true, fullName: true } },
      },
    });
  }
}