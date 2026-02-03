import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PaystackService } from './paystack.service';

@Module({
  imports: [PrismaModule],
  controllers: [BillingController],
  providers: [BillingService, PaystackService],
  exports: [BillingService, PaystackService],
})
export class BillingModule {}