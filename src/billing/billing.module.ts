import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PaystackService } from './paystack.service';
import { AuthModule } from '../auth/auth.module';
import { AuthGuard } from '../auth/auth.guard';
import { WorkspaceAccessGuard } from '../auth/workspace-access.guard';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [BillingController],
  providers: [BillingService, PaystackService, AuthGuard, WorkspaceAccessGuard],
  exports: [BillingService, PaystackService, BillingDomainService],
})
export class BillingModule {}
