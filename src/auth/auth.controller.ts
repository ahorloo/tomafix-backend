import { Body, Controller, Delete, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PasskeyService } from './passkey.service';
import { SendLoginOtpDto } from './dto/send-login-otp.dto';
import { VerifyLoginOtpDto } from './dto/verify-login-otp.dto';
import { AuthGuard } from './auth.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly passkey: PasskeyService,
  ) {}

  // ── Email OTP login ────────────────────────────────────────────────────

  @Post('login/otp/send')
  sendLoginOtp(@Body() dto: SendLoginOtpDto) {
    return this.auth.sendLoginOtp(dto.email);
  }

  @Post('login/otp/verify')
  verifyLoginOtp(@Body() dto: VerifyLoginOtpDto) {
    return this.auth.verifyLoginOtp(dto.email, dto.code);
  }

  // ── Passkey: Register (must be logged in) ─────────────────────────────

  @Post('passkey/register/options')
  passkeyRegisterOptions(@Headers('authorization') authorization?: string) {
    const payload = this.auth.verifyBearerToken(authorization);
    return this.passkey.getRegistrationOptions(payload.uid);
  }

  @Post('passkey/register/verify')
  passkeyRegisterVerify(
    @Headers('authorization') authorization?: string,
    @Body() body: { credential: any; deviceName?: string } = { credential: null },
  ) {
    const payload = this.auth.verifyBearerToken(authorization);
    return this.passkey.confirmRegistration(payload.uid, body.credential, body.deviceName);
  }

  // ── Passkey: Login (no auth needed) ───────────────────────────────────

  @Post('passkey/authenticate/options')
  passkeyAuthOptions() {
    return this.passkey.getAuthenticationOptions();
  }

  @Post('passkey/authenticate/verify')
  passkeyAuthVerify(@Body() body: { credential: any }) {
    return this.passkey.confirmAuthentication(body.credential);
  }

  // ── Passkey: Manage (must be logged in) ───────────────────────────────

  @Get('passkeys')
  listPasskeys(@Headers('authorization') authorization?: string) {
    const payload = this.auth.verifyBearerToken(authorization);
    return this.passkey.listPasskeys(payload.uid);
  }

  @Delete('passkeys/:id')
  removePasskey(
    @Headers('authorization') authorization?: string,
    @Param('id') id?: string,
  ) {
    const payload = this.auth.verifyBearerToken(authorization);
    return this.passkey.removePasskey(payload.uid, id!);
  }

  // ── Profile ────────────────────────────────────────────────────────────

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

  @UseGuards(AuthGuard)
  @Post('sessions/revoke-all')
  revokeAll(@Req() req: any) {
    return this.auth.revokeAllSessions(req.authUserId);
  }
}
