import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProject } from '@/lib/data/projects';
import { myProjectRole } from '@/lib/data/members';
import { listChatRoster } from '@/lib/data/chat-roster';
import { myOrgRole } from '@/lib/data/tasks';
import { getProjectConversationId, listMessages, othersMaxReadSeq } from '@/lib/data/chat';
import { ChatPanel } from '@/components/chat/chat-panel';
import { Card } from '@/components/ui/card';

export default async function ProjectChatPage({
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

  const conversationId = await getProjectConversationId(projectId);

  return (
    <div className="flex h-full flex-col px-4 py-4 xl:px-8">
      <Link href={`/projects/${projectId}`} className="text-xs text-zinc-500 hover:underline">
        ← {project.name}
      </Link>

      {!conversationId ? (
        <div className="mt-3">
          <Card>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              The project group chat is for the delivery team. Contractors use their per-task
              discussion; a project manager can add you here if needed.
            </p>
          </Card>
        </div>
      ) : (
        await (async () => {
          const [messages, roster, orgRole, projectRole, othersRead] = await Promise.all([
            listMessages(conversationId, user.id),
            listChatRoster(projectId),
            myOrgRole(project.org_id),
            myProjectRole(projectId),
            othersMaxReadSeq(conversationId, user.id),
          ]);
          const names = Object.fromEntries(roster.map((m) => [m.userId, m.name]));
          const meName = names[user.id] ?? user.email?.split('@')[0] ?? 'You';
          const canModerate = orgRole === 'owner' || orgRole === 'admin' || projectRole === 'pm';
          return (
            <ChatPanel
              className="mt-3 min-h-0 flex-1"
              title="Project Chat"
              conversationId={conversationId}
              orgId={project.org_id}
              projectId={projectId}
              currentUserId={user.id}
              meName={meName}
              initialMessages={messages}
              othersReadSeq={othersRead}
              canPost
              canModerate={canModerate}
              members={roster}
            />
          );
        })()
      )}
    </div>
  );
}
