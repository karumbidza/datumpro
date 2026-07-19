import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { getProject } from '@/lib/data/projects';
import { myOrgRole } from '@/lib/data/tasks';
import { listProjectMembers, listAddableOrgMembers, myProjectRole, myMemberType, redactContacts } from '@/lib/data/members';
import { updateProjectMemberRole, removeProjectMember } from './actions';
import { AddTeammateForm } from './add-teammate-form';
import { Card, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SubmitButton } from '@/components/ui/submit-button';
import { PROJECT_ROLES, projectRolesForType } from '@datumpro/shared/access';

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

const ROLE_TONE = {
  pm: 'blue',
  contractor: 'blue',
  contributor: 'green',
  client: 'amber',
  viewer: 'neutral',
} as const;

const ROLE_BLURB: Record<string, string> = {
  pm: 'Manages the project — tasks, members, schedule.',
  contractor: 'Executes tasks under an agreed commitment (cost, timeline, terms).',
  contributor: 'Does the work — updates assigned tasks, submits reports.',
  client: 'External stakeholder — sees progress and their invoices.',
  viewer: 'Read-only access to this project.',
};

export default async function ProjectTeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ error?: string; added?: string }>;
}) {
  const { projectId } = await params;
  const sp = await searchParams;
  const notice = sp.error
    ? { kind: 'error' as const, text: sp.error }
    : sp.added
      ? { kind: 'ok' as const, text: 'Added to the project.' }
      : null;
  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  const project = await getProject(projectId);
  if (!project) notFound();

  const [rawMembers, orgRole, projectRole, viewerType] = await Promise.all([
    listProjectMembers(projectId),
    myOrgRole(project.org_id),
    myProjectRole(projectId),
    myMemberType(project.org_id),
  ]);
  // Contractors/clients don't get owner/admin contact details — only the PM (+
  // fellow contractors). Internal roles see everyone.
  const members = redactContacts(viewerType, rawMembers);

  const canManage =
    orgRole === 'owner' || orgRole === 'admin' || projectRole === 'pm';
  const addable = canManage ? await listAddableOrgMembers(project.org_id, projectId) : [];

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href={`/projects/${projectId}`} className="text-xs text-zinc-500 hover:underline">
        ← {project.name}
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Team</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Members added here see only this project. Company owners, admins and finance see every
        project automatically.
      </p>

      {notice && (
        <p
          className={`mt-4 rounded-md px-3 py-2 text-sm ${
            notice.kind === 'error'
              ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400'
              : 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400'
          }`}
        >
          {notice.text}
        </p>
      )}

      <section className="mt-6 space-y-2">
        {members.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No members yet.</p>
        ) : (
          members.map((m) => (
            <Card key={m.userId}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{m.name}</p>
                  {m.email && <p className="truncate text-xs text-zinc-500">{m.email}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {canManage ? (
                    <>
                      <form action={updateProjectMemberRole} className="flex items-center gap-2">
                        <input type="hidden" name="projectId" value={projectId} />
                        <input type="hidden" name="userId" value={m.userId} />
                        <select name="role" defaultValue={m.role} className={inputClass}>
                          {projectRolesForType(m.memberType).map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                        <SubmitButton variant="secondary" pendingText="…">
                          Update
                        </SubmitButton>
                      </form>
                      <form action={removeProjectMember}>
                        <input type="hidden" name="projectId" value={projectId} />
                        <input type="hidden" name="userId" value={m.userId} />
                        <SubmitButton variant="ghost" pendingText="…">
                          Remove
                        </SubmitButton>
                      </form>
                    </>
                  ) : (
                    <Badge tone={ROLE_TONE[m.role]}>{m.role}</Badge>
                  )}
                </div>
              </div>
            </Card>
          ))
        )}
      </section>

      {canManage && (
        <section className="mt-8">
          <Card>
            <CardTitle>Add a teammate</CardTitle>
            {addable.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                Everyone in this company is already on the project. To bring in someone new,{' '}
                <Link href="/org/members" className="text-brand-600 hover:underline">
                  invite them to the company
                </Link>{' '}
                first, then add them here.
              </p>
            ) : (
              <AddTeammateForm projectId={projectId} addable={addable} />
            )}

            <ul className="mt-4 space-y-1 border-t border-zinc-100 pt-3 text-xs text-zinc-500 dark:border-zinc-800">
              {PROJECT_ROLES.map((r) => (
                <li key={r}>
                  <span className="font-medium capitalize text-zinc-700 dark:text-zinc-300">{r}</span>{' '}
                  — {ROLE_BLURB[r]}
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </main>
  );
}
