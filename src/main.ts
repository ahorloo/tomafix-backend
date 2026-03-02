import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

function parseCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS;
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function bootstrap() {
  // ✅ rawBody: needed for Paystack webhook signature verification
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // ✅ Versioned API prefix
  app.setGlobalPrefix('api/v1');

  // ✅ If you’re behind proxies (Render/Nginx), this helps with real client IP, https, etc.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  const corsOrigins = parseCorsOrigins();

  // ✅ CORS for Vite dev server + production frontend domains
  app.enableCors({
    origin:
      corsOrigins.length > 0
        ? corsOrigins
        : ['http://localhost:5173', 'http://localhost:5174'],
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