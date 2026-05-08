import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { MailModule } from '../mail/mail.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SmsModule } from '../sms/sms.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [MailModule, PrismaModule, SmsModule, NotificationsModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
