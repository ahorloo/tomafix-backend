import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ApartmentController } from './apartment.controller';
import { ApartmentService } from './apartment.service';

@Module({
  imports: [PrismaModule],
  controllers: [ApartmentController],
  providers: [ApartmentService],
})
export class ApartmentModule {}