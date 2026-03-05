# Template Domain Cutover / Shared-Table Deprecation Plan

## Current state

- Template-separated domain tables exist and are active for runtime reads/writes:
  - Apartment: `ApartmentUnit`, `ApartmentResident`, `ApartmentRequest`
  - Estate: `EstateUnit`, `EstateResident`, `EstateRequest`
- Shared legacy tables still exist:
  - `Unit`, `Resident`, `Request`
- Blockers still attached to shared tables:
  - `RequestMessage -> Request`
  - `Inspection -> Unit`

## Safety checks

Run before any destructive migration:

```bash
pnpm run cutover:verify
pnpm run cutover:readiness
```

## Drop readiness requirements

1. Zero mismatches between shared and template-specific counts.
2. `RequestMessage` migrated to template-specific request message tables.
3. `Inspection` migrated to template-specific unit references (or independent scope tables).
4. No backend code paths rely on shared `Unit/Resident/Request` for APARTMENT/ESTATE runtime.

## Proposed final sequence

1. Add `ApartmentRequestMessage` / `EstateRequestMessage` + backfill.
2. Add `ApartmentInspection` / `EstateInspection` (or equivalent) + backfill.
3. Switch runtime to template message/inspection tables.
4. Freeze shared writes.
5. Observe for a full cycle.
6. Archive shared tables (`Unit`, `Resident`, `Request`) then drop.
