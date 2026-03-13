import { OfficeRequestCategory, RequestPriority } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class CreateWorkOrderDto {
  @IsOptional()
  @IsString()
  areaId?: string;

  @IsOptional()
  @IsString()
  assetId?: string;

  @IsOptional()
  @IsString()
  assignedToUserId?: string;

  @IsOptional()
  @IsEnum(OfficeRequestCategory)
  category?: OfficeRequestCategory;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(RequestPriority)
  priority?: RequestPriority;

  @IsOptional()
  @IsString()
  slaDeadline?: string;
}
