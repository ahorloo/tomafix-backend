import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReminderType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { SmsService } from '../sms/sms.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly sms: SmsService,
  ) {}

  private smsEnabled() {
    return String(process.env.NOTIFICATION_SMS_ENABLED || 'false').toLowerCase() === 'true';
  }

  private async sendEstateReminder(target: { email?: string | null; phone?: string | null }, subject: string, html: string, smsText?: string) {
    const email = String(target.email || '').trim().toLowerCase();
    if (email) {
      await this.mail.send(email, subject, html);
    }
    if (smsText && this.smsEnabled() && target.phone) {
      await this.sms.send({ to: target.phone, message: smsText, tag: 'reminder' }).catch((e) => {
        this.logger.warn(`[Reminder Cron] SMS failed: ${e?.message || e}`);
      });
    }
  }

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

  // Every hour: process due recurring charges (estate billing)
  @Cron(CronExpression.EVERY_HOUR)
  async processRecurringCharges() {
    this.logger.log('[Recurring Cron] Checking for due recurring charges...');
    const now = new Date();

    const dueSchedules = await this.prisma.estateRecurringCharge.findMany({
      where: {
        isActive: true,
        nextRunAt: { lte: now },
      },
    });

    this.logger.log(`[Recurring Cron] Found ${dueSchedules.length} due schedules`);

    for (const schedule of dueSchedules) {
      try {
        // Find all active residents for this workspace (and estate if specified)
        const residents = await this.prisma.estateResident.findMany({
          where: {
            workspaceId: schedule.workspaceId,
            status: 'ACTIVE',
            unitId: { not: null },
            ...(schedule.estateId
              ? { unit: { estateId: schedule.estateId } }
              : {}),
          },
          select: { id: true, unitId: true },
        });

        if (residents.length === 0) {
          this.logger.log(`[Recurring Cron] No active residents for schedule ${schedule.id}`);
        } else {
          // Post a charge for each resident
          const dueDate = new Date(now);
          dueDate.setDate(dueDate.getDate() + 7); // due in 7 days

          await this.prisma.estateCharge.createMany({
            data: residents.map((r) => ({
              workspaceId: schedule.workspaceId,
              estateId: schedule.estateId ?? undefined,
              unitId: r.unitId!,
              residentId: r.id,
              title: schedule.title,
              category: schedule.category ?? undefined,
              amount: schedule.amount,
              currency: schedule.currency,
              notes: schedule.notes ?? undefined,
              dueDate,
              status: 'POSTED' as const,
            })),
          });

          this.logger.log(`[Recurring Cron] Posted ${residents.length} charges for schedule "${schedule.title}"`);
        }

        // Calculate next run date
        const nextRun = new Date(now);
        switch (schedule.frequency) {
          case 'DAILY':
            nextRun.setDate(nextRun.getDate() + 1);
            break;
          case 'WEEKLY':
            nextRun.setDate(nextRun.getDate() + 7);
            break;
          case 'MONTHLY':
            nextRun.setMonth(nextRun.getMonth() + 1);
            if (schedule.dayOfMonth) nextRun.setDate(schedule.dayOfMonth);
            break;
          case 'QUARTERLY':
            nextRun.setMonth(nextRun.getMonth() + 3);
            if (schedule.dayOfMonth) nextRun.setDate(schedule.dayOfMonth);
            break;
          case 'YEARLY':
            nextRun.setFullYear(nextRun.getFullYear() + 1);
            break;
        }

        await this.prisma.estateRecurringCharge.update({
          where: { id: schedule.id },
          data: { lastRunAt: now, nextRunAt: nextRun },
        });
      } catch (e: any) {
        this.logger.error(`[Recurring Cron] Failed for schedule ${schedule.id}: ${e.message}`);
      }
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async sendEstateChargeAndLeaseReminders() {
    const now = new Date();
    const dueSoonCutoff = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const leaseCutoff = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const dueSoonCharges = await this.prisma.estateCharge.findMany({
      where: {
        status: { in: ['POSTED', 'PARTIALLY_PAID'] },
        dueDate: { gte: now, lte: dueSoonCutoff },
        reminderLogs: { none: { type: ReminderType.PAYMENT_DUE_SOON } },
      },
      include: {
        resident: { select: { id: true, fullName: true, email: true, phone: true } },
        unit: { select: { label: true } },
        estate: { select: { name: true } },
      },
      take: 200,
    });

    for (const charge of dueSoonCharges) {
      if (!charge.resident?.email && !charge.resident?.phone) continue;
      try {
        await this.sendEstateReminder(
          charge.resident,
          `Payment due soon • ${charge.title}`,
          `<p>Hello ${charge.resident?.fullName || 'resident'},</p><p>Your charge <strong>${charge.title}</strong> for ${charge.unit?.label || 'your unit'} is due on ${new Date(charge.dueDate).toLocaleDateString()}.</p><p>Outstanding amount: <strong>GHS ${Number(charge.amount).toFixed(2)}</strong>.</p>`,
          `TomaFix: ${charge.title} for ${charge.unit?.label || 'your unit'} is due on ${new Date(charge.dueDate).toLocaleDateString()}.`,
        );
        await this.prisma.estateReminderLog.create({
          data: {
            workspaceId: charge.workspaceId,
            chargeId: charge.id,
            type: ReminderType.PAYMENT_DUE_SOON,
            recipientEmail: charge.resident?.email || charge.resident?.phone || 'n/a',
            recipientPhone: charge.resident?.phone || null,
          },
        });
        await this.prisma.estateCharge.update({
          where: { id: charge.id },
          data: { lastReminderType: ReminderType.PAYMENT_DUE_SOON, lastReminderSentAt: now },
        });
      } catch (e: any) {
        this.logger.error(`[Reminder Cron] Failed due-soon reminder for charge ${charge.id}: ${e.message}`);
      }
    }

    const overdueCharges = await this.prisma.estateCharge.findMany({
      where: {
        status: { in: ['POSTED', 'PARTIALLY_PAID', 'OVERDUE'] },
        dueDate: { lt: now },
        reminderLogs: { none: { type: ReminderType.PAYMENT_OVERDUE } },
      },
      include: {
        resident: { select: { id: true, fullName: true, email: true, phone: true } },
        unit: { select: { label: true } },
      },
      take: 200,
    });

    for (const charge of overdueCharges) {
      if (!charge.resident?.email && !charge.resident?.phone) continue;
      try {
        await this.sendEstateReminder(
          charge.resident,
          `Overdue payment • ${charge.title}`,
          `<p>Hello ${charge.resident?.fullName || 'resident'},</p><p>Your charge <strong>${charge.title}</strong> for ${charge.unit?.label || 'your unit'} is now overdue.</p><p>Please settle the outstanding amount as soon as possible.</p>`,
          `TomaFix: ${charge.title} for ${charge.unit?.label || 'your unit'} is overdue. Please make payment as soon as possible.`,
        );
        await this.prisma.estateReminderLog.create({
          data: {
            workspaceId: charge.workspaceId,
            chargeId: charge.id,
            type: ReminderType.PAYMENT_OVERDUE,
            recipientEmail: charge.resident?.email || charge.resident?.phone || 'n/a',
            recipientPhone: charge.resident?.phone || null,
          },
        });
        await this.prisma.estateCharge.update({
          where: { id: charge.id },
          data: { status: 'OVERDUE', lastReminderType: ReminderType.PAYMENT_OVERDUE, lastReminderSentAt: now },
        });
      } catch (e: any) {
        this.logger.error(`[Reminder Cron] Failed overdue reminder for charge ${charge.id}: ${e.message}`);
      }
    }

    const expiringLeases = await this.prisma.estateLease.findMany({
      where: {
        status: { in: ['ACTIVE', 'EXPIRING'] },
        endDate: { gte: now, lte: leaseCutoff },
        reminderLogs: { none: { type: ReminderType.LEASE_EXPIRING } },
      },
      include: {
        resident: { select: { email: true, phone: true, fullName: true } },
        unit: { select: { label: true } },
      },
      take: 200,
    });

    for (const lease of expiringLeases) {
      if (!lease.resident?.email && !lease.resident?.phone) continue;
      try {
        await this.sendEstateReminder(
          lease.resident,
          `Lease expiry reminder • ${lease.unit.label}`,
          `<p>Hello ${lease.resident?.fullName || lease.leaseHolderName},</p><p>Your lease for <strong>${lease.unit.label}</strong> is due to end on ${new Date(lease.endDate).toLocaleDateString()}.</p><p>Please contact estate management if a renewal is needed.</p>`,
          `TomaFix: Your lease for ${lease.unit.label} ends on ${new Date(lease.endDate).toLocaleDateString()}. Please contact management if you want to renew.`,
        );
        await this.prisma.estateReminderLog.create({
          data: {
            workspaceId: lease.workspaceId,
            leaseId: lease.id,
            type: ReminderType.LEASE_EXPIRING,
            recipientEmail: lease.resident?.email || lease.resident?.phone || 'n/a',
            recipientPhone: lease.resident?.phone || null,
          },
        });
        await this.prisma.estateLease.update({
          where: { id: lease.id },
          data: { status: 'EXPIRING', expiryReminderSentAt: now },
        });
      } catch (e: any) {
        this.logger.error(`[Reminder Cron] Failed lease reminder for lease ${lease.id}: ${e.message}`);
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
