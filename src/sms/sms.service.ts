import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getHubtelSmsConfig, normalizeSmsPhone } from './hubtel.config';

type SendSmsArgs = {
  to: string;
  message: string;
  senderId?: string;
  tag?: string;
};

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly config: ConfigService) {}

  normalizePhone(phone?: string | null) {
    return normalizeSmsPhone(String(phone || ''));
  }

  async send(args: SendSmsArgs) {
    const message = String(args.message || '').trim();
    const to = this.normalizePhone(args.to);
    if (!message || !to) {
      return { ok: false, skipped: true, reason: 'missing_message_or_phone' as const };
    }

    const hubtel = getHubtelSmsConfig(process.env);
    const provider = hubtel.provider;
    const senderId = String(args.senderId || hubtel.senderId || '').trim();
    const tag = args.tag ? `[${args.tag}] ` : '';

    if (provider === 'none') {
      this.logger.log(`${tag}SMS skipped because SMS_PROVIDER=none -> ${to}`);
      return { ok: false, skipped: true, reason: 'provider_disabled' as const };
    }

    if (provider === 'mock') {
      this.logger.warn(`${tag}[MOCK SMS] ${to} :: ${message}`);
      return { ok: true, provider: 'mock' as const, to };
    }

    if (!hubtel.configured) {
      this.logger.warn(`${tag}Hubtel SMS not configured. Missing client ID, client secret, or sender ID.`);
      return { ok: false, skipped: true, reason: 'provider_not_configured' as const };
    }

    const url = new URL(hubtel.baseUrl);
    url.searchParams.set('clientid', hubtel.clientId);
    url.searchParams.set('clientsecret', hubtel.clientSecret);
    url.searchParams.set('from', senderId);
    url.searchParams.set('to', to);
    url.searchParams.set('content', message);
    url.searchParams.set('registeredDelivery', String(hubtel.deliveryReport));

    const res = await fetch(url.toString(), { method: 'GET' });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Hubtel SMS failed (${res.status}): ${body || res.statusText}`);
    }

    this.logger.log(`${tag}Hubtel SMS queued -> ${to}`);
    return { ok: true, provider: 'hubtel' as const, to };
  }

  async sendVisitorInviteSms(args: {
    to?: string | null;
    visitorName: string;
    workspaceName: string;
    unitLabel?: string | null;
    validUntil?: Date | null;
  }) {
    const validity = args.validUntil ? ` Valid until ${args.validUntil.toLocaleString()}.` : '';
    const unit = args.unitLabel ? ` for ${args.unitLabel}` : '';
    return this.send({
      to: String(args.to || ''),
      tag: 'visitor',
      message: `TomaFix: Hi ${args.visitorName}, you have been invited to ${args.workspaceName}${unit}.${validity} Show your visitor QR pass at the gate.`,
    });
  }

  async sendAmenityBookingSms(args: {
    to?: string | null;
    residentName: string;
    amenityName: string;
    status: string;
    startAt: Date;
    workspaceName: string;
  }) {
    const statusText: Record<string, string> = {
      REQUESTED: 'was received and is awaiting approval',
      APPROVED: 'has been approved',
      REJECTED: 'was not approved',
      CANCELLED: 'has been cancelled',
      COMPLETED: 'has been marked completed',
    };
    return this.send({
      to: String(args.to || ''),
      tag: 'facility',
      message: `TomaFix: ${args.residentName}, your booking for ${args.amenityName} at ${args.workspaceName} ${statusText[args.status] || `is now ${args.status.toLowerCase()}`}. ${args.startAt.toLocaleString()}.`,
    });
  }

  async sendParcelSms(args: {
    to?: string | null;
    recipientName: string;
    workspaceName: string;
    status: string;
    trackingCode?: string | null;
  }) {
    const tracking = args.trackingCode ? ` Ref ${args.trackingCode}.` : '';
    const statusText: Record<string, string> = {
      RECEIVED: 'A parcel has been received for you',
      NOTIFIED: 'Your parcel is ready for pickup',
      PICKED_UP: 'Your parcel has been marked picked up',
      RETURNED: 'Your parcel has been returned',
    };
    return this.send({
      to: String(args.to || ''),
      tag: 'parcel',
      message: `TomaFix: ${args.recipientName}, ${statusText[args.status] || 'there is a parcel update for you'} at ${args.workspaceName}.${tracking}`,
    });
  }
}
