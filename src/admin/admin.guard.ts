import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';

export const ADMIN_ROLES_KEY = 'adminRoles';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) throw new UnauthorizedException('Admin token required');

    const session = await this.prisma.adminSession.findUnique({
      where: { token },
      include: { admin: true },
    });

    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Admin session expired or invalid');
    }

    if (!session.admin.isActive) {
      throw new ForbiddenException('Admin account is inactive');
    }

    req.adminUser = session.admin;

    // Check role restriction if decorator used
    const requiredRoles: string[] = this.reflector.get(ADMIN_ROLES_KEY, context.getHandler()) || [];
    if (requiredRoles.length && session.admin.role !== 'SUPER_ADMIN' && !requiredRoles.includes(session.admin.role)) {
      throw new ForbiddenException(`Requires one of: ${requiredRoles.join(', ')}`);
    }

    return true;
  }
}
