import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProject } from '@/lib/data/projects';
import { listProjectMembers } from '@/lib/data/members';
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
    <div className="flex h-full flex-col">
      <header className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <Link href={`/projects/${projectId}`} className="text-xs text-zinc-500 hover:underline">
          ← {project.name}
        </Link>
        <h1 className="mt-1 text-lg font-semibold tracking-tight">Project chat</h1>
      </header>

      {!conversationId ? (
        <div className="p-6">
          <Card>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              The project group chat is for the delivery team. Contractors use their per-task
              discussion; a project manager can add you here if needed.
            </p>
          </Card>
        </div>
      ) : (
        await (async () => {
          const [messages, members] = await Promise.all([
            listMessages(conversationId),
            listProjectMembers(projectId),
          ]);
          const othersRead = await othersMaxReadSeq(conversationId, user.id);
          const names = Object.fromEntries(members.map((m) => [m.userId, m.name]));
          const meName = names[user.id] ?? user.email?.split('@')[0] ?? 'You';
          return (
            <ChatPanel
              className="min-h-0 flex-1"
              conversationId={conversationId}
              currentUserId={user.id}
              meName={meName}
              initialMessages={messages}
              initialNames={names}
              othersReadSeq={othersRead}
              canPost
            />
          );
        })()
      )}
    </div>
  );
}
