import { TemplateType } from '@prisma/client';
import { PlanName } from '../types/billing';

type PlanLimits = {
  properties: number;
  units: number;
  managers: number;
  residents: number;
  requestsPerMonth: number;
};
type PlanFeatures = {
  blocks: boolean;
  staff: boolean;
  visitors: boolean;
  inspections: boolean;
  assistant: boolean;
  requestTypes: boolean;
  preventiveMaintenance: boolean;
  leaderboard: boolean;
  integrations: boolean;
  publicRequests: boolean;
  advancedReports: boolean;
  exports: boolean;
  prioritySupport: boolean;
  earlyAccess: boolean;
};

type PlanConfig = {
  pricePesewas: number;
  currency: string;
  limits: PlanLimits;
  features: PlanFeatures;
  notes?: string[];
};

export const PLAN_MAP: Record<PlanName, PlanConfig> = {
  Starter: {
    pricePesewas: 9900,
    currency: 'GHS',
    limits: { properties: 1, units: 20, managers: 1, residents: 50, requestsPerMonth: 100 },
    features: {
      blocks: false,
      staff: false,
      visitors: false,
      inspections: false,
      assistant: false,
      requestTypes: false,
      preventiveMaintenance: false,
      leaderboard: false,
      integrations: false,
      publicRequests: false,
      advancedReports: false,
      exports: false,
      prioritySupport: false,
      earlyAccess: false,
    },
    notes: ['Upgrade anytime'],
  },
  Growth: {
    pricePesewas: 19900,
    currency: 'GHS',
    limits: { properties: 3, units: 120, managers: 3, residents: 300, requestsPerMonth: 1000 },
    features: {
      blocks: true,
      staff: true,
      visitors: false,
      inspections: false,
      assistant: false,
      requestTypes: false,
      preventiveMaintenance: false,
      leaderboard: false,
      integrations: false,
      publicRequests: false,
      advancedReports: false,
      exports: false,
      prioritySupport: false,
      earlyAccess: false,
    },
  },
  TomaPrime: {
    pricePesewas: 39900,
    currency: 'GHS',
    limits: { properties: 5, units: 250, managers: 8, residents: 1500, requestsPerMonth: 100000 },
    features: {
      blocks: true,
      staff: true,
      visitors: false,
      inspections: false,
      assistant: false,
      requestTypes: false,
      preventiveMaintenance: false,
      leaderboard: false,
      integrations: false,
      publicRequests: false,
      advancedReports: true,
      exports: true,
      prioritySupport: true,
      earlyAccess: true,
    },
  },
};

const PLAN_ALIASES: Record<string, PlanName> = {
  starter: 'Starter',
  growth: 'Growth',
  tomaprime: 'TomaPrime',
  'toma-prime': 'TomaPrime',
  'toma prime': 'TomaPrime',
};

const TEMPLATE_LIMIT_OVERRIDES: Partial<Record<TemplateType, Record<PlanName, PlanLimits>>> = {
  // APARTMENT: properties = buildings (always 1 per workspace), units = apartment units, managers = staff accounts
  APARTMENT: {
    Starter: { properties: 1, units: 25, managers: 2, residents: 50, requestsPerMonth: 200 },
    Growth: { properties: 1, units: 120, managers: 8, residents: 300, requestsPerMonth: 2000 },
    TomaPrime: { properties: 1, units: 300, managers: 999, residents: 1500, requestsPerMonth: 100000 },
  },
  ESTATE: {
    Starter: { properties: 2, units: 60, managers: 1, residents: 200, requestsPerMonth: 500 },
    Growth: { properties: 6, units: 220, managers: 3, residents: 800, requestsPerMonth: 4000 },
    TomaPrime: { properties: 15, units: 600, managers: 8, residents: 3000, requestsPerMonth: 100000 },
  },
  // OFFICE: properties = number of office locations, units = number of areas/departments
  OFFICE: {
    Starter: { properties: 25, units: 10, managers: 1, residents: 50, requestsPerMonth: 200 },
    Growth: { properties: 150, units: 35, managers: 3, residents: 300, requestsPerMonth: 2000 },
    TomaPrime: { properties: 500, units: 120, managers: 10, residents: 1500, requestsPerMonth: 100000 },
  },
};

