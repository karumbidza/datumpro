import { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { BrandLoader } from '../../../components/brand-loader';
import { listProjectCalendar, localDay, type CalendarItem, type CalendarKind } from '../../../lib/data/calendar';
import { contentWidth, radius, font, type Colors } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';

function isoOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localDay(d);
}
function dateHeader(iso: string, today: string, tomorrow: string): string {
  if (iso === today) return 'Today';
  if (iso === tomorrow) return 'Tomorrow';
  const d = new Date(`${iso}T00:00:00`);
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  return `${wd}, ${mon} ${d.getDate()}`;
}

function kindMeta(k: CalendarKind, c: Colors): { icon: keyof typeof Ionicons.glyphMap; color: string; label: string } {
  switch (k) {
    case 'task':
      return { icon: 'clipboard-outline', color: c.brand, label: 'Task' };
    case 'todo':
      return { icon: 'checkmark-circle-outline', color: c.brand, label: 'To-do' };
    case 'event':
      return { icon: 'calendar-outline', color: c.violet ?? c.accentDeep, label: 'Event' };
    case 'rfi':
      return { icon: 'help-circle-outline', color: c.accentDeep, label: 'RFI' };
    case 'snag':
      return { icon: 'construct-outline', color: c.danger, label: 'Snag' };
    case 'transmittal':
      return { icon: 'send-outline', color: c.muted, label: 'Transmittal' };
  }
}

/** Consecutive items sharing a date, for a section header. */
interface DayGroup {
  date: string;
  items: CalendarItem[];
}

export default function ProjectCalendar() {
  const { projectId, name } = useLocalSearchParams<{ projectId: string; name?: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setItems(await listProjectCalendar(String(projectId)));
    setLoading(false);
    setRefreshing(false);
  }, [projectId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const today = isoOffset(0);
  const tomorrow = isoOffset(1);

  // Overdue = still-open deadlines before today; the rest group by date forward.
  const { overdue, groups } = useMemo(() => {
    const od: CalendarItem[] = [];
    const forward: CalendarItem[] = [];
    for (const i of items) {
      if (i.deadline && !i.done && i.date < today) od.push(i);
      else forward.push(i);
    }
    const byDate: DayGroup[] = [];
    for (const i of forward) {
      const last = byDate[byDate.length - 1];
      if (last && last.date === i.date) last.items.push(i);
      else byDate.push({ date: i.date, items: [i] });
    }
    return { overdue: od, groups: byDate };
  }, [items, today]);

  function open(item: CalendarItem) {
    if (item.kind === 'task' && item.taskId) {
      router.push(`/(app)/task/${item.taskId}`);
      return;
    }
    const route =
      item.kind === 'todo'
        ? '/(app)/project-todos/[projectId]'
        : item.kind === 'rfi'
          ? '/(app)/rfis/[projectId]'
          : item.kind === 'snag'
            ? '/(app)/snags/[projectId]'
            : item.kind === 'transmittal'
              ? '/(app)/transmittals/[projectId]'
              : null;
    if (route) router.push({ pathname: route, params: { projectId: String(projectId), name: name ?? '' } });
  }

  function Row({ item }: { item: CalendarItem }) {
    const m = kindMeta(item.kind, colors);
    const isOverdue = item.deadline && !item.done && item.date < today;
    return (
      <Pressable style={styles.row} onPress={() => open(item)}>
        <View style={[styles.iconWrap, { backgroundColor: `${m.color}22` }]}>
          <Ionicons name={m.icon} size={16} color={isOverdue ? colors.danger : m.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, item.done && styles.done]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {m.label}
            {item.subtitle ? ` · ${item.subtitle}` : ''}
            {isOverdue ? ' · overdue' : ''}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.subtle} />
      </Pressable>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: name ? `${name} · Calendar` : 'Calendar',
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: { fontFamily: font.displayBold },
        }}
      />
      {loading ? (
        <View style={styles.center}>
          <BrandLoader />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
        >
          {overdue.length === 0 && groups.length === 0 ? (
            <Text style={styles.empty}>Nothing scheduled. Task and to-do due dates, RFI/snag deadlines and events show up here.</Text>
          ) : null}

          {overdue.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.dayHeader, styles.overdueHeader]}>Overdue · {overdue.length}</Text>
              {overdue.map((i) => (
                <Row key={i.id} item={i} />
              ))}
            </View>
          )}

          {groups.map((g) => (
            <View key={g.date} style={styles.section}>
              <Text style={styles.dayHeader}>{dateHeader(g.date, today, tomorrow)}</Text>
              {g.items.map((i) => (
                <Row key={i.id} item={i} />
              ))}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    content: { padding: 16, paddingBottom: 40, ...contentWidth },
    empty: { color: c.subtle, fontSize: 14, fontFamily: font.body, textAlign: 'center', marginTop: 32 },
    section: { marginBottom: 18 },
    dayHeader: { fontSize: 12, fontFamily: font.bodyBold, letterSpacing: 0.4, color: c.subtle, textTransform: 'uppercase', marginBottom: 8 },
    overdueHeader: { color: c.danger },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border },
    iconWrap: { width: 34, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
    title: { fontSize: 15, fontFamily: font.bodySemi, color: c.text },
    done: { color: c.subtle, textDecorationLine: 'line-through' },
    sub: { fontSize: 12, fontFamily: font.body, color: c.muted, marginTop: 1 },
  });
