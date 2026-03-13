import { getPaystackConfig, resolvePaystackMode } from '../../src/billing/paystack.config';

describe('paystack config', () => {
  it('defaults to test mode outside production', () => {
    expect(resolvePaystackMode({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe('test');
    expect(resolvePaystackMode({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toBe('test');
  });

  it('defaults to live mode in production', () => {
    expect(resolvePaystackMode({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe('live');
  });

  it('allows explicit test mode with matching keys', () => {
    expect(
      getPaystackConfig({
        PAYSTACK_MODE: 'test',
        PAYSTACK_SECRET_KEY: 'sk_test_example',
        PAYSTACK_PUBLIC_KEY: 'pk_test_example',
      } as NodeJS.ProcessEnv),
    ).toEqual(
      expect.objectContaining({
        mode: 'test',
        configured: true,
      }),
    );
  });

  it('rejects a live/test mismatch', () => {
    expect(() =>
      getPaystackConfig({
        PAYSTACK_MODE: 'live',
        PAYSTACK_SECRET_KEY: 'sk_test_example',
      } as NodeJS.ProcessEnv),
    ).toThrow('PAYSTACK_SECRET_KEY must use a live Paystack key when PAYSTACK_MODE=live');
  });
});
