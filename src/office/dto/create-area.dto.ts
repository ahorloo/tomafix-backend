import { OfficeAreaType } from '@prisma/client';

export class CreateAreaDto {
  name: string;
  type?: OfficeAreaType;
  floor?: string;
  description?: string;
}
