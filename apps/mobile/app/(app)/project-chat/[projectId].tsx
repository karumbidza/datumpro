import { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { getProjectConversationId } from '../../../lib/data/chat';
import { ChatThread } from '../../../components/chat-thread';
import { ProjectNavRail, ProjectNavDrawer, ProjectNavBurger } from '../../../components/project-nav';
import { useResponsive } from '../../../lib/responsive';
import { useTheme } from '../../../lib/theme-context';

export default function ProjectChat() {
  const { projectId, name } = useLocalSearchParams<{ projectId: string; name?: string }>();
  const { colors } = useTheme();
  const { isWide } = useResponsive();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [resolving, setResolving] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

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

  const chat = (
    <ChatThread
      conversationId={conversationId}
      resolving={resolving}
      emptyText="You don't have access to this project's team channel."
    />
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: name ? `${name} · Team` : 'Team channel',
          // Portrait gets a burger to reach the registers; wide keeps the rail visible.
          headerRight: isWide ? undefined : () => <ProjectNavBurger onPress={() => setDrawerOpen(true)} />,
        }}
      />
      {isWide ? (
        <View style={[styles.wide, { backgroundColor: colors.bg }]}>
          <ProjectNavRail projectId={String(projectId)} name={name ?? ''} />
          <View style={styles.flex}>{chat}</View>
        </View>
      ) : (
        <>
          {chat}
          <ProjectNavDrawer
            visible={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            projectId={String(projectId)}
            name={name ?? ''}
          />
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  wide: { flex: 1, flexDirection: 'row' },
  flex: { flex: 1 },
});
