import { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { BrandLoader } from '../../../components/brand-loader';
import { getProjectEvent, EVENT_KIND_LABEL, type ProjectEventDetail, type EventKind } from '../../../lib/data/events';
import { contentWidth, radius, font, type Colors } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Wed, Sep 2 2026" — hand-rolled to avoid RN's patchy Intl on Android. */
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`;
}
function fmtTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${String(d.getMinutes()).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
}
function sameDay(a: string, b: string): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

function kindIcon(k: EventKind): keyof typeof Ionicons.glyphMap {
  switch (k) {
    case 'site_visit':
      return 'walk-outline';
    case 'inspection':
      return 'search-outline';
    case 'meeting':
      return 'people-outline';
    default:
      return 'calendar-outline';
  }
}

export default function EventDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [event, setEvent] = useState<ProjectEventDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setEvent(await getProjectEvent(String(id)));
    setLoading(false);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const when = useMemo(() => {
    if (!event) return '';
    if (event.allDay) return `${fmtDate(event.startsAt)} · All day`;
    const start = `${fmtDate(event.startsAt)} · ${fmtTime(event.startsAt)}`;
    if (!event.endsAt) return start;
    // Same day → show just the end time; a multi-day span shows the full end date.
    return sameDay(event.startsAt, event.endsAt)
      ? `${start} – ${fmtTime(event.endsAt)}`
      : `${start} → ${fmtDate(event.endsAt)} · ${fmtTime(event.endsAt)}`;
  }, [event]);

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: 'Event',
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: { fontFamily: font.displayBold },
        }}
      />
      {loading ? (
        <View style={styles.center}>
          <BrandLoader />
        </View>
      ) : !event ? (
        <View style={styles.center}>
          <Text style={styles.empty}>This event isn&apos;t available, or you don&apos;t have access to it.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.titleRow}>
            <View style={[styles.kindChip, { backgroundColor: colors.brandSoft }]}>
              <Ionicons name={kindIcon(event.kind)} size={13} color={colors.brand} />
              <Text style={styles.kindText}>{EVENT_KIND_LABEL[event.kind]}</Text>
            </View>
            {event.status === 'cancelled' && (
              <View style={styles.cancelChip}>
                <Text style={styles.cancelText}>Cancelled</Text>
              </View>
            )}
          </View>
          <Text style={[styles.title, event.status === 'cancelled' && styles.struck]}>{event.title}</Text>

          <Field icon="time-outline" label="When" value={when} styles={styles} colors={colors} />
          {event.location ? (
            <Field icon="location-outline" label="Where" value={event.location} styles={styles} colors={colors} />
          ) : null}

          {event.detail ? (
            <View style={styles.block}>
              <Text style={styles.blockLabel}>Agenda</Text>
              <Text style={styles.body}>{event.detail}</Text>
            </View>
          ) : null}

          {event.attendees.length > 0 && (
            <View style={styles.block}>
              <Text style={styles.blockLabel}>Attendees · {event.attendees.length}</Text>
              {event.attendees.map((a) => (
                <View key={a.userId} style={styles.attendee}>
                  <Ionicons name="person-circle-outline" size={20} color={colors.subtle} />
                  <Text style={styles.attendeeName}>{a.name}</Text>
                </View>
              ))}
            </View>
          )}

          {event.notes ? (
            <View style={styles.block}>
              <Text style={styles.blockLabel}>Minutes</Text>
              <Text style={styles.body}>{event.notes}</Text>
            </View>
          ) : null}

          {event.organiserName ? (
            <Text style={styles.organiser}>Scheduled by {event.organiserName}</Text>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

function Field({
  icon,
  label,
  value,
  styles,
  colors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  return (
    <View style={styles.field}>
      <Ionicons name={icon} size={18} color={colors.brand} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={styles.fieldValue}>{value}</Text>
      </View>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    empty: { color: c.subtle, fontSize: 14, fontFamily: font.body, textAlign: 'center' },
    content: { padding: 16, paddingBottom: 40, ...contentWidth },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
    kindChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
    kindText: { fontSize: 12, fontFamily: font.bodySemi, color: c.brand },
    cancelChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: `${c.danger}22` },
    cancelText: { fontSize: 12, fontFamily: font.bodySemi, color: c.danger },
    title: { fontSize: 22, fontFamily: font.displayBold, color: c.text, marginBottom: 18 },
    struck: { textDecorationLine: 'line-through', color: c.muted },
    field: { flexDirection: 'row', gap: 12, marginBottom: 16 },
    fieldLabel: { fontSize: 11, fontFamily: font.bodyBold, letterSpacing: 0.4, textTransform: 'uppercase', color: c.subtle, marginBottom: 2 },
    fieldValue: { fontSize: 15, fontFamily: font.bodySemi, color: c.text },
    block: {
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.md,
      padding: 14,
      marginBottom: 14,
    },
    blockLabel: { fontSize: 11, fontFamily: font.bodyBold, letterSpacing: 0.4, textTransform: 'uppercase', color: c.subtle, marginBottom: 8 },
    body: { fontSize: 15, fontFamily: font.body, color: c.text, lineHeight: 21 },
    attendee: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
    attendeeName: { fontSize: 15, fontFamily: font.body, color: c.text },
    organiser: { fontSize: 13, fontFamily: font.body, color: c.subtle, marginTop: 4 },
  });
