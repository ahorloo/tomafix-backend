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
