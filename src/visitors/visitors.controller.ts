import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { MemberRole } from '@prisma/client';
import { VisitorsService } from './visitors.service';
import { CreateVisitorDto } from './dto/create-visitor.dto';
import { ScanVisitorDto } from './dto/scan-visitor.dto';
import { AuthGuard } from '../auth/auth.guard';
import { WorkspaceAccessGuard } from '../auth/workspace-access.guard';
import { WorkspacePermission } from '../auth/workspace-permission.decorator';
import { WorkspaceRoles } from '../auth/workspace-roles.decorator';

@UseGuards(AuthGuard, WorkspaceAccessGuard)
@Controller('workspaces/:workspaceId/visitors')
export class VisitorsController {
  constructor(private readonly visitors: VisitorsService) {}

  // Stats for dashboard card
  @WorkspacePermission('visitors:view')
  @Get('stats')
  getStats(@Param('workspaceId') workspaceId: string) {
    return this.visitors.getStats(workspaceId);
  }

  // List visitors (with optional status filter)
  @WorkspacePermission('visitors:view')
  @Get()
  listVisitors(
    @Param('workspaceId') workspaceId: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.visitors.listVisitors(workspaceId, status, limit ? parseInt(limit, 10) : 50);
  }

  // Create a visitor invite (managers, staff, residents can all invite)
  @WorkspacePermission('visitors:view')
  @Post()
  createVisitor(
    @Param('workspaceId') workspaceId: string,
    @Req() req: any,
    @Body() dto: CreateVisitorDto,
  ) {
    const userId: string = req.authUserId ?? '';
    return this.visitors.createVisitor(workspaceId, userId, dto);
  }

  // Get single visitor by ID
  @WorkspacePermission('visitors:view')
  @Get(':visitorId')
  getVisitor(
    @Param('workspaceId') workspaceId: string,
    @Param('visitorId') visitorId: string,
  ) {
    return this.visitors.getVisitor(workspaceId, visitorId);
  }

  // Guard scans QR code to check in / check out
  @WorkspacePermission('visitors:view')
  @Post('scan')
  scanVisitor(
    @Param('workspaceId') workspaceId: string,
    @Req() req: any,
    @Body() dto: ScanVisitorDto,
  ) {
    const scannerId: string = req.authUserId ?? '';
    return this.visitors.scanVisitor(workspaceId, scannerId, dto);
  }

  // Cancel a visitor pass
  @WorkspacePermission('visitors:view')
  @Patch(':visitorId/cancel')
  cancelVisitor(
    @Param('workspaceId') workspaceId: string,
    @Param('visitorId') visitorId: string,
  ) {
    return this.visitors.cancelVisitor(workspaceId, visitorId);
  }
}
