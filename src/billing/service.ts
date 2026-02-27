import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { cacheGet, cacheSet, cacheBust, cacheStats } from './cache';
import { getEntitlements, assertPlanExists, PLAN_MAP } from './planConfig';
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

    const [propertiesUsed, unitsUsed] = await Promise.all([
      this.prisma.property.count({ where: { workspaceId } }),
      this.prisma.unit.count({ where: { workspaceId } }),
    ]);

    const plan = getEntitlements(planName);

    const payload: EntitlementsPayload = {
      planName,
      limits: plan.limits,
      usage: { propertiesUsed, unitsUsed },
      features: plan.features,
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
