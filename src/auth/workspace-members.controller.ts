import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { MemberRole } from '@prisma/client';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { WorkspaceAccessGuard } from './workspace-access.guard';
import { WorkspacePermission } from './workspace-permission.decorator';

@UseGuards(AuthGuard, WorkspaceAccessGuard)
@Controller('workspaces/:workspaceId/members')
export class WorkspaceMembersController {
  constructor(private readonly auth: AuthService) {}

  @WorkspacePermission('users:manage')
  @Get()
  list(@Param('workspaceId') workspaceId: string) {
    return this.auth.listWorkspaceMembers(workspaceId);
  }

  @WorkspacePermission('users:manage')
  @Patch(':memberId')
  update(
    @Param('workspaceId') workspaceId: string,
    @Param('memberId') memberId: string,
    @Body() dto: { role?: MemberRole; isActive?: boolean },
  ) {
    return this.auth.updateWorkspaceMember(workspaceId, memberId, dto);
  }

}
