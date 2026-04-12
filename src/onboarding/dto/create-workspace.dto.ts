import { IsEmail, IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
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

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  ownerPhone!: string;

  @IsEnum(TemplateType)
  templateType!: TemplateType;
}
