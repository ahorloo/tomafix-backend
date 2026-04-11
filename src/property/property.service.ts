import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AmenityBookingStatus,
  MemberRole,
  ParcelStatus,
  PropertyCommunityChannelKey,
  RequestPriority,
  ResidentStatus,
  TemplateType,
  WorkOrderStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { SmsService } from '../sms/sms.service';
import { assertWorkspaceTemplate } from '../shared/workspace-boundary';

type PropertyTemplate = Extract<TemplateType, 'APARTMENT' | 'ESTATE'>;

const PROPERTY_COMMUNITY_CHANNELS: Array<{
  key: PropertyCommunityChannelKey;
  name: string;
  description: string;
  postingMode: 'everyone' | 'managers';
}> = [
  {
    key: PropertyCommunityChannelKey.GENERAL,
    name: 'Community Feed',
    description: 'Resident conversation, everyday updates, and neighborhood help.',
    postingMode: 'everyone',
  },
  {
    key: PropertyCommunityChannelKey.MARKETPLACE,
    name: 'Buy • Sell • Help',
    description: 'Share recommendations, borrow items, or sell to neighbors safely.',
    postingMode: 'everyone',
  },
  {
    key: PropertyCommunityChannelKey.UPDATES,
    name: 'Management Updates',
    description: 'Fast manager updates that do not need a formal notice.',
    postingMode: 'managers',
  },
  {
    key: PropertyCommunityChannelKey.EMERGENCY,
    name: 'Emergency Alerts',
    description: 'Urgent incidents, outages, and safety broadcasts for the whole community.',
    postingMode: 'managers',
  },
];

@Injectable()
export class PropertyService {
  private readonly logger = new Logger(PropertyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly sms: SmsService,
  ) {}

  private async assertPropertyWorkspace(workspaceId: string) {
    return assertWorkspaceTemplate(
      this.prisma,
      workspaceId,
      [TemplateType.APARTMENT, TemplateType.ESTATE] as const,
      'Property module is enabled only for apartment and estate workspaces',
    ) as Promise<{ id: string; name: string; templateType: PropertyTemplate; planName: string }>;
  }

  private isPropertyCommunityManager(role?: MemberRole | string | null) {
    return role === MemberRole.OWNER_ADMIN || role === MemberRole.MANAGER;
  }

  private normalizeOptionalText(value: unknown) {
    const text = String(value ?? '').trim();
    return text ? text : null;
  }

  private channelDelegate(templateType: PropertyTemplate) {
    return templateType === TemplateType.ESTATE
      ? (this.prisma.estateCommunityChannel as any)
      : (this.prisma.apartmentCommunityChannel as any);
  }

  private messageDelegate(templateType: PropertyTemplate) {
    return templateType === TemplateType.ESTATE
      ? (this.prisma.estateCommunityMessage as any)
      : (this.prisma.apartmentCommunityMessage as any);
  }

  private residentDelegate(templateType: PropertyTemplate) {
    return templateType === TemplateType.ESTATE
      ? (this.prisma.estateResident as any)
      : (this.prisma.apartmentResident as any);
  }

  private unitDelegate(templateType: PropertyTemplate) {
    return templateType === TemplateType.ESTATE
      ? (this.prisma.estateUnit as any)
      : (this.prisma.apartmentUnit as any);
  }

  private householdDelegate(templateType: PropertyTemplate) {
    return templateType === TemplateType.ESTATE
      ? (this.prisma.estateHouseholdMember as any)
      : (this.prisma.apartmentHouseholdMember as any);
  }

  private amenityDelegate(templateType: PropertyTemplate) {
    return templateType === TemplateType.ESTATE
      ? (this.prisma.estateAmenity as any)
      : (this.prisma.apartmentAmenity as any);
  }

  private amenityBookingDelegate(templateType: PropertyTemplate) {
    return templateType === TemplateType.ESTATE
      ? (this.prisma.estateAmenityBooking as any)
      : (this.prisma.apartmentAmenityBooking as any);
  }

  private vehicleDelegate(templateType: PropertyTemplate) {
    return templateType === TemplateType.ESTATE
      ? (this.prisma.estateVehicle as any)
      : (this.prisma.apartmentVehicle as any);
  }

  private parcelDelegate(templateType: PropertyTemplate) {
    return templateType === TemplateType.ESTATE
      ? (this.prisma.estateParcel as any)
      : (this.prisma.apartmentParcel as any);
  }

  private vendorDelegate(templateType: PropertyTemplate) {
    return templateType === TemplateType.ESTATE
      ? (this.prisma.estateVendor as any)
      : (this.prisma.apartmentVendor as any);
  }

  private workOrderDelegate(templateType: PropertyTemplate) {
    return templateType === TemplateType.ESTATE
      ? (this.prisma.estateWorkOrder as any)
      : (this.prisma.apartmentWorkOrder as any);
  }

  private workOrderMessageDelegate(templateType: PropertyTemplate) {
    return templateType === TemplateType.ESTATE
      ? (this.prisma.estateWorkOrderMessage as any)
      : (this.prisma.apartmentWorkOrderMessage as any);
  }

