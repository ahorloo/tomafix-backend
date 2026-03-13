import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { BillingModule } from './billing/billing.module';
import { ApartmentModule } from './apartment/apartment.module';
import { OfficeModule } from './office/office.module';
import { AuthModule } from './auth/auth.module';
import { OperationsModule } from './operations/operations.module';
import { ReportsModule } from './reports/reports.module';
import { TenantModule } from './tenant/tenant.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    PrismaModule,
    OnboardingModule,
    BillingModule,
    ApartmentModule,
    OfficeModule,
    AuthModule,
    OperationsModule,
    ReportsModule,
    TenantModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}