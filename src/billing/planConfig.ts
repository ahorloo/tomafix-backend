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
    pricePesewas: 7900,
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
    pricePesewas: 14900,
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
    pricePesewas: 29900,
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

export function assertPlanExists(planName: string): asserts planName is PlanName {
  if (!planName || !Object.prototype.hasOwnProperty.call(PLAN_MAP, planName)) {
    throw new Error(`Unknown plan: ${planName}`);
  }
}

export function getEntitlements(planName: PlanName) {
  return PLAN_MAP[planName];
}
