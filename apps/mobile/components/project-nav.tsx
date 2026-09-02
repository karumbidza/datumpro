import { useMemo } from 'react';
import { View, Text, Pressable, ScrollView, Modal, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { radius, font, type Colors } from '../lib/theme';
import { useTheme } from '../lib/theme-context';

export interface RegisterLink {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  pathname: string;
}

/** The project registers, surfaced in the team channel's side rail (landscape)
 *  and burger drawer (portrait). Keep in sync with the routes under app/(app). */
export const REGISTERS: RegisterLink[] = [
  { key: 'variations', label: 'Change orders', icon: 'git-compare-outline', pathname: '/(app)/variations/[projectId]' },
  { key: 'todos', label: 'To-dos', icon: 'checkbox-outline', pathname: '/(app)/project-todos/[projectId]' },
  { key: 'snags', label: 'Snags', icon: 'construct-outline', pathname: '/(app)/snags/[projectId]' },
  { key: 'diary', label: 'Site diary', icon: 'book-outline', pathname: '/(app)/diary/[projectId]' },
  { key: 'rfis', label: 'RFIs', icon: 'help-circle-outline', pathname: '/(app)/rfis/[projectId]' },
  { key: 'drawings', label: 'Drawings', icon: 'layers-outline', pathname: '/(app)/drawings/[projectId]' },
  { key: 'transmittals', label: 'Transmittals', icon: 'send-outline', pathname: '/(app)/transmittals/[projectId]' },
  { key: 'calendar', label: 'Calendar', icon: 'calendar-outline', pathname: '/(app)/calendar/[projectId]' },
  { key: 'reports', label: 'Site reports', icon: 'document-text-outline', pathname: '/(app)/reports/[projectId]' },
];

function useOpenRegister(projectId: string, name: string) {
  const router = useRouter();
  return useMemo(
    () => (r: RegisterLink) =>
      router.push({ pathname: r.pathname as never, params: { projectId, name } }),
    [router, projectId, name],
  );
}

/** A persistent left rail for wide layouts (tablet / landscape). */
export function ProjectNavRail({ projectId, name }: { projectId: string; name: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const open = useOpenRegister(projectId, name);
  return (
    <View style={styles.rail}>
      <Text style={styles.railHeader}>Registers</Text>
      <ScrollView contentContainerStyle={styles.railList} showsVerticalScrollIndicator={false}>
        {REGISTERS.map((r) => (
          <Pressable key={r.key} style={styles.item} onPress={() => open(r)}>
            <Ionicons name={r.icon} size={18} color={colors.brand} />
            <Text style={styles.itemText} numberOfLines={1}>
              {r.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

/** A slide-in drawer for portrait — opened by the header burger. */
export function ProjectNavDrawer({
  visible,
  onClose,
  projectId,
  name,
}: {
  visible: boolean;
  onClose: () => void;
  projectId: string;
  name: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const go = (r: RegisterLink) => {
    onClose();
    router.push({ pathname: r.pathname as never, params: { projectId, name } });
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        <Pressable style={styles.drawer} onPress={(e) => e.stopPropagation()}>
          <View style={styles.drawerHead}>
            <Text style={styles.drawerTitle} numberOfLines={1}>
              {name || 'Project'}
            </Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={colors.text} />
            </Pressable>
          </View>
          <Text style={styles.railHeader}>Registers</Text>
          <ScrollView contentContainerStyle={styles.drawerList} showsVerticalScrollIndicator={false}>
            {REGISTERS.map((r) => (
              <Pressable key={r.key} style={styles.drawerItem} onPress={() => go(r)}>
                <Ionicons name={r.icon} size={20} color={colors.brand} />
                <Text style={styles.drawerItemText} numberOfLines={1}>
                  {r.label}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={colors.subtle} style={{ marginLeft: 'auto' }} />
              </Pressable>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** The burger button for the team-channel header (portrait only). */
export function ProjectNavBurger({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={8} style={{ paddingHorizontal: 4 }}>
      <Ionicons name="menu" size={24} color={colors.text} />
    </Pressable>
  );
}

const RAIL_WIDTH = 210;

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    rail: {
      width: RAIL_WIDTH,
      backgroundColor: c.surface,
      borderRightWidth: 1,
      borderRightColor: c.border,
      paddingTop: 12,
    },
    railHeader: {
      fontSize: 11,
      fontFamily: font.bodyBold,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
      color: c.subtle,
      paddingHorizontal: 14,
      marginBottom: 6,
    },
    railList: { gap: 2, paddingBottom: 16 },
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 14,
      paddingVertical: 11,
    },
    itemText: { flex: 1, fontSize: 14, fontFamily: font.bodySemi, color: c.text },
    scrim: { flex: 1, flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.4)' },
    drawer: {
      width: 280,
      maxWidth: '85%',
      backgroundColor: c.bg,
      paddingTop: 52,
      flex: 1,
    },
    drawerHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
      marginBottom: 10,
    },
    drawerTitle: { flex: 1, fontSize: 17, fontFamily: font.displayBold, color: c.text, marginRight: 12 },
    drawerList: { paddingBottom: 24 },
    drawerItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderRadius: radius.sm,
      marginHorizontal: 8,
    },
    drawerItemText: { fontSize: 15, fontFamily: font.bodySemi, color: c.text },
  });
