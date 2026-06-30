import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProject } from '@/lib/data/projects';
import { myOrgRole } from '@/lib/data/tasks';
import { listProjectMembers, listAddableOrgMembers, myProjectRole } from '@/lib/data/members';
import { addProjectMember, updateProjectMemberRole, removeProjectMember } from './actions';
import { Card, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PROJECT_ROLES } from '@datumpro/shared/access';

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

const ROLE_TONE = { pm: 'blue', contributor: 'green', client: 'amber', viewer: 'neutral' } as const;

const ROLE_BLURB: Record<string, string> = {
  pm: 'Manages the project — tasks, members, schedule.',
  contributor: 'Does the work — updates assigned tasks, submits reports.',
  client: 'External stakeholder — sees progress and their invoices.',
  viewer: 'Read-only access to this project.',
};

export default async function ProjectTeamPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const project = await getProject(projectId);
  if (!project) notFound();

  const [members, orgRole, projectRole] = await Promise.all([
    listProjectMembers(projectId),
    myOrgRole(project.org_id),
    myProjectRole(projectId),
  ]);

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
                          {PROJECT_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                        <Button type="submit" variant="secondary">
                          Update
                        </Button>
                      </form>
                      <form action={removeProjectMember}>
                        <input type="hidden" name="projectId" value={projectId} />
                        <input type="hidden" name="userId" value={m.userId} />
                        <Button type="submit" variant="ghost">
                          Remove
                        </Button>
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
                Everyone in this company is already on the project. To bring in someone new, add
                them to the company first (invites by email are coming with the onboarding flow).
              </p>
            ) : (
              <form action={addProjectMember} className="mt-3 flex flex-wrap items-end gap-3">
                <input type="hidden" name="projectId" value={projectId} />
                <div className="min-w-48 flex-1">
                  <label className="mb-1 block text-xs font-medium">Company member</label>
                  <select name="userId" required className={inputClass} defaultValue="">
                    <option value="" disabled>
                      Select a person…
                    </option>
                    {addable.map((a) => (
                      <option key={a.userId} value={a.userId}>
                        {a.name}
                        {a.email ? ` · ${a.email}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Role</label>
                  <select name="role" defaultValue="contributor" className={inputClass}>
                    {PROJECT_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
                <Button type="submit">Add</Button>
              </form>
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
