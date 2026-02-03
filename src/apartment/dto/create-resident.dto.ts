import { ResidentRole, ResidentStatus } from '@prisma/client';
import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateResidentDto {
  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  unitId?: string;

  @IsOptional()
  @IsEnum(ResidentRole)
  role?: ResidentRole;

  @IsOptional()
  @IsEnum(ResidentStatus)
  status?: ResidentStatus;
}