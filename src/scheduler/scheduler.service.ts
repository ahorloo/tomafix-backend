import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  // Every hour: process due preventive maintenance
  @Cron(CronExpression.EVERY_HOUR)
  async runPreventiveMaintenance() {
    this.logger.log('[PM Cron] Checking for due preventive maintenance...');
    const now = new Date();

    const dueAssets = await this.prisma.officeAsset.findMany({
      where: {
        pmAutoCreate: true,
        pmIntervalDays: { not: null },
        nextServiceAt: { lte: now },
        status: { in: ['ACTIVE', 'UNDER_MAINTENANCE'] },
      },
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
            ownerUserId: true,
            slackWebhookUrl: true,
            members: {
              where: { role: { in: ['OWNER_ADMIN', 'MANAGER'] }, isActive: true },
              select: { userId: true },
              take: 3,
            },
          },
        },
      },
    });

    this.logger.log(`[PM Cron] Found ${dueAssets.length} assets due for PM`);

    for (const asset of dueAssets) {
      try {
        const woTitle = `PM: ${asset.name}`;
        await this.prisma.$transaction(async (tx) => {
          // Create the work order
          await tx.officeWorkOrder.create({
            data: {
              workspaceId: asset.workspaceId,
              assetId: asset.id,
              category: 'FACILITY',
              title: woTitle,
              description: `Scheduled preventive maintenance for ${asset.name}${asset.location ? ` at ${asset.location}` : ''}.`,
              priority: 'NORMAL',
              status: 'OPEN',
              slaDeadline: new Date(Date.now() + 72 * 60 * 60 * 1000),
            },
          });

          // Advance next service date
          const nextDate = new Date(now.getTime() + (asset.pmIntervalDays! * 24 * 60 * 60 * 1000));
          await tx.officeAsset.update({
            where: { id: asset.id },
            data: { lastServicedAt: now, nextServiceAt: nextDate },
          });
        });

        this.logger.log(`[PM Cron] Created WO for asset: ${asset.name}`);

        // Notify via Slack
        if (asset.workspace.slackWebhookUrl) {
          await this.mail.sendSlackNotification(
            asset.workspace.slackWebhookUrl,
            `🔧 *TomaFix PM Alert*: Preventive maintenance work order created for *${asset.name}* in workspace *${asset.workspace.name}*.`,
          );
        }

        // Notify workspace admin via email
        if (asset.workspace.ownerUserId) {
          const owner = await this.prisma.user.findUnique({
            where: { id: asset.workspace.ownerUserId },
            select: { email: true, fullName: true },
          });
          if (owner?.email) {
            await this.mail.sendPmCreated(
              owner.email,
              owner.fullName || 'Manager',
              asset.name,
              woTitle,
              asset.workspaceId,
            );
          }
        }
      } catch (e) {
        this.logger.error(`[PM Cron] Failed for asset ${asset.id}: ${e.message}`);
      }
    }
  }

  // Every day at 8am: send daily digest to workspace owners
  @Cron('0 8 * * *')
  async sendDailyDigest() {
    this.logger.log('[Digest Cron] Sending daily digests...');

    // Get all OFFICE workspaces with an owner
    const workspaces = await this.prisma.workspace.findMany({
      where: { templateType: 'OFFICE', status: 'ACTIVE', ownerUserId: { not: null } },
      select: { id: true, ownerUserId: true, slackWebhookUrl: true },
    });

    for (const ws of workspaces) {
      try {
        const owner = await this.prisma.user.findUnique({
          where: { id: ws.ownerUserId! },
          select: { email: true, fullName: true },
        });
        if (!owner?.email) continue;

        const [openRequests, overdueRows] = await Promise.all([
          this.prisma.officeRequest.count({
            where: { workspaceId: ws.id, status: { in: ['PENDING', 'IN_PROGRESS'] } },
          }),
          this.prisma.officeRequest.findMany({
            where: {
              workspaceId: ws.id,
              status: { in: ['PENDING', 'IN_PROGRESS'] },
              slaDeadline: { lt: new Date() },
            },
            select: { id: true },
          }),
        ]);

        const overdue = overdueRows.length;
        const compliance = openRequests > 0 ? Math.round(((openRequests - overdue) / openRequests) * 100) : 100;

        await this.mail.sendDailyDigest(owner.email, owner.fullName || 'Manager', {
          open: openRequests,
          overdue,
          compliance,
          workspaceId: ws.id,
        });

        // Also send Slack summary
        if (ws.slackWebhookUrl) {
          const emoji = compliance >= 85 ? '✅' : compliance >= 70 ? '⚠️' : '🚨';
          await this.mail.sendSlackNotification(
            ws.slackWebhookUrl,
            `${emoji} *TomaFix Daily Summary*\n• Open Requests: ${openRequests}\n• Overdue: ${overdue}\n• SLA Compliance: ${compliance}%`,
          );
        }
      } catch (e) {
        this.logger.error(`[Digest Cron] Failed for workspace ${ws.id}: ${e.message}`);
      }
    }
  }

  // Every hour: send one-time reminder to incomplete workspaces (24h+ old, not yet active)
  @Cron(CronExpression.EVERY_HOUR)
  async sendOnboardingReminders() {
    this.logger.log('[Onboarding Reminder Cron] Checking for incomplete workspaces...');

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24h ago

    const incompleteWorkspaces = await this.prisma.workspace.findMany({
      where: {
        status: { in: ['PENDING_OTP', 'PENDING_PAYMENT'] },
        createdAt: { lte: cutoff },
        onboardingReminderSentAt: null,
        ownerUserId: { not: null },
      },
      select: {
        id: true,
        name: true,
        status: true,
        templateType: true,
        ownerUserId: true,
      },
    });

    this.logger.log(`[Onboarding Reminder Cron] Found ${incompleteWorkspaces.length} incomplete workspace(s)`);

    for (const ws of incompleteWorkspaces) {
      try {
        const owner = await this.prisma.user.findUnique({
          where: { id: ws.ownerUserId! },
          select: { email: true, fullName: true },
        });
        if (!owner?.email) continue;

        const step = ws.status === 'PENDING_OTP' ? 'otp' : 'payment';

        await this.mail.sendOnboardingReminder(
          owner.email,
          owner.fullName || 'there',
          ws.name,
          ws.templateType,
          step,
          ws.id,
        );

        await this.prisma.workspace.update({
          where: { id: ws.id },
          data: { onboardingReminderSentAt: new Date() },
        });

        this.logger.log(`[Onboarding Reminder Cron] Sent reminder to ${owner.email} for workspace ${ws.id}`);
      } catch (e) {
        this.logger.error(`[Onboarding Reminder Cron] Failed for workspace ${ws.id}: ${e.message}`);
      }
    }
  }

  // Every hour: check for overdue alerts and notify via Slack
  @Cron(CronExpression.EVERY_HOUR)
  async checkOverdueAlerts() {
    const overdueThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24h past deadline

    const workspacesWithEscalations = await this.prisma.officeRequest.groupBy({
      by: ['workspaceId'],
      where: {
        status: { in: ['PENDING', 'IN_PROGRESS'] },
        slaDeadline: { lt: overdueThreshold },
      },
      _count: { id: true },
    });

    for (const { workspaceId, _count } of workspacesWithEscalations) {
      const ws = await this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { slackWebhookUrl: true, name: true },
      });
      if (ws?.slackWebhookUrl) {
        await this.mail.sendSlackNotification(
          ws.slackWebhookUrl,
          `🚨 *TomaFix Escalation Alert*: *${_count.id}* request${_count.id > 1 ? 's are' : ' is'} critically overdue (24h+ past SLA) in workspace *${ws.name}*.`,
        );
      }
    }
  }
}
