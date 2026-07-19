-- Extend realtime coverage to the rest of the app's live surfaces (dashboard,
-- requests, team, reports, finance, notifications). RLS is enforced per subscriber.
alter publication supabase_realtime add table
  public.projects,
  public.project_members,
  public.notifications,
  public.milestones,
  public.budget_lines,
  public.invoices,
  public.payments,
  public.contractor_documents;
