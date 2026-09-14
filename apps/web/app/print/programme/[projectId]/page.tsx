import { notFound, redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { getProject } from '@/lib/data/projects';
import { getProgrammeData } from '@/lib/data/programme';
import { ProgrammePrint } from './programme-print';

/** Standalone, printable programme sheet — no app shell, laid out landscape for
 *  "Save as PDF". Opened in a new tab from the Programme view's Export button.
 *  Auth + RLS are the same as the in-app page; this route just drops the chrome. */
export default async function ProgrammePrintPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  const project = await getProject(projectId);
  if (!project) notFound();

  const data = await getProgrammeData(projectId);

  return <ProgrammePrint projectName={project.name} data={data} />;
}
