import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();

    const authHeader = req.headers?.authorization;
    if (!authHeader) {
      const nodeEnv = (process.env.NODE_ENV || '').toLowerCase();
      const relaxGuardsForLocal =
        nodeEnv !== 'production' && String(process.env.LOCAL_RELAX_GUARDS || '').toLowerCase() === 'true';

      if (!relaxGuardsForLocal) return false;

      const workspaceId = String(req.params?.workspaceId || '').trim();
      if (!workspaceId) return false;

      const ws = await this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { ownerUserId: true },
      });

      if (!ws?.ownerUserId) return false;
      req.authUserId = ws.ownerUserId;
      return true;
    }

    const payload = this.auth.verifyBearerToken(authHeader);
    await this.auth.assertTokenNotRevoked(payload.uid, payload.iat);
    req.authUserId = payload.uid;
    return true;
  }
}
