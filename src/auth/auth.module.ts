import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { WorkspaceMembersController } from './workspace-members.controller';
import { WorkspacePermissionsController } from './workspace-permissions.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController, WorkspaceMembersController, WorkspacePermissionsController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
