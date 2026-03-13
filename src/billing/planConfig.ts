import { TemplateType } from '@prisma/client';
import { PlanName } from '../types/billing';

type PlanLimits = { properties: number; units: number };
type PlanFeatures = {
  blocks: boolean;
  staff: boolean;
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
    limits: { properties: 1, units: 20 },
    features: {
      blocks: false,
      staff: false,
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
    limits: { properties: 3, units: 120 },
    features: {
      blocks: true,
      staff: true,
      advancedReports: false,
      exports: false,
      prioritySupport: false,
      earlyAccess: false,
    },
  },
  TomaPrime: {
    pricePesewas: 39900,
    currency: 'GHS',
    limits: { properties: 5, units: 250 },
    features: {
      blocks: true,
      staff: true,
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
  ESTATE: {
    Starter: { properties: 2, units: 60 },
    Growth: { properties: 6, units: 220 },
    TomaPrime: { properties: 15, units: 600 },
  },
  // OFFICE: properties = number of office locations, units = number of areas/departments
  OFFICE: {
    Starter: { properties: 1, units: 10 },
    Growth: { properties: 3, units: 50 },
    TomaPrime: { properties: 10, units: 200 },
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
  if (!override) return base;
  return { ...base, limits: override };
}
