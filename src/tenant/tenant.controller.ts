import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { MemberRole, RequestPriority } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { WorkspaceAccessGuard } from '../auth/workspace-access.guard';
import { WorkspaceRoles } from '../auth/workspace-roles.decorator';
import { WorkspacePermission } from '../auth/workspace-permission.decorator';
import { TenantService } from './tenant.service';

@UseGuards(AuthGuard, WorkspaceAccessGuard)
@WorkspaceRoles(MemberRole.RESIDENT)
@Controller('workspaces/:workspaceId/tenant')
export class TenantController {
  constructor(private readonly tenant: TenantService) {}

  @WorkspacePermission('dashboard:view')
  @Get('dashboard')
  dashboard(@Param('workspaceId') workspaceId: string, @Req() req: any) {
    return this.tenant.dashboard(workspaceId, req.authUserId);
  }

  @WorkspacePermission('requests:view')
  @Get('requests')
  requests(@Param('workspaceId') workspaceId: string, @Req() req: any) {
    return this.tenant.listMyRequests(workspaceId, req.authUserId);
  }

  @WorkspacePermission('requests:create')
  @Post('requests')
  createRequest(
    @Param('workspaceId') workspaceId: string,
    @Req() req: any,
    @Body() dto: { title: string; description?: string; priority?: RequestPriority },
  ) {
    return this.tenant.createMyRequest(workspaceId, req.authUserId, dto);
  }

  @WorkspacePermission('notices:view')
  @Get('notices')
  notices(@Param('workspaceId') workspaceId: string) {
    return this.tenant.listTenantNotices(workspaceId);
  }

  @WorkspacePermission('requests:view')
  @Get('requests/:requestId/messages')
  requestMessages(@Param('workspaceId') workspaceId: string, @Param('requestId') requestId: string, @Req() req: any) {
    return this.tenant.listMyRequestMessages(workspaceId, req.authUserId, requestId);
  }

  @WorkspacePermission('requests:create')
  @Post('requests/:requestId/messages')
  addRequestMessage(
    @Param('workspaceId') workspaceId: string,
    @Param('requestId') requestId: string,
    @Req() req: any,
    @Body() dto: { body: string },
  ) {
    return this.tenant.addMyRequestMessage(workspaceId, req.authUserId, requestId, dto.body);
  }
}
