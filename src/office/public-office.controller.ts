import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { OfficeService } from './office.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('public/workspaces/:workspaceId/office')
export class PublicOfficeController {
  constructor(
    private readonly office: OfficeService,
    private readonly prisma: PrismaService,
  ) {}

  // Get workspace info + areas for public request form
  @Get('info')
  async getPublicInfo(@Param('workspaceId') workspaceId: string) {
    const ws = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, name: true, templateType: true, status: true },
    });
    if (!ws || ws.templateType !== 'OFFICE' || ws.status !== 'ACTIVE') {
      throw new NotFoundException('Workspace not available');
    }
    const areas = await this.prisma.officeArea.findMany({
      where: { workspaceId },
      select: { id: true, name: true, type: true, floor: true },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
    return { workspace: { id: ws.id, name: ws.name }, areas };
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
