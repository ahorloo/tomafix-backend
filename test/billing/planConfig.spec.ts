import { PLAN_MAP } from '../../src/billing/planConfig';

describe('PLAN_MAP snapshot', () => {
  it('matches expected config', () => {
    expect(PLAN_MAP).toMatchInlineSnapshot(`
      {
        "Starter": {
          "currency": "GHS",
          "features": {
            "advancedReports": false,
            "blocks": false,
            "earlyAccess": false,
            "exports": false,
            "prioritySupport": false,
            "staff": false,
          },
          "limits": {
            "properties": 1,
            "units": 20,
          },
          "notes": [
            "Upgrade anytime",
          ],
          "pricePesewas": 7900,
        },
        "Growth": {
          "currency": "GHS",
          "features": {
            "advancedReports": false,
            "blocks": true,
            "earlyAccess": false,
            "exports": false,
            "prioritySupport": false,
            "staff": true,
          },
          "limits": {
            "properties": 3,
            "units": 120,
          },
          "pricePesewas": 14900,
        },
        "TomaPrime": {
          "currency": "GHS",
          "features": {
            "advancedReports": true,
            "blocks": true,
            "earlyAccess": true,
            "exports": true,
            "prioritySupport": true,
            "staff": true,
          },
          "limits": {
            "properties": 5,
            "units": 250,
          },
          "pricePesewas": 29900,
        },
      }
    `);
  });
});
