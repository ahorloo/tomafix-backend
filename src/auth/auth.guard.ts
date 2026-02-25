import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthService } from './auth.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const strict = String(process.env.AUTH_STRICT || '').toLowerCase() === 'true';

    const authHeader = req.headers?.authorization;
    if (!authHeader) {
      if (strict) return false;
      return true;
    }

    const payload = this.auth.verifyBearerToken(authHeader);
    req.authUserId = payload.uid;
    return true;
  }
}
