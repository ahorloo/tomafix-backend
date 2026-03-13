import { OfficeRequestCategory, RequestPriority } from '@prisma/client';

export class CreateOfficeRequestDto {
  areaId: string;
  category?: OfficeRequestCategory;
  requestTypeId?: string;
  title: string;
  description?: string;
  photoUrl?: string;
  priority?: RequestPriority;
  submitterName?: string;
}
