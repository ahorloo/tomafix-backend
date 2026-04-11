import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { TemplateType } from '@prisma/client';

export class CreateWorkspaceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  workspaceName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  ownerFullName!: string;

  @IsEmail()
  ownerEmail!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  ownerPhone?: string;

  @IsEnum(TemplateType)
  templateType!: TemplateType;
}
