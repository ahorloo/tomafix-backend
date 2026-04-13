import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private config: ConfigService) {
    const host = config.get('SMTP_HOST');
    const user = config.get('SMTP_USER');
    if (host && user) {
      this.transporter = nodemailer.createTransport({
        host,
        port: parseInt(config.get('SMTP_PORT') || '587'),
        secure: config.get('SMTP_SECURE') === 'true',
        auth: { user, pass: config.get('SMTP_PASS') },
      });
    }
  }

  private getAppUrl() {
    return (
      this.config.get('APP_URL') ||
      this.config.get('APP_BASE_URL') ||
      this.config.get('FRONTEND_URL') ||
      'http://localhost:5173'
    );
  }

  private wrapHtml(html: string) {
    const logoUrl = this.config.get('EMAIL_LOGO_URL') || 'https://www.tomafix.com/bimi-logo-preview.jpg';
    return `
      <div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;background:linear-gradient(180deg,#08101f 0%,#0c162a 100%);padding:24px 14px;">
        <div style="max-width:640px;margin:0 auto;background:#101a2f;border:1px solid rgba(230,237,246,0.12);border-radius:16px;overflow:hidden;color:#e6edf6;box-shadow:0 10px 30px rgba(0,0,0,0.25);">
          <div style="padding:16px 18px;border-bottom:1px solid rgba(230,237,246,0.08);background:rgba(56,189,248,0.08);">
            <img src="${logoUrl}" alt="TomaFix" style="max-width:170px;height:auto;display:block;" />
          </div>
          <div style="padding:18px;color:#e6edf6;line-height:1.55;font-size:14px;">
            ${html}
          </div>
          <div style="padding:12px 18px;border-top:1px solid rgba(230,237,246,0.08);font-size:11px;color:rgba(230,237,246,0.65);">
            TomaFix • Property operations made simple
          </div>
        </div>
      </div>
    `;
  }

  private async sendWithResend(to: string, subject: string, html: string) {
    const apiKey = this.config.get('RESEND_API_KEY');
    if (!apiKey) return false;

    const from = this.config.get('RESEND_FROM') || this.config.get('EMAIL_FROM') || 'TomaFix <onboarding@resend.dev>';
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Resend send failed (${res.status}): ${body}`);
    }

    return true;
  }

  async send(to: string, subject: string, html: string) {
    const brandedHtml = this.wrapHtml(html);

    try {
      const sentViaResend = await this.sendWithResend(to, subject, brandedHtml).catch((e) => {
        this.logger.error(`Resend email failed for ${to}: ${e.message}`);
        return false;
      });
      if (sentViaResend) {
        this.logger.log(`Email sent via Resend to ${to}: ${subject}`);
        return;
      }

      if (!this.transporter) {
        this.logger.warn(`[MAIL SKIPPED] To: ${to} | Subject: ${subject}`);
        return;
      }

      await this.transporter.sendMail({
        from: this.config.get('SMTP_FROM') || 'TomaFix <noreply@tomafix.com>',
        to,
        subject,
        html: brandedHtml,
      });
      this.logger.log(`Email sent via SMTP to ${to}: ${subject}`);
    } catch (e: any) {
      this.logger.error(`Failed to send email to ${to}: ${e.message}`);
    }
  }

  // Template helpers
  sendWoAssigned(email: string, techName: string, woTitle: string, workspaceId: string) {
    return this.send(
      email,
      `Work Order Assigned: ${woTitle}`,
      `<p>Hi ${techName},</p><p>You have been assigned a new work order: <strong>${woTitle}</strong>.</p><p><a href="${this.getAppUrl()}/app/${workspaceId}/work-orders">View Work Orders</a></p><p>— TomaFix</p>`,
    );
  }

  sendRequestStatusUpdate(email: string, requesterName: string, requestTitle: string, newStatus: string, workspaceId: string) {
    const statusLabel: Record<string, string> = {
      IN_PROGRESS: 'is now In Progress',
      RESOLVED: 'has been Resolved',
      CLOSED: 'has been Closed',
    };
    return this.send(
      email,
      `Request Update: ${requestTitle}`,
      `<p>Hi ${requesterName},</p><p>Your request <strong>${requestTitle}</strong> ${statusLabel[newStatus] || newStatus}.</p><p><a href="${this.getAppUrl()}/app/${workspaceId}/office-requests">View Request</a></p><p>— TomaFix</p>`,
    );
  }

  sendOverdueAlert(email: string, managerName: string, overdueCount: number, workspaceId: string) {
    return this.send(
      email,
      `⚠️ ${overdueCount} Overdue Request${overdueCount > 1 ? 's' : ''} Need Attention`,
      `<p>Hi ${managerName},</p><p>Your workspace has <strong>${overdueCount} overdue request${overdueCount > 1 ? 's' : ''}</strong> that have passed their SLA deadline.</p><p><a href="${this.getAppUrl()}/app/${workspaceId}/dashboard">View Dashboard</a></p><p>— TomaFix</p>`,
    );
  }

  sendDailyDigest(email: string, managerName: string, stats: { open: number; overdue: number; compliance: number; workspaceId: string }) {
    const complianceColor = stats.compliance >= 85 ? '#22c55e' : stats.compliance >= 70 ? '#f59e0b' : '#ef4444';
    return this.send(
      email,
      `TomaFix Daily Digest — ${new Date().toLocaleDateString()}`,
      `<p>Good morning ${managerName},</p>
       <table style="border-collapse:collapse;width:100%;max-width:400px">
         <tr><td style="padding:8px;border:1px solid #e5e7eb">Open Requests</td><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold">${stats.open}</td></tr>
         <tr><td style="padding:8px;border:1px solid #e5e7eb">Overdue</td><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;color:#ef4444">${stats.overdue}</td></tr>
         <tr><td style="padding:8px;border:1px solid #e5e7eb">SLA Compliance</td><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;color:${complianceColor}">${stats.compliance}%</td></tr>
       </table>
       <p><a href="${this.getAppUrl()}/app/${stats.workspaceId}/dashboard">Open Dashboard</a></p>
       <p>— TomaFix</p>`,
    );
  }

  sendPmCreated(email: string, managerName: string, assetName: string, woTitle: string, workspaceId: string) {
    return this.send(
      email,
      `Preventive Maintenance Due: ${assetName}`,
      `<p>Hi ${managerName},</p><p>A preventive maintenance work order has been created for asset <strong>${assetName}</strong>: <em>${woTitle}</em>.</p><p><a href="${this.getAppUrl()}/app/${workspaceId}/work-orders">View Work Orders</a></p><p>— TomaFix</p>`,
    );
  }

  sendOnboardingReminder(
    email: string,
    ownerName: string,
    workspaceName: string,
    templateType: string,
    step: 'otp' | 'payment',
    workspaceId: string,
  ) {
    const appUrl = this.getAppUrl();
    const ctaUrl =
      step === 'otp'
        ? `${appUrl}/onboarding/otp?workspaceId=${workspaceId}&email=${encodeURIComponent(email)}`
        : `${appUrl}/billing/start?workspaceId=${workspaceId}`;
    const ctaLabel = step === 'otp' ? 'Verify My Email' : 'Complete Payment';
    const stepDesc =
      step === 'otp'
        ? 'Your workspace is waiting for email verification. Enter the OTP code we sent you to activate it.'
        : "Your email is verified but payment wasn't completed. Pick a plan to unlock your workspace.";

    return this.send(
      email,
      `Complete your TomaFix setup — ${workspaceName}`,
      `<p>Hi ${ownerName},</p>
       <p>You started setting up your <strong>${templateType}</strong> workspace <strong>${workspaceName}</strong> on TomaFix but didn't finish.</p>
       <p>${stepDesc}</p>
       <p style="margin:20px 0;">
         <a href="${ctaUrl}" style="background:#2ee6c5;color:#08101f;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;">${ctaLabel}</a>
       </p>
       <p style="font-size:12px;color:rgba(230,237,246,0.55);">If you didn't create this workspace, you can ignore this email.</p>
       <p>— TomaFix</p>`,
    );
  }

  async sendVisitorInviteEmail(args: {
    to: string;
    visitorName: string;
    workspaceName: string;
    unitLabel?: string | null;
    validUntil?: Date | null;
    qrToken: string;
  }) {
    const validity = args.validUntil ? `<p><strong>Valid until:</strong> ${args.validUntil.toLocaleString()}</p>` : '';
    const unit = args.unitLabel ? `<p><strong>Unit / destination:</strong> ${args.unitLabel}</p>` : '';
    // QR encodes the full TomaFix pass URL — phone cameras open the pass page directly
    const passUrl = `https://tomafix.com/visitor-pass/${args.qrToken}`;
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(passUrl)}&bgcolor=ffffff&color=08101f&margin=10`;
    const qrBlock = `<div style="margin:18px 0;padding:14px;border:1px solid rgba(15,23,42,0.08);border-radius:14px;text-align:center;background:#ffffff;">
         <img src="${qrImageUrl}" alt="Visitor QR Code" style="width:240px;height:240px;display:block;margin:0 auto;border-radius:12px;" />
         <p style="margin:10px 0 0;font-size:12px;color:#475569;">Show this QR code at the gate. The guard scans it to verify entry.</p>
       </div>`;
    return this.send(
      args.to,
      `Your TomaFix visitor pass for ${args.workspaceName}`,
      `<p>Hi ${args.visitorName},</p>
       <p>You have been invited to visit <strong>${args.workspaceName}</strong>.</p>
       ${unit}
       ${validity}
       ${qrBlock}
       <p>If you cannot show the QR image, use the pass code above or ask the host to resend the invite.</p>
       <p>— TomaFix</p>`,
    );
  }

  async sendVisitorPassUpdatedEmail(args: {
    to: string;
    visitorName: string;
    workspaceName: string;
    unitLabel?: string | null;
    purpose?: string | null;
    validUntil?: Date | null;
    qrToken: string;
  }) {
    const validity = args.validUntil
      ? `<p><strong>Valid until:</strong> ${args.validUntil.toLocaleString()}</p>`
      : '<p><strong>Valid until:</strong> No expiry set</p>';
    const unit = args.unitLabel ? `<p><strong>Unit / destination:</strong> ${args.unitLabel}</p>` : '';
    const purpose = args.purpose ? `<p><strong>Purpose:</strong> ${args.purpose}</p>` : '';
    const passUrl = `https://tomafix.com/visitor-pass/${args.qrToken}`;
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(passUrl)}&bgcolor=ffffff&color=08101f&margin=10`;
    const qrBlock = `<div style="margin:18px 0;padding:14px;border:1px solid rgba(15,23,42,0.08);border-radius:14px;text-align:center;background:#ffffff;">
         <img src="${qrImageUrl}" alt="Visitor QR Code" style="width:240px;height:240px;display:block;margin:0 auto;border-radius:12px;" />
         <p style="margin:10px 0 0;font-size:12px;color:#475569;">Show this QR code at the gate. The guard scans it to verify entry.</p>
       </div>`;
    return this.send(
      args.to,
      `Your visitor pass for ${args.workspaceName} has been updated`,
      `<p>Hi ${args.visitorName},</p>
       <p>Your visitor pass for <strong>${args.workspaceName}</strong> has been updated. Here are your latest pass details:</p>
       ${unit}
       ${purpose}
       ${validity}
       ${qrBlock}
       <p>If you have any questions, please contact the person who invited you.</p>
       <p>— TomaFix</p>`,
    );
  }

  sendAmenityBookingEmail(args: {
    to: string;
    residentName: string;
    amenityName: string;
    status: string;
    startAt: Date;
    workspaceName: string;
    workspaceId: string;
  }) {
    const statusText: Record<string, string> = {
      REQUESTED: 'was received and is awaiting approval',
      APPROVED: 'has been approved',
      REJECTED: 'was not approved',
      CANCELLED: 'has been cancelled',
      COMPLETED: 'has been marked completed',
    };
    return this.send(
      args.to,
      `Facility booking update: ${args.amenityName}`,
      `<p>Hi ${args.residentName},</p>
       <p>Your booking for <strong>${args.amenityName}</strong> at <strong>${args.workspaceName}</strong> ${statusText[args.status] || `is now ${args.status.toLowerCase()}` }.</p>
       <p><strong>Booking time:</strong> ${args.startAt.toLocaleString()}</p>
       <p><a href="${this.getAppUrl()}/app/${args.workspaceId}/facilities">Open Facilities</a></p>
       <p>— TomaFix</p>`,
    );
  }

  sendParcelEmail(args: {
    to: string;
    recipientName: string;
    workspaceName: string;
    status: string;
    trackingCode?: string | null;
    workspaceId: string;
  }) {
    const statusText: Record<string, string> = {
      RECEIVED: 'A parcel has been received for you',
      NOTIFIED: 'Your parcel is ready for pickup',
      PICKED_UP: 'Your parcel has been marked as picked up',
      RETURNED: 'Your parcel has been marked as returned',
    };
    const tracking = args.trackingCode ? `<p><strong>Reference:</strong> ${args.trackingCode}</p>` : '';
    return this.send(
      args.to,
      `Parcel update from ${args.workspaceName}`,
      `<p>Hi ${args.recipientName},</p>
       <p>${statusText[args.status] || 'There is a parcel update for you'} at <strong>${args.workspaceName}</strong>.</p>
       ${tracking}
       <p><a href="${this.getAppUrl()}/app/${args.workspaceId}/parcels">Open Deliveries</a></p>
       <p>— TomaFix</p>`,
    );
  }

  sendSlackNotification(webhookUrl: string, text: string) {
    // Inline fetch for Slack
    return fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }).catch((e) => this.logger.error(`Slack notify failed: ${e.message}`));
  }
}
