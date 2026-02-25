import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ApartmentController } from './apartment.controller';
import { ApartmentService } from './apartment.service';
import { EntitlementsGuard } from '../billing/guards';
import { BillingModule } from '../billing/billing.module';
import { AuthModule } from '../auth/auth.module';
import { AuthGuard } from '../auth/auth.guard';
import { WorkspaceAccessGuard } from '../auth/workspace-access.guard';

@Module({
  imports: [PrismaModule, BillingModule, AuthModule],
  controllers: [ApartmentController],
  providers: [ApartmentService, EntitlementsGuard, AuthGuard, WorkspaceAccessGuard],
})
export class ApartmentModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(EntitlementsGuard).forRoutes(ApartmentController);
  }
}
