import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthService } from './auth.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();

    const authHeader = req.headers?.authorization;
    if (!authHeader) return false;

    const payload = this.auth.verifyBearerToken(authHeader);
    await this.auth.assertTokenNotRevoked(payload.uid, payload.iat);
    req.authUserId = payload.uid;
    return true;
  }
}
