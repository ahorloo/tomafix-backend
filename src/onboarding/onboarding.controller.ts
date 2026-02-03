import { Body, Controller, Post } from '@nestjs/common';
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
}