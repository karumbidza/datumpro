import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { getProject } from '@/lib/data/projects';
import { myProjectRole } from '@/lib/data/members';
import { listChatRoster } from '@/lib/data/chat-roster';
import { myOrgRole } from '@/lib/data/tasks';
import {
  getProjectConversationId,
  listMessages,
  othersMaxReadSeq,
  myReadSeq,
  listConversationAttachments,
  getConversationAbout,
  listPinnedMessages,
} from '@/lib/data/chat';
import { listProjectActionItems } from '@/lib/data/action-items';
import { listProjectEvents } from '@/lib/data/events';
import { chatV2Enabled } from '@/lib/chat-flag';
import { ChatPanel } from '@/components/chat/chat-panel';
import { ChatPanelV2 } from '@/components/chat/v2/chat-panel-v2';
import { TodayOnSite } from '@/components/chat/v2/today-on-site';
import { ChatActionItems } from '@/components/chat/chat-action-items';
import { ChatEvents } from '@/components/chat/chat-events';
import { Card } from '@/components/ui/card';

export default async function ProjectChatPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const user = await getAuthUser();
  if (!user) redirect('/sign-in');

  const project = await getProject(projectId);
  if (!project) notFound();

  const conversationId = await getProjectConversationId(projectId);
  const v2 = chatV2Enabled();

  return (
    <div className="flex h-full flex-col px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <h1 className="sr-only">{project.name} — project chat</h1>
      <Link href={`/projects/${projectId}`} className="text-xs text-zinc-500 dark:text-zinc-400 hover:underline">
        ← {project.name}
      </Link>

      {!conversationId ? (
        <div className="mt-3">
          <Card>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              This project doesn’t have a group chat yet. Every project member can use it once it’s
              created — it stays open for the life of the project.
            </p>
          </Card>
        </div>
      ) : (
        await (async () => {
          const [messages, roster, orgRole, projectRole, othersRead, ownRead, actionItems, events, sharedFiles, about, pinned] =
            await Promise.all([
              listMessages(conversationId, user.id),
              listChatRoster(projectId),
              myOrgRole(project.org_id),
              myProjectRole(projectId),
              othersMaxReadSeq(conversationId, user.id),
              myReadSeq(conversationId, user.id),
              listProjectActionItems(projectId),
              listProjectEvents(projectId),
              listConversationAttachments(conversationId),
              getConversationAbout(conversationId),
              listPinnedMessages(conversationId),
            ]);
          const names = Object.fromEntries(roster.map((m) => [m.userId, m.name]));
          const meName = names[user.id] ?? user.email?.split('@')[0] ?? 'You';
          const canModerate = orgRole === 'owner' || orgRole === 'admin' || projectRole === 'pm';
          const stripMembers = roster.map((m) => ({ userId: m.userId, name: m.name }));

          if (v2) {
            return (
              <ChatPanelV2
                className="mt-3 min-h-0 flex-1"
                title={project.name}
                conversationId={conversationId}
                orgId={project.org_id}
                projectId={projectId}
                currentUserId={user.id}
                meName={meName}
                initialMessages={messages}
                othersReadSeq={othersRead}
                myReadSeq={ownRead}
                canPost
                canModerate={canModerate}
                members={roster}
                sharedFiles={sharedFiles}
                about={about}
                pinnedMessages={pinned}
                pinnedMessageIds={pinned.map((p) => p.messageId)}
                showRegisterLinks
                todayStrip={
                  <TodayOnSite
                    projectId={projectId}
                    conversationId={conversationId}
                    actionItems={actionItems}
                    events={events}
                    members={stripMembers}
                    canManage={canModerate}
                    currentUserId={user.id}
                  />
                }
              />
            );
          }

          return (
            <>
              {/* Messaging leads; the to-dos + events strip sits below it. */}
              <ChatPanel
                className="mt-3 min-h-0 flex-1"
                title={project.name}
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
                sharedFiles={sharedFiles}
                about={about}
                pinnedMessages={pinned}
                pinnedMessageIds={pinned.map((p) => p.messageId)}
                showRegisterLinks
              />
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <ChatActionItems
                  projectId={projectId}
                  conversationId={conversationId}
                  items={actionItems}
                  members={stripMembers}
                  canManage={canModerate}
                  currentUserId={user.id}
                />
                <ChatEvents
                  projectId={projectId}
                  conversationId={conversationId}
                  events={events}
                  members={stripMembers}
                  canManage={canModerate}
                  currentUserId={user.id}
                />
              </div>
            </>
          );
        })()
      )}
    </div>
  );
}
