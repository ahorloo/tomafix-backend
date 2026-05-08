import { Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { WorkspaceAccessGuard } from '../auth/workspace-access.guard';
import { NotificationsService } from './notifications.service';

@UseGuards(AuthGuard, WorkspaceAccessGuard)
@Controller('workspaces/:workspaceId/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @Param('workspaceId') workspaceId: string,
    @Req() req: any,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('limit') limit?: string,
  ) {
    return this.notifications.listForUser(workspaceId, String(req.authUserId), {
      unreadOnly: String(unreadOnly || '').toLowerCase() === 'true',
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('unread-count')
  unread(@Param('workspaceId') workspaceId: string, @Req() req: any) {
    return this.notifications
      .unreadCount(workspaceId, String(req.authUserId))
      .then((count) => ({ count }));
  }

  @Patch(':id/read')
  markRead(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Req() req: any,
  ) {
    return this.notifications.markRead(workspaceId, String(req.authUserId), id);
  }

  @Patch('read-all')
  markAllRead(@Param('workspaceId') workspaceId: string, @Req() req: any) {
    return this.notifications.markAllRead(workspaceId, String(req.authUserId));
  }
}
