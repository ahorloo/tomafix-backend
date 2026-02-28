import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthService } from './auth.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();

    const authHeader = req.headers?.authorization;
    if (!authHeader) return false;

    const payload = this.auth.verifyBearerToken(authHeader);
    req.authUserId = payload.uid;
    return true;
  }
}
