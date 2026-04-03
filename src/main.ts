import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { assertSafeBillingRuntimeEnv } from './billing/runtime-billing-env.guard';

function isLocalDevOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    const { protocol, hostname } = url;
    if (!['http:', 'https:'].includes(protocol)) return false;
    if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
    if (hostname.startsWith('192.168.')) return true;
    if (hostname.startsWith('10.')) return true;

    const match = hostname.match(/^172\.(\d{1,3})\./);
    if (!match) return false;

    const secondOctet = Number(match[1]);
    return secondOctet >= 16 && secondOctet <= 31;
  } catch {
    return false;
  }
}

function parseCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS;
  const configured = raw
    ? raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const expanded = new Set<string>(configured);

  for (const origin of configured) {
    if (origin.includes('localhost')) {
      expanded.add(origin.replace('localhost', '127.0.0.1'));
    }
    if (origin.includes('127.0.0.1')) {
      expanded.add(origin.replace('127.0.0.1', 'localhost'));
    }
  }

  return Array.from(expanded);
}

async function bootstrap() {
  assertSafeBillingRuntimeEnv(process.env);

  // ✅ rawBody: needed for Paystack webhook signature verification
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // ✅ Versioned API prefix
  app.setGlobalPrefix('api/v1');

  // ✅ If you’re behind proxies (Render/Nginx), this helps with real client IP, https, etc.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  const corsOrigins = parseCorsOrigins();
  const isDev = process.env.NODE_ENV !== 'production';

  // ✅ CORS for Vite dev server + production frontend domains
  app.enableCors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      if (isDev && isLocalDevOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin not allowed by CORS: ${origin}`), false);
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // ✅ Security headers
  // Safari can block fetch when CORP is `same-origin`, so disable CORP/COOP/COEP for the API.
  app.use(
    helmet({
      crossOriginResourcePolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Allow image data URLs and richer payloads for request attachments.
  app.use(json({ limit: '6mb' }));
  app.use(urlencoded({ extended: true, limit: '6mb' }));

  // ✅ Strict request validation (good for API safety)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ✅ Graceful shutdown
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');

  console.log(`✅ API running at http://localhost:${port}/api/v1`);
}

bootstrap();
