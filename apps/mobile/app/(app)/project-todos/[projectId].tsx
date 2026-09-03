import { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { listProjectMembers, type Member } from '../../../lib/data/members';
import {
  listProjectActionItems,
  createActionItem,
  updateActionItem,
  setActionItemDone,
  deleteActionItem,
  canManageTodos,
  type ActionItem,
  type Urgency,
} from '../../../lib/data/action-items';
import { DateField } from '../../../components/date-field';
import { useSession } from '../../../lib/auth';
import { contentWidth, radius, font, type Colors } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';

const URGENCY_ORDER: Urgency[] = ['low', 'normal', 'high', 'urgent'];

/** Urgency → chip tone on a list row. 'normal' shows no chip (the quiet default). */
function urgencyTone(u: Urgency, c: Colors): { label: string; bg: string; fg: string } | null {
  switch (u) {
    case 'urgent':
      return { label: 'Urgent', bg: c.dangerSoft, fg: c.danger };
    case 'high':
      return { label: 'High', bg: c.accentSoft, fg: c.accentDeep };
    case 'low':
      return { label: 'Low', bg: c.sunk, fg: c.subtle };
    default:
      return null;
  }
}

function fmtDue(iso: string): string {
  const [, m, d] = iso.split('-');
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1];
  return `${mon} ${Number(d)}`;
}
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ProjectTodos() {
  const { projectId, name } = useLocalSearchParams<{ projectId: string; name?: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { session } = useSession();
  const meId = session?.user.id ?? null;

  const [items, setItems] = useState<ActionItem[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Composer: null = closed, 'new' = create, or the item being edited.
  const [composer, setComposer] = useState<'new' | ActionItem | null>(null);

  const load = useCallback(async () => {
    const [list, mem, manage] = await Promise.all([
      listProjectActionItems(String(projectId)),
      listProjectMembers(String(projectId)),
      canManageTodos(String(projectId)),
    ]);
    setItems(list);
    setMembers(mem);
    setCanManage(manage);
    setLoading(false);
  }, [projectId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  function canComplete(item: ActionItem): boolean {
    return !item.assigneeId || item.assigneeId === meId || canManage;
  }
  function canEdit(item: ActionItem): boolean {
    return canManage || item.createdBy === meId;
  }

  async function toggle(item: ActionItem) {
    const done = item.status === 'done';
    if (!done && !canComplete(item)) {
      Alert.alert('Not your to-do', `Only ${item.assigneeName ?? 'the assignee'} can complete this.`);
      return;
    }
    setBusyId(item.id);
    try {
      await setActionItemDone(item.id, String(projectId), !done);
      await load();
    } catch (e) {
      Alert.alert('Could not update', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  function confirmRemove(item: ActionItem) {
    Alert.alert('Remove to-do', `Remove "${item.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setBusyId(item.id);
          try {
            await deleteActionItem(item.id);
            await load();
          } catch (e) {
            Alert.alert('Could not remove', e instanceof Error ? e.message : 'Please try again.');
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior="padding">
      <Stack.Screen
        options={{
          title: 'To-dos',
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: { fontFamily: font.displayBold },
        }}
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {name ? <Text style={styles.project}>{name}</Text> : null}

        {composer ? (
          <Composer
            key={composer === 'new' ? 'new' : composer.id}
            projectId={String(projectId)}
            members={members}
            item={composer === 'new' ? undefined : composer}
            styles={styles}
            colors={colors}
            onCancel={() => setComposer(null)}
            onDone={() => {
              setComposer(null);
              void load();
            }}
          />
        ) : (
          <Pressable style={styles.addBtn} onPress={() => setComposer('new')}>
            <Ionicons name="add" size={18} color={colors.onBrand} />
            <Text style={styles.addBtnText}>New to-do</Text>
          </Pressable>
        )}

        {loading ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={colors.brand} />
        ) : items.length === 0 ? (
          <Text style={styles.empty}>No to-dos yet. Raise one to give someone a quick task with a deadline.</Text>
        ) : (
          <View style={styles.list}>
            {items.map((item) => {
              const done = item.status === 'done';
              const overdue = !done && item.dueDate != null && item.dueDate < todayIso();
              const tone = !done ? urgencyTone(item.urgency, colors) : null;
              const completable = canComplete(item);
              return (
                <View key={item.id} style={styles.rowItem}>
                  <Pressable
                    onPress={() => void toggle(item)}
                    disabled={busyId === item.id || (!done && !completable)}
                    hitSlop={8}
                    style={[styles.check, done && styles.checkDone, !done && !completable && styles.checkDisabled]}
                  >
                    {done ? <Ionicons name="checkmark" size={14} color={colors.onBrand} /> : null}
                  </Pressable>
                  <View style={styles.rowBody}>
                    <Text style={[styles.itemTitle, done && styles.itemTitleDone]}>{item.title}</Text>
                    <View style={styles.metaRow}>
                      {tone ? (
                        <View style={[styles.chipSmall, { backgroundColor: tone.bg }]}>
                          <Text style={[styles.chipSmallText, { color: tone.fg }]}>{tone.label}</Text>
                        </View>
                      ) : null}
                      <Text style={styles.metaText}>
                        {item.assigneeName ? `For ${item.assigneeName}` : 'Unassigned'}
                      </Text>
                      {item.dueDate ? (
                        <Text style={[styles.metaText, overdue && styles.overdue]}>Due {fmtDue(item.dueDate)}</Text>
                      ) : null}
                    </View>
                  </View>
                  {canEdit(item) && !done ? (
                    <Pressable onPress={() => setComposer(item)} hitSlop={8} style={styles.iconBtn}>
                      <Ionicons name="pencil" size={15} color={colors.subtle} />
                    </Pressable>
                  ) : null}
                  {canEdit(item) ? (
                    <Pressable onPress={() => confirmRemove(item)} hitSlop={8} style={styles.iconBtn}>
                      <Ionicons name="trash-outline" size={15} color={colors.subtle} />
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Composer({
  projectId,
  members,
  item,
  styles,
  colors,
  onCancel,
  onDone,
}: {
  projectId: string;
  members: Member[];
  item?: ActionItem;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [assignee, setAssignee] = useState<string | null>(item?.assigneeId ?? null);
  const [due, setDue] = useState<string | null>(item?.dueDate ?? null);
  const [urgency, setUrgency] = useState<Urgency>(item?.urgency ?? 'normal');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    if (title.trim().length < 2) {
      Alert.alert('Title required', 'Give the to-do a short title.');
      return;
    }
    setBusy(true);
    try {
      if (item) {
        await updateActionItem({ id: item.id, projectId, title, assigneeId: assignee, dueDate: due, urgency });
      } else {
        await createActionItem({ projectId, title, assigneeId: assignee, dueDate: due, urgency });
      }
      onDone();
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.composer}>
      <TextInput
        style={styles.input}
        placeholder="What needs doing?"
        placeholderTextColor={colors.subtle}
        value={title}
        onChangeText={setTitle}
        autoFocus
      />

      <Text style={styles.fieldLabel}>Urgency</Text>
      <View style={styles.chips}>
        {URGENCY_ORDER.map((u) => (
          <Pressable key={u} onPress={() => setUrgency(u)} style={[styles.chip, urgency === u && styles.chipActive]}>
            <Text style={[styles.chipText, urgency === u && styles.chipTextActive]}>{u}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.fieldLabel}>Assignee</Text>
      <View style={styles.chips}>
        <Pressable onPress={() => setAssignee(null)} style={[styles.chip, assignee === null && styles.chipActive]}>
          <Text style={[styles.chipText, assignee === null && styles.chipTextActive]}>Unassigned</Text>
        </Pressable>
        {members.map((m) => (
          <Pressable
            key={m.userId}
            onPress={() => setAssignee(m.userId)}
            style={[styles.chip, assignee === m.userId && styles.chipActive]}
          >
            <Text style={[styles.chipText, assignee === m.userId && styles.chipTextActive]}>{m.name}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.fieldLabel}>Due date</Text>
      <View style={{ flexDirection: 'row' }}>
        <DateField label="Due" value={due} onChange={setDue} min={todayIso()} />
      </View>

      <View style={styles.composerActions}>
        <Pressable style={[styles.submit, busy && styles.disabled]} onPress={submit} disabled={busy}>
          {busy ? (
            <ActivityIndicator color={colors.onBrand} />
          ) : (
            <Text style={styles.submitText}>{item ? 'Save' : 'Add to-do'}</Text>
          )}
        </Pressable>
        <Pressable onPress={onCancel} style={styles.cancelBtn}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16, gap: 14, paddingBottom: 40, ...contentWidth },
    project: { fontSize: 12, fontFamily: font.body, color: c.subtle, textTransform: 'uppercase', letterSpacing: 0.5 },
    addBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: c.brand,
      borderRadius: radius.sm,
      paddingVertical: 12,
    },
    addBtnText: { color: c.onBrand, fontFamily: font.bodyBold, fontSize: 15 },
    empty: { fontSize: 14, fontFamily: font.body, color: c.subtle, marginTop: 8 },
    list: { gap: 2 },
    rowItem: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    check: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1.5,
      borderColor: c.subtle,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 1,
    },
    checkDone: { backgroundColor: c.success, borderColor: c.success },
    checkDisabled: { opacity: 0.4 },
    rowBody: { flex: 1, gap: 3 },
    itemTitle: { fontSize: 15, fontFamily: font.bodySemi, color: c.text },
    itemTitleDone: { color: c.subtle, textDecorationLine: 'line-through' },
    metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
    metaText: { fontSize: 12, fontFamily: font.body, color: c.muted },
    overdue: { color: c.danger, fontFamily: font.bodySemi },
    chipSmall: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
    chipSmallText: { fontSize: 11, fontFamily: font.bodySemi },
    iconBtn: { padding: 4 },
    // Composer
    composer: {
      gap: 8,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.sm,
      padding: 12,
    },
    input: {
      backgroundColor: c.bg,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.sm,
      padding: 12,
      fontSize: 15,
      fontFamily: font.body,
      color: c.text,
    },
    fieldLabel: { fontSize: 13, fontFamily: font.bodyBold, color: c.text, marginTop: 4 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 8,
      backgroundColor: c.bg,
      borderWidth: 1,
      borderColor: c.border,
    },
    chipActive: { backgroundColor: c.text, borderColor: c.text },
    chipText: { fontSize: 13, fontFamily: font.bodySemi, color: c.muted, textTransform: 'capitalize' },
    chipTextActive: { color: c.bg },
    composerActions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
    submit: {
      flex: 1,
      backgroundColor: c.brand,
      borderRadius: radius.sm,
      paddingVertical: 13,
      alignItems: 'center',
    },
    disabled: { opacity: 0.6 },
    submitText: { color: c.onBrand, fontFamily: font.bodyBold, fontSize: 15 },
    cancelBtn: { paddingHorizontal: 8, paddingVertical: 10 },
    cancelText: { color: c.muted, fontFamily: font.bodySemi, fontSize: 14 },
  });
