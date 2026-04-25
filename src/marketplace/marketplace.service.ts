import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

export interface CreateTechnicianApplicationDto {
  businessName: string;
  contactPerson: string;
  phone: string;
  whatsapp: string;
  email: string;
  businessAddress: string;
  businessLocationUrl?: string;
  serviceAreas: string;
  serviceAreaLinks?: string[];
  serviceAreaLocations?: Array<{ name: string; latitude: number; longitude: number }>;
  categories: string[];
  yearsInOperation?: string;
  teamSize?: string;
  bio?: string;
  website?: string;
  logoUrl?: string;
  latitude: number;
  longitude: number;
}

export interface PublicTechnicianBusinessDto {
  slug: string;
  name: string;
  headline: string;
  categories: string[];
  baseLocation: string;
  latitude: number;
  longitude: number;
  serviceAreas: string[];
  phone: string;
  whatsapp: string;
  email: string;
  website?: string | null;
  logoUrl?: string | null;
  yearsInBusiness: number;
  teamSize: string;
  availability: string;
  responseTime: string;
  description: string;
  verificationNote: string;
}

@Injectable()
export class MarketplaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async listApprovedTechnicians(): Promise<PublicTechnicianBusinessDto[]> {
    const rows = await this.prisma.technicianApplication.findMany({
      where: { status: 'APPROVED' },
      orderBy: { updatedAt: 'desc' },
    });

    return rows.map((row) => this.toPublicBusiness(row));
  }

  async getApprovedTechnicianBySlug(slug: string): Promise<PublicTechnicianBusinessDto> {
    const id = this.extractApplicationId(slug);
    const row = await this.prisma.technicianApplication.findFirst({
      where: { id, status: 'APPROVED' },
    });

    if (!row) throw new NotFoundException('Technician business not found');
    return this.toPublicBusiness(row);
  }

  async createTechnicianApplication(dto: CreateTechnicianApplicationDto) {
    if (!dto.businessName?.trim()) throw new BadRequestException('Business name is required');
    if (!dto.email?.trim()) throw new BadRequestException('Email is required');
    if (!dto.categories?.length) throw new BadRequestException('At least one category is required');
    if (dto.latitude == null || dto.longitude == null) throw new BadRequestException('Location is required');

    // Business location URL is still required — it proves where the business is based.
    if (!dto.businessLocationUrl?.trim()) throw new BadRequestException('Google Maps business location URL is required');
    const isMapsUrl = (url: string) => /^https?:\/\/.+/i.test(url) && /(google\.|maps\.app\.goo\.gl|goo\.gl)/i.test(url);
    if (!isMapsUrl(dto.businessLocationUrl.trim())) {
      throw new BadRequestException('Business location must be a valid Google Maps URL');
    }

    // Service area links are now OPTIONAL — technicians can just type area names.
    // If links are provided, validate them but don't block on partial failures.
    const validatedServiceAreaLinks = (dto.serviceAreaLinks || []).filter((u) => isMapsUrl(String(u).trim()));

    const created = await this.prisma.technicianApplication.create({
      data: {
        businessName: dto.businessName.trim(),
        contactPerson: dto.contactPerson.trim(),
        phone: dto.phone.trim(),
        whatsapp: dto.whatsapp.trim(),
        email: dto.email.trim().toLowerCase(),
        businessAddress: dto.businessAddress.trim(),
        businessLocationUrl: dto.businessLocationUrl?.trim() || null,
        serviceAreas: (dto.serviceAreas || '').trim() || dto.businessAddress.trim(),
        serviceAreaLinks: validatedServiceAreaLinks,
        serviceAreaLocations: (dto.serviceAreaLocations?.length ? dto.serviceAreaLocations : null) as any,
        categories: dto.categories,
        yearsInOperation: dto.yearsInOperation?.trim() || null,
        teamSize: dto.teamSize?.trim() || null,
        bio: dto.bio?.trim() || null,
        website: dto.website?.trim() || null,
        logoUrl: dto.logoUrl?.trim() || null,
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

    // Notify admin about the new application (fire-and-forget)
    const adminEmail = this.config.get<string>('ADMIN_NOTIFY_EMAIL');
    if (adminEmail) {
      this.mail.sendNewTechnicianApplication(adminEmail, {
        businessName: dto.businessName.trim(),
        contactPerson: dto.contactPerson.trim(),
        email: dto.email.trim(),
        phone: dto.phone.trim(),
        serviceAreas: (dto.serviceAreas || '').trim() || dto.businessAddress.trim(),
        categories: dto.categories,
        applicationId: created.id,
      }).catch(() => {});
    }

    return created;
  }

  private toPublicBusiness(row: {
    id: string;
    businessName: string;
    phone: string;
    whatsapp: string;
    email: string;
    website: string | null;
    logoUrl?: string | null;
    categories: string[];
    businessAddress: string;
    serviceAreas: string;
    yearsInOperation: string | null;
    teamSize: string | null;
    bio: string | null;
    latitude: number;
    longitude: number;
    reviewNote: string | null;
  }): PublicTechnicianBusinessDto {
    const serviceAreas = row.serviceAreas
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const headlineCategories = row.categories.slice(0, 2).join(' and ');
    const areaLabel = serviceAreas[0] || row.businessAddress;

    return {
      slug: `${row.id}--${this.slugify(row.businessName)}`,
      name: row.businessName,
      headline: `${headlineCategories || 'Technician'} support serving ${areaLabel}.`,
      categories: row.categories,
      baseLocation: row.businessAddress,
      latitude: row.latitude,
      longitude: row.longitude,
      serviceAreas,
      phone: row.phone,
      whatsapp: row.whatsapp,
      email: row.email,
      website: row.website,
      logoUrl: row.logoUrl ?? null,
      yearsInBusiness: Number.parseInt(row.yearsInOperation || '', 10) || 0,
      teamSize: row.teamSize || 'Business team',
      availability: 'Contact for availability',
      responseTime: 'Response time shared after contact',
      description:
        row.bio?.trim() ||
        `${row.businessName} is an approved TomaFix technician business serving ${serviceAreas.join(', ') || row.businessAddress}.`,
      verificationNote: row.reviewNote?.trim() || 'Approved by TomaFix',
    };
  }

  private extractApplicationId(slug: string) {
    return String(slug || '').split('--')[0]?.trim();
  }

  private slugify(value: string) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
