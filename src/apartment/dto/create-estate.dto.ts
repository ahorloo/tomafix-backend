import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateEstateDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  locationMapsUrl?: string | null;

  @IsOptional()
  @IsNumber()
  locationLatitude?: number | null;

  @IsOptional()
  @IsNumber()
  locationLongitude?: number | null;
}
