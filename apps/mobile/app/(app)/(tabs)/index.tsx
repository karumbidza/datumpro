import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle } from 'react-native-svg';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  getHomeData,
  listPendingApprovals,
  type HomeData,
  type PendingApproval,
} from '../../../lib/data/home';
import { Card, ProgressBar, StatTile, Avatar } from '../../../components/ui';
import { contentWidth, radius, font, type Colors } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { useResponsive } from '../../../lib/responsive';

/** SVG progress ring — dasharray = circumference, dashoffset shrinks as pct rises. */
function ProgressRing({
  pct,
  size = 74,
  stroke = 7,
  track,
  fill,
  children,
}: {
  pct: number;
  size?: number;
  stroke?: number;
  track: string;
  fill: string;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={fill}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
}

export default function Home() {
  const router = useRouter();
  const { colors, scheme, toggle } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { contentMaxWidth } = useResponsive();
  const [data, setData] = useState<HomeData | null>(null);
  const [signoffs, setSignoffs] = useState<PendingApproval[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [home, pending] = await Promise.all([getHomeData(), listPendingApprovals()]);
    setData(home);
    setSignoffs(pending);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onTrack = data ? data.myOverdue === 0 : true;

  const kindConfig: Record<PendingApproval['kind'], { abbr: string; label: string; soft: string; deep: string }> = {
    signoff: { abbr: 'SGN', label: 'Sign-off', soft: colors.brandSoft, deep: colors.brandDeep },
    extension: { abbr: 'EXT', label: 'Extension', soft: colors.accentSoft, deep: colors.accentDeep },
    variation: { abbr: 'VO', label: 'Variation', soft: colors.violetSoft, deep: colors.violet },
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={[styles.content, { maxWidth: contentMaxWidth }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.brand}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
          />
        }
      >
        {/* Header: brand mark · theme toggle + avatar */}
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <View style={styles.brandDot}>
              <Ionicons name="stats-chart" size={17} color={colors.onBrand} />
            </View>
            <Text style={styles.wordmark}>datumpro</Text>
          </View>
          <View style={styles.headerRight}>
            <Pressable style={styles.iconBtn} onPress={toggle} hitSlop={8}>
              <Ionicons name={scheme === 'dark' ? 'sunny-outline' : 'moon-outline'} size={19} color={colors.muted} />
            </Pressable>
            <Avatar name={data?.displayName ?? '?'} size={38} />
          </View>
        </View>

        {/* Greeting */}
        <Text style={styles.greeting}>
          {greeting()},{'\n'}
          {data ? firstName(data.displayName) : '…'}.
        </Text>
        <Text style={styles.subGreeting}>{subline(data, signoffs.length)}</Text>

        {/* Hero portfolio card */}
        <LinearGradient
          colors={[colors.brandDeep, colors.brand]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.heroTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroLabel}>{data?.isManager ? 'PORTFOLIO PROGRESS' : 'YOUR PROGRESS'}</Text>
              <Text style={styles.heroPct}>{data?.portfolioPct ?? 0}%</Text>
              <Text style={styles.heroHint}>
                {data ? `${data.doneTasks} of ${data.totalTasks} tasks complete` : 'Loading…'}
              </Text>
            </View>
            <ProgressRing pct={data?.portfolioPct ?? 0} track="rgba(255,255,255,0.25)" fill="#ffffff">
              <Text style={styles.ringText}>{data?.portfolioPct ?? 0}%</Text>
            </ProgressRing>
          </View>
          <View style={styles.heroPill}>
            <View style={[styles.heroDot, { backgroundColor: onTrack ? '#7ef0ad' : '#ffb4ac' }]} />
            <Text style={styles.heroPillText}>
              {onTrack
                ? 'On track · finishing on time'
                : `${data?.myOverdue} task${data?.myOverdue === 1 ? '' : 's'} overdue`}
            </Text>
          </View>
        </LinearGradient>

        {/* Quick stats */}
        <View style={styles.statRow}>
          <StatTile label="My open" value={data?.myOpen ?? 0} />
          <StatTile label="At risk" value={data?.myAtRisk ?? 0} accent={colors.accentDeep} />
          <StatTile label="Overdue" value={data?.myOverdue ?? 0} accent={colors.danger} />
        </View>

        {/* Awaiting your approval */}
        {signoffs.length > 0 && (
          <>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Awaiting your approval</Text>
              <View style={styles.approvalCount}>
                <Text style={styles.approvalCountText}>{signoffs.length}</Text>
              </View>
            </View>
            <View style={{ gap: 10 }}>
              {signoffs.map((a) => {
                const k = kindConfig[a.kind];
                return (
                  <Pressable
                    key={a.key}
                    onPress={() =>
                      a.taskId
                        ? router.push(`/(app)/task/${a.taskId}`)
                        : router.push({
                            pathname: '/(app)/variations/[projectId]',
                            params: { projectId: a.projectId, name: a.projectName },
                          })
                    }
                  >
                    {({ pressed }) => (
                      <Card style={pressed ? styles.pressed : undefined}>
                        <View style={styles.approvalRow}>
                          <View style={[styles.kindBadge, { backgroundColor: k.soft }]}>
                            <Text style={[styles.kindBadgeText, { color: k.deep }]}>{k.abbr}</Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.kindLabel, { color: k.deep }]}>{k.label}</Text>
                            <Text style={styles.approvalTitle} numberOfLines={1}>
                              {a.title}
                            </Text>
                            <Text style={styles.approvalMeta} numberOfLines={1}>
                              {a.projectName} · {a.detail}
                            </Text>
                          </View>
                          <Ionicons name="chevron-forward" size={16} color={colors.subtle} />
                        </View>
                      </Card>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

        {/* Projects */}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>{data?.isManager ? 'Projects' : 'My projects'}</Text>
          <Text style={styles.sectionCount}>{data?.projects.length ?? 0}</Text>
        </View>
        {(data?.projects ?? []).length === 0 ? (
          <Text style={styles.empty}>No projects yet.</Text>
        ) : (
          <View style={{ gap: 10 }}>
            {data!.projects.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => router.push({ pathname: '/(app)/project/[id]', params: { id: p.id, name: p.name } })}
              >
                {({ pressed }) => (
                  <Card style={pressed ? styles.pressed : undefined}>
                    <View style={styles.projRow}>
                      <Text style={styles.projName} numberOfLines={1}>
                        {p.name}
                      </Text>
                      <View style={styles.projRight}>
                        <Text style={styles.projPct}>{p.pct}%</Text>
                        <Ionicons name="chevron-forward" size={16} color={colors.subtle} />
                      </View>
                    </View>
                    <View style={{ marginTop: 10 }}>
                      <ProgressBar value={p.pct} />
                    </View>
                    <Text style={styles.projMeta}>
                      {p.done}/{p.total} tasks done
                    </Text>
                  </Card>
                )}
              </Pressable>
            ))}
          </View>
        )}

        <Pressable style={styles.viewTasks} onPress={() => router.push('/(app)/(tabs)/tasks')}>
          <Text style={styles.viewTasksText}>View all my tasks</Text>
          <Ionicons name="arrow-forward" size={16} color={colors.brand} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}
function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
function subline(data: HomeData | null, approvals: number): string {
  const day = new Date().toLocaleDateString(undefined, { weekday: 'long' });
  if (!data) return day;
  const bits = [day, `${data.myOpen} open task${data.myOpen === 1 ? '' : 's'}`];
  if (approvals > 0) bits.push(`${approvals} to sign off`);
  return bits.join(' · ');
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    content: { padding: 20, paddingBottom: 32, ...contentWidth },
    pressed: { opacity: 0.85 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    brandRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
    brandDot: {
      width: 34,
      height: 34,
      borderRadius: 10,
      backgroundColor: c.brand,
      alignItems: 'center',
      justifyContent: 'center',
    },
    wordmark: { fontSize: 18, fontFamily: font.displayBold, color: c.text, letterSpacing: -0.3 },
    headerRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    iconBtn: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    greeting: { marginTop: 18, fontSize: 27, lineHeight: 32, fontFamily: font.displayBold, color: c.text },
    subGreeting: { fontSize: 13, fontFamily: font.body, color: c.muted, marginTop: 8 },
    hero: { borderRadius: radius.lg, padding: 20, marginTop: 18, overflow: 'hidden' },
    heroTop: { flexDirection: 'row', alignItems: 'center', gap: 16 },
    heroLabel: { fontSize: 11, fontFamily: font.bodyBold, letterSpacing: 0.6, color: 'rgba(255,255,255,0.8)' },
    heroPct: { fontSize: 52, lineHeight: 58, fontFamily: font.displayBold, color: '#ffffff', marginTop: 2 },
    heroHint: { fontSize: 13, fontFamily: font.body, color: 'rgba(255,255,255,0.9)' },
    ringText: { fontSize: 15, fontFamily: font.displayBold, color: '#ffffff' },
    heroPill: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      backgroundColor: 'rgba(255,255,255,0.18)',
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 6,
      marginTop: 16,
    },
    heroDot: { width: 8, height: 8, borderRadius: 4 },
    heroPillText: { fontSize: 12.5, fontFamily: font.bodySemi, color: '#ffffff' },
    statRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
    sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 24, marginBottom: 10 },
    sectionTitle: { fontSize: 17, fontFamily: font.displayBold, color: c.text },
    sectionCount: { fontSize: 13, fontFamily: font.body, color: c.subtle },
    empty: { color: c.subtle, fontSize: 14, fontFamily: font.body },
    approvalCount: {
      minWidth: 22,
      height: 22,
      borderRadius: 11,
      paddingHorizontal: 7,
      backgroundColor: c.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    approvalCountText: { fontSize: 12, fontFamily: font.bodyBold, color: c.accentDeep },
    approvalRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    kindBadge: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    kindBadgeText: { fontSize: 12, fontFamily: font.displayBold, letterSpacing: 0.3 },
    kindLabel: { fontSize: 10.5, fontFamily: font.bodyBold, letterSpacing: 0.5, textTransform: 'uppercase' },
    approvalTitle: { fontSize: 14.5, fontFamily: font.bodyBold, color: c.text, marginTop: 1 },
    approvalMeta: { fontSize: 12, fontFamily: font.body, color: c.subtle, marginTop: 1 },
    projRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    projName: { fontSize: 15, fontFamily: font.bodyBold, color: c.text, flex: 1, marginRight: 8 },
    projRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    projPct: { fontSize: 15, fontFamily: font.display, color: c.brand },
    projMeta: { fontSize: 12, fontFamily: font.body, color: c.subtle, marginTop: 8 },
    viewTasks: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginTop: 22,
      paddingVertical: 12,
    },
    viewTasksText: { color: c.brand, fontFamily: font.bodyBold, fontSize: 14 },
  });
