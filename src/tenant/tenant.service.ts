import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RequestPriority, RequestStatus } from '@prisma/client';

@Injectable()
export class TenantService {
  constructor(private readonly prisma: PrismaService) {}

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
      include: { unit: { select: { id: true, label: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createMyRequest(workspaceId: string, userId: string, dto: { title: string; description?: string; priority?: RequestPriority }) {
    const { resident } = await this.getResidentContext(workspaceId, userId);
    if (!resident.unitId) throw new BadRequestException('Resident has no assigned unit');

    return this.prisma.request.create({
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

    return this.prisma.requestMessage.create({
      data: {
        workspaceId,
        requestId,
        senderUserId: user.id,
        senderName: user.fullName || user.email || resident.fullName,
        body: text,
      },
    });
  }
}
