# Runbook — Database backups & restore drill

DatumPro's data (accounts, projects, tenders, payments, the audit trail) lives in
**Supabase Postgres**. Backups protect against accidental deletion, a bad
migration, or corruption. A backup you have never restored is a *hope*, not a
backup — so this runbook covers both **enabling** protection and **rehearsing** a
restore. **These are Supabase-dashboard / project actions; they can't be done from
the app.**

---

## What the options are

- **Daily backups** — Supabase takes automated daily snapshots. Restore
  granularity is one day; you lose up to ~24h of data on restore. On by default on
  paid plans.
- **Point-in-Time Recovery (PITR)** — continuous backup of the write-ahead log so
  you can restore to *any second* within the retention window (e.g. 7 days). This
  is what you want for a production system holding financial records: a bad
  migration at 14:32 can be undone by restoring to 14:31.

Enable **PITR** for production.

---

## 1. Enable PITR
1. Supabase Dashboard → your project → **Database** → **Backups** (or
   **Settings → Add-ons**).
2. Enable **Point-in-Time Recovery** and pick a retention window (7 days is a good
   default). Note: PITR is a paid add-on.
3. Confirm the **latest restorable point** timestamp updates (it should track a
   minute or two behind now once WAL archiving is running).

## 2. Before any risky change
Before running migrations or a bulk data operation on production:
- Note the current UTC time (your rollback target).
- For extra safety, trigger a **manual backup**/snapshot from the dashboard so
  there's a labelled point to return to.

## 3. Restore drill (rehearse this — don't wait for a real incident)
The goal is to prove you can recover, and to know how long it takes.

1. **Restore into a separate project**, not production. Dashboard → **Backups** →
   **Restore** → choose a point in time → target a **new/staging project** (or use
   Supabase's clone-to-new-project flow). Restoring *over* production is
   destructive and should only happen in a real incident.
2. Once the restore completes, connect to the restored database and verify:
   ```sql
   -- row counts look sane
   select
     (select count(*) from public.organizations) as orgs,
     (select count(*) from public.projects)      as projects,
     (select count(*) from public.tasks)         as tasks,
     (select count(*) from public.org_members)   as members;

   -- the security invariants survive a restore (helpers + policies intact)
   select proname from pg_proc
    where proname in ('is_org_member','session_meets_org_mfa','mfa_required_pending')
    order by 1;
   select polname, polwithcheck is not null as has_with_check
     from pg_policy where polname = 'org_domains_update';
   ```
3. Optionally run the full regression suite against the restored DB:
   ```bash
   psql "<restored-db-connection-string>" -v ON_ERROR_STOP=1 -f supabase/tests/rls_security.sql
   ```
4. **Record**: how long the restore took, and that verification passed. That number
   is your recovery-time objective (RTO) — everyone should know it before an
   incident, not during one.
5. Tear down the temporary restore project.

## 4. Real-incident restore (production)
1. **Stop writes** if feasible (put the app in maintenance / pause traffic) so you
   don't lose data created after the restore point.
2. Restore production to the chosen point in time.
3. Re-run outstanding migrations if the restore point predates a needed schema
   change.
4. Run the verification SQL above, then resume traffic.
5. Write a short post-incident note: what happened, the restore point chosen, and
   what data (if any) was lost between the incident and the restore point.

---

## Cadence
- **PITR:** always on in production.
- **Restore drill:** rehearse at least **quarterly**, and after any major schema or
  infrastructure change. Update the recorded RTO each time.
