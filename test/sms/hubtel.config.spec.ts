import { getHubtelSmsConfig, normalizeSmsPhone, resolveSmsProvider } from '../../src/sms/hubtel.config';

describe('hubtel sms config', () => {
  it('defaults to mock outside production', () => {
    expect(resolveSmsProvider({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe('mock');
    expect(resolveSmsProvider({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toBe('mock');
  });

  it('defaults to none in production when no explicit provider is set', () => {
    expect(resolveSmsProvider({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe('none');
  });

  it('marks hubtel as configured when required credentials are present', () => {
    expect(
      getHubtelSmsConfig({
        SMS_PROVIDER: 'hubtel',
        HUBTEL_SMS_CLIENT_ID: 'client-id',
        HUBTEL_SMS_CLIENT_SECRET: 'client-secret',
        HUBTEL_SMS_SENDER_ID: 'TomaFix',
      } as NodeJS.ProcessEnv),
    ).toEqual(
      expect.objectContaining({
        provider: 'hubtel',
        configured: true,
      }),
    );
  });

  it('normalizes Ghana local phone numbers into Hubtel-friendly format', () => {
    expect(normalizeSmsPhone('024 123 4567')).toBe('233241234567');
    expect(normalizeSmsPhone('+233241234567')).toBe('233241234567');
    expect(normalizeSmsPhone('241234567')).toBe('233241234567');
  });
});
