import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TemplateType } from '@prisma/client';
import { cacheGet, cacheSet, cacheBust, cacheStats } from './cache';
import { getEntitlements, assertPlanExists, PLAN_MAP, applyWorkspaceOverrides } from './planConfig';
import { EntitlementsPayload, PlanName, mapWorkspaceStatusToBillingStatus } from '../types/billing';

const ENTITLEMENTS_TTL_MS = 3 * 60 * 1000; // 3 minutes

@Injectable()
export class BillingDomainService {
  constructor(private readonly prisma: PrismaService) {}

  async getWorkspaceEntitlements(workspaceId: string): Promise<EntitlementsPayload> {
    const cacheKey = `billing:entitlements:${workspaceId}`;
    const hit = cacheGet<EntitlementsPayload>(cacheKey);
    if (hit) return hit;

    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!ws) throw new NotFoundException('Workspace not found');

    const planName = (ws as any).planName || 'Starter';
    assertPlanExists(planName);

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const [propertiesUsed, unitsUsed, managersUsed, residentsUsed, requestsThisMonthUsed] = await Promise.all([
      ws.templateType === TemplateType.ESTATE
        ? this.prisma.estate.count({ where: { workspaceId } })
        : ws.templateType === TemplateType.OFFICE
          ? this.prisma.officeAsset.count({ where: { workspaceId } })
          : Promise.resolve(1),
      ws.templateType === TemplateType.ESTATE
        ? this.prisma.estateUnit.count({ where: { workspaceId } })
        : ws.templateType === TemplateType.OFFICE
          ? this.prisma.officeArea.count({ where: { workspaceId } })
          : this.prisma.apartmentUnit.count({ where: { workspaceId } }),
      this.prisma.workspaceMember.count({
        where: { workspaceId, isActive: true, role: 'MANAGER' as any },
      }),
      ws.templateType === TemplateType.ESTATE
        ? this.prisma.estateResident.count({ where: { workspaceId } })
        : ws.templateType === TemplateType.APARTMENT
          ? this.prisma.apartmentResident.count({ where: { workspaceId } })
          : Promise.resolve(0),
      ws.templateType === TemplateType.ESTATE
        ? this.prisma.estateRequest.count({ where: { workspaceId, createdAt: { gte: monthStart } } })
        : ws.templateType === TemplateType.APARTMENT
          ? this.prisma.apartmentRequest.count({ where: { workspaceId, createdAt: { gte: monthStart } } })
          : ws.templateType === TemplateType.OFFICE
            ? this.prisma.officeRequest.count({ where: { workspaceId, createdAt: { gte: monthStart } } })
            : Promise.resolve(0),
    ]);

    const baseEntitlements = getEntitlements(planName, ws.templateType);
    const overrides = ((ws as any).permissionPolicy as any)?.entitlementOverrides ?? null;
    const plan = applyWorkspaceOverrides(baseEntitlements, overrides);

    // Surface "over-cap" resources so the UI can show what to clean up after a
    // downgrade. Cap is hard at create-time (guards.ts blocks new creates) but
    // existing rows are grandfathered.
    const overCap = {
      properties: propertiesUsed > plan.limits.properties,
      units: unitsUsed > plan.limits.units,
      managers: managersUsed > plan.limits.managers,
      residents: residentsUsed > plan.limits.residents,
      requestsPerMonth: requestsThisMonthUsed > plan.limits.requestsPerMonth,
    };

    const payload: EntitlementsPayload = {
      planName,
      limits: plan.limits,
      usage: { propertiesUsed, unitsUsed, managersUsed, residentsUsed, requestsThisMonthUsed },
      features: plan.features,
      overCap,
      billingStatus: (ws as any).billingStatus || mapWorkspaceStatusToBillingStatus(ws.status),
      nextRenewal: (ws as any).nextRenewal ?? null,
      currency: plan.currency,
      amount: plan.pricePesewas,
      notes: plan.notes,
    };

    cacheSet(cacheKey, payload, ENTITLEMENTS_TTL_MS);
    return payload;
  }

  async bustWorkspaceCache(workspaceId: string) {
    cacheBust(`billing:entitlements:${workspaceId}`);
  }

  async health() {
    const webhook = await this.prisma.webhookEvent.findFirst({
      where: { provider: 'PAYSTACK' },
      orderBy: { receivedAt: 'desc' },
      select: { receivedAt: true },
    });
    return {
      cache: cacheStats(),
      webhookLastSeenAt: webhook?.receivedAt ?? null,
    };
  }
}
