import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BillingStatus, MemberRole, WorkspaceStatus } from '@prisma/client';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { WORKSPACE_ROLES_KEY } from './workspace-roles.decorator';
import { hasPermission, PermissionKey } from './permissions';
import { WORKSPACE_PERMISSION_KEY } from './workspace-permission.decorator';

@Injectable()
export class WorkspaceAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  private isBillingRoute(path: string) {
    return /\/billing\//.test(path);
  }

  private isLockedStatus(status?: WorkspaceStatus | string) {
    return status === WorkspaceStatus.PENDING_PAYMENT || status === WorkspaceStatus.SUSPENDED;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const userId: string | undefined = req.authUserId;
    const workspaceId: string | undefined = req.params?.workspaceId;
    if (!workspaceId) return false;
    if (!userId) return false;

    const allowedRoles = this.reflector.getAllAndOverride<MemberRole[]>(WORKSPACE_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const permission = this.reflector.getAllAndOverride<PermissionKey>(WORKSPACE_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const membership = await this.auth.assertWorkspaceAccess(userId, workspaceId, allowedRoles);

    const path = `${req.baseUrl || ''}${req.path || ''}`.replace(/\\/g, '/');
    const workspace: any = membership.workspace || {};
    const renewalAt = workspace?.nextRenewal ? new Date(workspace.nextRenewal) : null;
    const shouldExpireForBilling =
      !!renewalAt &&
      Number.isFinite(renewalAt.getTime()) &&
      renewalAt.getTime() <= Date.now() &&
      workspace.status === WorkspaceStatus.ACTIVE;

    if (shouldExpireForBilling) {
      const updated = await this.prisma.workspace.update({
        where: { id: workspaceId },
        data: {
          status: WorkspaceStatus.PENDING_PAYMENT,
          billingStatus:
            workspace.billingStatus === BillingStatus.CANCELLED
              ? BillingStatus.CANCELLED
              : BillingStatus.PAST_DUE,
        },
        select: { status: true, billingStatus: true, nextRenewal: true },
      });

      workspace.status = updated.status;
      workspace.billingStatus = updated.billingStatus;
      workspace.nextRenewal = updated.nextRenewal;
    }

    if (this.isLockedStatus(workspace.status) && !this.isBillingRoute(path)) {
      return false;
    }

    if (
      permission &&
      !hasPermission(
        membership.workspace.templateType,
        membership.role,
        permission,
        (membership.workspace as any).permissionPolicy || null,
      )
    ) {
      return false;
    }

    req.workspaceContext = membership;
    return true;
  }
}
