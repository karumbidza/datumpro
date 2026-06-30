# DatumPro

Universal project management with **remote monitoring** and a real **finance module** (budgets, invoices, proof-of-payment, Paynow collection, variations). First vertical: **construction**. By **Grafaid Engineers**.

> Multi-tenant SaaS. One backend, two clients: an offline-first **mobile field app** (Expo) and a **web dashboard** (Next.js), over **Supabase** (Postgres + RLS + Storage + Auth).

## Monorepo layout

```
apps/web        → Next.js (App Router) dashboard — office & finance        (Vercel)
apps/mobile     → Expo (React Native) field app — offline capture          (PowerSync ↔ Supabase)
packages/shared → domain types, roles & permissions, zod validation, auth interface
supabase/       → Postgres migrations + Row-Level Security policies
docs/           → architecture decisions
```

## Stack

| Concern | Choice |
|---|---|
| Web | Next.js 15 (App Router) on Vercel |
| Mobile | Expo / React Native, offline-first |
| DB / Auth / Storage | Supabase (Postgres, RLS, Supabase Auth) |
| Offline sync | PowerSync (Postgres ↔ on-device SQLite) — *mobile slice* |
| Background jobs | Inngest (Paynow polling, reminders, escalations) — *finance slice* |
| Email / SMS | Resend · Africa's Talking |
| Payments | Paynow (USD) — *finance slice* |
| Errors | Sentry |

## Getting started

```bash
pnpm install
cp .env.example .env            # fill in Supabase + provider keys

# local database
pnpm db:start                   # boots local Supabase (Docker)
pnpm db:reset                   # applies migrations in supabase/migrations
pnpm db:types                   # regenerate typed DB schema into packages/shared

# run the web app
pnpm --filter @datumpro/web dev
```

## Conventions

- **Money is integer USD cents** everywhere — never floats.
- **Authorization lives in `packages/shared/access`** (single source of truth); the DB enforces *tenant isolation* via RLS, the app enforces *capability* via permissions.
- **Auth is used only through `@datumpro/shared/auth`** so enterprise SSO can drop in later.
- Apps depend on `@datumpro/shared`; the shared package depends on nothing framework-specific.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the why behind these.
