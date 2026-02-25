import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class VerifyLoginOtpDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  code!: string;
}
