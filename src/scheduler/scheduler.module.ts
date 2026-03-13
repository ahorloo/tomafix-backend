import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { MailModule } from '../mail/mail.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [MailModule, PrismaModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
