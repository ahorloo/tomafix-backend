export type PaystackMode = 'test' | 'live';

type EnvLike = NodeJS.ProcessEnv;

function normalize(raw?: string) {
  return String(raw || '').trim().toLowerCase();
}

export function resolvePaystackMode(env: EnvLike = process.env): PaystackMode {
  const configured = normalize(env.PAYSTACK_MODE);
  if (!configured || configured === 'auto') {
    return normalize(env.NODE_ENV) === 'production' ? 'live' : 'test';
  }

  if (configured === 'test' || configured === 'live') {
    return configured;
  }

  throw new Error('PAYSTACK_MODE must be one of: auto, test, live');
}

function assertKeyMatchesMode(rawKey: string, mode: PaystackMode, envName: 'PAYSTACK_SECRET_KEY' | 'PAYSTACK_PUBLIC_KEY') {
  const expectedPrefix =
    envName === 'PAYSTACK_SECRET_KEY'
      ? mode === 'live'
        ? 'sk_live_'
        : 'sk_test_'
      : mode === 'live'
        ? 'pk_live_'
        : 'pk_test_';

  if (!rawKey.startsWith(expectedPrefix)) {
    throw new Error(`${envName} must use a ${mode} Paystack key when PAYSTACK_MODE=${mode}`);
  }
}

export function getPaystackConfig(
  env: EnvLike = process.env,
  options?: { allowUnconfigured?: boolean },
) {
  const mode = resolvePaystackMode(env);
  const secret = String(env.PAYSTACK_SECRET_KEY || '').trim();
  const publicKey = String(env.PAYSTACK_PUBLIC_KEY || '').trim();

  if (!secret) {
    if (options?.allowUnconfigured) {
      return {
        mode,
        secret: '',
        publicKey,
        configured: false,
      };
    }
    throw new Error('PAYSTACK_SECRET_KEY not set');
  }

  assertKeyMatchesMode(secret, mode, 'PAYSTACK_SECRET_KEY');
  if (publicKey) assertKeyMatchesMode(publicKey, mode, 'PAYSTACK_PUBLIC_KEY');

  return {
    mode,
    secret,
    publicKey,
    configured: true,
  };
}
