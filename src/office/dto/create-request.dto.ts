import { OfficeRequestCategory, RequestPriority } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class CreateOfficeRequestDto {
  @IsString()
  areaId!: string;

  @IsOptional()
  @IsEnum(OfficeRequestCategory)
  category?: OfficeRequestCategory;

  @IsOptional()
  @IsString()
  requestTypeId?: string;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  photoUrl?: string;

  @IsOptional()
  @IsEnum(RequestPriority)
  priority?: RequestPriority;

  @IsOptional()
  @IsString()
  submitterName?: string;
}
