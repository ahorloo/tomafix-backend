import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateAssetDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  serialNo?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  lastServicedAt?: string;

  @IsOptional()
  @IsString()
  nextServiceAt?: string;

  @IsOptional()
  @IsNumber()
  pmIntervalDays?: number;

  @IsOptional()
  @IsBoolean()
  pmAutoCreate?: boolean;

  @IsOptional()
  @IsNumber()
  costPerService?: number;
}
