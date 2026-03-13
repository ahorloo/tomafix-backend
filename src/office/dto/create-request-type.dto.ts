import { OfficeRequestCategory } from '@prisma/client';

export class CreateOfficeRequestTypeDto {
  label: string;
  baseCategory?: OfficeRequestCategory;
  slaHours?: number;
}
