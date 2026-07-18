import { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { TASK_PRIORITIES } from '@datumpro/shared/domain';
import { listProjectMembers, type Member } from '../../lib/data/members';
import { createTask } from '../../lib/data/task-actions';
import { contentWidth, radius, font, type Colors } from '../../lib/theme';
import { useTheme } from '../../lib/theme-context';

function isoOffset(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

export default function NewTask() {
  const { projectId, projectName } = useLocalSearchParams<{ projectId: string; projectName?: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [assignee, setAssignee] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      listProjectMembers(String(projectId)).then(setMembers);
    }, [projectId]),
  );

  async function submit() {
    if (busy) return;
    if (title.trim().length < 3) {
      Alert.alert('Title required', 'Give the task a short title.');
      return;
    }
    setBusy(true);
    try {
      const id = await createTask({
        projectId: String(projectId),
        title,
        description,
        priority,
        assigneeId: assignee,
        dueDate: dueDate || null,
      });
      router.replace(`/(app)/task/${id}`);
    } catch (e) {
      Alert.alert('Could not create task', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen
        options={{
          title: 'New task',
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: { fontFamily: font.displayBold },
        }}
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {projectName ? <Text style={styles.project}>{projectName}</Text> : null}

        <Field label="Title" styles={styles}>
          <TextInput
            style={styles.input}
            placeholder="e.g. Pour ground-floor slab"
            placeholderTextColor={colors.subtle}
            value={title}
            onChangeText={setTitle}
          />
        </Field>

        <Field label="Description" styles={styles}>
          <TextInput
            style={[styles.input, styles.multiline]}
            placeholder="Optional details"
            placeholderTextColor={colors.subtle}
            value={description}
            onChangeText={setDescription}
            multiline
          />
        </Field>

        <Field label="Priority" styles={styles}>
          <View style={styles.chips}>
            {TASK_PRIORITIES.map((p) => (
              <Pressable
                key={p}
                onPress={() => setPriority(p)}
                style={[styles.chip, priority === p && styles.chipActive]}
              >
                <Text style={[styles.chipText, priority === p && styles.chipTextActive]}>{p}</Text>
              </Pressable>
            ))}
          </View>
        </Field>

        <Field label="Assignee" styles={styles}>
          <View style={styles.chips}>
            <Pressable
              onPress={() => setAssignee(null)}
              style={[styles.chip, assignee === null && styles.chipActive]}
            >
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
        </Field>

        <Field label="Due date" styles={styles}>
          <TextInput
            style={styles.input}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.subtle}
            value={dueDate}
            onChangeText={setDueDate}
            autoCapitalize="none"
          />
          <View style={[styles.chips, { marginTop: 8 }]}>
            {[
              { label: 'Today', days: 0 },
              { label: '+1 week', days: 7 },
              { label: '+1 month', days: 30 },
            ].map((q) => (
              <Pressable key={q.label} onPress={() => setDueDate(isoOffset(q.days))} style={styles.chip}>
                <Text style={styles.chipText}>{q.label}</Text>
              </Pressable>
            ))}
          </View>
        </Field>

        <Pressable style={[styles.submit, busy && styles.disabled]} onPress={submit} disabled={busy}>
          {busy ? (
            <ActivityIndicator color={colors.onBrand} />
          ) : (
            <Text style={styles.submitText}>Create task</Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  children,
  styles,
}: {
  label: string;
  children: React.ReactNode;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16, gap: 16, paddingBottom: 40, ...contentWidth },
    project: { fontSize: 12, fontFamily: font.body, color: c.subtle, textTransform: 'uppercase', letterSpacing: 0.5 },
    field: { gap: 8 },
    label: { fontSize: 13, fontFamily: font.bodyBold, color: c.text },
    input: {
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.sm,
      padding: 12,
      fontSize: 15,
      fontFamily: font.body,
      color: c.text,
    },
    multiline: { minHeight: 80, textAlignVertical: 'top' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 8,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    chipActive: { backgroundColor: c.text, borderColor: c.text },
    chipText: { fontSize: 13, fontFamily: font.bodySemi, color: c.muted, textTransform: 'capitalize' },
    chipTextActive: { color: c.bg },
    submit: {
      backgroundColor: c.brand,
      borderRadius: radius.sm,
      paddingVertical: 15,
      alignItems: 'center',
      marginTop: 8,
    },
    disabled: { opacity: 0.6 },
    submitText: { color: c.onBrand, fontFamily: font.bodyBold, fontSize: 15 },
  });
