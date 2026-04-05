import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { MemberRole } from '@prisma/client';
import { PropertyService } from './property.service';
import { AuthGuard } from '../auth/auth.guard';
import { WorkspaceAccessGuard } from '../auth/workspace-access.guard';
import { WorkspacePermission } from '../auth/workspace-permission.decorator';
import { WorkspaceRoles } from '../auth/workspace-roles.decorator';

@UseGuards(AuthGuard, WorkspaceAccessGuard)
@Controller('workspaces/:workspaceId/property')
export class PropertyController {
  constructor(private readonly property: PropertyService) {}

  // ── Work Order Stats ─────────────────────────────────────────────────────────

  @WorkspacePermission('requests:view')
  @Get('work-orders/stats')
  getWorkOrderStats(@Param('workspaceId') workspaceId: string) {
    return this.property.getWorkOrderStats(workspaceId);
  }

  // ── Work Orders ──────────────────────────────────────────────────────────────

  @WorkspacePermission('requests:view')
  @Get('work-orders')
  listWorkOrders(
    @Param('workspaceId') workspaceId: string,
    @Query('status') status?: string,
    @Query('estateId') estateId?: string,
    @Query('unitId') unitId?: string,
  ) {
    return this.property.listWorkOrders(workspaceId, status, estateId, unitId);
  }

