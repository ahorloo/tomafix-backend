import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

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
}
