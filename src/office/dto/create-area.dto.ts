import { OfficeAreaType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateAreaDto {
  @IsString()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsEnum(OfficeAreaType)
  type?: OfficeAreaType;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  floor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  ownerUserId?: string;
}
