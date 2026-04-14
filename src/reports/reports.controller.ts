import { Controller, Get, Header, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { WorkspaceAccessGuard } from '../auth/workspace-access.guard';
import { WorkspacePermission } from '../auth/workspace-permission.decorator';
import { ReportsService } from './reports.service';

@UseGuards(AuthGuard, WorkspaceAccessGuard)
@Controller('workspaces/:workspaceId/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @WorkspacePermission('dashboard:view')
  @Get('trends')
  trends(
    @Param('workspaceId') workspaceId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.trends(workspaceId, from, to);
  }

  @WorkspacePermission('dashboard:view')
  @Get('summary')
  summary(
    @Param('workspaceId') workspaceId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('estateId') estateId?: string,
  ) {
    return this.reports.summary(workspaceId, from, to, estateId);
  }

  @WorkspacePermission('requests:view')
  @Get('exports/requests.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  requestsCsv(@Param('workspaceId') workspaceId: string, @Query('estateId') estateId?: string) {
    return this.reports.exportRequestsCsv(workspaceId, estateId);
  }

  @WorkspacePermission('residents:view')
  @Get('exports/residents.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  residentsCsv(@Param('workspaceId') workspaceId: string, @Query('estateId') estateId?: string) {
    return this.reports.exportResidentsCsv(workspaceId, estateId);
  }

  @WorkspacePermission('inspections:view')
  @Get('exports/inspections.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  inspectionsCsv(@Param('workspaceId') workspaceId: string, @Query('estateId') estateId?: string) {
    return this.reports.exportInspectionsCsv(workspaceId, estateId);
  }

  @WorkspacePermission('notices:view')
  @Get('exports/notices.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  noticesCsv(@Param('workspaceId') workspaceId: string, @Query('estateId') estateId?: string) {
    return this.reports.exportNoticesCsv(workspaceId, estateId);
  }
}
