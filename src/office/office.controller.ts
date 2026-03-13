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
import { MemberRole, RequestPriority, RequestStatus } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { WorkspaceAccessGuard } from '../auth/workspace-access.guard';
import { WorkspaceRoles } from '../auth/workspace-roles.decorator';
import { WorkspacePermission } from '../auth/workspace-permission.decorator';
import { OfficeService } from './office.service';
import { CreateAreaDto } from './dto/create-area.dto';
import { CreateOfficeRequestDto } from './dto/create-request.dto';
import { CreateWorkOrderDto } from './dto/create-work-order.dto';
import { CreateAssetDto } from './dto/create-asset.dto';

@UseGuards(AuthGuard, WorkspaceAccessGuard)
@Controller('workspaces/:workspaceId/office')
export class OfficeController {
  constructor(private readonly office: OfficeService) {}

  // ─── Dashboard ─────────────────────────────────────────────────────────────
  @WorkspacePermission('dashboard:view')
  @Get('dashboard')
  getDashboard(@Param('workspaceId') workspaceId: string) {
    return this.office.getDashboard(workspaceId);
  }

  // ─── Areas ─────────────────────────────────────────────────────────────────
  @WorkspacePermission('units:view')
  @Get('areas')
  listAreas(@Param('workspaceId') workspaceId: string) {
    return this.office.listAreas(workspaceId);
  }

  @WorkspacePermission('units:manage')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER)
  @Post('areas')
  createArea(@Param('workspaceId') workspaceId: string, @Body() dto: CreateAreaDto) {
    return this.office.createArea(workspaceId, dto);
  }

  @WorkspacePermission('units:manage')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER)
  @Patch('areas/:areaId')
  updateArea(
    @Param('workspaceId') workspaceId: string,
    @Param('areaId') areaId: string,
    @Body() dto: Partial<CreateAreaDto>,
  ) {
    return this.office.updateArea(workspaceId, areaId, dto);
  }

  @WorkspacePermission('units:manage')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER)
  @Delete('areas/:areaId')
  deleteArea(@Param('workspaceId') workspaceId: string, @Param('areaId') areaId: string) {
    return this.office.deleteArea(workspaceId, areaId);
  }

  // ─── Requests ───────────────────────────────────────────────────────────────
  @WorkspacePermission('requests:view')
  @Get('requests')
  listRequests(
    @Param('workspaceId') workspaceId: string,
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('areaId') areaId?: string,
    @Query('escalated') escalated?: string,
  ) {
    return this.office.listRequests(workspaceId, { status, category, areaId, escalated });
  }

  @WorkspacePermission('requests:view')
  @Get('requests/:requestId')
  getRequest(
    @Param('workspaceId') workspaceId: string,
    @Param('requestId') requestId: string,
  ) {
    return this.office.getRequest(workspaceId, requestId);
  }

  @WorkspacePermission('requests:create')
  @WorkspaceRoles(
    MemberRole.OWNER_ADMIN,
    MemberRole.MANAGER,
    MemberRole.STAFF,
    MemberRole.TECHNICIAN,
  )
  @Post('requests')
  createRequest(
    @Param('workspaceId') workspaceId: string,
    @Req() req: any,
    @Body() dto: CreateOfficeRequestDto,
  ) {
    return this.office.createRequest(workspaceId, dto, req.authUserId);
  }

  @WorkspacePermission('requests:create')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.TECHNICIAN)
  @Patch('requests/:requestId')
  updateRequest(
    @Param('workspaceId') workspaceId: string,
    @Param('requestId') requestId: string,
    @Body()
    dto: {
      status?: RequestStatus;
      priority?: RequestPriority;
      workOrderId?: string;
      slaDeadline?: string;
    },
  ) {
    return this.office.updateRequest(workspaceId, requestId, dto);
  }

  // ─── Request Messages ───────────────────────────────────────────────────────
  @WorkspacePermission('requests:view')
  @Get('requests/:requestId/messages')
  listRequestMessages(
    @Param('workspaceId') workspaceId: string,
    @Param('requestId') requestId: string,
  ) {
    return this.office.listRequestMessages(workspaceId, requestId);
  }

  @WorkspacePermission('requests:create')
  @Post('requests/:requestId/messages')
  addRequestMessage(
    @Param('workspaceId') workspaceId: string,
    @Param('requestId') requestId: string,
    @Req() req: any,
    @Body() dto: { body: string; senderName?: string },
  ) {
    return this.office.addRequestMessage(workspaceId, requestId, {
      senderUserId: req.authUserId,
      senderName: dto.senderName,
      body: dto.body,
    });
  }

  // ─── Work Orders ────────────────────────────────────────────────────────────
  @WorkspacePermission('requests:view')
  @Get('work-orders')
  listWorkOrders(
    @Param('workspaceId') workspaceId: string,
    @Query('status') status?: string,
    @Query('assignedToUserId') assignedToUserId?: string,
  ) {
    return this.office.listWorkOrders(workspaceId, { status, assignedToUserId });
  }

  @WorkspacePermission('requests:create')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER)
  @Post('work-orders')
  createWorkOrder(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: CreateWorkOrderDto,
  ) {
    return this.office.createWorkOrder(workspaceId, dto);
  }

  @WorkspacePermission('requests:create')
  @WorkspaceRoles(
    MemberRole.OWNER_ADMIN,
    MemberRole.MANAGER,
    MemberRole.TECHNICIAN,
  )
  @Patch('work-orders/:workOrderId')
  updateWorkOrder(
    @Param('workspaceId') workspaceId: string,
    @Param('workOrderId') workOrderId: string,
    @Body()
    dto: {
      status?: string;
      priority?: RequestPriority;
      assignedToUserId?: string;
      completionNote?: string;
      proofPhotoUrl?: string;
    },
  ) {
    return this.office.updateWorkOrder(workspaceId, workOrderId, dto);
  }

  // ─── Assets ─────────────────────────────────────────────────────────────────
  @WorkspacePermission('units:view')
  @Get('assets')
  listAssets(
    @Param('workspaceId') workspaceId: string,
    @Query('status') status?: string,
  ) {
    return this.office.listAssets(workspaceId, { status });
  }

  @WorkspacePermission('units:manage')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER)
  @Post('assets')
  createAsset(@Param('workspaceId') workspaceId: string, @Body() dto: CreateAssetDto) {
    return this.office.createAsset(workspaceId, dto);
  }

  @WorkspacePermission('units:manage')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER)
  @Patch('assets/:assetId')
  updateAsset(
    @Param('workspaceId') workspaceId: string,
    @Param('assetId') assetId: string,
    @Body() dto: Partial<CreateAssetDto> & { status?: string },
  ) {
    return this.office.updateAsset(workspaceId, assetId, dto);
  }

  @WorkspacePermission('units:manage')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER)
  @Delete('assets/:assetId')
  deleteAsset(@Param('workspaceId') workspaceId: string, @Param('assetId') assetId: string) {
    return this.office.deleteAsset(workspaceId, assetId);
  }
}
