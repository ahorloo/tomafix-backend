export class CreateAssetDto {
  name: string;
  category?: string;
  serialNo?: string;
  location?: string;
  notes?: string;
  lastServicedAt?: string;
  nextServiceAt?: string;
}
