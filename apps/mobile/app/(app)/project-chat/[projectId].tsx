import { useEffect, useState } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { getProjectConversationId } from '../../../lib/data/chat';
import { ChatThread } from '../../../components/chat-thread';

export default function ProjectChat() {
  const { projectId, name } = useLocalSearchParams<{ projectId: string; name?: string }>();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [resolving, setResolving] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const id = await getProjectConversationId(String(projectId));
      if (!active) return;
      setConversationId(id);
      setResolving(false);
    })();
    return () => {
      active = false;
    };
  }, [projectId]);

  return (
    <>
      <Stack.Screen options={{ title: name ? `${name} · Team` : 'Team channel' }} />
      <ChatThread
        conversationId={conversationId}
        resolving={resolving}
        emptyText="You don't have access to this project's team channel."
      />
    </>
  );
}
