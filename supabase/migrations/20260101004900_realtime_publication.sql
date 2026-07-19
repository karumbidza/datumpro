-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — enable Postgres-changes realtime on frequently-changing tables.
--
-- Chat already feels live because it uses Realtime broadcast; everything else was
-- only refreshed on the tab that made the change. Adding these tables to the
-- realtime publication lets the web app subscribe (via <LiveRefresh>) and refresh
-- across all open tabs / users the moment data changes. RLS is still enforced per
-- authenticated subscriber, so a client only receives changes to rows it may SELECT.
-- ─────────────────────────────────────────────────────────────────────────────

alter publication supabase_realtime add table
  public.tasks,
  public.task_subtasks,
  public.task_media,
  public.task_extension_requests,
  public.task_quotes,
  public.task_activity,
  public.contractor_payment_requests,
  public.approvals,
  public.requests,
  public.site_reports;
