import { redirect } from 'next/navigation';

/** The setup checklist now lives in the Project set up "Progress" tab. */
export default async function ProjectSetupRedirect({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  redirect(`/projects/${projectId}/settings?tab=progress`);
}
