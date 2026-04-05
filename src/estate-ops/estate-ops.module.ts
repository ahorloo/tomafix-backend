import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BillingModule } from '../billing/billing.module';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { SmsModule } from '../sms/sms.module';
import { EntitlementsGuard } from '../billing/guards';
import { AuthGuard } from '../auth/auth.guard';
import { WorkspaceAccessGuard } from '../auth/workspace-access.guard';
import { EstateOpsController } from './estate-ops.controller';
import { EstateOpsService } from './estate-ops.service';

@Module({
  imports: [PrismaModule, BillingModule, AuthModule, MailModule, SmsModule],
  controllers: [EstateOpsController],
  providers: [EstateOpsService, EntitlementsGuard, AuthGuard, WorkspaceAccessGuard],
  exports: [EstateOpsService],
})
export class EstateOpsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(EntitlementsGuard).forRoutes(EstateOpsController);
  }
}
