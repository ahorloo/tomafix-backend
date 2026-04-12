import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { VisitorsController } from './visitors.controller';
import { PublicVisitorsController } from './public-visitors.controller';
import { VisitorsService } from './visitors.service';
import { EntitlementsGuard } from '../billing/guards';
import { BillingModule } from '../billing/billing.module';
import { AuthModule } from '../auth/auth.module';
import { AuthGuard } from '../auth/auth.guard';
import { WorkspaceAccessGuard } from '../auth/workspace-access.guard';
import { MailModule } from '../mail/mail.module';
import { SmsModule } from '../sms/sms.module';

@Module({
  imports: [PrismaModule, BillingModule, AuthModule, MailModule, SmsModule],
  controllers: [VisitorsController, PublicVisitorsController],
  providers: [VisitorsService, EntitlementsGuard, AuthGuard, WorkspaceAccessGuard],
  exports: [VisitorsService],
})
export class VisitorsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(EntitlementsGuard).forRoutes(VisitorsController);
  }
}