  private sortCommunityChannels<T extends { key: PropertyCommunityChannelKey }>(rows: T[]) {
    const order = new Map(PROPERTY_COMMUNITY_CHANNELS.map((channel, index) => [channel.key, index] as const));
    return [...rows].sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));
  }

  private async resolveSenderName(userId?: string | null, fallback?: string | null) {
    const cleanFallback = this.normalizeOptionalText(fallback);
    if (cleanFallback) return cleanFallback;
    if (!userId) return 'User';
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true, email: true },
    });
    return user?.fullName || user?.email || 'User';
  }

  private async ensureCommunityChannels(workspaceId: string, templateType: PropertyTemplate) {
    const repo = this.channelDelegate(templateType);
    const existing = await repo.findMany({
      where: { workspaceId },
      select: { key: true },
    });
    const existingKeys = new Set(existing.map((channel: any) => channel.key));
    const missing = PROPERTY_COMMUNITY_CHANNELS.filter((channel) => !existingKeys.has(channel.key));

    if (missing.length > 0) {
      await repo.createMany({
        data: missing.map((channel) => ({
          workspaceId,
          key: channel.key,
          name: channel.name,
          description: channel.description,
        })),
        skipDuplicates: true,
      });
    }

    const channels = await repo.findMany({
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

  private async getResidentContext(
    workspaceId: string,
    templateType: PropertyTemplate,
    residentId: string,
  ) {
    if (templateType === TemplateType.ESTATE) {
      const resident = await this.prisma.estateResident.findFirst({
        where: { id: residentId, workspaceId },
        include: {
          unit: {
            select: { id: true, label: true, block: true, floor: true, estateId: true },
          },
        },
      });
      if (!resident) throw new NotFoundException('Resident not found');
      return resident;
    }

    const resident = await this.prisma.apartmentResident.findFirst({
      where: { id: residentId, workspaceId },
      include: {
        unit: {
          select: { id: true, label: true, block: true, floor: true },
        },
      },
    });
    if (!resident) throw new NotFoundException('Resident not found');
    return resident;
  }

  private async getResidentContextForActorUser(
    workspaceId: string,
    templateType: PropertyTemplate,
    actorUserId?: string | null,
  ) {
    const userId = String(actorUserId || '').trim();
    if (!userId) return null;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    const email = String(user?.email || '').trim().toLowerCase();
    if (!email) return null;

    if (templateType === TemplateType.ESTATE) {
      return this.prisma.estateResident.findFirst({
        where: {
          workspaceId,
          status: ResidentStatus.ACTIVE,
          email: { equals: email, mode: 'insensitive' },
        },
        include: {
          unit: {
            select: { id: true, label: true, block: true, floor: true, estateId: true },
          },
        },
      });
    }

    return this.prisma.apartmentResident.findFirst({
      where: {
        workspaceId,
        status: ResidentStatus.ACTIVE,
        email: { equals: email, mode: 'insensitive' },
      },
      include: {
        unit: {
          select: { id: true, label: true, block: true, floor: true },
        },
      },
    });
  }

  private async getUnitContext(
    workspaceId: string,
    templateType: PropertyTemplate,
    unitId?: string | null,
  ) {
    if (!unitId) return null;
    if (templateType === TemplateType.ESTATE) {
      return this.prisma.estateUnit.findFirst({
        where: { id: unitId, workspaceId },
        select: { id: true, label: true, block: true, floor: true, estateId: true },
      });
    }
    return this.prisma.apartmentUnit.findFirst({
      where: { id: unitId, workspaceId },
      select: { id: true, label: true, block: true, floor: true },
    });
  }

  private async getParcelById(workspaceId: string, templateType: PropertyTemplate, parcelId: string) {
    const repo = this.parcelDelegate(templateType);
    if (templateType === TemplateType.ESTATE) {
      return repo.findFirst({
        where: { id: parcelId, workspaceId },
        include: {
          estate: { select: { id: true, name: true } },
          resident: { select: { id: true, fullName: true, email: true, phone: true } },
          unit: { select: { id: true, label: true, block: true, floor: true } },
        },
      });
    }
    return repo.findFirst({
      where: { id: parcelId, workspaceId },
      include: {
        resident: { select: { id: true, fullName: true, email: true, phone: true } },
        unit: { select: { id: true, label: true, block: true, floor: true } },
      },
    });
  }

  private async getAmenityBookingById(workspaceId: string, templateType: PropertyTemplate, bookingId: string) {
    const repo = this.amenityBookingDelegate(templateType);
    if (templateType === TemplateType.ESTATE) {
      return repo.findFirst({
        where: { id: bookingId, workspaceId },
        include: {
          estate: { select: { id: true, name: true } },
          amenity: { select: { id: true, name: true, location: true, feeAmount: true, requiresApproval: true } },
          resident: { select: { id: true, fullName: true, email: true, phone: true } },
          unit: { select: { id: true, label: true, block: true, floor: true } },
        },
      });
    }
    return repo.findFirst({
      where: { id: bookingId, workspaceId },
      include: {
        amenity: { select: { id: true, name: true, location: true, feeAmount: true, requiresApproval: true } },
        resident: { select: { id: true, fullName: true, email: true, phone: true } },
        unit: { select: { id: true, label: true, block: true, floor: true } },
      },
    });
  }

  private notificationSmsEnabled() {
    return String(process.env.NOTIFICATION_SMS_ENABLED || 'false').toLowerCase() === 'true';
  }

  private async sendBookingSms(workspaceName: string, booking: any) {
    const phone = booking?.resident?.phone;
    if (!phone) return;
    try {
      await this.sms.sendAmenityBookingSms({
        to: phone,
        residentName: booking.resident?.fullName || 'Resident',
        amenityName: booking.amenity?.name || 'facility',
        status: String(booking.status || 'REQUESTED').toUpperCase(),
        startAt: booking.startAt instanceof Date ? booking.startAt : new Date(booking.startAt),
        workspaceName,
      });
    } catch (e: any) {
      this.logger.warn(`Amenity booking SMS failed: ${e?.message || e}`);
    }
  }

  private async sendBookingEmail(workspaceName: string, workspaceId: string, booking: any) {
    const email = booking?.resident?.email;
    if (!email) return;
    try {
      await this.mail.sendAmenityBookingEmail({
        to: email,
        residentName: booking.resident?.fullName || 'Resident',
        amenityName: booking.amenity?.name || 'facility',
        status: String(booking.status || 'REQUESTED').toUpperCase(),
        startAt: booking.startAt instanceof Date ? booking.startAt : new Date(booking.startAt),
        workspaceName,
        workspaceId,
      });
    } catch (e: any) {
      this.logger.warn(`Amenity booking email failed: ${e?.message || e}`);
    }
  }

  private async sendParcelSms(workspaceName: string, parcel: any) {
    const phone = parcel?.resident?.phone;
    if (!phone) return;
    try {
      await this.sms.sendParcelSms({
        to: phone,
        recipientName: parcel.recipientName || parcel.resident?.fullName || 'Resident',
        workspaceName,
        status: String(parcel.status || 'RECEIVED').toUpperCase(),
        trackingCode: parcel.trackingCode || null,
      });
    } catch (e: any) {
      this.logger.warn(`Parcel SMS failed: ${e?.message || e}`);
    }
  }

  private async sendParcelEmail(workspaceName: string, workspaceId: string, parcel: any) {
    const email = parcel?.resident?.email;
    if (!email) return;
    try {
      await this.mail.sendParcelEmail({
        to: email,
        recipientName: parcel.recipientName || parcel.resident?.fullName || 'Resident',
        workspaceName,
        status: String(parcel.status || 'RECEIVED').toUpperCase(),
        trackingCode: parcel.trackingCode || null,
        workspaceId,
      });
    } catch (e: any) {
      this.logger.warn(`Parcel email failed: ${e?.message || e}`);
    }
  }

  // ── Vendors ─────────────────────────────────────────────────────────────────

  async listVendors(workspaceId: string, category?: string) {
    const ws = await this.assertPropertyWorkspace(workspaceId);
    return this.vendorDelegate(ws.templateType).findMany({
      where: {
        workspaceId,
        isActive: true,
        ...(category ? { category } : {}),
      },
      orderBy: { name: 'asc' },
    });
  }

  async createVendor(workspaceId: string, dto: any) {
    const ws = await this.assertPropertyWorkspace(workspaceId);
    return this.vendorDelegate(ws.templateType).create({
      data: {
        workspaceId,
        name: dto.name,
        category: dto.category || null,
        phone: dto.phone || null,
        email: dto.email || null,
        address: dto.address || null,
        notes: dto.notes || null,
        isActive: true,
      },
    });
  }

  async updateVendor(workspaceId: string, vendorId: string, dto: any) {
    const ws = await this.assertPropertyWorkspace(workspaceId);
    const repo = this.vendorDelegate(ws.templateType);
    const existing = await repo.findFirst({ where: { id: vendorId, workspaceId } });
    if (!existing) throw new NotFoundException('Vendor not found');
    return repo.update({
      where: { id: vendorId },
      data: {
        name: dto.name ?? existing.name,
        category: dto.category !== undefined ? dto.category : existing.category,
        phone: dto.phone !== undefined ? dto.phone : existing.phone,
        email: dto.email !== undefined ? dto.email : existing.email,
        address: dto.address !== undefined ? dto.address : existing.address,
        notes: dto.notes !== undefined ? dto.notes : existing.notes,
        rating: dto.rating !== undefined ? parseFloat(String(dto.rating)) : existing.rating,
        isActive: dto.isActive !== undefined ? Boolean(dto.isActive) : existing.isActive,
      },
    });
  }

  async deleteVendor(workspaceId: string, vendorId: string) {
    const ws = await this.assertPropertyWorkspace(workspaceId);
    const repo = this.vendorDelegate(ws.templateType);
    const existing = await repo.findFirst({ where: { id: vendorId, workspaceId } });
    if (!existing) throw new NotFoundException('Vendor not found');
    await repo.delete({ where: { id: vendorId } });
    return { success: true };
  }

  // ── Work Orders ──────────────────────────────────────────────────────────────

  async listWorkOrders(workspaceId: string, status?: string, estateId?: string, unitId?: string) {
    const ws = await this.assertPropertyWorkspace(workspaceId);
    const repo = this.workOrderDelegate(ws.templateType);
    return repo.findMany({
      where: {
        workspaceId,
        ...(status ? { status: status as WorkOrderStatus } : {}),
        ...(ws.templateType === TemplateType.ESTATE && estateId ? { estateId } : {}),
        ...(unitId ? { unitId } : {}),
      },
      include: {
        vendor: { select: { id: true, name: true, phone: true, category: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async createWorkOrder(workspaceId: string, dto: any) {
    const ws = await this.assertPropertyWorkspace(workspaceId);
    return this.workOrderDelegate(ws.templateType).create({
      data: {
        workspaceId,
        unitId: dto.unitId || null,
        unitLabel: dto.unitLabel || null,
        estateId: ws.templateType === TemplateType.ESTATE ? (dto.estateId || null) : undefined,
        residentId: dto.residentId || null,
        vendorId: dto.vendorId || null,
        assignedToUserId: dto.assignedToUserId || null,
        assignedToName: dto.assignedToName || null,
        title: dto.title,
        description: dto.description || null,
        category: dto.category || null,
        priority: (dto.priority as RequestPriority) || 'NORMAL',
        estimatedCost: dto.estimatedCost ? parseFloat(String(dto.estimatedCost)) : null,
        slaDeadline: dto.slaDeadline ? new Date(dto.slaDeadline) : null,
      },
      include: {
        vendor: { select: { id: true, name: true, phone: true } },
      },
    });
  }

  async updateWorkOrder(workspaceId: string, workOrderId: string, dto: any) {
    const ws = await this.assertPropertyWorkspace(workspaceId);
    const repo = this.workOrderDelegate(ws.templateType);
    const existing = await repo.findFirst({ where: { id: workOrderId, workspaceId } });
    if (!existing) throw new NotFoundException('Work order not found');

    const completedAt =
      dto.status === 'COMPLETED' && existing.status !== 'COMPLETED'
        ? new Date()
        : existing.completedAt;

    return repo.update({
      where: { id: workOrderId },
      data: {
        status: dto.status ?? existing.status,
        priority: dto.priority ?? existing.priority,
        assignedToUserId:
          dto.assignedToUserId !== undefined ? dto.assignedToUserId : existing.assignedToUserId,
        assignedToName:
          dto.assignedToName !== undefined ? dto.assignedToName : existing.assignedToName,
        vendorId: dto.vendorId !== undefined ? dto.vendorId : existing.vendorId,
        completionNote:
          dto.completionNote !== undefined ? dto.completionNote : existing.completionNote,
        proofPhotoUrl:
          dto.proofPhotoUrl !== undefined ? dto.proofPhotoUrl : existing.proofPhotoUrl,
        actualCost:
          dto.actualCost !== undefined ? parseFloat(String(dto.actualCost)) : existing.actualCost,
        completedAt,
      },
      include: {
        vendor: { select: { id: true, name: true, phone: true } },
      },
    });
  }

  async getWorkOrderMessages(workspaceId: string, workOrderId: string) {
    const ws = await this.assertPropertyWorkspace(workspaceId);
    return this.workOrderMessageDelegate(ws.templateType).findMany({
      where: { workspaceId, workOrderId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addWorkOrderMessage(
    workspaceId: string,
    workOrderId: string,
    userId: string,
    userName: string,
    body: string,
  ) {
    const ws = await this.assertPropertyWorkspace(workspaceId);
    const workOrders = this.workOrderDelegate(ws.templateType);
    const messages = this.workOrderMessageDelegate(ws.templateType);
    const wo = await workOrders.findFirst({ where: { id: workOrderId, workspaceId } });
    if (!wo) throw new NotFoundException('Work order not found');
    return messages.create({
      data: { workspaceId, workOrderId, senderUserId: userId || null, senderName: userName, body },
    });
  }

  async getWorkOrderStats(workspaceId: string) {
    const ws = await this.assertPropertyWorkspace(workspaceId);
    const repo = this.workOrderDelegate(ws.templateType);
    const [open, inProgress, completed, total] = await Promise.all([
      repo.count({ where: { workspaceId, status: 'OPEN' } }),
      repo.count({ where: { workspaceId, status: 'IN_PROGRESS' } }),
      repo.count({ where: { workspaceId, status: 'COMPLETED' } }),
      repo.count({ where: { workspaceId } }),
    ]);
    return { open, inProgress, completed, total };
  }

  // ── Property Community ──────────────────────────────────────────────────────

  async listCommunityChannels(workspaceId: string) {
    const ws = await this.assertPropertyWorkspace(workspaceId);
    const channels = await this.ensureCommunityChannels(workspaceId, ws.templateType);

    return channels.map((channel: any) => {
      const config = PROPERTY_COMMUNITY_CHANNELS.find((item) => item.key === channel.key);
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
    const ws = await this.assertPropertyWorkspace(workspaceId);
    await this.ensureCommunityChannels(workspaceId, ws.templateType);

    const channel = await this.channelDelegate(ws.templateType).findFirst({
      where: { id: channelId, workspaceId },
    });
    if (!channel) throw new NotFoundException('Community channel not found');

    const config = PROPERTY_COMMUNITY_CHANNELS.find((item) => item.key === channel.key);
    const messages = await this.messageDelegate(ws.templateType).findMany({
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
    const ws = await this.assertPropertyWorkspace(workspaceId);
    await this.ensureCommunityChannels(workspaceId, ws.templateType);

    const channel = await this.channelDelegate(ws.templateType).findFirst({
      where: { id: channelId, workspaceId },
    });
    if (!channel) throw new NotFoundException('Community channel not found');

    const body = String(dto.body || '').trim();
    if (!body) throw new BadRequestException('Message body is required');
    if (body.length > 1200) throw new BadRequestException('Message body is too long');

    if (
      (channel.key === PropertyCommunityChannelKey.UPDATES ||
        channel.key === PropertyCommunityChannelKey.EMERGENCY) &&
      !this.isPropertyCommunityManager(dto.actorRole)
    ) {
      throw new ForbiddenException('Only owner admins and managers can post in management channels');
    }

    if (dto.isPinned && !this.isPropertyCommunityManager(dto.actorRole)) {
      throw new ForbiddenException('Only owner admins and managers can pin property community messages');
    }

    const senderName = await this.resolveSenderName(dto.senderUserId, dto.senderName);
    return this.messageDelegate(ws.templateType).create({
      data: {
        workspaceId,
        channelId,
        senderUserId: dto.senderUserId || null,
        senderName,
        body,
        isPinned: !!dto.isPinned,
      },
    });
  }

  // ── Facilities / Amenities ──────────────────────────────────────────────────

  async listAmenities(
    workspaceId: string,
    opts?: {
      estateId?: string;
      actorUserId?: string;
      actorRole?: MemberRole | string | null;
    },
  ) {
    const ws = await this.assertPropertyWorkspace(workspaceId);
    const repo = this.amenityDelegate(ws.templateType);
    const actorResident =
      opts?.actorRole === MemberRole.RESIDENT
        ? await this.getResidentContextForActorUser(workspaceId, ws.templateType, opts?.actorUserId)
        : null;

    if (ws.templateType === TemplateType.ESTATE) {
      const estateId = this.normalizeOptionalText((actorResident as any)?.unit?.estateId || opts?.estateId);
      const rows = await repo.findMany({
        where: {
          workspaceId,
          ...(estateId ? { estateId } : {}),
          ...(opts?.actorRole === MemberRole.RESIDENT ? { isActive: true } : {}),
        },
        include: {
          estate: { select: { id: true, name: true } },
          _count: { select: { bookings: true } },
        },
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      });

      return rows.map((row: any) => ({
        ...row,
        bookingCount: row._count?.bookings ?? 0,
      }));
    }

    const rows = await repo.findMany({
      where: {
        workspaceId,
        ...(opts?.actorRole === MemberRole.RESIDENT ? { isActive: true } : {}),
      },
      include: {
        _count: { select: { bookings: true } },
      },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });

    return rows.map((row: any) => ({
      ...row,
      bookingCount: row._count?.bookings ?? 0,
    }));
  }

  async createAmenity(workspaceId: string, dto: any) {
    const ws = await this.assertPropertyWorkspace(workspaceId);
    const name = String(dto.name || '').trim();
    if (!name) throw new BadRequestException('Amenity name is required');

    const data: any = {
      workspaceId,
      name,
      description: this.normalizeOptionalText(dto.description),
      location: this.normalizeOptionalText(dto.location),
      capacity:
        dto.capacity !== undefined && dto.capacity !== null && String(dto.capacity).trim() !== ''
          ? Math.max(1, parseInt(String(dto.capacity), 10))
          : null,
      feeAmount:
        dto.feeAmount !== undefined && dto.feeAmount !== null && String(dto.feeAmount).trim() !== ''
          ? parseFloat(String(dto.feeAmount))
          : null,
      requiresApproval: dto.requiresApproval !== undefined ? !!dto.requiresApproval : true,
      isActive: dto.isActive !== undefined ? !!dto.isActive : true,
    };

    if (ws.templateType === TemplateType.ESTATE) {
      const estateId = this.normalizeOptionalText(dto.estateId);
      if (estateId) {
        const estate = await this.prisma.estate.findFirst({
          where: { id: estateId, workspaceId },
          select: { id: true },
        });
        if (!estate) throw new NotFoundException('Property not found');
      }
      data.estateId = estateId;
    }

    return this.amenityDelegate(ws.templateType).create({ data });
  }

  async updateAmenity(workspaceId: string, amenityId: string, dto: any) {
    const ws = await this.assertPropertyWorkspace(workspaceId);
    const repo = this.amenityDelegate(ws.templateType);
    const existing = await repo.findFirst({ where: { id: amenityId, workspaceId } });
    if (!existing) throw new NotFoundException('Amenity not found');

    const data: any = {
      name: dto.name !== undefined ? String(dto.name || '').trim() : undefined,
      description: dto.description !== undefined ? this.normalizeOptionalText(dto.description) : undefined,
      location: dto.location !== undefined ? this.normalizeOptionalText(dto.location) : undefined,
      capacity:
        dto.capacity !== undefined
          ? (String(dto.capacity).trim() ? Math.max(1, parseInt(String(dto.capacity), 10)) : null)
          : undefined,
      feeAmount:
        dto.feeAmount !== undefined
          ? (String(dto.feeAmount).trim() ? parseFloat(String(dto.feeAmount)) : null)
          : undefined,
      requiresApproval: dto.requiresApproval !== undefined ? !!dto.requiresApproval : undefined,
      isActive: dto.isActive !== undefined ? !!dto.isActive : undefined,
    };

    if (data.name !== undefined && !data.name) {
      throw new BadRequestException('Amenity name is required');
    }

    if (ws.templateType === TemplateType.ESTATE && dto.estateId !== undefined) {
      const estateId = this.normalizeOptionalText(dto.estateId);
      if (estateId) {
        const estate = await this.prisma.estate.findFirst({
          where: { id: estateId, workspaceId },
          select: { id: true },
        });
        if (!estate) throw new NotFoundException('Property not found');
      }
      data.estateId = estateId;
    }

    return repo.update({
      where: { id: amenityId },
      data,
    });
  }

  async listAmenityBookings(
    workspaceId: string,
    opts?: {
      estateId?: string;
      amenityId?: string;
      status?: string;
      actorUserId?: string;
      actorRole?: MemberRole | string | null;
    },
  ) {
    const ws = await this.assertPropertyWorkspace(workspaceId);
    const repo = this.amenityBookingDelegate(ws.templateType);
    const actorResident =
      opts?.actorRole === MemberRole.RESIDENT
        ? await this.getResidentContextForActorUser(workspaceId, ws.templateType, opts?.actorUserId)
        : null;

    const where: any = {
      workspaceId,
      ...(opts?.amenityId ? { amenityId: opts.amenityId } : {}),
      ...(opts?.status ? { status: opts.status as AmenityBookingStatus } : {}),
      ...(actorResident ? { residentId: actorResident.id } : {}),
    };

    if (ws.templateType === TemplateType.ESTATE) {
      const estateId = this.normalizeOptionalText((actorResident as any)?.unit?.estateId || opts?.estateId);
      if (estateId) where.estateId = estateId;

      return repo.findMany({
        where,
        include: {
          estate: { select: { id: true, name: true } },
          amenity: { select: { id: true, name: true, location: true, feeAmount: true, requiresApproval: true } },
          resident: { select: { id: true, fullName: true, phone: true } },
          unit: { select: { id: true, label: true, block: true, floor: true } },
        },
        orderBy: [{ startAt: 'asc' }, { createdAt: 'desc' }],
        take: 100,
      });
    }

    return repo.findMany({
      where,
      include: {
        amenity: { select: { id: true, name: true, location: true, feeAmount: true, requiresApproval: true } },
        resident: { select: { id: true, fullName: true, phone: true } },
        unit: { select: { id: true, label: true, block: true, floor: true } },
      },
      orderBy: [{ startAt: 'asc' }, { createdAt: 'desc' }],
      take: 100,
    });
  }

  async createAmenityBooking(
    workspaceId: string,
    dto: any,
    actor?: { actorUserId?: string; actorRole?: MemberRole | string | null },
  ) {
    const ws = await this.assertPropertyWorkspace(workspaceId);
    const actorResident = await this.getResidentContextForActorUser(workspaceId, ws.templateType, actor?.actorUserId);
    const isResidentActor = actor?.actorRole === MemberRole.RESIDENT;
    const resident = dto.residentId
      ? await this.getResidentContext(workspaceId, ws.templateType, String(dto.residentId))
      : actorResident;

    if (!resident) throw new BadRequestException('residentId is required');
    if (isResidentActor && actorResident?.id !== resident.id) {
      throw new ForbiddenException('Residents can only create bookings for themselves');
    }

    const amenity: any = ws.templateType === TemplateType.ESTATE
      ? await this.prisma.estateAmenity.findFirst({
          where: { id: String(dto.amenityId || ''), workspaceId },
          include: { estate: { select: { id: true, name: true } } },
        })
      : await this.prisma.apartmentAmenity.findFirst({
          where: { id: String(dto.amenityId || ''), workspaceId },
        });
    if (!amenity) throw new NotFoundException('Amenity not found');
    if (!amenity.isActive) throw new BadRequestException('Amenity is inactive');

    const startAt = new Date(String(dto.startAt || ''));
    const endAt = new Date(String(dto.endAt || ''));
    if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime())) {
      throw new BadRequestException('Valid booking start and end times are required');
    }
    if (endAt <= startAt) throw new BadRequestException('Booking end time must be after the start time');

    if (ws.templateType === TemplateType.ESTATE) {
      const residentEstateId = (resident as any)?.unit?.estateId || null;
      if (amenity.estateId && residentEstateId && amenity.estateId !== residentEstateId) {
        throw new BadRequestException('Resident does not belong to this property');
      }
    }

    const overlap = await this.amenityBookingDelegate(ws.templateType).findFirst({
      where: {
        workspaceId,
        amenityId: amenity.id,
        status: { in: [AmenityBookingStatus.REQUESTED, AmenityBookingStatus.APPROVED] },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: { id: true },
    });
    if (overlap) {
      throw new BadRequestException('This facility is already booked for the selected time window');
    }

    const status = amenity.requiresApproval ? AmenityBookingStatus.REQUESTED : AmenityBookingStatus.APPROVED;
    const approvedName =
      status === AmenityBookingStatus.APPROVED
        ? await this.resolveSenderName(actor?.actorUserId, isResidentActor ? resident.fullName : undefined)
        : null;

    const data: any = {
      workspaceId,
      amenityId: amenity.id,
      residentId: resident.id,
      unitId: resident.unitId || null,
      title: this.normalizeOptionalText(dto.title),
      notes: this.normalizeOptionalText(dto.notes),
      startAt,
      endAt,
      status,
      feeAmount: amenity.feeAmount ?? null,
      ...(status === AmenityBookingStatus.APPROVED
        ? {
            approvedAt: new Date(),
            approvedByUserId: actor?.actorUserId || null,
            approvedByName: approvedName,
          }
        : {}),
    };

    if (ws.templateType === TemplateType.ESTATE) {
      data.estateId = amenity.estateId || (resident as any)?.unit?.estateId || null;
    }

    const created = await this.amenityBookingDelegate(ws.templateType).create({ data });
    const booking = await this.getAmenityBookingById(workspaceId, ws.templateType, created.id);
    await this.sendBookingEmail(ws.name, ws.id, booking);
    if (this.notificationSmsEnabled()) {
      await this.sendBookingSms(ws.name, booking);
    }
    return booking;
  }

  async updateAmenityBooking(
    workspaceId: string,
    bookingId: string,
    dto: any,
    actor?: { actorUserId?: string; actorRole?: MemberRole | string | null },
  ) {
    const ws = await this.assertPropertyWorkspace(workspaceId);
    const repo = this.amenityBookingDelegate(ws.templateType);
    const existing = await repo.findFirst({ where: { id: bookingId, workspaceId } });
    if (!existing) throw new NotFoundException('Booking not found');

    const actorResident = await this.getResidentContextForActorUser(workspaceId, ws.templateType, actor?.actorUserId);
    const isResidentActor = actor?.actorRole === MemberRole.RESIDENT;
    if (isResidentActor) {
      if (!actorResident || actorResident.id !== existing.residentId) {
        throw new ForbiddenException('Residents can only manage their own bookings');
      }
      if (dto.status && String(dto.status).toUpperCase() !== AmenityBookingStatus.CANCELLED) {
        throw new ForbiddenException('Residents can only cancel their own bookings');
      }
    }

    const nextStartAt = dto.startAt !== undefined ? new Date(String(dto.startAt || '')) : existing.startAt;
    const nextEndAt = dto.endAt !== undefined ? new Date(String(dto.endAt || '')) : existing.endAt;
    if (!Number.isFinite(nextStartAt.getTime()) || !Number.isFinite(nextEndAt.getTime())) {
      throw new BadRequestException('Valid booking start and end times are required');
    }
    if (nextEndAt <= nextStartAt) throw new BadRequestException('Booking end time must be after the start time');

    const nextStatus = dto.status
      ? (String(dto.status).toUpperCase() as AmenityBookingStatus)
      : existing.status;

    if ([AmenityBookingStatus.REQUESTED, AmenityBookingStatus.APPROVED].includes(nextStatus)) {
      const overlap = await repo.findFirst({
        where: {
          workspaceId,
          amenityId: existing.amenityId,
          NOT: { id: bookingId },
          status: { in: [AmenityBookingStatus.REQUESTED, AmenityBookingStatus.APPROVED] },
          startAt: { lt: nextEndAt },
          endAt: { gt: nextStartAt },
        },
        select: { id: true },
      });
      if (overlap) {
        throw new BadRequestException('This facility is already booked for the selected time window');
      }
    }

    const data: any = {
      title: dto.title !== undefined ? this.normalizeOptionalText(dto.title) : undefined,
      notes: dto.notes !== undefined ? this.normalizeOptionalText(dto.notes) : undefined,
      responseNote: dto.responseNote !== undefined ? this.normalizeOptionalText(dto.responseNote) : undefined,
      startAt: dto.startAt !== undefined ? nextStartAt : undefined,
      endAt: dto.endAt !== undefined ? nextEndAt : undefined,
      status: nextStatus,
    };

    if (nextStatus === AmenityBookingStatus.APPROVED && existing.status !== AmenityBookingStatus.APPROVED) {
      data.approvedAt = new Date();
      data.approvedByUserId = actor?.actorUserId || null;
      data.approvedByName = await this.resolveSenderName(actor?.actorUserId);
    }

    if (nextStatus === AmenityBookingStatus.COMPLETED && existing.status !== AmenityBookingStatus.COMPLETED) {
      data.completedAt = new Date();
    }

    await repo.update({
      where: { id: bookingId },
      data,
    });

    const booking = await this.getAmenityBookingById(workspaceId, ws.templateType, bookingId);
    if (nextStatus !== existing.status) {
      await this.sendBookingEmail(ws.name, ws.id, booking);
      if (this.notificationSmsEnabled()) {
        await this.sendBookingSms(ws.name, booking);
      }
    }
    return booking;
  }

  // ── Parcels ──────────────────────────────────────────────────────────────────

  async listParcels(
    workspaceId: string,
    status?: string,
    residentId?: string,
    estateId?: string,
  ) {
    const ws = await this.assertPropertyWorkspace(workspaceId);
    const repo = this.parcelDelegate(ws.templateType);

    const rows = ws.templateType === TemplateType.ESTATE
      ? await repo.findMany({
          where: {
            workspaceId,
            ...(status ? { status: status as ParcelStatus } : {}),
            ...(residentId ? { residentId } : {}),
            ...(estateId ? { estateId } : {}),
          },
          include: {
            estate: { select: { id: true, name: true } },
            resident: { select: { id: true, fullName: true, phone: true } },
            unit: { select: { id: true, label: true, block: true, floor: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 100,
        })
      : await repo.findMany({
          where: {
            workspaceId,
            ...(status ? { status: status as ParcelStatus } : {}),
            ...(residentId ? { residentId } : {}),
          },
          include: {
            resident: { select: { id: true, fullName: true, phone: true } },
            unit: { select: { id: true, label: true, block: true, floor: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 100,
        });

    return rows;
  }

  async createParcel(workspaceId: string, dto: any) {
    const ws = await this.assertPropertyWorkspace(workspaceId);
    const resident = dto.residentId
      ? await this.getResidentContext(workspaceId, ws.templateType, String(dto.residentId))
      : null;
    const unit = await this.getUnitContext(
      workspaceId,
      ws.templateType,
      String(dto.unitId || resident?.unitId || '').trim() || null,
    );

    const recipientName =
      this.normalizeOptionalText(dto.recipientName) ||
      this.normalizeOptionalText((resident as any)?.fullName);
    if (!recipientName) throw new BadRequestException('Recipient name is required');

    if (dto.unitId && !unit) throw new NotFoundException('Unit not found');

    const data: any = {
      workspaceId,
      residentId: resident?.id || null,
      unitId: unit?.id || null,
      recipientName,
      courierName: this.normalizeOptionalText(dto.courierName),
      description: this.normalizeOptionalText(dto.description),
      trackingCode: this.normalizeOptionalText(dto.trackingCode),
      notes: this.normalizeOptionalText(dto.notes),
      receivedByName: this.normalizeOptionalText(dto.receivedByName),
    };

    if (ws.templateType === TemplateType.ESTATE) {
      data.estateId =
        this.normalizeOptionalText(dto.estateId) ||
        (resident as any)?.unit?.estateId ||
        (unit as any)?.estateId ||
        null;
    }

    const created = await this.parcelDelegate(ws.templateType).create({ data });
    const parcel = await this.getParcelById(workspaceId, ws.templateType, created.id);
    await this.sendParcelEmail(ws.name, ws.id, parcel);
    if (this.notificationSmsEnabled()) {
      await this.sendParcelSms(ws.name, parcel);
    }
    return parcel;
  }

  async updateParcel(workspaceId: string, parcelId: string, dto: any) {
    const ws = await this.assertPropertyWorkspace(workspaceId);
    const repo = this.parcelDelegate(ws.templateType);
    const existing = await repo.findFirst({ where: { id: parcelId, workspaceId } });
    if (!existing) throw new NotFoundException('Parcel not found');

    const nextStatus = dto.status ? (String(dto.status).toUpperCase() as ParcelStatus) : existing.status;
    const now = new Date();
    const data: any = {
      status: nextStatus,
      courierName:
        dto.courierName !== undefined ? this.normalizeOptionalText(dto.courierName) : undefined,
      description:
        dto.description !== undefined ? this.normalizeOptionalText(dto.description) : undefined,
      trackingCode:
        dto.trackingCode !== undefined ? this.normalizeOptionalText(dto.trackingCode) : undefined,
      notes: dto.notes !== undefined ? this.normalizeOptionalText(dto.notes) : undefined,
      receivedByName:
        dto.receivedByName !== undefined ? this.normalizeOptionalText(dto.receivedByName) : undefined,
      pickupByName:
        dto.pickupByName !== undefined ? this.normalizeOptionalText(dto.pickupByName) : undefined,
    };

    if (nextStatus === ParcelStatus.NOTIFIED && !existing.notifiedAt) {
      data.notifiedAt = now;
    }
    if (nextStatus === ParcelStatus.PICKED_UP && !existing.pickedUpAt) {
      data.pickedUpAt = now;
    }
    if (nextStatus === ParcelStatus.RETURNED && !existing.returnedAt) {
      data.returnedAt = now;
    }

    await repo.update({
      where: { id: parcelId },
      data,
    });

    const parcel = await this.getParcelById(workspaceId, ws.templateType, parcelId);
    if (nextStatus !== existing.status) {
      await this.sendParcelEmail(ws.name, ws.id, parcel);
      if (this.notificationSmsEnabled()) {
        await this.sendParcelSms(ws.name, parcel);
      }
    }
    return parcel;
  }

  // ── Registry ─────────────────────────────────────────────────────────────────

  async listResidentRegistry(workspaceId: string, estateId?: string, residentId?: string) {
    const ws = await this.assertPropertyWorkspace(workspaceId);

    if (ws.templateType === TemplateType.ESTATE) {
      const residents = await this.prisma.estateResident.findMany({
        where: {
          workspaceId,
          ...(residentId ? { id: residentId } : {}),
          ...(estateId ? { unit: { estateId } } : {}),
        },
        include: {
          unit: { select: { id: true, label: true, block: true, floor: true, estateId: true } },
          householdMembers: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
          vehicles: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
        },
        orderBy: { fullName: 'asc' },
      });

      return residents.map((resident) => ({
        ...resident,
        householdCount: resident.householdMembers.length,
        vehicleCount: resident.vehicles.length,
      }));
    }

    const residents = await this.prisma.apartmentResident.findMany({
      where: {
        workspaceId,
        ...(residentId ? { id: residentId } : {}),
      },
      include: {
        unit: { select: { id: true, label: true, block: true, floor: true } },
        householdMembers: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
        vehicles: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
      },
      orderBy: { fullName: 'asc' },
    });

    return residents.map((resident) => ({
      ...resident,
      householdCount: resident.householdMembers.length,
      vehicleCount: resident.vehicles.length,
    }));
  }

  async createHouseholdMember(workspaceId: string, dto: any) {
    const ws = await this.assertPropertyWorkspace(workspaceId);
    const resident = await this.getResidentContext(workspaceId, ws.templateType, String(dto.residentId));
    const repo = this.householdDelegate(ws.templateType);
    const isPrimary = !!dto.isPrimary;

    if (isPrimary) {
      await repo.updateMany({
        where: { workspaceId, residentId: resident.id },
        data: { isPrimary: false },
      });
    }

    return repo.create({
      data: {
        workspaceId,
        residentId: resident.id,
        fullName: String(dto.fullName || '').trim(),
        relationship: this.normalizeOptionalText(dto.relationship),
        phone: this.normalizeOptionalText(dto.phone),
        email: this.normalizeOptionalText(dto.email),
        isPrimary,
        notes: this.normalizeOptionalText(dto.notes),
      },
    });
  }

  async updateHouseholdMember(workspaceId: string, memberId: string, dto: any) {
    const ws = await this.assertPropertyWorkspace(workspaceId);
    const repo = this.householdDelegate(ws.templateType);
    const existing = await repo.findFirst({ where: { id: memberId, workspaceId } });
    if (!existing) throw new NotFoundException('Household member not found');
    const isPrimary = dto.isPrimary !== undefined ? !!dto.isPrimary : existing.isPrimary;

    if (isPrimary) {
      await repo.updateMany({
        where: { workspaceId, residentId: existing.residentId, NOT: { id: memberId } },
        data: { isPrimary: false },
      });
    }

    return repo.update({
      where: { id: memberId },
      data: {
        fullName: dto.fullName !== undefined ? String(dto.fullName || '').trim() : undefined,
        relationship:
          dto.relationship !== undefined ? this.normalizeOptionalText(dto.relationship) : undefined,
        phone: dto.phone !== undefined ? this.normalizeOptionalText(dto.phone) : undefined,
        email: dto.email !== undefined ? this.normalizeOptionalText(dto.email) : undefined,
        notes: dto.notes !== undefined ? this.normalizeOptionalText(dto.notes) : undefined,
        isPrimary,
      },
    });
  }

  async deleteHouseholdMember(workspaceId: string, memberId: string) {
    const ws = await this.assertPropertyWorkspace(workspaceId);
    const repo = this.householdDelegate(ws.templateType);
    const existing = await repo.findFirst({ where: { id: memberId, workspaceId } });
    if (!existing) throw new NotFoundException('Household member not found');
    await repo.delete({ where: { id: memberId } });
    return { success: true };
  }

  async createVehicle(workspaceId: string, dto: any) {
    const ws = await this.assertPropertyWorkspace(workspaceId);
    const resident = await this.getResidentContext(workspaceId, ws.templateType, String(dto.residentId));
    const repo = this.vehicleDelegate(ws.templateType);
    const plateNumber = String(dto.plateNumber || '').trim().toUpperCase();
    if (!plateNumber) throw new BadRequestException('Plate number is required');

    const duplicate = await repo.findFirst({
      where: { workspaceId, plateNumber },
      select: { id: true },
    });
    if (duplicate) throw new BadRequestException('This plate number is already registered');

    const isPrimary = !!dto.isPrimary;
    if (isPrimary) {
      await repo.updateMany({
        where: { workspaceId, residentId: resident.id },
        data: { isPrimary: false },
      });
    }

    return repo.create({
      data: {
        workspaceId,
        residentId: resident.id,
        plateNumber,
        make: this.normalizeOptionalText(dto.make),
        model: this.normalizeOptionalText(dto.model),
        color: this.normalizeOptionalText(dto.color),
        notes: this.normalizeOptionalText(dto.notes),
        isPrimary,
      },
    });
  }

  async updateVehicle(workspaceId: string, vehicleId: string, dto: any) {
    const ws = await this.assertPropertyWorkspace(workspaceId);
    const repo = this.vehicleDelegate(ws.templateType);
    const existing = await repo.findFirst({ where: { id: vehicleId, workspaceId } });
    if (!existing) throw new NotFoundException('Vehicle not found');

    const plateNumber =
      dto.plateNumber !== undefined ? String(dto.plateNumber || '').trim().toUpperCase() : existing.plateNumber;
    if (!plateNumber) throw new BadRequestException('Plate number is required');

    if (plateNumber !== existing.plateNumber) {
      const duplicate = await repo.findFirst({
        where: { workspaceId, plateNumber, NOT: { id: vehicleId } },
        select: { id: true },
      });
      if (duplicate) throw new BadRequestException('This plate number is already registered');
    }

    const isPrimary = dto.isPrimary !== undefined ? !!dto.isPrimary : existing.isPrimary;
    if (isPrimary) {
      await repo.updateMany({
        where: { workspaceId, residentId: existing.residentId, NOT: { id: vehicleId } },
        data: { isPrimary: false },
      });
    }

    return repo.update({
      where: { id: vehicleId },
      data: {
        plateNumber,
        make: dto.make !== undefined ? this.normalizeOptionalText(dto.make) : undefined,
        model: dto.model !== undefined ? this.normalizeOptionalText(dto.model) : undefined,
        color: dto.color !== undefined ? this.normalizeOptionalText(dto.color) : undefined,
        notes: dto.notes !== undefined ? this.normalizeOptionalText(dto.notes) : undefined,
        isPrimary,
      },
    });
  }

  async deleteVehicle(workspaceId: string, vehicleId: string) {
    const ws = await this.assertPropertyWorkspace(workspaceId);
    const repo = this.vehicleDelegate(ws.templateType);
    const existing = await repo.findFirst({ where: { id: vehicleId, workspaceId } });
    if (!existing) throw new NotFoundException('Vehicle not found');
    await repo.delete({ where: { id: vehicleId } });
    return { success: true };
  }

  // ── Tenant Balance ───────────────────────────────────────────────────────────

  async getTenantBalance(workspaceId: string, residentId: string) {
    const charges = await this.prisma.estateCharge.findMany({
      where: { workspaceId, residentId },
      include: { payments: true },
      orderBy: { dueDate: 'desc' },
    });

    const balanceSummary = charges.map((c) => {
      const paid = c.payments.reduce((s, p) => s + p.amount, 0);
      const outstanding = Math.max(0, c.amount - paid);
      return {
        id: c.id,
        title: c.title,
        category: c.category,
        amount: c.amount,
        paid,
        outstanding,
        dueDate: c.dueDate,
        status: c.status,
        payments: c.payments.map((p) => ({
          id: p.id,
          amount: p.amount,
          paidAt: p.paidAt,
          method: p.method,
          reference: p.reference,
        })),
      };
    });

    const totalBilled = balanceSummary.reduce((s, c) => s + c.amount, 0);
    const totalPaid = balanceSummary.reduce((s, c) => s + c.paid, 0);
    const totalOutstanding = balanceSummary.reduce((s, c) => s + c.outstanding, 0);
    const overdue = balanceSummary
      .filter((c) => c.status === 'OVERDUE')
      .reduce((s, c) => s + c.outstanding, 0);

    return { totalBilled, totalPaid, totalOutstanding, overdue, charges: balanceSummary };
  }
}
