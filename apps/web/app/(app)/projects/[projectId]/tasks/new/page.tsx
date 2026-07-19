import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { getProject } from '@/lib/data/projects';
import { listOrgMembers } from '@/lib/data/org-members';
import { NewTaskForm } from '@/components/task/new-task-form';
import { Card } from '@/components/ui/card';

export default async function NewTaskPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  const project = await getProject(projectId);
  if (!project) notFound();
  // Anyone in the org can receive a task; assigning a non-member enrols them at
  // their type-correct project role (handled in createTask).
  const members = (await listOrgMembers(project.org_id))
    .filter((m) => m.status === 'active')
    .map((m) => ({ userId: m.userId, name: m.name, role: m.memberType }));

  return (
    <main className="mx-auto max-w-xl px-6 py-10">
      <Link href={`/projects/${projectId}/tasks`} className="text-xs text-zinc-500 hover:underline">
        ← Tasks
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">New task</h1>

      <Card className="mt-6">
        <NewTaskForm projectId={projectId} members={members} />
      </Card>
    </main>
  );
}
