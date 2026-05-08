import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type NotifyTopic =
  | 'REQUEST'
  | 'NOTICE'
  | 'INSPECTION'
  | 'ASSIGNMENT'
  | 'SLA'
  | 'INVITE'
  | 'SYSTEM';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Push a notification row for a single user. Best-effort — failures here
  // never bubble back into the caller's transaction.
  async push(args: {
    workspaceId: string;
    userId: string;
    topic: NotifyTopic;
    title: string;
    body?: string | null;
    link?: string | null;
    data?: Record<string, unknown>;
  }) {
    try {
      return await this.prisma.notification.create({
        data: {
          workspaceId: args.workspaceId,
          userId: args.userId,
          topic: args.topic,
          title: args.title,
          body: args.body ?? null,
          link: args.link ?? null,
          data: (args.data as any) ?? null,
        },
      });
    } catch (e: any) {
      this.logger.warn(`Notification push failed (${args.topic}): ${e?.message || e}`);
      return null;
    }
  }

  // Fan-out to multiple users in one go. Skips empty userIds.
  async pushMany(
    workspaceId: string,
    userIds: string[],
    payload: { topic: NotifyTopic; title: string; body?: string; link?: string; data?: Record<string, unknown> },
  ) {
    const dedup = Array.from(new Set(userIds.filter(Boolean)));
    if (!dedup.length) return { count: 0 };
    try {
      const result = await this.prisma.notification.createMany({
        data: dedup.map((userId) => ({
          workspaceId,
          userId,
          topic: payload.topic,
          title: payload.title,
          body: payload.body ?? null,
          link: payload.link ?? null,
          data: (payload.data as any) ?? null,
        })),
      });
      return result;
    } catch (e: any) {
      this.logger.warn(`Notification fan-out failed (${payload.topic}): ${e?.message || e}`);
      return { count: 0 };
    }
  }

  async listForUser(workspaceId: string, userId: string, opts?: { unreadOnly?: boolean; limit?: number }) {
    const limit = Math.min(Math.max(Number(opts?.limit ?? 50), 1), 200);
    return this.prisma.notification.findMany({
      where: {
        workspaceId,
        userId,
        ...(opts?.unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async unreadCount(workspaceId: string, userId: string) {
    return this.prisma.notification.count({
      where: { workspaceId, userId, readAt: null },
    });
  }

  async markRead(workspaceId: string, userId: string, notificationId: string) {
    const row = await this.prisma.notification.findFirst({
      where: { id: notificationId, workspaceId, userId },
    });
    if (!row) throw new NotFoundException('Notification not found');
    if (row.readAt) return row;
    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(workspaceId: string, userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { workspaceId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { count: result.count };
  }
}
