import { PageContainer } from '@/components/shell/page-container';
import { PageHeader } from '@/components/ui/page-header';
import { redirect, notFound } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { getProject } from '@/lib/data/projects';
import { listOrgMembers } from '@/lib/data/org-members';
import { listProjectTaskOptions } from '@/lib/data/tasks';
import { NewTaskForm } from '@/components/task/new-task-form';
import { Card } from '@/components/ui/card';

// A real UUID that no task will ever be — lets us reuse listProjectTaskOptions
// (which excludes one id) to return every task in the project.
const NONE = '00000000-0000-0000-0000-000000000000';

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
  const [members, taskOptions] = await Promise.all([
    listOrgMembers(project.org_id).then((ms) =>
      ms.filter((m) => m.status === 'active').map((m) => ({ userId: m.userId, name: m.name, role: m.memberType })),
    ),
    listProjectTaskOptions(projectId, NONE),
  ]);

  return (
    <PageContainer width="xl">
      <PageHeader
        backHref={`/projects/${projectId}/tasks`}
        backLabel="Tasks"
        title="New task"
      />

      <Card className="mt-6">
        <NewTaskForm
          projectId={projectId}
          members={members}
          taskOptions={taskOptions}
          todayIso={new Date().toISOString().slice(0, 10)}
        />
      </Card>
    </PageContainer>
  );
}