  @WorkspacePermission('requests:create')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF)
  @Post('work-orders')
  createWorkOrder(@Param('workspaceId') workspaceId: string, @Body() dto: any) {
    return this.property.createWorkOrder(workspaceId, dto);
  }

  @WorkspacePermission('requests:create')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF, MemberRole.TECHNICIAN)
  @Patch('work-orders/:workOrderId')
  updateWorkOrder(
    @Param('workspaceId') workspaceId: string,
    @Param('workOrderId') workOrderId: string,
    @Body() dto: any,
  ) {
    return this.property.updateWorkOrder(workspaceId, workOrderId, dto);
  }

  @WorkspacePermission('requests:view')
  @Get('work-orders/:workOrderId/messages')
  getWorkOrderMessages(
    @Param('workspaceId') workspaceId: string,
    @Param('workOrderId') workOrderId: string,
  ) {
    return this.property.getWorkOrderMessages(workspaceId, workOrderId);
  }

  @WorkspacePermission('requests:create')
  @Post('work-orders/:workOrderId/messages')
  addWorkOrderMessage(
    @Param('workspaceId') workspaceId: string,
    @Param('workOrderId') workOrderId: string,
    @Req() req: any,
    @Body() body: { body: string },
  ) {
    const userId: string = String(req.authUserId || '');
    const userName: string = req.user?.fullName ?? req.user?.email ?? 'Unknown';
    return this.property.addWorkOrderMessage(workspaceId, workOrderId, userId, userName, body.body);
  }

  // ── Property Community ──────────────────────────────────────────────────────

  @WorkspacePermission('notices:view')
  @Get('community/channels')
  listCommunityChannels(@Param('workspaceId') workspaceId: string) {
    return this.property.listCommunityChannels(workspaceId);
  }

  @WorkspacePermission('notices:view')
  @Get('community/channels/:channelId/messages')
  listCommunityMessages(
    @Param('workspaceId') workspaceId: string,
    @Param('channelId') channelId: string,
  ) {
    return this.property.listCommunityMessages(workspaceId, channelId);
  }

  @WorkspacePermission('requests:create')
  @Post('community/channels/:channelId/messages')
  addCommunityMessage(
    @Param('workspaceId') workspaceId: string,
    @Param('channelId') channelId: string,
    @Req() req: any,
    @Body() body: { body: string; isPinned?: boolean },
  ) {
    return this.property.addCommunityMessage(workspaceId, channelId, {
      senderUserId: String(req.authUserId || ''),
      senderName: req.user?.fullName ?? req.user?.email ?? undefined,
      body: body.body,
      isPinned: body.isPinned,
      actorRole: req.workspaceContext?.role,
    });
  }

  // ── Facilities / Amenities ──────────────────────────────────────────────────

  @WorkspacePermission('requests:view')
  @Get('amenities')
  listAmenities(
    @Param('workspaceId') workspaceId: string,
    @Req() req: any,
    @Query('estateId') estateId?: string,
  ) {
    return this.property.listAmenities(workspaceId, {
      estateId,
      actorUserId: req.authUserId,
      actorRole: req.workspaceContext?.role,
    });
  }

  @WorkspacePermission('units:manage')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER)
  @Post('amenities')
  createAmenity(@Param('workspaceId') workspaceId: string, @Body() dto: any) {
    return this.property.createAmenity(workspaceId, dto);
  }

  @WorkspacePermission('units:manage')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER)
  @Patch('amenities/:amenityId')
  updateAmenity(
    @Param('workspaceId') workspaceId: string,
    @Param('amenityId') amenityId: string,
    @Body() dto: any,
  ) {
    return this.property.updateAmenity(workspaceId, amenityId, dto);
  }

  @WorkspacePermission('requests:view')
  @Get('amenity-bookings')
  listAmenityBookings(
    @Param('workspaceId') workspaceId: string,
    @Req() req: any,
    @Query('estateId') estateId?: string,
    @Query('amenityId') amenityId?: string,
    @Query('status') status?: string,
  ) {
    return this.property.listAmenityBookings(workspaceId, {
      estateId,
      amenityId,
      status,
      actorUserId: req.authUserId,
      actorRole: req.workspaceContext?.role,
    });
  }

  @WorkspacePermission('requests:create')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF, MemberRole.RESIDENT)
  @Post('amenity-bookings')
  createAmenityBooking(
    @Param('workspaceId') workspaceId: string,
    @Req() req: any,
    @Body() dto: any,
  ) {
    return this.property.createAmenityBooking(workspaceId, dto, {
      actorUserId: req.authUserId,
      actorRole: req.workspaceContext?.role,
    });
  }

  @WorkspacePermission('requests:create')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF, MemberRole.RESIDENT)
  @Patch('amenity-bookings/:bookingId')
  updateAmenityBooking(
    @Param('workspaceId') workspaceId: string,
    @Param('bookingId') bookingId: string,
    @Req() req: any,
    @Body() dto: any,
  ) {
    return this.property.updateAmenityBooking(workspaceId, bookingId, dto, {
      actorUserId: req.authUserId,
      actorRole: req.workspaceContext?.role,
    });
  }

  // ── Vendors ──────────────────────────────────────────────────────────────────

  @WorkspacePermission('requests:view')
  @Get('vendors')
  listVendors(
    @Param('workspaceId') workspaceId: string,
    @Query('category') category?: string,
  ) {
    return this.property.listVendors(workspaceId, category);
  }

  @WorkspacePermission('requests:create')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER)
  @Post('vendors')
  createVendor(@Param('workspaceId') workspaceId: string, @Body() dto: any) {
    return this.property.createVendor(workspaceId, dto);
  }

  @WorkspacePermission('requests:create')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER)
  @Patch('vendors/:vendorId')
  updateVendor(
    @Param('workspaceId') workspaceId: string,
    @Param('vendorId') vendorId: string,
    @Body() dto: any,
  ) {
    return this.property.updateVendor(workspaceId, vendorId, dto);
  }

  @WorkspacePermission('users:manage')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN)
  @Delete('vendors/:vendorId')
  deleteVendor(
    @Param('workspaceId') workspaceId: string,
    @Param('vendorId') vendorId: string,
  ) {
    return this.property.deleteVendor(workspaceId, vendorId);
  }

  // ── Parcels ──────────────────────────────────────────────────────────────────

  @WorkspacePermission('residents:view')
  @Get('parcels')
  listParcels(
    @Param('workspaceId') workspaceId: string,
    @Query('status') status?: string,
    @Query('residentId') residentId?: string,
    @Query('estateId') estateId?: string,
  ) {
    return this.property.listParcels(workspaceId, status, residentId, estateId);
  }

  @WorkspacePermission('residents:manage')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF)
  @Post('parcels')
  createParcel(@Param('workspaceId') workspaceId: string, @Body() dto: any) {
    return this.property.createParcel(workspaceId, dto);
  }

  @WorkspacePermission('residents:manage')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF)
  @Patch('parcels/:parcelId')
  updateParcel(
    @Param('workspaceId') workspaceId: string,
    @Param('parcelId') parcelId: string,
    @Body() dto: any,
  ) {
    return this.property.updateParcel(workspaceId, parcelId, dto);
  }

  // ── Resident Registry ────────────────────────────────────────────────────────

  @WorkspacePermission('residents:view')
  @Get('registry')
  listResidentRegistry(
    @Param('workspaceId') workspaceId: string,
    @Query('estateId') estateId?: string,
    @Query('residentId') residentId?: string,
  ) {
    return this.property.listResidentRegistry(workspaceId, estateId, residentId);
  }

  @WorkspacePermission('residents:manage')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF)
  @Post('registry/household-members')
  createHouseholdMember(@Param('workspaceId') workspaceId: string, @Body() dto: any) {
    return this.property.createHouseholdMember(workspaceId, dto);
  }

  @WorkspacePermission('residents:manage')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF)
  @Patch('registry/household-members/:memberId')
  updateHouseholdMember(
    @Param('workspaceId') workspaceId: string,
    @Param('memberId') memberId: string,
    @Body() dto: any,
  ) {
    return this.property.updateHouseholdMember(workspaceId, memberId, dto);
  }

  @WorkspacePermission('residents:manage')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF)
  @Delete('registry/household-members/:memberId')
  deleteHouseholdMember(
    @Param('workspaceId') workspaceId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.property.deleteHouseholdMember(workspaceId, memberId);
  }

  @WorkspacePermission('residents:manage')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF)
  @Post('registry/vehicles')
  createVehicle(@Param('workspaceId') workspaceId: string, @Body() dto: any) {
    return this.property.createVehicle(workspaceId, dto);
  }

  @WorkspacePermission('residents:manage')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF)
  @Patch('registry/vehicles/:vehicleId')
  updateVehicle(
    @Param('workspaceId') workspaceId: string,
    @Param('vehicleId') vehicleId: string,
    @Body() dto: any,
  ) {
    return this.property.updateVehicle(workspaceId, vehicleId, dto);
  }

  @WorkspacePermission('residents:manage')
  @WorkspaceRoles(MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF)
  @Delete('registry/vehicles/:vehicleId')
  deleteVehicle(
    @Param('workspaceId') workspaceId: string,
    @Param('vehicleId') vehicleId: string,
  ) {
    return this.property.deleteVehicle(workspaceId, vehicleId);
  }

  // ── Tenant Balance (called from tenant-facing pages) ─────────────────────────

  @WorkspacePermission('requests:view')
  @Get('tenant-balance/:residentId')
  getTenantBalance(
    @Param('workspaceId') workspaceId: string,
    @Param('residentId') residentId: string,
  ) {
    return this.property.getTenantBalance(workspaceId, residentId);
  }
}
