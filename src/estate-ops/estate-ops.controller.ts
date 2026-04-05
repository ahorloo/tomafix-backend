import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { MemberRole, NoticeAudience } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { WorkspaceAccessGuard } from '../auth/workspace-access.guard';
import { WorkspacePermission } from '../auth/workspace-permission.decorator';
import { WorkspaceRoles } from '../auth/workspace-roles.decorator';
import { EstateOpsService } from './estate-ops.service';

@UseGuards(AuthGuard, WorkspaceAccessGuard)
@Controller('workspaces/:workspaceId/estate')
export class EstateOpsController {
  constructor(private readonly estate: EstateOpsService) {}

  @WorkspacePermission('residents:view')
  @Get('leases')
  listLeases(@Param('workspaceId') workspaceId: string, @Query('estateId') estateId?: string, @Query('status') status?: string) {
    return this.estate.listLeases(workspaceId, { estateId, status });
  }

  @WorkspacePermission('residents:manage')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF)
  @Post('leases')
  createLease(@Param('workspaceId') workspaceId: string, @Body() dto: any) {
    return this.estate.createLease(workspaceId, dto);
  }

  @WorkspacePermission('residents:manage')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF)
  @Patch('leases/:leaseId')
  updateLease(@Param('workspaceId') workspaceId: string, @Param('leaseId') leaseId: string, @Body() dto: any) {
    return this.estate.updateLease(workspaceId, leaseId, dto);
  }

  @WorkspacePermission('units:view')
  @Get('utilities/meters')
  listUtilityMeters(@Param('workspaceId') workspaceId: string, @Query('estateId') estateId?: string, @Query('unitId') unitId?: string) {
    return this.estate.listUtilityMeters(workspaceId, { estateId, unitId });
  }

  @WorkspacePermission('units:manage')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF)
  @Post('utilities/meters')
  createUtilityMeter(@Param('workspaceId') workspaceId: string, @Body() dto: any) {
    return this.estate.createUtilityMeter(workspaceId, dto);
  }

  @WorkspacePermission('units:manage')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF)
  @Patch('utilities/meters/:meterId')
  updateUtilityMeter(@Param('workspaceId') workspaceId: string, @Param('meterId') meterId: string, @Body() dto: any) {
    return this.estate.updateUtilityMeter(workspaceId, meterId, dto);
  }

  @WorkspacePermission('units:view')
  @Get('utilities/readings')
  listUtilityReadings(@Param('workspaceId') workspaceId: string, @Query('meterId') meterId?: string) {
    return this.estate.listUtilityReadings(workspaceId, meterId);
  }

  @WorkspacePermission('units:manage')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF)
  @Post('utilities/readings')
  recordUtilityReading(@Param('workspaceId') workspaceId: string, @Body() dto: any) {
    return this.estate.recordUtilityReading(workspaceId, dto);
  }

  @WorkspacePermission('requests:view')
  @Get('violations')
  listViolations(@Param('workspaceId') workspaceId: string, @Query('estateId') estateId?: string, @Query('status') status?: string) {
    return this.estate.listViolations(workspaceId, { estateId, status });
  }

  @WorkspacePermission('requests:create')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF)
  @Post('violations')
  createViolation(@Param('workspaceId') workspaceId: string, @Req() req: any, @Body() dto: any) {
    return this.estate.createViolation(workspaceId, dto, req.user?.fullName ?? req.user?.email ?? 'Manager');
  }

  @WorkspacePermission('requests:create')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF)
  @Patch('violations/:violationId')
  updateViolation(@Param('workspaceId') workspaceId: string, @Param('violationId') violationId: string, @Req() req: any, @Body() dto: any) {
    return this.estate.updateViolation(workspaceId, violationId, dto, req.user?.fullName ?? req.user?.email ?? 'Manager');
  }

  @WorkspacePermission('requests:view')
  @Get('approvals')
  listApprovals(@Param('workspaceId') workspaceId: string, @Req() req: any, @Query('estateId') estateId?: string, @Query('status') status?: string) {
    return this.estate.listApprovalRequests(workspaceId, {
      estateId,
      status,
      actorUserId: req.authUserId,
      actorRole: req.workspaceContext?.role,
    });
  }

  @WorkspacePermission('requests:create')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF, MemberRole.RESIDENT)
  @Post('approvals')
  createApproval(@Param('workspaceId') workspaceId: string, @Req() req: any, @Body() dto: any) {
    return this.estate.createApprovalRequest(workspaceId, dto, {
      actorUserId: req.authUserId,
      actorRole: req.workspaceContext?.role,
      actorName: req.user?.fullName ?? req.user?.email ?? 'Resident',
    });
  }

  @WorkspacePermission('requests:create')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF)
  @Patch('approvals/:approvalId')
  updateApproval(@Param('workspaceId') workspaceId: string, @Param('approvalId') approvalId: string, @Req() req: any, @Body() dto: any) {
    return this.estate.updateApprovalRequest(workspaceId, approvalId, dto, req.user?.fullName ?? req.user?.email ?? 'Manager');
  }

  @WorkspacePermission('inspections:view')
  @Get('inspection-templates')
  listInspectionTemplates(@Param('workspaceId') workspaceId: string, @Query('estateId') estateId?: string) {
    return this.estate.listInspectionTemplates(workspaceId, estateId);
  }

  @WorkspacePermission('inspections:manage')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF)
  @Post('inspection-templates')
  createInspectionTemplate(@Param('workspaceId') workspaceId: string, @Body() dto: any) {
    return this.estate.createInspectionTemplate(workspaceId, dto);
  }

  @WorkspacePermission('inspections:manage')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF)
  @Patch('inspection-templates/:templateId')
  updateInspectionTemplate(@Param('workspaceId') workspaceId: string, @Param('templateId') templateId: string, @Body() dto: any) {
    return this.estate.updateInspectionTemplate(workspaceId, templateId, dto);
  }

  @WorkspacePermission('inspections:view')
  @Get('inspections')
  listInspections(@Param('workspaceId') workspaceId: string, @Query('estateId') estateId?: string, @Query('status') status?: string) {
    return this.estate.listInspections(workspaceId, { estateId, status });
  }

  @WorkspacePermission('inspections:manage')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF)
  @Post('inspections')
  createInspection(@Param('workspaceId') workspaceId: string, @Body() dto: any) {
    return this.estate.createInspection(workspaceId, dto);
  }

  @WorkspacePermission('inspections:manage')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF)
  @Patch('inspections/:inspectionId')
  updateInspection(@Param('workspaceId') workspaceId: string, @Param('inspectionId') inspectionId: string, @Body() dto: any) {
    return this.estate.updateInspection(workspaceId, inspectionId, dto);
  }

  @WorkspacePermission('notices:view')
  @Get('alerts')
  listAlerts(@Param('workspaceId') workspaceId: string, @Query('estateId') estateId?: string) {
    return this.estate.listEmergencyAlerts(workspaceId, estateId);
  }

  @WorkspacePermission('notices:manage')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER)
  @Post('alerts')
  createAlert(@Param('workspaceId') workspaceId: string, @Req() req: any, @Body() dto: { title: string; body: string; estateId?: string; audience?: NoticeAudience; sendSms?: boolean }) {
    return this.estate.createEmergencyAlert(workspaceId, {
      ...dto,
      sentByName: req.user?.fullName ?? req.user?.email ?? 'Manager',
    });
  }

  @WorkspacePermission('notices:view')
  @Get('reminders')
  listReminders(@Param('workspaceId') workspaceId: string) {
    return this.estate.listReminderLogs(workspaceId);
  }
}
