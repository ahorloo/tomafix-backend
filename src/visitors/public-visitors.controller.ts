import { Controller, Get, Param } from '@nestjs/common';
import { VisitorsService } from './visitors.service';

/** No auth — anyone with the token URL can view the pass details. */
@Controller('public/visitor-pass')
export class PublicVisitorsController {
  constructor(private readonly visitors: VisitorsService) {}

  @Get(':token')
  getPass(@Param('token') token: string) {
    // Strip full URL in case someone passes the whole href
    const qrToken = token.includes('/visitor-pass/')
      ? token.split('/visitor-pass/').pop()!
      : token;
    return this.visitors.getVisitorByToken(qrToken);
  }
}
