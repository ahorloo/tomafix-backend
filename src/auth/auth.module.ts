import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { WorkspaceMembersController } from './workspace-members.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController, WorkspaceMembersController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
