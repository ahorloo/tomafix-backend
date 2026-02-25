import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';
import { AuthGuard } from '../auth/auth.guard';
import { WorkspaceAccessGuard } from '../auth/workspace-access.guard';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [OperationsController],
  providers: [OperationsService, AuthGuard, WorkspaceAccessGuard],
})
export class OperationsModule {}
