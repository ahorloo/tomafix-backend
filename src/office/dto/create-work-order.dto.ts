import { OfficeRequestCategory, RequestPriority } from '@prisma/client';

export class CreateWorkOrderDto {
  areaId?: string;
  assetId?: string;
  assignedToUserId?: string;
  category?: OfficeRequestCategory;
  title: string;
  description?: string;
  priority?: RequestPriority;
  slaDeadline?: string;
}
