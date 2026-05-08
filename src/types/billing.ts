import { WorkspaceStatus } from '@prisma/client';

export type PlanName = 'Starter' | 'Growth' | 'TomaPrime';

export type BillingStatus =
  | 'PENDING_PAYMENT'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'SUSPENDED'
  | 'CANCELLED';

export type FeatureKey =
  | 'blocks'
  | 'staff'
  | 'visitors'
  | 'inspections'
  | 'assistant'
  | 'requestTypes'
  | 'preventiveMaintenance'
  | 'leaderboard'
  | 'integrations'
  | 'publicRequests'
  | 'advancedReports'
  | 'exports'
  | 'prioritySupport'
  | 'earlyAccess';

export type LimitKey = 'properties' | 'units' | 'managers' | 'residents' | 'requestsPerMonth';

export type FeatureFlags = Record<FeatureKey, boolean>;

export interface EntitlementLimits {
  properties: number;
  units: number;
  managers: number;
  residents: number;
  requestsPerMonth: number;
}

export interface EntitlementUsage {
  propertiesUsed: number;
  unitsUsed: number;
  managersUsed: number;
  residentsUsed: number;
  requestsThisMonthUsed: number;
}

export interface EntitlementsPayload {
  planName: PlanName;
  limits: EntitlementLimits;
  usage: EntitlementUsage;
  features: FeatureFlags;
  billingStatus: BillingStatus;
  nextRenewal?: string | null;
  currency: string;
  amount: number; // pesewas
  notes?: string[];
  // Per-resource flags that flip true when a workspace is over its plan cap
  // after a downgrade. Existing rows are grandfathered; new creates are blocked
  // by the entitlements guard.
  overCap?: {
    properties: boolean;
    units: boolean;
    managers: boolean;
    residents: boolean;
    requestsPerMonth: boolean;
  };
}

export type GatedErrorPayload = {
  code: 'LIMIT_EXCEEDED' | 'FEATURE_LOCKED';
  requiredPlan: PlanName;
  message: string;
  context?: { limit?: LimitKey; feature?: FeatureKey };
};

export const mapWorkspaceStatusToBillingStatus = (
  status: WorkspaceStatus,
): BillingStatus => {
  switch (status) {
    case WorkspaceStatus.PENDING_PAYMENT:
      return 'PENDING_PAYMENT';
    case WorkspaceStatus.SUSPENDED:
      return 'SUSPENDED';
    default:
      return 'ACTIVE';
  }
};
