import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { MemberRole } from '@prisma/client';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { WorkspaceAccessGuard } from './workspace-access.guard';
import { WorkspacePermission } from './workspace-permission.decorator';
import { WorkspaceRoles } from './workspace-roles.decorator';

@UseGuards(AuthGuard, WorkspaceAccessGuard)
@Controller('workspaces/:workspaceId/members')
export class WorkspaceMembersController {
  constructor(private readonly auth: AuthService) {}

  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF)
  @Get()
  list(@Param('workspaceId') workspaceId: string) {
    return this.auth.listWorkspaceMembers(workspaceId);
  }

  @WorkspacePermission('users:manage')
  @Post('staff')
  createStaff(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: { fullName: string; email: string; role?: MemberRole },
    @Req() req: any,
  ) {
    return this.auth.createWorkspaceStaff(workspaceId, dto, {
      userId: req?.authUserId,
      role: req?.workspaceContext?.role,
    });
  }

  @WorkspacePermission('users:manage')
  @Get(':memberId/blocks')
  blocks(@Param('workspaceId') workspaceId: string, @Param('memberId') memberId: string) {
    return this.auth.listStaffBlocks(workspaceId, memberId);
  }

  @WorkspacePermission('users:manage')
  @Patch(':memberId/blocks')
  setBlocks(
    @Param('workspaceId') workspaceId: string,
    @Param('memberId') memberId: string,
    @Body() dto: { blocks?: string[] },
  ) {
    return this.auth.setStaffBlocks(workspaceId, memberId, dto.blocks || []);
  }

  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER)
  @Patch(':memberId')
  update(
    @Param('workspaceId') workspaceId: string,
    @Param('memberId') memberId: string,
    @Body() dto: { role?: MemberRole; isActive?: boolean },
    @Req() req: any,
  ) {
    return this.auth.updateWorkspaceMember(workspaceId, memberId, dto, {
      userId: req?.authUserId,
      role: req?.workspaceContext?.role,
    });
  }

}
