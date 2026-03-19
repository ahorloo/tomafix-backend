import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { MarketplaceService } from './marketplace.service';
import type { CreateTechnicianApplicationDto } from './marketplace.service';

@Controller('marketplace')
export class MarketplaceController {
  constructor(private readonly marketplace: MarketplaceService) {}

  @Get('technicians')
  listApprovedTechnicians() {
    return this.marketplace.listApprovedTechnicians();
  }

  @Get('technicians/:slug')
  getApprovedTechnician(@Param('slug') slug: string) {
    return this.marketplace.getApprovedTechnicianBySlug(slug);
  }

  @Post('technician-applications')
  @HttpCode(HttpStatus.CREATED)
  createTechnicianApplication(@Body() dto: CreateTechnicianApplicationDto) {
    return this.marketplace.createTechnicianApplication(dto);
  }
}
