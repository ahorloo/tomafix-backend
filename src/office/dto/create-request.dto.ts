import { OfficeRequestCategory, RequestPriority } from '@prisma/client';

export class CreateOfficeRequestDto {
  areaId: string;
  category?: OfficeRequestCategory;
  title: string;
  description?: string;
  photoUrl?: string;
  priority?: RequestPriority;
  submitterName?: string;
}
