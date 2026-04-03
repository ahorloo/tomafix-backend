import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NestMiddleware,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { cacheGet, cacheSet } from './cache';
import { FeatureKey, GatedErrorPayload, LimitKey, PlanName } from '../types/billing';
import { getEntitlements, assertPlanExists } from './planConfig';
import { TemplateType } from '@prisma/client';

type GuardedMutation = {
  limit?: LimitKey;
  feature?: FeatureKey;
};

type GuardRule = GuardedMutation & { method: string; pattern: RegExp };

// Map mutate endpoints (regex on full path)
const GUARDED: GuardRule[] = [
  { method: 'POST', pattern: /^\/workspaces\/[^/]+\/apartment\/estates$/, limit: 'properties' },
  { method: 'POST', pattern: /^\/workspaces\/[^/]+\/apartment\/units$/, limit: 'units' },
  { method: 'POST', pattern: /^\/workspaces\/[^/]+\/apartment\/residents$/, feature: 'staff' },
  { method: 'POST', pattern: /^\/workspaces\/[^/]+\/office\/areas$/, limit: 'units' },
  { method: 'POST', pattern: /^\/workspaces\/[^/]+\/office\/assets$/, limit: 'properties' },
  { method: 'POST', pattern: /^\/workspaces\/[^/]+\/apartment\/reports\/advanced$/, feature: 'advancedReports' },
  { method: 'POST', pattern: /^\/workspaces\/[^/]+\/apartment\/exports$/, feature: 'exports' },
];

@Injectable()
export class EntitlementsGuard implements NestMiddleware {
  private readonly logger = new Logger(EntitlementsGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const path = (req.baseUrl + req.path).replace(/\\/g, '/');
    const rule = GUARDED.find((r) => r.method === req.method && r.pattern.test(path));
    if (!rule) return next();

    const workspaceId = req.params.workspaceId;
    if (!workspaceId) throw new BadRequestException('workspaceId is required');

    const cacheKey = `billing:entitlements:${workspaceId}`;
    const cached = cacheGet<{ planName: PlanName; templateType: TemplateType; usage: { propertiesUsed: number; unitsUsed: number; managersUsed: number } }>(cacheKey);
    const entitlements = cached || (await this.computeAndCache(workspaceId, cacheKey));

    const { limits, features } = getEntitlements(entitlements.planName, entitlements.templateType as TemplateType);

    if (rule.limit) {
      const used = entitlements.usage[`${rule.limit}Used` as const];
      const limit = limits[rule.limit];
      if (used >= limit) {
        return this.denyLimit(workspaceId, entitlements.planName, rule.limit, limit, used);
      }
    }

    if (rule.feature && !features[rule.feature]) {
      return this.denyFeature(workspaceId, entitlements.planName, rule.feature);
    }

    return next();
  }

  private async computeAndCache(workspaceId: string, cacheKey: string) {
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!ws) throw new BadRequestException('Workspace not found');

    const planName = (ws as any).planName || 'Starter';
    assertPlanExists(planName);

    const [propertiesUsed, unitsUsed, managersUsed] = await Promise.all([
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
    ]);

    const value = { planName, templateType: ws.templateType, usage: { propertiesUsed, unitsUsed, managersUsed } };
    cacheSet(cacheKey, value, 3 * 60 * 1000);
    return value;
  }

  private denyLimit(
    workspaceId: string,
    planName: PlanName,
    limit: LimitKey,
    limitValue: number,
    used: number,
  ) {
    const payload: GatedErrorPayload = {
      code: 'LIMIT_EXCEEDED',
      requiredPlan: this.nextPlan(planName),
      message: `Over ${planName} ${limit} limit (${used}/${limitValue}). Remove items or upgrade.`,
      context: { limit },
    };
    this.logger.warn({ workspaceId, planName, limit, used, limitValue, at: new Date().toISOString() });
    throw new ForbiddenException(payload as any);
  }

  private denyFeature(workspaceId: string, planName: PlanName, feature: FeatureKey) {
    const payload: GatedErrorPayload = {
      code: 'FEATURE_LOCKED',
      requiredPlan: this.nextPlan(planName),
      message: `${feature} is not available on ${planName}. Upgrade to unlock.`,
      context: { feature },
    };
    this.logger.warn({ workspaceId, planName, feature, at: new Date().toISOString() });
    throw new ForbiddenException(payload as any);
  }

  private nextPlan(plan: PlanName): PlanName {
    if (plan === 'Starter') return 'Growth';
    if (plan === 'Growth') return 'TomaPrime';
    return 'TomaPrime';
  }
}
