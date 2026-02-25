import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApartmentService } from './apartment.service';
import { CreateUnitDto } from './dto/create-unit.dto';
import { CreateResidentDto } from './dto/create-resident.dto';
import { CreateRequestDto } from './dto/create-request.dto';

// If main.ts sets global prefix 'api', these become:
// /api/workspaces/:workspaceId/apartment/...
@Controller('workspaces/:workspaceId/apartment')
export class ApartmentController {
  constructor(private readonly apartment: ApartmentService) {}

  @Get('dashboard')
  getDashboard(@Param('workspaceId') workspaceId: string) {
    return this.apartment.getDashboard(workspaceId);
  }

  // Units
  @Get('units')
  listUnits(@Param('workspaceId') workspaceId: string) {
    return this.apartment.listUnits(workspaceId);
  }

  @Post('units')
  createUnit(@Param('workspaceId') workspaceId: string, @Body() dto: CreateUnitDto) {
    return this.apartment.createUnit(workspaceId, dto);
  }

  @Patch('units/:unitId')
  updateUnit(
    @Param('workspaceId') workspaceId: string,
    @Param('unitId') unitId: string,
    @Body() dto: Partial<CreateUnitDto>,
  ) {
    return this.apartment.updateUnit(workspaceId, unitId, dto);
  }

  @Delete('units/:unitId')
  deleteUnit(@Param('workspaceId') workspaceId: string, @Param('unitId') unitId: string) {
    return this.apartment.deleteUnit(workspaceId, unitId);
  }

  // Residents
  @Get('residents')
  listResidents(@Param('workspaceId') workspaceId: string) {
    return this.apartment.listResidents(workspaceId);
  }

  @Post('residents')
  createResident(@Param('workspaceId') workspaceId: string, @Body() dto: CreateResidentDto) {
    return this.apartment.createResident(workspaceId, dto);
  }

  @Patch('residents/:residentId')
  updateResident(
    @Param('workspaceId') workspaceId: string,
    @Param('residentId') residentId: string,
    @Body() dto: Partial<CreateResidentDto>,
  ) {
    return this.apartment.updateResident(workspaceId, residentId, dto);
  }

  @Delete('residents/:residentId')
  deleteResident(@Param('workspaceId') workspaceId: string, @Param('residentId') residentId: string) {
    return this.apartment.deleteResident(workspaceId, residentId);
  }

  // Requests
  @Get('requests')
  listRequests(@Param('workspaceId') workspaceId: string, @Query('status') status?: string) {
    return this.apartment.listRequests(workspaceId, status);
  }

  @Post('requests')
  createRequest(@Param('workspaceId') workspaceId: string, @Body() dto: CreateRequestDto) {
    return this.apartment.createRequest(workspaceId, dto);
  }
}