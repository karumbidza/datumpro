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

  // The rail replaces the burger when wide — make sure a drawer left open in
  // portrait doesn't spring back when the device is rotated to landscape.
  useEffect(() => {
    if (isWide) setDrawerOpen(false);
  }, [isWide]);

  return (
    <>
      <Stack.Screen
        options={{
          title: name ? `${name} · Team` : 'Team channel',
          // Portrait gets a burger to reach the registers; wide keeps the rail visible.
          headerRight: isWide ? undefined : () => <ProjectNavBurger onPress={() => setDrawerOpen(true)} />,
        }}
      />
      {/* Keep ChatThread at a stable tree position across rotation so it isn't
          remounted (which would drop the unsent draft + re-fetch messages). */}
      <View style={[styles.row, { backgroundColor: colors.bg }]}>
        {isWide && <ProjectNavRail projectId={String(projectId)} name={name ?? ''} />}
        <View style={styles.flex}>
          <ChatThread
            conversationId={conversationId}
            resolving={resolving}
            emptyText="You don't have access to this project's team channel."
          />
        </View>
      </View>
      <ProjectNavDrawer
        visible={!isWide && drawerOpen}
        onClose={() => setDrawerOpen(false)}
        projectId={String(projectId)}
        name={name ?? ''}
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row' },
  flex: { flex: 1 },
});
