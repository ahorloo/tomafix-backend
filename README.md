## TomaFix Backend

NestJS + Prisma API for TomaFix workspace onboarding, billing, apartment, estate, and office operations.

## Project setup

```bash
$ pnpm install
```

## Compile and run the project

```bash
$ pnpm run start:dev
$ pnpm run build
$ pnpm run start:prod
```

## Run tests

```bash
$ pnpm run test
$ pnpm run test:e2e
```

## Environment files

- Local development template: [`.env.example`](./.env.example)
- Production template: [`.env.production.example`](./.env.production.example)
- Vercel + Render deploy guide: [`docs/DEPLOY_VERCEL_RENDER.md`](./docs/DEPLOY_VERCEL_RENDER.md)

## Billing mode

- Local development should use `PAYSTACK_MODE=test` with `sk_test_...` and `pk_test_...` keys.
- Production should use `PAYSTACK_MODE=live` with `sk_live_...` and `pk_live_...` keys.
- `LOCAL_BYPASS_PAYMENT` must stay `false` anywhere you want real checkout behavior.
- The backend now rejects mismatched Paystack mode and key prefixes at runtime.
- The backend now also fails fast if production uses local billing flags or localhost callback/frontend URLs.
- Non-production environments now reject `PAYSTACK_MODE=live` unless `ALLOW_LIVE_PAYSTACK_IN_DEV=true` is set for a deliberate one-off smoke test.

## Production deploy checklist

1. Copy [`.env.production.example`](./.env.production.example) into your hosting platform's environment variable manager.
2. Replace every placeholder value with a real secret or real URL.
3. Set `PAYSTACK_CALLBACK_URL` to your real frontend success route over HTTPS.
4. Register the backend webhook URL in Paystack: `https://your-api-domain/api/billing/paystack/webhook`
5. Keep `PAYSTACK_MODE=live`, `LOCAL_BYPASS_PAYMENT=false`, and `LOCAL_RELAX_GUARDS=false`.
6. Set a strong `BILLING_ADMIN_KEY` before using billing admin routes.
7. Run `pnpm run build` and `pnpm run start:prod` against the production env.

## Useful commands

```bash
$ pnpm run prisma:generate
$ pnpm run build
$ pnpm run test
$ pnpm run test:e2e
```

## Schema changes — local workflow

`prisma migrate dev` is broken in this repo because two early migrations
(`20260114121829_init` and `20260206102908_init_billing_plan_fields`) both
`CREATE TYPE "TemplateType"`. Shadow-DB replay collides on the second one.
Editing applied migrations would break the `_prisma_migrations` checksum on
production, so we use this workflow instead:

1. Edit `prisma/schema.prisma` with the changes you want.
2. Sync the local dev DB:
   ```bash
   pnpm exec dotenv -e .env -- pnpm exec prisma db push --schema=prisma/schema.prisma
   ```
3. Hand-write a migration SQL file under
   `prisma/migrations/<timestamp>_<name>/migration.sql`. Use `IF NOT EXISTS`
   on every `CREATE TABLE` / `CREATE INDEX` and wrap `CREATE TYPE` in
   `DO $$ ... EXCEPTION WHEN duplicate_object THEN null; END $$` so the
   migration is safely re-runnable. See
   `20260508220000_apartment_health_fixes/migration.sql` for the pattern.
4. Production deploys via `pnpm run prisma:migrate` (which runs
   `prisma migrate deploy`) and applies new files only.

The shadow-DB issue can be permanently fixed later by squashing the two init
migrations into one, but doing that requires resetting prod's
`_prisma_migrations` table and is not safe without coordinated downtime.
