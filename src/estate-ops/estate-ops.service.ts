import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ApprovalStatus,
  InspectionScope,
  InspectionStatus,
  LeaseStatus,
  MemberRole,
  NoticeAudience,
  ReminderType,
  ResidentStatus,
  TemplateType,
  UtilityMeterStatus,
  UtilityType,
  ViolationStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { SmsService } from '../sms/sms.service';
import { assertWorkspaceTemplate } from '../shared/workspace-boundary';

@Injectable()
export class EstateOpsService {
  private readonly logger = new Logger(EstateOpsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly sms: SmsService,
  ) {}

  private async assertEstateWorkspace(workspaceId: string) {
    return assertWorkspaceTemplate(this.prisma, workspaceId, [TemplateType.ESTATE] as const, 'This endpoint is available for estate workspaces only');
  }

  private normalizeOptionalText(value: unknown) {
    const text = String(value ?? '').trim();
    return text ? text : null;
  }

  private normalizeAmount(value: unknown) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) throw new BadRequestException('Invalid amount');
    return Number(parsed.toFixed(2));
  }

  private normalizeDate(value: unknown, label: string) {
    const date = new Date(String(value || ''));
    if (!Number.isFinite(date.getTime())) throw new BadRequestException(`Invalid ${label}`);
    return date;
  }

  private async resolveEstateId(workspaceId: string, estateId?: string | null) {
    if (!estateId) return null;
    const estate = await this.prisma.estate.findFirst({
      where: { id: estateId, workspaceId },
      select: { id: true },
    });
    if (!estate) throw new BadRequestException('estateId does not belong to this workspace');
    return estate.id;
  }

  private deriveLeaseStatus(startDate: Date, endDate: Date, noticeDays: number, explicit?: LeaseStatus | string | null) {
    if (explicit && explicit === LeaseStatus.TERMINATED) return LeaseStatus.TERMINATED;
    const now = new Date();
    if (endDate < now) return LeaseStatus.EXPIRED;
    const expiringCutoff = new Date(now.getTime() + noticeDays * 24 * 60 * 60 * 1000);
    if (startDate <= now && endDate <= expiringCutoff) return LeaseStatus.EXPIRING;
    if (startDate <= now) return LeaseStatus.ACTIVE;
    return LeaseStatus.DRAFT;
  }

  private smsEnabled() {
    return String(process.env.NOTIFICATION_SMS_ENABLED || 'false').toLowerCase() === 'true';
  }

  private async notify(targets: Array<{ email?: string | null; phone?: string | null; name?: string | null }>, subject: string, html: string, smsMessage?: string) {
    const seen = new Set<string>();
    for (const target of targets) {
      const email = String(target.email || '').trim().toLowerCase();
      if (email && !seen.has(`e:${email}`)) {
        seen.add(`e:${email}`);
        await this.mail.send(email, subject, html);
      }
      const phone = String(target.phone || '').trim();
      if (smsMessage && this.smsEnabled() && phone && !seen.has(`p:${phone}`)) {
        seen.add(`p:${phone}`);
        await this.sms.send({ to: phone, message: smsMessage, tag: 'estate' }).catch((e) => {
          this.logger.warn(`Estate SMS failed: ${e?.message || e}`);
        });
      }
    }
  }

  private async getResidentTargets(workspaceId: string, residentId?: string | null) {
    if (!residentId) return [];
    const resident = await this.prisma.estateResident.findFirst({
      where: { id: residentId, workspaceId },
      select: { email: true, phone: true, fullName: true },
    });
    return resident ? [resident] : [];
  }

  private async getEstateAudienceTargets(workspaceId: string, estateId?: string | null, audience: NoticeAudience = NoticeAudience.ALL) {
    const residents =
      audience === NoticeAudience.STAFF
        ? []
        : await this.prisma.estateResident.findMany({
            where: {
              workspaceId,
              status: ResidentStatus.ACTIVE,
              ...(estateId ? { unit: { estateId } } : {}),
            },
            select: { email: true, phone: true, fullName: true },
          });
    const members =
      audience === NoticeAudience.RESIDENTS
        ? []
        : await this.prisma.workspaceMember.findMany({
            where: {
              workspaceId,
              isActive: true,
              role: { in: [MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF] },
            },
            select: {
              user: { select: { email: true, phone: true, fullName: true } },
            },
          });
    return [
      ...residents,
      ...members.map((row) => row.user).filter(Boolean),
    ];
  }

  async listLeases(workspaceId: string, opts?: { estateId?: string; status?: string }) {
    await this.assertEstateWorkspace(workspaceId);
    const estateId = await this.resolveEstateId(workspaceId, opts?.estateId);
    const rows = await this.prisma.estateLease.findMany({
      where: {
        workspaceId,
        ...(estateId ? { estateId } : {}),
        ...(opts?.status ? { status: opts.status as LeaseStatus } : {}),
      },
      include: {
        estate: { select: { id: true, name: true, code: true } },
        unit: { select: { id: true, label: true, block: true, floor: true } },
        resident: { select: { id: true, fullName: true, email: true, phone: true } },
      },
      orderBy: [{ endDate: 'asc' }, { createdAt: 'desc' }],
    });
    return rows.map((row) => ({
      ...row,
      status: this.deriveLeaseStatus(row.startDate, row.endDate, row.renewalNoticeDays, row.status),
    }));
  }

  async createLease(workspaceId: string, dto: any) {
    await this.assertEstateWorkspace(workspaceId);
    const unit = await this.prisma.estateUnit.findFirst({
      where: { id: String(dto.unitId || ''), workspaceId },
      include: { estate: { select: { id: true, name: true } } },
    });
    if (!unit) throw new BadRequestException('Valid unitId is required');

    const residentId = this.normalizeOptionalText(dto.residentId);
    const resident = residentId
      ? await this.prisma.estateResident.findFirst({ where: { id: residentId, workspaceId } })
      : null;
    if (residentId && !resident) throw new BadRequestException('residentId does not belong to this workspace');

    const startDate = this.normalizeDate(dto.startDate, 'startDate');
    const endDate = this.normalizeDate(dto.endDate, 'endDate');
    if (endDate <= startDate) throw new BadRequestException('Lease end date must be after the start date');
    const renewalNoticeDays = Math.max(1, parseInt(String(dto.renewalNoticeDays || '30'), 10));
    const status = this.deriveLeaseStatus(startDate, endDate, renewalNoticeDays, dto.status);

    const created = await this.prisma.estateLease.create({
      data: {
        workspaceId,
        estateId: unit.estateId || null,
        unitId: unit.id,
        residentId: resident?.id || null,
        leaseHolderName: this.normalizeOptionalText(dto.leaseHolderName) || resident?.fullName || 'Lease holder',
        startDate,
        endDate,
        monthlyRent: dto.monthlyRent !== undefined && dto.monthlyRent !== null && String(dto.monthlyRent).trim() !== '' ? this.normalizeAmount(dto.monthlyRent) : null,
        securityDeposit: dto.securityDeposit !== undefined && dto.securityDeposit !== null && String(dto.securityDeposit).trim() !== '' ? this.normalizeAmount(dto.securityDeposit) : null,
        renewalNoticeDays,
        status,
        agreementUrl: this.normalizeOptionalText(dto.agreementUrl),
        notes: this.normalizeOptionalText(dto.notes),
        moveInDate: dto.moveInDate ? this.normalizeDate(dto.moveInDate, 'moveInDate') : null,
      },
      include: {
        estate: { select: { id: true, name: true, code: true } },
        unit: { select: { id: true, label: true, block: true, floor: true } },
        resident: { select: { id: true, fullName: true, email: true, phone: true } },
      },
    });

    await this.notify(
      await this.getResidentTargets(workspaceId, created.residentId),
      `Lease recorded for ${created.unit.label}`,
      `<p>A lease has been recorded for <strong>${created.unit.label}</strong> in ${created.estate?.name || 'your estate'}.</p><p>Lease period: ${created.startDate.toLocaleDateString()} to ${created.endDate.toLocaleDateString()}.</p>`,
    );

    return created;
  }

  async updateLease(workspaceId: string, leaseId: string, dto: any) {
    await this.assertEstateWorkspace(workspaceId);
    const existing = await this.prisma.estateLease.findFirst({
      where: { id: leaseId, workspaceId },
      include: { unit: true, estate: true, resident: true },
    });
    if (!existing) throw new NotFoundException('Lease not found');

    const startDate = dto.startDate ? this.normalizeDate(dto.startDate, 'startDate') : existing.startDate;
    const endDate = dto.endDate ? this.normalizeDate(dto.endDate, 'endDate') : existing.endDate;
    if (endDate <= startDate) throw new BadRequestException('Lease end date must be after the start date');
    const renewalNoticeDays =
      dto.renewalNoticeDays !== undefined
        ? Math.max(1, parseInt(String(dto.renewalNoticeDays || '30'), 10))
        : existing.renewalNoticeDays;
    const status = this.deriveLeaseStatus(startDate, endDate, renewalNoticeDays, dto.status || existing.status);

    const updated = await this.prisma.estateLease.update({
      where: { id: leaseId },
      data: {
        leaseHolderName: dto.leaseHolderName !== undefined ? this.normalizeOptionalText(dto.leaseHolderName) || existing.leaseHolderName : undefined,
        startDate: dto.startDate ? startDate : undefined,
        endDate: dto.endDate ? endDate : undefined,
        monthlyRent: dto.monthlyRent !== undefined ? (String(dto.monthlyRent).trim() ? this.normalizeAmount(dto.monthlyRent) : null) : undefined,
        securityDeposit: dto.securityDeposit !== undefined ? (String(dto.securityDeposit).trim() ? this.normalizeAmount(dto.securityDeposit) : null) : undefined,
        renewalNoticeDays,
        status,
        agreementUrl: dto.agreementUrl !== undefined ? this.normalizeOptionalText(dto.agreementUrl) : undefined,
        notes: dto.notes !== undefined ? this.normalizeOptionalText(dto.notes) : undefined,
        moveInDate: dto.moveInDate !== undefined ? (dto.moveInDate ? this.normalizeDate(dto.moveInDate, 'moveInDate') : null) : undefined,
        moveOutDate: dto.moveOutDate !== undefined ? (dto.moveOutDate ? this.normalizeDate(dto.moveOutDate, 'moveOutDate') : null) : undefined,
      },
      include: {
        estate: { select: { id: true, name: true, code: true } },
        unit: { select: { id: true, label: true, block: true, floor: true } },
        resident: { select: { id: true, fullName: true, email: true, phone: true } },
      },
    });

    return updated;
  }

  async listUtilityMeters(workspaceId: string, opts?: { estateId?: string; unitId?: string }) {
    await this.assertEstateWorkspace(workspaceId);
    const estateId = await this.resolveEstateId(workspaceId, opts?.estateId);
    return this.prisma.estateUtilityMeter.findMany({
      where: {
        workspaceId,
        ...(estateId ? { estateId } : {}),
        ...(opts?.unitId ? { unitId: opts.unitId } : {}),
      },
      include: {
        estate: { select: { id: true, name: true, code: true } },
        unit: { select: { id: true, label: true, block: true, floor: true } },
        readings: {
          orderBy: { readingDate: 'desc' },
          take: 3,
        },
      },
      orderBy: [{ type: 'asc' }, { label: 'asc' }],
    });
  }

  async createUtilityMeter(workspaceId: string, dto: any) {
    await this.assertEstateWorkspace(workspaceId);
    const unit = await this.prisma.estateUnit.findFirst({
      where: { id: String(dto.unitId || ''), workspaceId },
    });
    if (!unit) throw new BadRequestException('Valid unitId is required');
    return this.prisma.estateUtilityMeter.create({
      data: {
        workspaceId,
        estateId: unit.estateId || null,
        unitId: unit.id,
        type: (String(dto.type || 'OTHER').toUpperCase() as UtilityType),
        label: String(dto.label || '').trim() || 'Meter',
        meterNumber: this.normalizeOptionalText(dto.meterNumber),
        status: dto.status ? (String(dto.status).toUpperCase() as UtilityMeterStatus) : UtilityMeterStatus.ACTIVE,
        unitRate: dto.unitRate !== undefined && String(dto.unitRate).trim() !== '' ? this.normalizeAmount(dto.unitRate) : null,
        fixedCharge: dto.fixedCharge !== undefined && String(dto.fixedCharge).trim() !== '' ? this.normalizeAmount(dto.fixedCharge) : null,
        notes: this.normalizeOptionalText(dto.notes),
      },
      include: {
        estate: { select: { id: true, name: true, code: true } },
        unit: { select: { id: true, label: true, block: true, floor: true } },
      },
    });
  }

  async updateUtilityMeter(workspaceId: string, meterId: string, dto: any) {
    await this.assertEstateWorkspace(workspaceId);
    const existing = await this.prisma.estateUtilityMeter.findFirst({ where: { id: meterId, workspaceId } });
    if (!existing) throw new NotFoundException('Utility meter not found');
    return this.prisma.estateUtilityMeter.update({
      where: { id: meterId },
      data: {
        label: dto.label !== undefined ? String(dto.label || '').trim() || existing.label : undefined,
        meterNumber: dto.meterNumber !== undefined ? this.normalizeOptionalText(dto.meterNumber) : undefined,
        status: dto.status !== undefined ? (String(dto.status).toUpperCase() as UtilityMeterStatus) : undefined,
        unitRate: dto.unitRate !== undefined ? (String(dto.unitRate).trim() ? this.normalizeAmount(dto.unitRate) : null) : undefined,
        fixedCharge: dto.fixedCharge !== undefined ? (String(dto.fixedCharge).trim() ? this.normalizeAmount(dto.fixedCharge) : null) : undefined,
        notes: dto.notes !== undefined ? this.normalizeOptionalText(dto.notes) : undefined,
      },
    });
  }

  async listUtilityReadings(workspaceId: string, meterId?: string) {
    await this.assertEstateWorkspace(workspaceId);
    return this.prisma.estateUtilityReading.findMany({
      where: {
        workspaceId,
        ...(meterId ? { meterId } : {}),
      },
      include: {
        meter: {
          include: {
            estate: { select: { id: true, name: true, code: true } },
            unit: { select: { id: true, label: true, block: true, floor: true } },
          },
        },
        charge: { select: { id: true, title: true, amount: true, status: true, dueDate: true } },
      },
      orderBy: [{ readingDate: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async recordUtilityReading(workspaceId: string, dto: any) {
    await this.assertEstateWorkspace(workspaceId);
    const meter = await this.prisma.estateUtilityMeter.findFirst({
      where: { id: String(dto.meterId || ''), workspaceId },
      include: {
        unit: {
          include: {
            estateResidents: {
              where: { status: ResidentStatus.ACTIVE },
              orderBy: { createdAt: 'asc' },
              take: 1,
            },
          },
        },
        estate: true,
      },
    });
    if (!meter) throw new BadRequestException('Valid meterId is required');

    const readingDate = this.normalizeDate(dto.readingDate || new Date().toISOString(), 'readingDate');
    const readingValue = this.normalizeAmount(dto.readingValue);
    const previousValue = meter.lastReadingValue ?? null;
    const consumption = previousValue === null ? null : Number((readingValue - previousValue).toFixed(2));
    if (consumption !== null && consumption < 0) {
      throw new BadRequestException('Reading value cannot be below the previous reading');
    }
    const unitRate = dto.unitRate !== undefined && String(dto.unitRate).trim() !== '' ? this.normalizeAmount(dto.unitRate) : meter.unitRate ?? null;
    const fixedCharge = dto.fixedCharge !== undefined && String(dto.fixedCharge).trim() !== '' ? this.normalizeAmount(dto.fixedCharge) : meter.fixedCharge ?? null;
    const billedAmount = consumption !== null && unitRate !== null
      ? Number((consumption * unitRate + (fixedCharge || 0)).toFixed(2))
      : null;

    const result = await this.prisma.$transaction(async (tx) => {
      let chargeId: string | null = null;
      const resident = meter.unit.estateResidents[0] || null;
      if ((dto.postCharge !== false) && billedAmount !== null && billedAmount > 0) {
        const charge = await tx.estateCharge.create({
          data: {
            workspaceId,
            estateId: meter.estateId || null,
            unitId: meter.unitId,
            residentId: resident?.id || null,
            title: `${meter.type.replace(/_/g, ' ')} usage • ${meter.unit.label}`,
            category: 'UTILITIES',
            notes: this.normalizeOptionalText(dto.notes) || `${meter.label} meter reading`,
            amount: billedAmount,
            currency: 'GHS',
            dueDate: new Date(readingDate.getTime() + 7 * 24 * 60 * 60 * 1000),
          },
        });
        chargeId = charge.id;
      }

      const reading = await tx.estateUtilityReading.create({
        data: {
          workspaceId,
          meterId: meter.id,
          chargeId,
          readingDate,
          readingValue,
          previousValue,
          consumption,
          unitRate,
          fixedCharge,
          billedAmount,
          notes: this.normalizeOptionalText(dto.notes),
        },
      });

      await tx.estateUtilityMeter.update({
        where: { id: meter.id },
        data: {
          lastReadingValue: readingValue,
          lastReadingAt: readingDate,
          unitRate,
          fixedCharge,
        },
      });

      return reading;
    });

    return this.prisma.estateUtilityReading.findUnique({
      where: { id: result.id },
      include: {
        meter: {
          include: {
            estate: { select: { id: true, name: true, code: true } },
            unit: { select: { id: true, label: true, block: true, floor: true } },
          },
        },
        charge: { select: { id: true, title: true, amount: true, status: true, dueDate: true } },
      },
    });
  }

  async listViolations(workspaceId: string, opts?: { estateId?: string; status?: string }) {
    await this.assertEstateWorkspace(workspaceId);
    const estateId = await this.resolveEstateId(workspaceId, opts?.estateId);
    return this.prisma.estateViolation.findMany({
      where: {
        workspaceId,
        ...(estateId ? { estateId } : {}),
        ...(opts?.status ? { status: opts.status as ViolationStatus } : {}),
      },
      include: {
        estate: { select: { id: true, name: true, code: true } },
        unit: { select: { id: true, label: true, block: true, floor: true } },
        resident: { select: { id: true, fullName: true, email: true, phone: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  async createViolation(workspaceId: string, dto: any, actorName: string) {
    await this.assertEstateWorkspace(workspaceId);
    const unitId = this.normalizeOptionalText(dto.unitId);
    const unit = unitId ? await this.prisma.estateUnit.findFirst({ where: { id: unitId, workspaceId } }) : null;
    if (unitId && !unit) throw new BadRequestException('unitId does not belong to this workspace');
    const residentId = this.normalizeOptionalText(dto.residentId);
    const resident = residentId ? await this.prisma.estateResident.findFirst({ where: { id: residentId, workspaceId } }) : null;
    if (residentId && !resident) throw new BadRequestException('residentId does not belong to this workspace');

    const created = await this.prisma.estateViolation.create({
      data: {
        workspaceId,
        estateId: unit?.estateId || await this.resolveEstateId(workspaceId, dto.estateId),
        unitId: unit?.id || null,
        residentId: resident?.id || null,
        category: this.normalizeOptionalText(dto.category),
        title: String(dto.title || '').trim() || 'Violation',
        description: this.normalizeOptionalText(dto.description),
        severity: this.normalizeOptionalText(dto.severity),
        dueDate: dto.dueDate ? this.normalizeDate(dto.dueDate, 'dueDate') : null,
        fineAmount: dto.fineAmount !== undefined && String(dto.fineAmount).trim() !== '' ? this.normalizeAmount(dto.fineAmount) : null,
        evidencePhotos: Array.isArray(dto.evidencePhotos) ? dto.evidencePhotos : [],
        createdByName: actorName,
      },
      include: {
        estate: { select: { id: true, name: true, code: true } },
        unit: { select: { id: true, label: true, block: true, floor: true } },
        resident: { select: { id: true, fullName: true, email: true, phone: true } },
      },
    });

    await this.notify(
      await this.getResidentTargets(workspaceId, created.residentId),
      `Estate compliance notice: ${created.title}`,
      `<p>A compliance issue has been logged for ${created.unit?.label || 'your unit'}.</p><p><strong>${created.title}</strong></p><p>${created.description || ''}</p>`,
      `TomaFix: A compliance issue was logged for ${created.unit?.label || 'your unit'}. ${created.title}.`,
    );

    return created;
  }

  async updateViolation(workspaceId: string, violationId: string, dto: any, actorName: string) {
    await this.assertEstateWorkspace(workspaceId);
    const existing = await this.prisma.estateViolation.findFirst({ where: { id: violationId, workspaceId } });
    if (!existing) throw new NotFoundException('Violation not found');
    const nextStatus = dto.status ? (String(dto.status).toUpperCase() as ViolationStatus) : existing.status;
    const isClosedStatus =
      nextStatus === ViolationStatus.RESOLVED || nextStatus === ViolationStatus.CLOSED;
    const updated = await this.prisma.estateViolation.update({
      where: { id: violationId },
      data: {
        category: dto.category !== undefined ? this.normalizeOptionalText(dto.category) : undefined,
        title: dto.title !== undefined ? String(dto.title || '').trim() || existing.title : undefined,
        description: dto.description !== undefined ? this.normalizeOptionalText(dto.description) : undefined,
        severity: dto.severity !== undefined ? this.normalizeOptionalText(dto.severity) : undefined,
        status: nextStatus,
        dueDate: dto.dueDate !== undefined ? (dto.dueDate ? this.normalizeDate(dto.dueDate, 'dueDate') : null) : undefined,
        fineAmount: dto.fineAmount !== undefined ? (String(dto.fineAmount).trim() ? this.normalizeAmount(dto.fineAmount) : null) : undefined,
        evidencePhotos: dto.evidencePhotos !== undefined ? (Array.isArray(dto.evidencePhotos) ? dto.evidencePhotos : []) : undefined,
        resolutionNote: dto.resolutionNote !== undefined ? this.normalizeOptionalText(dto.resolutionNote) : undefined,
        resolvedAt: isClosedStatus && !existing.resolvedAt ? new Date() : existing.resolvedAt,
        closedByName: isClosedStatus ? actorName : existing.closedByName,
      },
      include: {
        estate: { select: { id: true, name: true, code: true } },
        unit: { select: { id: true, label: true, block: true, floor: true } },
        resident: { select: { id: true, fullName: true, email: true, phone: true } },
      },
    });
    return updated;
  }

  async listApprovalRequests(workspaceId: string, opts?: { estateId?: string; status?: string; actorUserId?: string; actorRole?: MemberRole | string | null }) {
    await this.assertEstateWorkspace(workspaceId);
    const estateId = await this.resolveEstateId(workspaceId, opts?.estateId);
    let residentId: string | undefined;
    if (String(opts?.actorRole || '') === MemberRole.RESIDENT) {
      const user = await this.prisma.user.findUnique({
        where: { id: String(opts?.actorUserId || '') },
        select: { email: true },
      });
      const email = String(user?.email || '').trim();
      if (email) {
        const resident = await this.prisma.estateResident.findFirst({
          where: { workspaceId, email: { equals: email, mode: 'insensitive' } },
          select: { id: true },
        });
        residentId = resident?.id;
      }
    }
    return this.prisma.estateApprovalRequest.findMany({
      where: {
        workspaceId,
        ...(estateId ? { estateId } : {}),
        ...(opts?.status ? { status: opts.status as ApprovalStatus } : {}),
        ...(residentId ? { residentId } : {}),
      },
      include: {
        estate: { select: { id: true, name: true, code: true } },
        unit: { select: { id: true, label: true, block: true, floor: true } },
        resident: { select: { id: true, fullName: true, email: true, phone: true } },
      },
      orderBy: [{ submittedAt: 'desc' }],
    });
  }

  async createApprovalRequest(workspaceId: string, dto: any, actor: { actorUserId?: string; actorRole?: MemberRole | string | null; actorName: string }) {
    await this.assertEstateWorkspace(workspaceId);
    const unit = dto.unitId
      ? await this.prisma.estateUnit.findFirst({ where: { id: String(dto.unitId), workspaceId } })
      : null;
    if (dto.unitId && !unit) throw new BadRequestException('unitId does not belong to this workspace');

    let resident = dto.residentId
      ? await this.prisma.estateResident.findFirst({ where: { id: String(dto.residentId), workspaceId } })
      : null;
    if (!resident && String(actor.actorRole || '') === MemberRole.RESIDENT) {
      const user = await this.prisma.user.findUnique({
        where: { id: String(actor.actorUserId || '') },
        select: { email: true },
      });
      const email = String(user?.email || '').trim();
      if (email) {
        resident = await this.prisma.estateResident.findFirst({
          where: { workspaceId, email: { equals: email, mode: 'insensitive' } },
        });
      }
    }

    const created = await this.prisma.estateApprovalRequest.create({
      data: {
        workspaceId,
        estateId: unit?.estateId || await this.resolveEstateId(workspaceId, dto.estateId),
        unitId: unit?.id || resident?.unitId || null,
        residentId: resident?.id || null,
        type: String(dto.type || '').trim() || 'ARCHITECTURAL',
        title: String(dto.title || '').trim() || 'Approval request',
        description: this.normalizeOptionalText(dto.description),
        attachmentUrls: Array.isArray(dto.attachmentUrls) ? dto.attachmentUrls : [],
        requestedStartAt: dto.requestedStartAt ? this.normalizeDate(dto.requestedStartAt, 'requestedStartAt') : null,
        requestedEndAt: dto.requestedEndAt ? this.normalizeDate(dto.requestedEndAt, 'requestedEndAt') : null,
      },
      include: {
        estate: { select: { id: true, name: true, code: true } },
        unit: { select: { id: true, label: true, block: true, floor: true } },
        resident: { select: { id: true, fullName: true, email: true, phone: true } },
      },
    });

    return created;
  }

  async updateApprovalRequest(workspaceId: string, approvalId: string, dto: any, actorName: string) {
    await this.assertEstateWorkspace(workspaceId);
    const existing = await this.prisma.estateApprovalRequest.findFirst({ where: { id: approvalId, workspaceId } });
    if (!existing) throw new NotFoundException('Approval request not found');
    const nextStatus = dto.status ? (String(dto.status).toUpperCase() as ApprovalStatus) : existing.status;
    const updated = await this.prisma.estateApprovalRequest.update({
      where: { id: approvalId },
      data: {
        title: dto.title !== undefined ? String(dto.title || '').trim() || existing.title : undefined,
        description: dto.description !== undefined ? this.normalizeOptionalText(dto.description) : undefined,
        status: nextStatus,
        decisionNote: dto.decisionNote !== undefined ? this.normalizeOptionalText(dto.decisionNote) : undefined,
        reviewedAt: nextStatus !== ApprovalStatus.PENDING ? new Date() : existing.reviewedAt,
        reviewedByName: nextStatus !== ApprovalStatus.PENDING ? actorName : existing.reviewedByName,
      },
      include: {
        estate: { select: { id: true, name: true, code: true } },
        unit: { select: { id: true, label: true, block: true, floor: true } },
        resident: { select: { id: true, fullName: true, email: true, phone: true } },
      },
    });

    if (nextStatus !== ApprovalStatus.PENDING) {
      await this.notify(
        await this.getResidentTargets(workspaceId, updated.residentId),
        `Approval request ${nextStatus.toLowerCase()}: ${updated.title}`,
        `<p>Your approval request <strong>${updated.title}</strong> has been ${nextStatus.toLowerCase()}.</p><p>${updated.decisionNote || ''}</p>`,
        `TomaFix: Your approval request ${updated.title} has been ${nextStatus.toLowerCase()}.`,
      );
    }

    return updated;
  }

  async listInspectionTemplates(workspaceId: string, estateId?: string) {
    await this.assertEstateWorkspace(workspaceId);
    const resolvedEstateId = await this.resolveEstateId(workspaceId, estateId);
    return this.prisma.estateInspectionTemplate.findMany({
      where: {
        workspaceId,
        ...(resolvedEstateId ? { estateId: resolvedEstateId } : {}),
      },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });
  }

  async createInspectionTemplate(workspaceId: string, dto: any) {
    await this.assertEstateWorkspace(workspaceId);
    return this.prisma.estateInspectionTemplate.create({
      data: {
        workspaceId,
        estateId: await this.resolveEstateId(workspaceId, dto.estateId),
        name: String(dto.name || '').trim() || 'Inspection template',
        kind: dto.kind || 'CUSTOM',
        description: this.normalizeOptionalText(dto.description),
        checklist: Array.isArray(dto.checklist) ? dto.checklist : [],
        isActive: dto.isActive !== undefined ? !!dto.isActive : true,
      },
    });
  }

  async updateInspectionTemplate(workspaceId: string, templateId: string, dto: any) {
    await this.assertEstateWorkspace(workspaceId);
    const existing = await this.prisma.estateInspectionTemplate.findFirst({ where: { id: templateId, workspaceId } });
    if (!existing) throw new NotFoundException('Inspection template not found');
    return this.prisma.estateInspectionTemplate.update({
      where: { id: templateId },
      data: {
        name: dto.name !== undefined ? String(dto.name || '').trim() || existing.name : undefined,
        kind: dto.kind !== undefined ? dto.kind : undefined,
        description: dto.description !== undefined ? this.normalizeOptionalText(dto.description) : undefined,
        checklist: dto.checklist !== undefined ? (Array.isArray(dto.checklist) ? dto.checklist : []) : undefined,
        isActive: dto.isActive !== undefined ? !!dto.isActive : undefined,
      },
    });
  }

  async listInspections(workspaceId: string, opts?: { estateId?: string; status?: string }) {
    await this.assertEstateWorkspace(workspaceId);
    const estateId = await this.resolveEstateId(workspaceId, opts?.estateId);
    return this.prisma.estateInspection.findMany({
      where: {
        workspaceId,
        ...(estateId ? { estateId } : {}),
        ...(opts?.status ? { status: opts.status as InspectionStatus } : {}),
      },
      include: {
        estate: { select: { id: true, name: true, code: true } },
        unit: { select: { id: true, label: true, block: true, floor: true } },
        template: { select: { id: true, name: true, kind: true } },
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async createInspection(workspaceId: string, dto: any) {
    await this.assertEstateWorkspace(workspaceId);
    const templateId = this.normalizeOptionalText(dto.templateId);
    const template = templateId
      ? await this.prisma.estateInspectionTemplate.findFirst({ where: { id: templateId, workspaceId } })
      : null;
    if (templateId && !template) throw new BadRequestException('templateId does not belong to this workspace');
    const unit = dto.unitId
      ? await this.prisma.estateUnit.findFirst({ where: { id: String(dto.unitId), workspaceId } })
      : null;
    if (dto.unitId && !unit) throw new BadRequestException('unitId does not belong to this workspace');

    const scope = dto.scope ? (String(dto.scope).toUpperCase() as InspectionScope) : InspectionScope.UNIT;
    return this.prisma.estateInspection.create({
      data: {
        workspaceId,
        estateId: unit?.estateId || await this.resolveEstateId(workspaceId, dto.estateId),
        unitId: unit?.id || null,
        templateId: template?.id || null,
        inspectionType: this.normalizeOptionalText(dto.inspectionType) || template?.kind || 'CUSTOM',
        scope,
        block: dto.block !== undefined ? this.normalizeOptionalText(dto.block) : unit?.block || null,
        floor: dto.floor !== undefined ? this.normalizeOptionalText(dto.floor) : unit?.floor || null,
        title: String(dto.title || '').trim() || template?.name || 'Inspection',
        dueDate: this.normalizeDate(dto.dueDate, 'dueDate'),
        checklist: Array.isArray(dto.checklist) ? dto.checklist : (template?.checklist || []),
        checklistResults: Array.isArray(dto.checklistResults) ? dto.checklistResults : [],
        evidencePhotos: Array.isArray(dto.evidencePhotos) ? dto.evidencePhotos : [],
        status: dto.status ? (String(dto.status).toUpperCase() as InspectionStatus) : InspectionStatus.SCHEDULED,
        result: this.normalizeOptionalText(dto.result),
        completedAt: dto.status === InspectionStatus.COMPLETED ? new Date() : null,
        signedOffByName: this.normalizeOptionalText(dto.signedOffByName),
        signedOffAt: dto.signedOffByName ? new Date() : null,
      },
      include: {
        estate: { select: { id: true, name: true, code: true } },
        unit: { select: { id: true, label: true, block: true, floor: true } },
        template: { select: { id: true, name: true, kind: true } },
      },
    });
  }

  async updateInspection(workspaceId: string, inspectionId: string, dto: any) {
    await this.assertEstateWorkspace(workspaceId);
    const existing = await this.prisma.estateInspection.findFirst({ where: { id: inspectionId, workspaceId } });
    if (!existing) throw new NotFoundException('Inspection not found');
    const nextStatus = dto.status ? (String(dto.status).toUpperCase() as InspectionStatus) : existing.status;
    return this.prisma.estateInspection.update({
      where: { id: inspectionId },
      data: {
        title: dto.title !== undefined ? String(dto.title || '').trim() || existing.title : undefined,
        dueDate: dto.dueDate !== undefined ? this.normalizeDate(dto.dueDate, 'dueDate') : undefined,
        checklistResults: dto.checklistResults !== undefined ? (Array.isArray(dto.checklistResults) ? dto.checklistResults : []) : undefined,
        evidencePhotos: dto.evidencePhotos !== undefined ? (Array.isArray(dto.evidencePhotos) ? dto.evidencePhotos : []) : undefined,
        status: nextStatus,
        result: dto.result !== undefined ? this.normalizeOptionalText(dto.result) : undefined,
        completedAt: nextStatus === InspectionStatus.COMPLETED && !existing.completedAt ? new Date() : existing.completedAt,
        signedOffByName: dto.signedOffByName !== undefined ? this.normalizeOptionalText(dto.signedOffByName) : undefined,
        signedOffAt: dto.signedOffByName ? new Date() : undefined,
      },
      include: {
        estate: { select: { id: true, name: true, code: true } },
        unit: { select: { id: true, label: true, block: true, floor: true } },
        template: { select: { id: true, name: true, kind: true } },
      },
    });
  }

  async listEmergencyAlerts(workspaceId: string, estateId?: string) {
    await this.assertEstateWorkspace(workspaceId);
    const resolvedEstateId = await this.resolveEstateId(workspaceId, estateId);
    return this.prisma.estateEmergencyAlert.findMany({
      where: {
        workspaceId,
        ...(resolvedEstateId ? { estateId: resolvedEstateId } : {}),
      },
      include: {
        estate: { select: { id: true, name: true, code: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createEmergencyAlert(workspaceId: string, dto: { title: string; body: string; estateId?: string; audience?: NoticeAudience; sendSms?: boolean; sentByName?: string }) {
    const workspace = await this.assertEstateWorkspace(workspaceId);
    const resolvedEstateId = await this.resolveEstateId(workspaceId, dto.estateId);
    const audience = dto.audience || NoticeAudience.ALL;
    const alert = await this.prisma.estateEmergencyAlert.create({
      data: {
        workspaceId,
        estateId: resolvedEstateId,
        title: String(dto.title || '').trim() || 'Emergency alert',
        body: String(dto.body || '').trim(),
        audience,
        channels: dto.sendSms ? ['email', 'sms'] : ['email'],
        status: 'SENT',
        sentAt: new Date(),
        sentByName: this.normalizeOptionalText(dto.sentByName),
      },
      include: { estate: { select: { id: true, name: true, code: true } } },
    });

    const targets = await this.getEstateAudienceTargets(workspaceId, resolvedEstateId, audience);
    const smsMessage = dto.sendSms ? `TomaFix ALERT: ${alert.title}. ${alert.body}` : undefined;
    await this.notify(
      targets,
      `Emergency alert • ${workspace.name}`,
      `<p><strong>${alert.title}</strong></p><p>${alert.body}</p><p>Please check your estate dashboard for follow-up updates.</p>`,
      smsMessage,
    );

    await this.prisma.estateCommunityChannel.upsert({
      where: { workspaceId_key: { workspaceId, key: 'EMERGENCY' as any } },
      update: {},
      create: {
        workspaceId,
        key: 'EMERGENCY' as any,
        name: 'Emergency Alerts',
        description: 'Urgent incidents, outages, and safety broadcasts for the whole community.',
      },
    }).then(async (channel) => {
      await this.prisma.estateCommunityMessage.create({
        data: {
          workspaceId,
          channelId: channel.id,
          senderName: dto.sentByName || 'Management',
          body: `${alert.title}\n\n${alert.body}`,
          isPinned: true,
        },
      });
    }).catch(() => undefined);

    return alert;
  }

  async listReminderLogs(workspaceId: string) {
    await this.assertEstateWorkspace(workspaceId);
    return this.prisma.estateReminderLog.findMany({
      where: { workspaceId },
      include: {
        charge: { select: { id: true, title: true, dueDate: true, amount: true } },
        lease: { select: { id: true, leaseHolderName: true, endDate: true, unit: { select: { label: true } } } },
      },
      orderBy: { sentAt: 'desc' },
      take: 120,
    });
  }
}
