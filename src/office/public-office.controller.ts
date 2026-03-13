import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { OfficeService } from './office.service';

@Controller('public/workspaces/:workspaceId/office')
export class PublicOfficeController {
  constructor(private readonly office: OfficeService) {}

  // Get workspace info + areas for public request form
  @Get('info')
  async getPublicInfo(@Param('workspaceId') workspaceId: string) {
    return this.office.getPublicWorkspaceInfo(workspaceId);
  }

  // Submit a public request (no auth required)
  @Post('requests')
  submitPublicRequest(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: { areaId: string; title: string; description?: string; submitterName?: string; category?: string },
  ) {
    return this.office.createPublicRequest(workspaceId, dto);
  }
}
