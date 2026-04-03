import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVisitorDto } from './dto/create-visitor.dto';
import { ScanVisitorDto } from './dto/scan-visitor.dto';
import { VisitorStatus } from '@prisma/client';

@Injectable()
export class VisitorsService {
  constructor(private readonly prisma: PrismaService) {}

  async createVisitor(workspaceId: string, userId: string, userName: string, dto: CreateVisitorDto) {
    const visitor = await this.prisma.visitor.create({
      data: {
        workspaceId,
        invitedByUserId: userId,
        invitedByName: userName,
        name: dto.name,
        phone: dto.phone,
        email: dto.email,
        purpose: dto.purpose,
        unitId: dto.unitId,
        unitLabel: dto.unitLabel,
        areaId: dto.areaId,
        areaName: dto.areaName,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : null,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
        notes: dto.notes,
        status: VisitorStatus.EXPECTED,
      },
    });
    return visitor;
  }

  async listVisitors(workspaceId: string, status?: string, limit = 50) {
    const where: any = { workspaceId };
    if (status) where.status = status as VisitorStatus;

    const visitors = await this.prisma.visitor.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return visitors;
  }

  async getVisitor(workspaceId: string, visitorId: string) {
    const visitor = await this.prisma.visitor.findFirst({
      where: { id: visitorId, workspaceId },
    });
    if (!visitor) throw new NotFoundException('Visitor not found');
    return visitor;
  }

  async getVisitorByToken(qrToken: string) {
    const visitor = await this.prisma.visitor.findUnique({ where: { qrToken } });
    if (!visitor) throw new NotFoundException('Invalid or expired visitor pass');
    return visitor;
  }

  async scanVisitor(workspaceId: string, scannerName: string, dto: ScanVisitorDto) {
    const visitor = await this.prisma.visitor.findUnique({ where: { qrToken: dto.qrToken } });
    if (!visitor) throw new NotFoundException('Invalid QR code — no visitor found');
    if (visitor.workspaceId !== workspaceId) throw new BadRequestException('This visitor pass is not for this property');
    if (visitor.status === VisitorStatus.CANCELLED) throw new BadRequestException('This visitor pass has been cancelled');
    if (visitor.status === VisitorStatus.EXPIRED) throw new BadRequestException('This visitor pass has expired');

    // Check validity window
    const now = new Date();
    if (visitor.validFrom && now < visitor.validFrom) {
      throw new BadRequestException(`This pass is only valid from ${visitor.validFrom.toLocaleDateString()}`);
    }
    if (visitor.validUntil && now > visitor.validUntil) {
      await this.prisma.visitor.update({ where: { id: visitor.id }, data: { status: VisitorStatus.EXPIRED } });
      throw new BadRequestException('This visitor pass has expired');
    }

    if (visitor.status === VisitorStatus.EXPECTED) {
      // Check in
      const updated = await this.prisma.visitor.update({
        where: { id: visitor.id },
        data: {
          status: VisitorStatus.CHECKED_IN,
          checkedInAt: now,
          checkedInByName: scannerName,
        },
      });
      return { action: 'CHECKED_IN', visitor: updated };
    }

    if (visitor.status === VisitorStatus.CHECKED_IN) {
      // Check out
      const updated = await this.prisma.visitor.update({
        where: { id: visitor.id },
        data: {
          status: VisitorStatus.CHECKED_OUT,
          checkedOutAt: now,
          checkedOutByName: scannerName,
        },
      });
      return { action: 'CHECKED_OUT', visitor: updated };
    }

    if (visitor.status === VisitorStatus.CHECKED_OUT) {
      throw new BadRequestException(`${visitor.name} has already checked out`);
    }

    throw new BadRequestException('Cannot process this visitor pass');
  }

  async cancelVisitor(workspaceId: string, visitorId: string) {
    const visitor = await this.prisma.visitor.findFirst({ where: { id: visitorId, workspaceId } });
    if (!visitor) throw new NotFoundException('Visitor not found');
    if (visitor.status === VisitorStatus.CHECKED_IN) {
      throw new BadRequestException('Cannot cancel a visitor who is currently checked in');
    }
    return this.prisma.visitor.update({
      where: { id: visitorId },
      data: { status: VisitorStatus.CANCELLED },
    });
  }

  async getStats(workspaceId: string) {
    const [expected, checkedIn, checkedOut, todayTotal] = await Promise.all([
      this.prisma.visitor.count({ where: { workspaceId, status: VisitorStatus.EXPECTED } }),
      this.prisma.visitor.count({ where: { workspaceId, status: VisitorStatus.CHECKED_IN } }),
      this.prisma.visitor.count({ where: { workspaceId, status: VisitorStatus.CHECKED_OUT } }),
      this.prisma.visitor.count({
        where: {
          workspaceId,
          createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
      }),
    ]);
    return { expected, checkedIn, checkedOut, todayTotal };
  }
}
