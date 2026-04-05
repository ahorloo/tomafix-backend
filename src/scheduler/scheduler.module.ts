import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { MailModule } from '../mail/mail.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SmsModule } from '../sms/sms.module';

@Module({
  imports: [MailModule, PrismaModule, SmsModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
