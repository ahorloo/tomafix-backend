import { IsString, IsNotEmpty } from 'class-validator';

export class ScanVisitorDto {
  @IsString()
  @IsNotEmpty()
  qrToken!: string;
}
