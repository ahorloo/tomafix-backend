import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';
import { AuthGuard } from '../auth/auth.guard';
import { WorkspaceAccessGuard } from '../auth/workspace-access.guard';
import { EntitlementsGuard } from '../billing/guards';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [OperationsController],
  providers: [OperationsService, EntitlementsGuard, AuthGuard, WorkspaceAccessGuard],
})
export class OperationsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(EntitlementsGuard).forRoutes(OperationsController);
  }
}
