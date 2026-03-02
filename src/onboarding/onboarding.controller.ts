import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';

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

  @Get('invites')
  listInvites(@Query('workspaceId') workspaceId: string) {
    return this.onboarding.listTenantInvites(workspaceId);
  }

  @Post('invites/create')
  createInvite(@Body() dto: CreateInviteDto) {
    return this.onboarding.createTenantInvite(dto);
  }

  @Post('invites/resend')
  resendInvite(@Body() dto: ResendInviteDto) {
    return this.onboarding.resendTenantInvite(dto);
  }

  @Post('invites/revoke')
  revokeInvite(@Body() dto: RevokeInviteDto) {
    return this.onboarding.revokeTenantInvite(dto);
  }

  @Post('invites/accept')
  acceptInvite(@Body() dto: AcceptInviteDto) {
    return this.onboarding.acceptTenantInvite(dto);
  }

  @Post('invites/bulk/preview')
  previewBulkInvites(@Body() dto: BulkInviteDto) {
    return this.onboarding.previewBulkTenantInvites(dto);
  }

  @Post('invites/bulk/commit')
  commitBulkInvites(@Body() dto: BulkInviteDto) {
    return this.onboarding.commitBulkTenantInvites(dto);
  }
}