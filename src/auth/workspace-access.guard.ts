import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MemberRole } from '@prisma/client';
import { AuthService } from './auth.service';
import { WORKSPACE_ROLES_KEY } from './workspace-roles.decorator';

@Injectable()
export class WorkspaceAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const userId: string | undefined = req.authUserId;
    const workspaceId: string | undefined = req.params?.workspaceId;
    const strict = String(process.env.AUTH_STRICT || '').toLowerCase() === 'true';

    if (!workspaceId) return false;
    if (!userId) return !strict;

    const allowedRoles = this.reflector.getAllAndOverride<MemberRole[]>(WORKSPACE_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    await this.auth.assertWorkspaceAccess(userId, workspaceId, allowedRoles);
    return true;
  }
}
