import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PropertyController } from './property.controller';
import { PropertyService } from './property.service';
import { EntitlementsGuard } from '../billing/guards';
import { BillingModule } from '../billing/billing.module';
import { AuthModule } from '../auth/auth.module';
import { AuthGuard } from '../auth/auth.guard';
import { WorkspaceAccessGuard } from '../auth/workspace-access.guard';
import { MailModule } from '../mail/mail.module';
import { SmsModule } from '../sms/sms.module';

@Module({
  imports: [PrismaModule, BillingModule, AuthModule, MailModule, SmsModule],
  controllers: [PropertyController],
  providers: [PropertyService, EntitlementsGuard, AuthGuard, WorkspaceAccessGuard],
  exports: [PropertyService],
})
export class PropertyModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(EntitlementsGuard).forRoutes(PropertyController);
  }
}
