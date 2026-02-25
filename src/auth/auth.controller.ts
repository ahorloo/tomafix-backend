import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SendLoginOtpDto } from './dto/send-login-otp.dto';
import { VerifyLoginOtpDto } from './dto/verify-login-otp.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login/otp/send')
  sendLoginOtp(@Body() dto: SendLoginOtpDto) {
    return this.auth.sendLoginOtp(dto.email);
  }

  @Post('login/otp/verify')
  verifyLoginOtp(@Body() dto: VerifyLoginOtpDto) {
    return this.auth.verifyLoginOtp(dto.email, dto.code);
  }

  @Get('me')
  async me(@Headers('authorization') authorization?: string) {
    const payload = this.auth.verifyBearerToken(authorization);
    return this.auth.me(payload.uid);
  }

  @Get('memberships')
  async memberships(@Headers('authorization') authorization?: string) {
    const payload = this.auth.verifyBearerToken(authorization);
    const me = await this.auth.me(payload.uid);
    return { memberships: me.memberships };
  }
}
