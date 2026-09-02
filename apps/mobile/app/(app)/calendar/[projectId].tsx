import { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { BrandLoader } from '../../../components/brand-loader';
import { listProjectCalendar, localDay, type CalendarItem, type CalendarKind } from '../../../lib/data/calendar';
import { contentWidth, radius, font, type Colors } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
  return `${wd}, ${MON_ABBR[d.getMonth()]} ${d.getDate()}`;
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

interface DayGroup {
  date: string;
  items: CalendarItem[];
}
interface Cell {
  iso: string;
  day: number;
  inMonth: boolean;
}

export default function ProjectCalendar() {
  const { projectId, name } = useLocalSearchParams<{ projectId: string; name?: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // The month shown in the grid (pinned to the 1st) and the tapped day, if any.
  const [view, setView] = useState(() => {
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() };
  });
  const [selected, setSelected] = useState<string | null>(null);

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

  // Index every item by its local day so the grid can dot days and the agenda
  // can show a tapped day. Overdue days (open, past deadline) are flagged red.
  const { byDay, overdueDays } = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    const od = new Set<string>();
    for (const i of items) {
      const list = map.get(i.date);
      if (list) list.push(i);
      else map.set(i.date, [i]);
      if (i.deadline && !i.done && i.date < today) od.add(i.date);
    }
    return { byDay: map, overdueDays: od };
  }, [items, today]);

  // The forward agenda shown when no day is tapped: overdue deadlines first, then
  // everything from today onward grouped by date.
  const { overdue, groups } = useMemo(() => {
    const od: CalendarItem[] = [];
    const forward: CalendarItem[] = [];
    for (const i of items) {
      if (i.deadline && !i.done && i.date < today) od.push(i);
      else if (i.date >= today) forward.push(i);
    }
    const byDate: DayGroup[] = [];
    for (const i of forward) {
      const last = byDate[byDate.length - 1];
      if (last && last.date === i.date) last.items.push(i);
      else byDate.push({ date: i.date, items: [i] });
    }
    return { overdue: od, groups: byDate };
  }, [items, today]);

  // Build the 6×7 grid for the current view month (leading/trailing days spill in).
  const cells = useMemo<Cell[]>(() => {
    const first = new Date(view.year, view.month, 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay()); // back up to the Sunday of the first week
    const out: Cell[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      out.push({ iso: localDay(d), day: d.getDate(), inMonth: d.getMonth() === view.month });
    }
    return out;
  }, [view]);

  const isCurrentMonth = view.year === new Date().getFullYear() && view.month === new Date().getMonth();

  function shiftMonth(delta: number) {
    setSelected(null);
    setView((v) => {
      const d = new Date(v.year, v.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }
  function goToday() {
    const n = new Date();
    setView({ year: n.getFullYear(), month: n.getMonth() });
    setSelected(today);
  }
  function tapDay(cell: Cell) {
    if (!cell.inMonth) {
      const d = new Date(`${cell.iso}T00:00:00`);
      setView({ year: d.getFullYear(), month: d.getMonth() });
    }
    setSelected((cur) => (cur === cell.iso ? null : cell.iso));
  }

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
    const isOverdue = !!item.deadline && !item.done && item.date < today;
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

  const selectedItems = selected ? byDay.get(selected) ?? [] : null;

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
          {/* Month grid */}
          <View style={styles.calCard}>
            <View style={styles.monthBar}>
              <Pressable onPress={() => shiftMonth(-1)} hitSlop={8} style={styles.arrow}>
                <Ionicons name="chevron-back" size={20} color={colors.text} />
              </Pressable>
              <Text style={styles.monthTitle}>
                {MONTHS[view.month]} {view.year}
              </Text>
              <Pressable onPress={() => shiftMonth(1)} hitSlop={8} style={styles.arrow}>
                <Ionicons name="chevron-forward" size={20} color={colors.text} />
              </Pressable>
            </View>

            <View style={styles.weekRow}>
              {WEEKDAYS.map((w, i) => (
                <Text key={i} style={styles.weekday}>
                  {w}
                </Text>
              ))}
            </View>

            <View style={styles.grid}>
              {cells.map((cell) => {
                const dayItems = byDay.get(cell.iso);
                const isToday = cell.iso === today;
                const isSelected = cell.iso === selected;
                const isOverdue = overdueDays.has(cell.iso);
                return (
                  <Pressable key={cell.iso} style={styles.cell} onPress={() => tapDay(cell)}>
                    <View style={[styles.dayCircle, isSelected && styles.daySelected, isToday && !isSelected && styles.dayToday]}>
                      <Text
                        style={[
                          styles.dayText,
                          !cell.inMonth && styles.dayOut,
                          isSelected && styles.dayTextSelected,
                          isToday && !isSelected && styles.dayTextToday,
                        ]}
                      >
                        {cell.day}
                      </Text>
                    </View>
                    <View style={styles.dotRow}>
                      {(dayItems ?? []).slice(0, 3).map((it, idx) => (
                        <View
                          key={idx}
                          style={[
                            styles.dot,
                            { backgroundColor: isOverdue && it.deadline && !it.done ? colors.danger : kindMeta(it.kind, colors).color },
                          ]}
                        />
                      ))}
                    </View>
                  </Pressable>
                );
              })}
            </View>

            {!isCurrentMonth && (
              <Pressable onPress={goToday} style={styles.todayBtn}>
                <Ionicons name="today-outline" size={15} color={colors.brand} />
                <Text style={styles.todayText}>Jump to today</Text>
              </Pressable>
            )}
          </View>

          {/* Agenda — a tapped day, or the forward-looking list */}
          {selected ? (
            <View style={styles.section}>
              <View style={styles.agendaHead}>
                <Text style={styles.dayHeader}>{dateHeader(selected, today, tomorrow)}</Text>
                <Pressable onPress={() => setSelected(null)} hitSlop={6}>
                  <Text style={styles.clearText}>Show upcoming</Text>
                </Pressable>
              </View>
              {selectedItems && selectedItems.length > 0 ? (
                selectedItems.map((i) => <Row key={i.id} item={i} />)
              ) : (
                <Text style={styles.empty}>Nothing scheduled on this day.</Text>
              )}
            </View>
          ) : (
            <>
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
            </>
          )}
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
    empty: { color: c.subtle, fontSize: 14, fontFamily: font.body, textAlign: 'center', marginTop: 20 },

    calCard: {
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.md,
      padding: 12,
      marginBottom: 20,
    },
    monthBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
    monthTitle: { fontSize: 16, fontFamily: font.displayBold, color: c.text },
    arrow: { padding: 4 },
    weekRow: { flexDirection: 'row', marginBottom: 4 },
    weekday: { flex: 1, textAlign: 'center', fontSize: 11, fontFamily: font.bodyBold, color: c.subtle },
    grid: { flexDirection: 'row', flexWrap: 'wrap' },
    cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 2 },
    dayCircle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    daySelected: { backgroundColor: c.brand },
    dayToday: { borderWidth: 1.5, borderColor: c.brand },
    dayText: { fontSize: 14, fontFamily: font.bodySemi, color: c.text, fontVariant: ['tabular-nums'] },
    dayTextSelected: { color: c.onBrand },
    dayTextToday: { color: c.brand },
    dayOut: { color: c.subtle, opacity: 0.55 },
    dotRow: { flexDirection: 'row', gap: 2, height: 6, marginTop: 2 },
    dot: { width: 5, height: 5, borderRadius: 2.5 },
    todayBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: c.border },
    todayText: { fontSize: 13, fontFamily: font.bodySemi, color: c.brand },

    section: { marginBottom: 18 },
    agendaHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    dayHeader: { fontSize: 12, fontFamily: font.bodyBold, letterSpacing: 0.4, color: c.subtle, textTransform: 'uppercase' },
    clearText: { fontSize: 12, fontFamily: font.bodySemi, color: c.brand },
    overdueHeader: { color: c.danger, marginBottom: 8 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border },
    iconWrap: { width: 34, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
    title: { fontSize: 15, fontFamily: font.bodySemi, color: c.text },
    done: { color: c.subtle, textDecorationLine: 'line-through' },
    sub: { fontSize: 12, fontFamily: font.body, color: c.muted, marginTop: 1 },
  });
