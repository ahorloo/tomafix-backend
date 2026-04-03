import { getPaystackConfig, resolvePaystackMode } from './paystack.config';

type EnvLike = NodeJS.ProcessEnv;

function normalize(raw?: string) {
  return String(raw || '').trim().toLowerCase();
}

function isTruthy(raw?: string) {
  const value = normalize(raw);
  return value === 'true' || value === '1' || value === 'yes';
}

function isPrivateHostname(hostname: string) {
  if (!hostname) return false;

  const normalized = hostname.trim().toLowerCase();
  if (normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1') return true;

  if (normalized.startsWith('10.')) return true;
  if (normalized.startsWith('192.168.')) return true;

  const match = normalized.match(/^172\.(\d{1,3})\./);
  if (!match) return false;

  const secondOctet = Number(match[1]);
  return secondOctet >= 16 && secondOctet <= 31;
}

function assertPublicHttpsUrl(envName: string, rawUrl: string | undefined) {
  const value = String(rawUrl || '').trim();
  if (!value) {
    throw new Error(`${envName} is required in production`);
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${envName} must be a valid absolute URL`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`${envName} must use https in production`);
  }

  if (isPrivateHostname(parsed.hostname)) {
    throw new Error(`${envName} must not point to localhost or a private network in production`);
  }
}

function assertNoLocalCorsOrigins(rawOrigins: string | undefined) {
  const origins = String(rawOrigins || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`CORS_ORIGINS contains an invalid URL: ${origin}`);
    }

    if (isPrivateHostname(parsed.hostname)) {
      throw new Error('CORS_ORIGINS must not include localhost or private-network origins in production');
    }
  }
}

export function assertSafeBillingRuntimeEnv(env: EnvLike = process.env) {
  const nodeEnv = normalize(env.NODE_ENV);
  const isProduction = nodeEnv === 'production';
  const allowLiveInDev = isTruthy(env.ALLOW_LIVE_PAYSTACK_IN_DEV);
  const mode = resolvePaystackMode(env);

  if (isProduction) {
    if (mode !== 'live') {
      throw new Error('Production must run with PAYSTACK_MODE=live');
    }

    if (isTruthy(env.LOCAL_BYPASS_PAYMENT)) {
      throw new Error('LOCAL_BYPASS_PAYMENT must be false in production');
    }

    if (isTruthy(env.LOCAL_RELAX_GUARDS)) {
      throw new Error('LOCAL_RELAX_GUARDS must be false in production');
    }

    getPaystackConfig(env);
    assertPublicHttpsUrl('FRONTEND_URL', env.FRONTEND_URL);
    assertPublicHttpsUrl('PAYSTACK_CALLBACK_URL', env.PAYSTACK_CALLBACK_URL);

    if (env.APP_BASE_URL) {
      assertPublicHttpsUrl('APP_BASE_URL', env.APP_BASE_URL);
    }

    if (env.APP_URL) {
      assertPublicHttpsUrl('APP_URL', env.APP_URL);
    }

    assertNoLocalCorsOrigins(env.CORS_ORIGINS);
    return { environment: 'production' as const, mode };
  }

  if (mode === 'live' && !allowLiveInDev) {
    throw new Error(
      'Non-production environments must use PAYSTACK_MODE=test. Set ALLOW_LIVE_PAYSTACK_IN_DEV=true only for deliberate live smoke tests.',
    );
  }

  if (mode === 'live') {
    getPaystackConfig(env);
  }

  return {
    environment: nodeEnv || 'development',
    mode,
    allowLiveInDev,
  };
}
