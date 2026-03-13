import { PLAN_MAP } from '../../src/billing/planConfig';

describe('PLAN_MAP snapshot', () => {
  it('matches expected config', () => {
    expect(PLAN_MAP).toEqual({
      Starter: {
        pricePesewas: 9900,
        currency: 'GHS',
        limits: {
          properties: 1,
          units: 20,
        },
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
        limits: {
          properties: 3,
          units: 120,
        },
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
        limits: {
          properties: 5,
          units: 250,
        },
        features: {
          blocks: true,
          staff: true,
          advancedReports: true,
          exports: true,
          prioritySupport: true,
          earlyAccess: true,
        },
      },
    });
  });
});
