import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateTechnicianApplicationDto {
  businessName: string;
  contactPerson: string;
  phone: string;
  whatsapp: string;
  email: string;
  businessAddress: string;
  serviceAreas: string;
  categories: string[];
  yearsInOperation?: string;
  teamSize?: string;
  bio?: string;
  website?: string;
  latitude: number;
  longitude: number;
}

@Injectable()
export class MarketplaceService {
  constructor(private readonly prisma: PrismaService) {}

  async createTechnicianApplication(dto: CreateTechnicianApplicationDto) {
    if (!dto.businessName?.trim()) throw new BadRequestException('Business name is required');
    if (!dto.email?.trim()) throw new BadRequestException('Email is required');
    if (!dto.categories?.length) throw new BadRequestException('At least one category is required');
    if (dto.latitude == null || dto.longitude == null) throw new BadRequestException('Location is required');

    return this.prisma.technicianApplication.create({
      data: {
        businessName: dto.businessName.trim(),
        contactPerson: dto.contactPerson.trim(),
        phone: dto.phone.trim(),
        whatsapp: dto.whatsapp.trim(),
        email: dto.email.trim().toLowerCase(),
        businessAddress: dto.businessAddress.trim(),
        serviceAreas: dto.serviceAreas.trim(),
        categories: dto.categories,
        yearsInOperation: dto.yearsInOperation?.trim() || null,
        teamSize: dto.teamSize?.trim() || null,
        bio: dto.bio?.trim() || null,
        website: dto.website?.trim() || null,
        latitude: dto.latitude,
        longitude: dto.longitude,
      },
      select: {
        id: true,
        businessName: true,
        status: true,
        createdAt: true,
      },
    });
  }
}
