import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';
import { AuthGuard } from '../auth/auth.guard';
import { WorkspaceAccessGuard } from '../auth/workspace-access.guard';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [TenantController],
  providers: [TenantService, AuthGuard, WorkspaceAccessGuard],
})
export class TenantModule {}
