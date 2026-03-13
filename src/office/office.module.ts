import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { OfficeController } from './office.controller';
import { PublicOfficeController } from './public-office.controller';
import { OfficeService } from './office.service';
import { AuthGuard } from '../auth/auth.guard';
import { WorkspaceAccessGuard } from '../auth/workspace-access.guard';
import { EntitlementsGuard } from '../billing/guards';
import { BillingModule } from '../billing/billing.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [PrismaModule, AuthModule, BillingModule, MailModule],
  controllers: [OfficeController, PublicOfficeController],
  providers: [OfficeService, EntitlementsGuard, AuthGuard, WorkspaceAccessGuard],
  exports: [OfficeService],
})
export class OfficeModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(EntitlementsGuard).forRoutes(OfficeController);
  }
}
