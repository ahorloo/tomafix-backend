import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { WorkspaceMembersController } from './workspace-members.controller';
import { WorkspacePermissionsController } from './workspace-permissions.controller';
import { AuthService } from './auth.service';
import { PasskeyService } from './passkey.service';
import { WorkspaceAuditController } from './workspace-audit.controller';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController, WorkspaceMembersController, WorkspacePermissionsController, WorkspaceAuditController],
  providers: [AuthService, PasskeyService],
  exports: [AuthService],
})
export class AuthModule {}
