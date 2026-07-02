import { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { getTask, type TaskDetail } from '../../../lib/data/tasks';
import { Badge } from '../../../components/badge';
import { formatDate, slaLabel, slaTone, statusLabel } from '../../../lib/ui';

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      getTask(String(id)).then((t) => {
        if (!active) return;
        setTask(t);
        setLoading(false);
      });
      return () => {
        active = false;
      };
    }, [id]),
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!task) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Task not found or no longer accessible.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: task.projectName }} />
      <Text style={styles.title}>{task.title}</Text>
      <View style={styles.badges}>
        <Badge label={slaLabel(task.slaStatus)} tone={slaTone(task.slaStatus)} />
      </View>

      <Field label="Status" value={statusLabel(task.status)} />
      <Field label="Priority" value={task.priority} />
      <Field label="Due" value={formatDate(task.dueDate)} />
      <Field label="Planned" value={`${formatDate(task.plannedStartDate)} → ${formatDate(task.plannedEndDate)}`} />

      {task.description ? (
        <View style={styles.block}>
          <Text style={styles.label}>Description</Text>
          <Text style={styles.body}>{task.description}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 20, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  muted: { color: '#71717a' },
  title: { fontSize: 20, fontWeight: '700', color: '#18181b' },
  badges: { flexDirection: 'row', gap: 8 },
  fieldRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#f4f4f5' },
  label: { fontSize: 12, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: 0.5 },
  value: { fontSize: 14, color: '#3f3f46', fontWeight: '500' },
  block: { gap: 6, marginTop: 8 },
  body: { fontSize: 14, color: '#3f3f46', lineHeight: 20 },
});
