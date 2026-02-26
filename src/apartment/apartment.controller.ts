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
import { MemberRole } from '@prisma/client';
import { ApartmentService } from './apartment.service';
import { CreateUnitDto } from './dto/create-unit.dto';
import { CreateResidentDto } from './dto/create-resident.dto';
import { CreateRequestDto } from './dto/create-request.dto';
import { AuthGuard } from '../auth/auth.guard';
import { WorkspaceAccessGuard } from '../auth/workspace-access.guard';
import { WorkspaceRoles } from '../auth/workspace-roles.decorator';
import { WorkspacePermission } from '../auth/workspace-permission.decorator';

// If main.ts sets global prefix 'api', these become:
// /api/workspaces/:workspaceId/apartment/...
@UseGuards(AuthGuard, WorkspaceAccessGuard)
@Controller('workspaces/:workspaceId/apartment')
export class ApartmentController {
  constructor(private readonly apartment: ApartmentService) {}

  @WorkspacePermission('dashboard:view')
  @Get('dashboard')
  getDashboard(@Param('workspaceId') workspaceId: string) {
    return this.apartment.getDashboard(workspaceId);
  }

  // Units
  @WorkspacePermission('units:view')
  @Get('units')
  listUnits(@Param('workspaceId') workspaceId: string) {
    return this.apartment.listUnits(workspaceId);
  }

  @WorkspacePermission('units:manage')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF)
  @Post('units')
  createUnit(@Param('workspaceId') workspaceId: string, @Body() dto: CreateUnitDto) {
    return this.apartment.createUnit(workspaceId, dto);
  }

  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF)
  @Patch('units/:unitId')
  updateUnit(
    @Param('workspaceId') workspaceId: string,
    @Param('unitId') unitId: string,
    @Body() dto: Partial<CreateUnitDto>,
  ) {
    return this.apartment.updateUnit(workspaceId, unitId, dto);
  }

  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER)
  @Delete('units/:unitId')
  deleteUnit(@Param('workspaceId') workspaceId: string, @Param('unitId') unitId: string) {
    return this.apartment.deleteUnit(workspaceId, unitId);
  }

  // Residents
  @WorkspacePermission('residents:view')
  @Get('residents')
  listResidents(@Param('workspaceId') workspaceId: string) {
    return this.apartment.listResidents(workspaceId);
  }

  @WorkspacePermission('residents:manage')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF)
  @Post('residents')
  createResident(@Param('workspaceId') workspaceId: string, @Body() dto: CreateResidentDto) {
    return this.apartment.createResident(workspaceId, dto);
  }

  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF)
  @Patch('residents/:residentId')
  updateResident(
    @Param('workspaceId') workspaceId: string,
    @Param('residentId') residentId: string,
    @Body() dto: Partial<CreateResidentDto>,
  ) {
    return this.apartment.updateResident(workspaceId, residentId, dto);
  }

  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER)
  @Delete('residents/:residentId')
  deleteResident(@Param('workspaceId') workspaceId: string, @Param('residentId') residentId: string) {
    return this.apartment.deleteResident(workspaceId, residentId);
  }

  // Requests
  @WorkspacePermission('requests:view')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF, MemberRole.TECHNICIAN)
  @Get('requests')
  listRequests(@Param('workspaceId') workspaceId: string, @Query('status') status?: string) {
    return this.apartment.listRequests(workspaceId, status);
  }

  @WorkspacePermission('requests:create')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF, MemberRole.TECHNICIAN)
  @Post('requests')
  createRequest(@Param('workspaceId') workspaceId: string, @Body() dto: CreateRequestDto) {
    return this.apartment.createRequest(workspaceId, dto);
  }

  @WorkspacePermission('requests:create')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF, MemberRole.TECHNICIAN)
  @Patch('requests/:requestId')
  updateRequest(
    @Param('workspaceId') workspaceId: string,
    @Param('requestId') requestId: string,
    @Body() dto: { status?: 'PENDING' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'; priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT' },
  ) {
    return this.apartment.updateRequest(workspaceId, requestId, dto as any);
  }

  @WorkspacePermission('requests:view')
  @Get('requests/:requestId/messages')
  listRequestMessages(@Param('workspaceId') workspaceId: string, @Param('requestId') requestId: string) {
    return this.apartment.listRequestMessages(workspaceId, requestId);
  }

  @WorkspacePermission('requests:create')
  @Post('requests/:requestId/messages')
  addRequestMessage(
    @Param('workspaceId') workspaceId: string,
    @Param('requestId') requestId: string,
    @Req() req: any,
    @Body() dto: { body: string; senderName?: string },
  ) {
    return this.apartment.addRequestMessage(workspaceId, requestId, {
      senderUserId: req.authUserId,
      senderName: dto.senderName,
      body: dto.body,
    });
  }
}