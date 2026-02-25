import { IsEmail } from 'class-validator';

export class SendLoginOtpDto {
  @IsEmail()
  email!: string;
}
