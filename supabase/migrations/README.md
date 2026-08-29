# Migrations — numbering & workflow

Timestamped, append-only SQL migrations applied in filename order by `supabase db push` (prod) and `supabase db reset` (local + CI).

## Numbering (read this before adding a migration)

**Number every new migration off the *highest existing version on the latest `main`* — never off your branch's stale base.** Two files with the same version number is a hard failure: `supabase db reset` aborts with `duplicate key value violates unique constraint "schema_migrations_pkey"`, which reds the `DB security` CI job and blocks prod deploys.

```bash
# 1. sync main and find the current highest version
git checkout main && git pull
ls supabase/migrations/*.sql | sed -E 's#.*/([0-9]+)_.*#\1#' | sort | tail -1
# 2. your new file = that number + 1, e.g. 20260826000027_my_change.sql

# before opening a PR, prove there are no duplicate numbers:
ls supabase/migrations/*.sql | sed -E 's#.*/([0-9]+)_.*#\1#' | sort | uniq -d   # must print nothing
```

If two branches race and collide, the LATER one renumbers (a `git mv` to the next free number) — and if it redefines a function the earlier one also changed (e.g. `enforce_payment_request_insert`), it must be layered ON TOP of the earlier version, not a stale copy.

## Deploy checklist (a migration is not "done" at merge)

Merging to `main` deploys the **web code** (Vercel) but **not** the database. If the code calls new DB objects, prod errors until the migration is applied:

```bash
supabase migration list --linked   # any row with a blank Remote column is UNDEPLOYED
supabase db push --linked          # applies pending migrations to prod
```

So: renumber-safe → CI green → **deploy to prod** → done.

## Conventions

- One logical change per file; idempotent DDL (`create ... if not exists`, `create or replace`) so replays are clean.
- SECURITY DEFINER functions set `search_path = ''` and fully-qualify (`public.`).
- Guard predicates are NULL-safe (`coalesce(is_org_admin(org), false)`), never a bare nullable scalar in `not (...)`.
- Add/extend assertions in `supabase/tests/rls_security.sql` (and siblings) for anything security- or money-affecting; CI runs every `supabase/tests/*.sql`.
