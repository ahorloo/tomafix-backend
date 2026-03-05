import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RequestPriority, RequestStatus, ResidentStatus, TemplateType } from '@prisma/client';
import { randomUUID } from 'crypto';

@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);

  constructor(private readonly prisma: PrismaService) {}

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

  private async getResidentContext(workspaceId: string, userId: string) {
    const [user, ws] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.workspace.findUnique({ where: { id: workspaceId } }),
    ]);
    if (!user?.email) throw new UnauthorizedException('Tenant user email missing');
    if (!ws) throw new NotFoundException('Workspace not found');
    if (ws.templateType !== TemplateType.APARTMENT && ws.templateType !== TemplateType.ESTATE) {
      throw new BadRequestException('Tenant module is enabled only for property templates');
    }

    const resident = ws.templateType === TemplateType.ESTATE
      ? await this.prisma.estateResident.findFirst({
          where: {
            workspaceId,
            email: { equals: user.email.trim(), mode: 'insensitive' },
            status: ResidentStatus.ACTIVE,
          },
          include: { unit: { select: { id: true, label: true, block: true, floor: true } } },
        })
      : await this.prisma.apartmentResident.findFirst({
          where: {
            workspaceId,
            email: { equals: user.email.trim(), mode: 'insensitive' },
            status: ResidentStatus.ACTIVE,
          },
          include: { unit: { select: { id: true, label: true, block: true, floor: true } } },
        });

    if (!resident) throw new NotFoundException('No resident profile found for this tenant in workspace');
    return { user, resident, ws };
  }

  async dashboard(workspaceId: string, userId: string) {
    const { resident, ws } = await this.getResidentContext(workspaceId, userId);

    const myRequests = ws.templateType === TemplateType.ESTATE
      ? await this.prisma.estateRequest.findMany({
          where: { workspaceId, residentId: resident.id },
          orderBy: { createdAt: 'desc' },
          take: 20,
        })
      : await this.prisma.apartmentRequest.findMany({
          where: { workspaceId, residentId: resident.id },
          orderBy: { createdAt: 'desc' },
          take: 20,
        });

    const notices = await this.prisma.notice.findMany({
      where: { workspaceId, audience: { in: ['ALL', 'RESIDENTS'] as any } },
      orderBy: { createdAt: 'desc' },
      take: 8,
    });

    return {
      resident: {
        id: resident.id,
        fullName: resident.fullName,
        email: resident.email,
        phone: resident.phone,
        unit: resident.unit,
      },
      metrics: {
        openRequests: myRequests.filter((r) => r.status === RequestStatus.PENDING || r.status === RequestStatus.IN_PROGRESS).length,
        totalRequests: myRequests.length,
        notices: notices.length,
      },
      requests: myRequests,
      notices,
    };
  }

  async listMyRequests(workspaceId: string, userId: string) {
    const { resident, ws } = await this.getResidentContext(workspaceId, userId);
    return ws.templateType === TemplateType.ESTATE
      ? this.prisma.estateRequest.findMany({
          where: { workspaceId, residentId: resident.id },
          include: {
            unit: { select: { id: true, label: true } },
          },
          orderBy: { createdAt: 'desc' },
        })
      : this.prisma.apartmentRequest.findMany({
          where: { workspaceId, residentId: resident.id },
          include: {
            unit: { select: { id: true, label: true } },
          },
          orderBy: { createdAt: 'desc' },
        });
  }

  async createMyRequest(
    workspaceId: string,
    userId: string,
    dto: { title: string; description?: string; priority?: RequestPriority; photoUrl?: string },
  ) {
    const { resident, ws } = await this.getResidentContext(workspaceId, userId);
    if (!resident.unitId) throw new BadRequestException('Resident has no assigned unit');

    const created = ws.templateType === TemplateType.ESTATE
      ? await this.prisma.estateRequest.create({
          data: {
            id: randomUUID(),
            workspaceId,
            unitId: resident.unitId,
            residentId: resident.id,
            title: dto.title.trim(),
            description: dto.description?.trim() || null,
            photoUrl: dto.photoUrl?.trim() || null,
            priority: dto.priority || RequestPriority.NORMAL,
          },
          include: { unit: { select: { id: true, label: true } } },
        })
      : await this.prisma.apartmentRequest.create({
          data: {
            id: randomUUID(),
            workspaceId,
            unitId: resident.unitId,
            residentId: resident.id,
            title: dto.title.trim(),
            description: dto.description?.trim() || null,
            photoUrl: dto.photoUrl?.trim() || null,
            priority: dto.priority || RequestPriority.NORMAL,
          },
          include: { unit: { select: { id: true, label: true } } },
        });

    try {
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        include: { owner: { select: { email: true, fullName: true } } },
      });
      const ownerEmail = workspace?.owner?.email?.toLowerCase();
      if (ownerEmail) {
        await this.sendEmail({
          to: ownerEmail,
          subject: `New tenant request • ${workspace?.name || 'Workspace'}`,
          html: `<p>A tenant submitted a new request.</p><p><b>Resident:</b> ${resident.fullName}</p><p><b>Unit:</b> ${created.unit?.label || '-'}</p><p><b>Title:</b> ${created.title}</p>`,
        });
      }
    } catch (e: any) {
      this.logger.warn(`Owner notification failed: ${e?.message || e}`);
    }

    return created;
  }

  async listTenantNotices(workspaceId: string) {
    return this.prisma.notice.findMany({
      where: { workspaceId, audience: { in: ['ALL', 'RESIDENTS'] as any } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listMyRequestMessages(workspaceId: string, userId: string, requestId: string) {
    const { resident, ws } = await this.getResidentContext(workspaceId, userId);
    const req = ws.templateType === TemplateType.ESTATE
      ? await this.prisma.estateRequest.findFirst({ where: { id: requestId, workspaceId, residentId: resident.id } })
      : await this.prisma.apartmentRequest.findFirst({ where: { id: requestId, workspaceId, residentId: resident.id } });
    if (!req) throw new NotFoundException('Request not found');

    return ws.templateType === TemplateType.ESTATE
      ? this.prisma.estateRequestMessage.findMany({ where: { workspaceId, requestId }, orderBy: { createdAt: 'asc' } })
      : this.prisma.apartmentRequestMessage.findMany({ where: { workspaceId, requestId }, orderBy: { createdAt: 'asc' } });
  }

  async addMyRequestMessage(workspaceId: string, userId: string, requestId: string, body: string) {
    const { resident, user, ws } = await this.getResidentContext(workspaceId, userId);
    const req = ws.templateType === TemplateType.ESTATE
      ? await this.prisma.estateRequest.findFirst({ where: { id: requestId, workspaceId, residentId: resident.id } })
      : await this.prisma.apartmentRequest.findFirst({ where: { id: requestId, workspaceId, residentId: resident.id } });
    if (!req) throw new NotFoundException('Request not found');

    const text = String(body || '').trim();
    if (!text) throw new BadRequestException('Message body is required');

    const msg = ws.templateType === TemplateType.ESTATE
      ? await this.prisma.estateRequestMessage.create({
          data: {
            id: randomUUID(),
            workspaceId,
            requestId,
            senderUserId: user.id,
            senderName: user.fullName || user.email || resident.fullName,
            body: text,
          },
        })
      : await this.prisma.apartmentRequestMessage.create({
          data: {
            id: randomUUID(),
            workspaceId,
            requestId,
            senderUserId: user.id,
            senderName: user.fullName || user.email || resident.fullName,
            body: text,
          },
        });

    try {
      const ws = await this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        include: { owner: { select: { email: true } } },
      });
      const ownerEmail = ws?.owner?.email?.toLowerCase();
      if (ownerEmail) {
        await this.sendEmail({
          to: ownerEmail,
          subject: `Tenant message on request • ${ws?.name || 'Workspace'}`,
          html: `<p>Your tenant sent a message on request <b>${req.title}</b>.</p><p><b>From:</b> ${msg.senderName}</p><p>${msg.body}</p>`,
        });
      }
    } catch (e: any) {
      this.logger.warn(`Owner message notification failed: ${e?.message || e}`);
    }

    return msg;
  }
}
