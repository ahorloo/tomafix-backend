import { Body, Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { MarketplaceService } from './marketplace.service';
import type { CreateTechnicianApplicationDto } from './marketplace.service';

@Controller('marketplace')
export class MarketplaceController {
  constructor(private readonly marketplace: MarketplaceService) {}

  @Post('technician-applications')
  @HttpCode(HttpStatus.CREATED)
  createTechnicianApplication(@Body() dto: CreateTechnicianApplicationDto) {
    return this.marketplace.createTechnicianApplication(dto);
  }
}
