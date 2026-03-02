import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { AuthGuard } from '../auth/auth.guard';

type SendOtpDto = {
  workspaceId: string;
  email: string;
};

type VerifyOtpDto = {
  workspaceId: string;
  email: string;
  code: string;
};

type CreateInviteDto = {
  workspaceId: string;
  email: string;
  residentName?: string;
};

type AcceptInviteDto = {
  token: string;
  email: string;
  fullName?: string;
};

type BulkInviteRowDto = {
  fullName?: string;
  email?: string;
  phone?: string;
  unitLabel?: string;
  block?: string;
  floor?: string;
};

type BulkInviteDto = {
  workspaceId: string;
  rows: BulkInviteRowDto[];
};

type ResendInviteDto = {
  workspaceId: string;
  inviteId: string;
  residentName?: string;
};

type RevokeInviteDto = {
  workspaceId: string;
  inviteId: string;
};

@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Post('workspaces')
  createWorkspace(@Body() dto: CreateWorkspaceDto) {
    return this.onboarding.createWorkspace(dto);
  }

  // Step 2: send OTP
  @Post('otp/send')
  sendOtp(@Body() dto: SendOtpDto) {
    return this.onboarding.sendOtpEmail(dto);
  }

  // Step 2: verify OTP -> move workspace to PENDING_PAYMENT
  @Post('otp/verify')
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.onboarding.verifyOtpEmail(dto);
  }

  @UseGuards(AuthGuard)
  @Get('invites')
  listInvites(@Query('workspaceId') workspaceId: string, @Req() req: any) {
    return this.onboarding.listTenantInvites(workspaceId, req?.authUserId);
  }

  @UseGuards(AuthGuard)
  @Post('invites/create')
  createInvite(@Body() dto: CreateInviteDto, @Req() req: any) {
    return this.onboarding.createTenantInvite(dto, req?.authUserId);
  }

  @UseGuards(AuthGuard)
  @Post('invites/resend')
  resendInvite(@Body() dto: ResendInviteDto, @Req() req: any) {
    return this.onboarding.resendTenantInvite(dto, req?.authUserId);
  }

  @UseGuards(AuthGuard)
  @Post('invites/revoke')
  revokeInvite(@Body() dto: RevokeInviteDto, @Req() req: any) {
    return this.onboarding.revokeTenantInvite(dto, req?.authUserId);
  }

  @Post('invites/accept')
  acceptInvite(@Body() dto: AcceptInviteDto) {
    return this.onboarding.acceptTenantInvite(dto);
  }

  @UseGuards(AuthGuard)
  @Post('invites/bulk/preview')
  previewBulkInvites(@Body() dto: BulkInviteDto, @Req() req: any) {
    return this.onboarding.previewBulkTenantInvites(dto, req?.authUserId);
  }

  @UseGuards(AuthGuard)
  @Post('invites/bulk/commit')
  commitBulkInvites(@Body() dto: BulkInviteDto, @Req() req: any) {
    return this.onboarding.commitBulkTenantInvites(dto, req?.authUserId);
  }
}