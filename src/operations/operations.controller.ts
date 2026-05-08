import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InspectionScope, MemberRole, NoticeAudience } from '@prisma/client';
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
  listNotices(
    @Param('workspaceId') workspaceId: string,
    @Query('estateId') estateId?: string,
    @Query('search') search?: string,
  ) {
    return this.operations.listNotices(workspaceId, estateId, search);
  }

  @WorkspacePermission('notices:manage')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF)
  @Post('notices')
  createNotice(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: {
      title: string;
      body: string;
      audience?: NoticeAudience;
      estateId?: string;
      targetBlock?: string | null;
      targetFloor?: string | null;
      targetUnitId?: string | null;
      pinned?: boolean;
      acknowledgeRequired?: boolean;
    },
  ) {
    return this.operations.createNotice(workspaceId, dto);
  }

  @Post('notices/:noticeId/acknowledge')
  acknowledgeNotice(
    @Param('workspaceId') workspaceId: string,
    @Param('noticeId') noticeId: string,
    @Req() req: any,
  ) {
    return this.operations.acknowledgeNotice(workspaceId, noticeId, String(req?.authUserId || ''));
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
  listInspections(@Param('workspaceId') workspaceId: string, @Req() req: any, @Query('estateId') estateId?: string) {
    return this.operations.listInspections(workspaceId, req.authUserId, estateId);
  }

  @WorkspacePermission('inspections:manage')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF)
  @Post('inspections')
  createInspection(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: {
      title: string;
      scope?: InspectionScope;
      inspectionType?: 'ROUTINE' | 'MOVE_IN' | 'MOVE_OUT';
      unitId?: string;
      block?: string;
      floor?: string;
      dueDate: string;
      checklist?: string[];
      estateId?: string;
    },
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

  // Convert an inspection finding into a follow-up maintenance request.
  // Body: { finding: string; priority?: RequestPriority; category?: string }
  @WorkspacePermission('inspections:manage')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF)
  @Post('inspections/:inspectionId/convert-to-request')
  convertInspectionToRequest(
    @Param('workspaceId') workspaceId: string,
    @Param('inspectionId') inspectionId: string,
    @Body() dto: { finding: string; priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'; category?: string },
  ) {
    return this.operations.convertInspectionToRequest(workspaceId, inspectionId, dto);
  }
}
