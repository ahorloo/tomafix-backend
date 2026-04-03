import { assertSafeBillingRuntimeEnv } from '../../src/billing/runtime-billing-env.guard';

describe('runtime billing env guard', () => {
  it('allows local development with test mode', () => {
    expect(
      assertSafeBillingRuntimeEnv({
        NODE_ENV: 'development',
        PAYSTACK_MODE: 'test',
        PAYSTACK_SECRET_KEY: 'sk_test_example',
        PAYSTACK_PUBLIC_KEY: 'pk_test_example',
        PAYSTACK_CALLBACK_URL: 'http://localhost:5173/onboarding/payment-success',
      } as NodeJS.ProcessEnv),
    ).toEqual(
      expect.objectContaining({
        environment: 'development',
        mode: 'test',
      }),
    );
  });

  it('rejects live mode outside production by default', () => {
    expect(() =>
      assertSafeBillingRuntimeEnv({
        NODE_ENV: 'development',
        PAYSTACK_MODE: 'live',
        PAYSTACK_SECRET_KEY: 'sk_live_example',
        PAYSTACK_PUBLIC_KEY: 'pk_live_example',
      } as NodeJS.ProcessEnv),
    ).toThrow(
      'Non-production environments must use PAYSTACK_MODE=test. Set ALLOW_LIVE_PAYSTACK_IN_DEV=true only for deliberate live smoke tests.',
    );
  });

  it('allows deliberate live smoke mode outside production when explicitly enabled', () => {
    expect(
      assertSafeBillingRuntimeEnv({
        NODE_ENV: 'development',
        PAYSTACK_MODE: 'live',
        PAYSTACK_SECRET_KEY: 'sk_live_example',
        PAYSTACK_PUBLIC_KEY: 'pk_live_example',
        ALLOW_LIVE_PAYSTACK_IN_DEV: 'true',
      } as NodeJS.ProcessEnv),
    ).toEqual(
      expect.objectContaining({
        environment: 'development',
        mode: 'live',
        allowLiveInDev: true,
      }),
    );
  });

  it('rejects production with unsafe local billing flags', () => {
    expect(() =>
      assertSafeBillingRuntimeEnv({
        NODE_ENV: 'production',
        PAYSTACK_MODE: 'live',
        PAYSTACK_SECRET_KEY: 'sk_live_example',
        PAYSTACK_PUBLIC_KEY: 'pk_live_example',
        FRONTEND_URL: 'https://app.tomafix.com',
        PAYSTACK_CALLBACK_URL: 'https://app.tomafix.com/onboarding/payment-success',
        CORS_ORIGINS: 'https://app.tomafix.com,https://www.tomafix.com',
        LOCAL_RELAX_GUARDS: 'true',
      } as NodeJS.ProcessEnv),
    ).toThrow('LOCAL_RELAX_GUARDS must be false in production');
  });

  it('rejects production localhost callback URLs', () => {
    expect(() =>
      assertSafeBillingRuntimeEnv({
        NODE_ENV: 'production',
        PAYSTACK_MODE: 'live',
        PAYSTACK_SECRET_KEY: 'sk_live_example',
        PAYSTACK_PUBLIC_KEY: 'pk_live_example',
        FRONTEND_URL: 'https://app.tomafix.com',
        PAYSTACK_CALLBACK_URL: 'http://localhost:5173/onboarding/payment-success',
        CORS_ORIGINS: 'https://app.tomafix.com,https://www.tomafix.com',
      } as NodeJS.ProcessEnv),
    ).toThrow('PAYSTACK_CALLBACK_URL must use https in production');
  });

  it('allows production with live keys and public https URLs', () => {
    expect(
      assertSafeBillingRuntimeEnv({
        NODE_ENV: 'production',
        PAYSTACK_MODE: 'live',
        PAYSTACK_SECRET_KEY: 'sk_live_example',
        PAYSTACK_PUBLIC_KEY: 'pk_live_example',
        FRONTEND_URL: 'https://app.tomafix.com',
        APP_BASE_URL: 'https://app.tomafix.com',
        PAYSTACK_CALLBACK_URL: 'https://app.tomafix.com/onboarding/payment-success',
        CORS_ORIGINS: 'https://app.tomafix.com,https://www.tomafix.com',
        LOCAL_BYPASS_PAYMENT: 'false',
        LOCAL_RELAX_GUARDS: 'false',
      } as NodeJS.ProcessEnv),
    ).toEqual(
      expect.objectContaining({
        environment: 'production',
        mode: 'live',
      }),
    );
  });
});
