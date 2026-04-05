export type SmsProvider = 'none' | 'mock' | 'hubtel';

export type HubtelSmsConfig = {
  provider: SmsProvider;
  configured: boolean;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  senderId: string;
  deliveryReport: boolean;
};

export function resolveSmsProvider(env: NodeJS.ProcessEnv = process.env): SmsProvider {
  const explicit = String(env.SMS_PROVIDER || '').trim().toLowerCase();
  if (explicit === 'hubtel' || explicit === 'mock' || explicit === 'none') return explicit;
  return String(env.NODE_ENV || '').toLowerCase() === 'production' ? 'none' : 'mock';
}

export function getHubtelSmsConfig(env: NodeJS.ProcessEnv = process.env): HubtelSmsConfig {
  const provider = resolveSmsProvider(env);
  const clientId = String(env.HUBTEL_SMS_CLIENT_ID || '').trim();
  const clientSecret = String(env.HUBTEL_SMS_CLIENT_SECRET || '').trim();
  const senderId = String(env.HUBTEL_SMS_SENDER_ID || env.HUBTEL_SMS_FROM || '').trim();

  return {
    provider,
    configured: !!(clientId && clientSecret && senderId),
    baseUrl: String(env.HUBTEL_SMS_BASE_URL || 'https://smsc.hubtel.com/v1/messages/send').trim(),
    clientId,
    clientSecret,
    senderId,
    deliveryReport: String(env.HUBTEL_SMS_DELIVERY_REPORT || 'true').trim().toLowerCase() !== 'false',
  };
}

export function normalizeSmsPhone(input: string): string | null {
  const raw = String(input || '').trim();
  if (!raw) return null;

  const hasPlus = raw.startsWith('+');
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return null;

  if (digits.startsWith('233') && digits.length === 12) return digits;
  if (digits.startsWith('0') && digits.length === 10) return `233${digits.slice(1)}`;
  if (digits.length === 9) return `233${digits}`;
  if (hasPlus && digits.length >= 10 && digits.length <= 15) return digits;
  if (digits.startsWith('00') && digits.length > 4) return digits.slice(2);
  if (digits.length >= 10 && digits.length <= 15) return digits;

  return null;
}
