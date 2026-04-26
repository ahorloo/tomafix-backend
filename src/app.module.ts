import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { BillingModule } from './billing/billing.module';
import { ApartmentModule } from './apartment/apartment.module';
import { OfficeModule } from './office/office.module';
import { AuthModule } from './auth/auth.module';
import { OperationsModule } from './operations/operations.module';
import { ReportsModule } from './reports/reports.module';
import { TenantModule } from './tenant/tenant.module';
import { MailModule } from './mail/mail.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { HealthModule } from './health/health.module';
import { MarketplaceModule } from './marketplace/marketplace.module';
import { AdminModule } from './admin/admin.module';
import { VisitorsModule } from './visitors/visitors.module';
import { PropertyModule } from './property/property.module';
import { SmsModule } from './sms/sms.module';
import { EstateOpsModule } from './estate-ops/estate-ops.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    ScheduleModule.forRoot(),
    // Global rate limiting: 120 requests per minute per IP across all endpoints
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    OnboardingModule,
    BillingModule,
    ApartmentModule,
    OfficeModule,
    AuthModule,
    OperationsModule,
    ReportsModule,
    TenantModule,
    MailModule,
    SchedulerModule,
    HealthModule,
    MarketplaceModule,
    AdminModule,
    VisitorsModule,
    PropertyModule,
    SmsModule,
    EstateOpsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Apply ThrottlerGuard globally — enforces the rate limit on every route
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
