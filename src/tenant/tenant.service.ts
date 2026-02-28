import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RequestPriority, RequestStatus } from '@prisma/client';

@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);

  constructor(private readonly prisma: PrismaService) {}

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

  private async getResidentContext(workspaceId: string, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.email) throw new UnauthorizedException('Tenant user email missing');

    const resident = await this.prisma.resident.findFirst({
      where: { workspaceId, email: user.email.toLowerCase() },
      include: { unit: { select: { id: true, label: true, block: true, floor: true } } },
    });
    if (!resident) throw new NotFoundException('No resident profile found for this tenant in workspace');
    return { user, resident };
  }

  async dashboard(workspaceId: string, userId: string) {
    const { resident } = await this.getResidentContext(workspaceId, userId);

    const myRequests = await this.prisma.request.findMany({
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
    const { resident } = await this.getResidentContext(workspaceId, userId);
    return this.prisma.request.findMany({
      where: { workspaceId, residentId: resident.id },
      include: {
        unit: { select: { id: true, label: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, body: true, senderName: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createMyRequest(workspaceId: string, userId: string, dto: { title: string; description?: string; priority?: RequestPriority }) {
    const { resident } = await this.getResidentContext(workspaceId, userId);
    if (!resident.unitId) throw new BadRequestException('Resident has no assigned unit');

    const created = await this.prisma.request.create({
      data: {
        workspaceId,
        unitId: resident.unitId,
        residentId: resident.id,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        priority: dto.priority || RequestPriority.NORMAL,
      },
      include: { unit: { select: { id: true, label: true } } },
    });

    try {
      const ws = await this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        include: { owner: { select: { email: true, fullName: true } } },
      });
      const ownerEmail = ws?.owner?.email?.toLowerCase();
      if (ownerEmail) {
        await this.sendEmail({
          to: ownerEmail,
          subject: `New tenant request • ${ws?.name || 'Workspace'}`,
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
    const { resident } = await this.getResidentContext(workspaceId, userId);
    const req = await this.prisma.request.findFirst({ where: { id: requestId, workspaceId, residentId: resident.id } });
    if (!req) throw new NotFoundException('Request not found');

    return this.prisma.requestMessage.findMany({
      where: { workspaceId, requestId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addMyRequestMessage(workspaceId: string, userId: string, requestId: string, body: string) {
    const { resident, user } = await this.getResidentContext(workspaceId, userId);
    const req = await this.prisma.request.findFirst({ where: { id: requestId, workspaceId, residentId: resident.id } });
    if (!req) throw new NotFoundException('Request not found');

    const text = String(body || '').trim();
    if (!text) throw new BadRequestException('Message body is required');

    const msg = await this.prisma.requestMessage.create({
      data: {
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
