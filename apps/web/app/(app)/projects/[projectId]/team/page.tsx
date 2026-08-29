import { redirect } from 'next/navigation';

/** Team management now lives in the Project set up "Team" tab. */
export default async function ProjectTeamRedirect({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  redirect(`/projects/${projectId}/settings?tab=team`);
}
