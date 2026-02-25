import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { WorkspaceAccessGuard } from './workspace-access.guard';
import { WorkspacePermission } from './workspace-permission.decorator';
import { PermissionPolicy } from './permissions';

@UseGuards(AuthGuard, WorkspaceAccessGuard)
@Controller('workspaces/:workspaceId/permissions')
export class WorkspacePermissionsController {
  constructor(private readonly auth: AuthService) {}

  @WorkspacePermission('users:manage')
  @Get()
  getPolicy(@Param('workspaceId') workspaceId: string) {
    return this.auth.getWorkspacePermissionPolicy(workspaceId);
  }

  @WorkspacePermission('users:manage')
  @Patch()
  updatePolicy(@Param('workspaceId') workspaceId: string, @Body() dto: { policy: PermissionPolicy }) {
    return this.auth.updateWorkspacePermissionPolicy(workspaceId, dto?.policy || {});
  }
}
