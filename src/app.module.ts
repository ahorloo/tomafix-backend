import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { BillingModule } from './billing/billing.module';
import { ApartmentModule } from './apartment/apartment.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    PrismaModule,
    OnboardingModule,
    BillingModule,
    ApartmentModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}