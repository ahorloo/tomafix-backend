import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { MemberRole } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { WorkspaceAccessGuard } from '../auth/workspace-access.guard';
import { WorkspaceRoles } from '../auth/workspace-roles.decorator';
import { AiService } from './ai.service';

@UseGuards(AuthGuard, WorkspaceAccessGuard)
@Controller('workspaces/:workspaceId/ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  // Resident-facing: turn a freeform message into a clean draft request.
  // Throttled per-IP to keep AI cost bounded.
  @WorkspaceRoles(MemberRole.RESIDENT, MemberRole.OWNER_ADMIN, MemberRole.MANAGER, MemberRole.STAFF)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post('draft-request')
  draftRequest(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: { message: string },
  ) {
    return this.ai.draftResidentRequest(workspaceId, dto?.message || '');
  }
}