const TEMPLATE_PRICE_OVERRIDES: Partial<Record<TemplateType, Record<PlanName, number>>> = {
  ESTATE: {
    Starter: 19900,
    Growth: 34900,
    TomaPrime: 69900,
  },
  OFFICE: {
    Starter: 19900,
    Growth: 34900,
    TomaPrime: 69900,
  },
};

const TEMPLATE_FEATURE_OVERRIDES: Partial<Record<TemplateType, Record<PlanName, Partial<PlanFeatures>>>> = {
  // APARTMENT: gate visitors + inspections at Growth, FixMate AI (assistant) at TomaPrime
  APARTMENT: {
    Starter: {
      staff: false,
      visitors: false,
      inspections: false,
      assistant: false,
      advancedReports: false,
      exports: false,
    },
    Growth: {
      staff: true,
      visitors: true,
      inspections: true,
      assistant: false,
      advancedReports: false,
      exports: false,
    },
    TomaPrime: {
      staff: true,
      visitors: true,
      inspections: true,
      assistant: true,
      advancedReports: true,
      exports: true,
    },
  },
  OFFICE: {
    Starter: {
      staff: true,
      requestTypes: false,
      preventiveMaintenance: false,
      leaderboard: false,
      integrations: false,
      publicRequests: false,
      advancedReports: false,
      exports: false,
      prioritySupport: false,
      earlyAccess: false,
    },
    Growth: {
      staff: true,
      requestTypes: true,
      preventiveMaintenance: true,
      leaderboard: true,
      integrations: true,
      publicRequests: true,
      advancedReports: true,
      exports: true,
      prioritySupport: false,
      earlyAccess: false,
    },
    TomaPrime: {
      staff: true,
      requestTypes: true,
      preventiveMaintenance: true,
      leaderboard: true,
      integrations: true,
      publicRequests: true,
      advancedReports: true,
      exports: true,
      prioritySupport: true,
      earlyAccess: true,
    },
  },
};

export function resolvePlanName(input?: string | null): PlanName {
  const raw = String(input || '').trim();
  if (!raw) return 'Starter';

  if (Object.prototype.hasOwnProperty.call(PLAN_MAP, raw)) {
    return raw as PlanName;
  }

  const key = raw.toLowerCase();
  if (PLAN_ALIASES[key]) return PLAN_ALIASES[key];

  throw new Error(`Unknown plan: ${input}`);
}

export function assertPlanExists(planName: string): asserts planName is PlanName {
  resolvePlanName(planName);
}

export function getEntitlements(planName: PlanName, templateType?: TemplateType) {
  const base = PLAN_MAP[planName];
  const override = templateType ? TEMPLATE_LIMIT_OVERRIDES[templateType]?.[planName] : undefined;
  const priceOverride = templateType ? TEMPLATE_PRICE_OVERRIDES[templateType]?.[planName] : undefined;
  const featureOverride = templateType ? TEMPLATE_FEATURE_OVERRIDES[templateType]?.[planName] : undefined;

  if (!override && !featureOverride && !priceOverride) return base;

  return {
    ...base,
    pricePesewas: priceOverride ?? base.pricePesewas,
    limits: override ?? base.limits,
    features: featureOverride ? { ...base.features, ...featureOverride } : base.features,
  };
}

// Layer per-workspace overrides on top of plan/template entitlements.
// Admins set these via AdminFeatureFlags; they're stored on
// Workspace.permissionPolicy.entitlementOverrides.
export function applyWorkspaceOverrides(
  entitlements: ReturnType<typeof getEntitlements>,
  overrides?: { features?: Record<string, boolean>; limits?: Record<string, number> } | null,
) {
  if (!overrides) return entitlements;
  const features = { ...entitlements.features } as Record<string, boolean>;
  const limits = { ...entitlements.limits } as Record<string, number>;
  if (overrides.features) {
    for (const [k, v] of Object.entries(overrides.features)) {
      if (typeof v === 'boolean' && k in features) features[k] = v;
    }
  }
  if (overrides.limits) {
    for (const [k, v] of Object.entries(overrides.limits)) {
      if (typeof v === 'number' && k in limits) limits[k] = v;
    }
  }
  return { ...entitlements, features: features as typeof entitlements.features, limits: limits as typeof entitlements.limits };
}
