import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { MemberRole, NoticeAudience } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { WorkspaceAccessGuard } from '../auth/workspace-access.guard';
import { WorkspaceRoles } from '../auth/workspace-roles.decorator';
import { WorkspacePermission } from '../auth/workspace-permission.decorator';
import { OperationsService } from './operations.service';

@UseGuards(AuthGuard, WorkspaceAccessGuard)
@Controller('workspaces/:workspaceId/operations')
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @WorkspacePermission('notices:view')
  @Get('notices')
  listNotices(@Param('workspaceId') workspaceId: string) {
    return this.operations.listNotices(workspaceId);
  }

  @WorkspacePermission('notices:manage')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF)
  @Post('notices')
  createNotice(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: { title: string; body: string; audience?: NoticeAudience },
  ) {
    return this.operations.createNotice(workspaceId, dto);
  }

  @Patch('notices/:noticeId/seen')
  markNoticeSeen(
    @Param('workspaceId') workspaceId: string,
    @Param('noticeId') noticeId: string,
    @Req() req: any,
    @Body() dto: { actor?: string },
  ) {
    const actor = String(req?.authUserId || dto?.actor || 'anon');
    return this.operations.markNoticeSeen(workspaceId, noticeId, actor);
  }

  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER)
  @Delete('notices/:noticeId')
  deleteNotice(@Param('workspaceId') workspaceId: string, @Param('noticeId') noticeId: string) {
    return this.operations.deleteNotice(workspaceId, noticeId);
  }

  @WorkspacePermission('inspections:view')
  @Get('inspections')
  listInspections(@Param('workspaceId') workspaceId: string) {
    return this.operations.listInspections(workspaceId);
  }

  @WorkspacePermission('inspections:manage')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF)
  @Post('inspections')
  createInspection(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: { title: string; unitId?: string; dueDate: string; checklist?: string[] },
  ) {
    return this.operations.createInspection(workspaceId, dto);
  }

  @WorkspacePermission('inspections:manage')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF)
  @Patch('inspections/:inspectionId')
  updateInspection(
    @Param('workspaceId') workspaceId: string,
    @Param('inspectionId') inspectionId: string,
    @Body() dto: { status?: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED'; result?: string },
  ) {
    return this.operations.updateInspection(workspaceId, inspectionId, dto as any);
  }
}
