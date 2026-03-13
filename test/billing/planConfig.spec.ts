import { TemplateType } from '@prisma/client';
import { PLAN_MAP, getEntitlements } from '../../src/billing/planConfig';

describe('PLAN_MAP snapshot', () => {
  it('matches expected config', () => {
    expect(PLAN_MAP).toEqual({
      Starter: {
        pricePesewas: 9900,
        currency: 'GHS',
        limits: {
          properties: 1,
          units: 20,
          managers: 1,
        },
        features: {
          blocks: false,
          staff: false,
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
        limits: {
          properties: 3,
          units: 120,
          managers: 3,
        },
        features: {
          blocks: true,
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
      },
      TomaPrime: {
        pricePesewas: 39900,
        currency: 'GHS',
        limits: {
          properties: 5,
          units: 250,
          managers: 8,
        },
        features: {
          blocks: true,
          staff: true,
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
    });
  });

  it('applies office-specific price overrides', () => {
    expect(getEntitlements('Starter', TemplateType.OFFICE).pricePesewas).toBe(14900);
    expect(getEntitlements('Growth', TemplateType.OFFICE).pricePesewas).toBe(34900);
    expect(getEntitlements('TomaPrime', TemplateType.OFFICE).pricePesewas).toBe(69900);
  });

  it('applies office-specific manager limits', () => {
    expect(getEntitlements('Starter', TemplateType.OFFICE).limits.managers).toBe(1);
    expect(getEntitlements('Growth', TemplateType.OFFICE).limits.managers).toBe(3);
    expect(getEntitlements('TomaPrime', TemplateType.OFFICE).limits.managers).toBe(10);
  });
});
