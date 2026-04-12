# Vercel + Render Deployment

This repo is already shaped for:

- Frontend on Vercel
- Backend on Render
- Paystack live billing in production

## Production URLs

Replace these with your real domains:

- Frontend: `https://app.tomafix.com`
- Backend: `https://tomafix-api.onrender.com`

## Backend on Render

Use [`.env.production.example`](../.env.production.example) as the base.

Set these values in the Render web service:

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://...
FRONTEND_URL=https://app.tomafix.com
APP_BASE_URL=https://app.tomafix.com
CORS_ORIGINS=https://app.tomafix.com,https://www.tomafix.com,https://admin.tomafix.com
AUTH_TOKEN_SECRET=replace-with-a-long-random-secret
BILLING_ADMIN_KEY=replace-with-a-long-random-admin-key
PAYSTACK_MODE=live
PAYSTACK_SECRET_KEY=sk_live_...
PAYSTACK_PUBLIC_KEY=pk_live_...
PAYSTACK_CALLBACK_URL=https://app.tomafix.com/onboarding/payment-success
PAYSTACK_CURRENCY_OVERRIDE=GHS
PAYSTACK_OMIT_CURRENCY=false
ALLOW_LIVE_PAYSTACK_IN_DEV=false
RESEND_API_KEY=replace-with-your-resend-key
RESEND_FROM=TomaFix <billing@tomafix.com>
EMAIL_FROM=TomaFix <billing@tomafix.com>
EMAIL_LOGO_URL=https://www.tomafix.com/bimi-logo-preview.jpg
LOCAL_BYPASS_PAYMENT=false
LOCAL_RELAX_GUARDS=false
BILLING_DUNNING_INTERVAL_MIN=60
```

Recommended Render service settings:

- Runtime: `Node`
- Build command: `pnpm install --frozen-lockfile && pnpm run build`
- Start command: `pnpm run start:prod`

## Frontend on Vercel

Use [`.env.production.example`](../../tomafix-frontend/.env.production.example) as the base.

Set this in the Vercel project:

```env
VITE_API_URL=https://tomafix-api.onrender.com
```

That makes the frontend call:

- `https://tomafix-api.onrender.com/api/v1/...`

## Paystack wiring

In Paystack dashboard:

- Callback URL:
  `https://app.tomafix.com/onboarding/payment-success`
- Webhook URL:
  `https://tomafix-api.onrender.com/api/v1/billing/paystack/webhook`

Do not use test keys in production. The backend now rejects:

- `PAYSTACK_MODE=live` with `sk_test_...`
- `PAYSTACK_MODE=test` with `sk_live_...`
- `LOCAL_BYPASS_PAYMENT=true` in production
- `LOCAL_RELAX_GUARDS=true` in production
- localhost/private callback or frontend URLs in production

## Sanity check after deploy

1. Open the frontend and start onboarding.
2. Verify OTP.
3. Confirm the workspace moves to payment, not straight to active.
4. Start checkout and confirm Paystack opens.
5. Complete a live payment on production or a test payment on local.
6. Confirm the callback returns to `/onboarding/payment-success`.
7. Confirm backend webhook marks the payment paid and activates the workspace.

## Local vs production split

- Local backend: `PAYSTACK_MODE=test`
- Local keys: `sk_test_...` and `pk_test_...`
- Production backend: `PAYSTACK_MODE=live`
- Production keys: `sk_live_...` and `pk_live_...`

Keep `LOCAL_BYPASS_PAYMENT=false` in any environment where you want real billing behavior.
