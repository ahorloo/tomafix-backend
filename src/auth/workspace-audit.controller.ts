import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { WorkspaceAccessGuard } from './workspace-access.guard';
import { WorkspacePermission } from './workspace-permission.decorator';
import { AuthService } from './auth.service';

@UseGuards(AuthGuard, WorkspaceAccessGuard)
@Controller('workspaces/:workspaceId/audit')
export class WorkspaceAuditController {
  constructor(private readonly auth: AuthService) {}

  @WorkspacePermission('users:manage')
  @Get()
  list(@Param('workspaceId') workspaceId: string) {
    return this.auth.listWorkspaceAuditLogs(workspaceId);
  }
}
