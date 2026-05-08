import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReminderType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { SmsService } from '../sms/sms.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly sms: SmsService,
    private readonly notifications: NotificationsService,
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

  // ── Subscription Expiry Reminders — runs daily at 8:00 AM ─────────────────
  @Cron('0 8 * * *')
  async checkSubscriptionExpiry() {
    this.logger.log('[Subscription Cron] Checking for expiring/expired subscriptions...');

    const now = new Date();

    // Remind at 7 days, 3 days, and 1 day before expiry
    const REMINDER_DAYS = [7, 3, 1];

    for (const daysLeft of REMINDER_DAYS) {
      // Window: subscriptions expiring within [daysLeft - 0.5, daysLeft + 0.5] days
      const windowStart = new Date(now.getTime() + (daysLeft - 0.5) * 24 * 60 * 60 * 1000);
      const windowEnd   = new Date(now.getTime() + (daysLeft + 0.5) * 24 * 60 * 60 * 1000);

      const expiringSubs = await this.prisma.subscription.findMany({
        where: {
          status: 'ACTIVE',
          currentPeriodEnd: { gte: windowStart, lte: windowEnd },
        },
        include: {
          workspace: {
            include: { owner: { select: { email: true, fullName: true } } },
          },
        },
      });

      for (const sub of expiringSubs) {
        const ws = sub.workspace;
        const ownerEmail = ws?.owner?.email;
        const ownerName  = ws?.owner?.fullName || 'there';
        const planName   = ws?.planName || 'your plan';

        if (!ownerEmail || !ws) continue;

        try {
          await this.mail.sendSubscriptionExpiringEmail({
            to: ownerEmail,
            ownerName,
            workspaceName: ws.name,
            workspaceId: ws.id,
            planName,
            daysLeft,
            expiresAt: sub.currentPeriodEnd!,
          });
          this.logger.log(`[Subscription Cron] Sent ${daysLeft}-day expiry warning to ${ownerEmail} for workspace ${ws.name}`);
        } catch (e: any) {
          this.logger.warn(`[Subscription Cron] Failed to send expiry email to ${ownerEmail}: ${e?.message}`);
        }
      }
    }

    // Also notify workspaces whose subscription expired in the last 24 hours
    const expiredWindowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const recentlyExpired = await this.prisma.subscription.findMany({
      where: {
        status: 'ACTIVE',
        currentPeriodEnd: { gte: expiredWindowStart, lte: now },
      },
      include: {
        workspace: {
          include: { owner: { select: { email: true, fullName: true } } },
        },
      },
    });

    for (const sub of recentlyExpired) {
      const ws = sub.workspace;
      const ownerEmail = ws?.owner?.email;
      const ownerName  = ws?.owner?.fullName || 'there';
      const planName   = ws?.planName || 'your plan';

      if (!ownerEmail || !ws) continue;

      // Mark subscription as PAST_DUE
      await this.prisma.subscription.update({
        where: { id: sub.id },
        data: { status: 'PAST_DUE' },
      }).catch(() => {});

      try {
        await this.mail.sendSubscriptionExpiredEmail({
          to: ownerEmail,
          ownerName,
          workspaceName: ws.name,
          workspaceId: ws.id,
          planName,
        });
        this.logger.log(`[Subscription Cron] Sent expiry notification to ${ownerEmail} for workspace ${ws.name}`);
      } catch (e: any) {
        this.logger.warn(`[Subscription Cron] Failed to send expired email to ${ownerEmail}: ${e?.message}`);
      }
    }

    this.logger.log('[Subscription Cron] Done.');
  }

  // Every 15 minutes: alert owners/managers about work orders that have breached
  // their SLA deadline and have not yet been alerted on. Skips terminal states.
  @Cron(CronExpression.EVERY_30_MINUTES)
  async runSlaBreachAlerts() {
    const now = new Date();
    const terminal = ['COMPLETED', 'CANCELLED'] as const;

    const [apt, est] = await Promise.all([
      this.prisma.apartmentWorkOrder.findMany({
        where: {
          slaDeadline: { not: null, lte: now },
          slaBreachAlertedAt: null,
          status: { notIn: terminal as any },
        },
        select: {
          id: true,
          workspaceId: true,
          title: true,
          unitLabel: true,
          slaDeadline: true,
          assignedToUserId: true,
        },
        take: 200,
      }),
      this.prisma.estateWorkOrder.findMany({
        where: {
          slaDeadline: { not: null, lte: now },
          slaBreachAlertedAt: null,
          status: { notIn: terminal as any },
        },
        select: {
          id: true,
          workspaceId: true,
          title: true,
          unitLabel: true,
          slaDeadline: true,
          assignedToUserId: true,
        },
        take: 200,
      }),
    ]);

    if (!apt.length && !est.length) return;
    this.logger.log(`[SLA Cron] Apartment breaches=${apt.length} Estate breaches=${est.length}`);

    const flagAndNotify = async (
      kind: 'apartment' | 'estate',
      rows: Array<{
        id: string;
        workspaceId: string;
        title: string;
        unitLabel: string | null;
        slaDeadline: Date | null;
        assignedToUserId: string | null;
      }>,
    ) => {
      for (const wo of rows) {
        try {
          // Resolve recipients: owner + active managers, plus the assignee if any.
          const ws = await this.prisma.workspace.findUnique({
            where: { id: wo.workspaceId },
            select: {
              id: true,
              name: true,
              owner: { select: { email: true } },
              members: {
                where: { isActive: true, role: { in: ['OWNER_ADMIN', 'MANAGER'] } },
                include: { user: { select: { email: true } } },
              },
            },
          });
          const recipients = new Set<string>();
          if (ws?.owner?.email) recipients.add(ws.owner.email.toLowerCase());
          for (const m of ws?.members || []) {
            const e = m.user?.email?.toLowerCase();
            if (e) recipients.add(e);
          }
          if (wo.assignedToUserId) {
            const u = await this.prisma.user.findUnique({
              where: { id: wo.assignedToUserId },
              select: { email: true },
            });
            if (u?.email) recipients.add(u.email.toLowerCase());
          }

          const subject = `SLA breach • ${wo.title}`;
          const html = `
            <p>A work order has breached its SLA deadline and is still open.</p>
            <p><b>Title:</b> ${wo.title}</p>
            <p><b>Unit:</b> ${wo.unitLabel || '-'}</p>
            <p><b>SLA deadline:</b> ${wo.slaDeadline?.toISOString()}</p>
          `;
          await Promise.all(
            Array.from(recipients).map((to) => this.mail.send(to, subject, html).catch((e) => {
              this.logger.warn(`[SLA Cron] mail send failed to ${to}: ${e?.message || e}`);
            })),
          );

          // Also push an in-app notification to the same audience.
          const userIds: string[] = [];
          if (ws?.owner) {
            const ownerUser = await this.prisma.user.findFirst({
              where: { email: ws.owner.email || '' },
              select: { id: true },
            });
            if (ownerUser?.id) userIds.push(ownerUser.id);
          }
          for (const m of ws?.members || []) {
            if (m.userId) userIds.push(m.userId);
          }
          if (wo.assignedToUserId) userIds.push(wo.assignedToUserId);
          await this.notifications.pushMany(wo.workspaceId, userIds, {
            topic: 'SLA',
            title: `SLA breach: ${wo.title}`,
            body: `Work order on unit ${wo.unitLabel || '-'} is past its SLA deadline.`,
            link: `/app/${wo.workspaceId}/work-orders/${wo.id}`,
            data: { workOrderId: wo.id, slaDeadline: wo.slaDeadline },
          });

          if (kind === 'apartment') {
            await this.prisma.apartmentWorkOrder.update({
              where: { id: wo.id },
              data: { slaBreachAlertedAt: new Date() },
            });
          } else {
            await this.prisma.estateWorkOrder.update({
              where: { id: wo.id },
              data: { slaBreachAlertedAt: new Date() },
            });
          }

          await this.prisma.auditLog.create({
            data: {
              workspaceId: wo.workspaceId,
              action: 'work_order.sla_breached',
              meta: { workOrderId: wo.id, slaDeadline: wo.slaDeadline },
            },
          });
        } catch (e: any) {
          this.logger.warn(`[SLA Cron] failed to alert on work order ${wo.id}: ${e?.message || e}`);
        }
      }
    };

    await flagAndNotify('apartment', apt);
    await flagAndNotify('estate', est);
  }

  // Every 5 minutes: retry failed notifications from the dead-letter queue
  // with exponential backoff. Marks rows SENT or FAILED after 6 attempts.
  @Cron(CronExpression.EVERY_5_MINUTES)
  async runNotificationDlq() {
    const MAX_ATTEMPTS = 6;
    const now = new Date();
    const due = await this.prisma.notificationDeadLetter.findMany({
      where: {
        status: { in: ['PENDING', 'RETRYING'] },
        nextAttemptAt: { lte: now },
      },
      orderBy: { nextAttemptAt: 'asc' },
      take: 50,
    });
    if (!due.length) return;
    this.logger.log(`[DLQ Cron] Retrying ${due.length} notification(s)`);

    for (const row of due) {
      try {
        if (row.channel !== 'EMAIL') {
          // Other channels not yet wired; skip but mark FAILED to stop polling.
          await this.prisma.notificationDeadLetter.update({
            where: { id: row.id },
            data: { status: 'FAILED', lastError: `Unsupported channel ${row.channel}` },
          });
          continue;
        }

        const payload = (row.payload as any) || {};
        const result = await this.mail.retryEmail(row.recipient, row.subject || '', String(payload.html || ''));
        if (result.ok) {
          await this.prisma.notificationDeadLetter.update({
            where: { id: row.id },
            data: { status: 'SENT', sentAt: new Date(), attempts: row.attempts + 1, lastError: null },
          });
          continue;
        }

        const nextAttempts = row.attempts + 1;
        if (nextAttempts >= MAX_ATTEMPTS) {
          await this.prisma.notificationDeadLetter.update({
            where: { id: row.id },
            data: { status: 'FAILED', attempts: nextAttempts, lastError: result.error },
          });
        } else {
          // Exponential backoff: 1m, 5m, 15m, 1h, 6h, 24h
          const backoffMins = [1, 5, 15, 60, 360, 1440][Math.min(nextAttempts, 5)];
          await this.prisma.notificationDeadLetter.update({
            where: { id: row.id },
            data: {
              status: 'RETRYING',
              attempts: nextAttempts,
              lastError: result.error,
              nextAttemptAt: new Date(Date.now() + backoffMins * 60 * 1000),
            },
          });
        }
      } catch (e: any) {
        this.logger.warn(`[DLQ Cron] retry failed for row ${row.id}: ${e?.message || e}`);
      }
    }
  }
}
