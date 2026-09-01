import { notFound, redirect } from 'next/navigation';
import { getProject } from '@/lib/data/projects';
import { getActiveContext } from '@/lib/data/org';

/** Enforces the active-org boundary for EVERY project sub-route: a project is only
 *  viewable in the context of its own org, so another org's data can never render
 *  while a different org is active.
 *
 *  RLS already limits getProject() to projects the user is a member of. So when the
 *  project's org differs from the active org, the user still belongs to that org —
 *  we align the active org to it (a deep link / notification into another of the
 *  user's orgs). Anything getProject can't return is genuinely not theirs → 404. */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const [project, ctx] = await Promise.all([getProject(projectId), getActiveContext()]);
  if (!ctx?.active) redirect('/sign-in');
  if (!project) notFound();

  if (project.org_id !== ctx.active.orgId) {
    if (ctx.memberships.some((m) => m.orgId === project.org_id)) {
      redirect(`/switch-org?org=${project.org_id}&next=/projects/${projectId}`);
    }
    notFound();
  }

  return <>{children}</>;
}
