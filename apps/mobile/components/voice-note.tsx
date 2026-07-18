import { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useTheme } from '../lib/theme-context';

function fmt(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** A playable voice-note bubble. One player per rendered audio message. Colours
 *  invert on the sender's own (dark) bubbles for contrast. */
export function VoiceNote({ url, mine }: { url: string; mine: boolean }) {
  const { colors } = useTheme();
  const player = useAudioPlayer(url);
  const status = useAudioPlayerStatus(player);

  // Reset to the start when a clip finishes so the next tap replays it.
  useEffect(() => {
    if (status.didJustFinish) player.seekTo(0);
  }, [status.didJustFinish, player]);

  const dur = status.duration || 0;
  const pos = status.currentTime || 0;
  const pct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0;

  const fg = mine ? colors.onBrand : colors.text;
  const trackBg = mine ? 'rgba(255,255,255,0.3)' : colors.border;

  function toggle() {
    if (status.playing) {
      player.pause();
    } else {
      if (dur > 0 && pos >= dur - 0.05) player.seekTo(0);
      player.play();
    }
  }

  return (
    <View style={styles.row}>
      <Pressable onPress={toggle} hitSlop={8} disabled={!status.isLoaded}>
        <Ionicons name={status.playing ? 'pause-circle' : 'play-circle'} size={32} color={fg} />
      </Pressable>
      <View style={styles.mid}>
        <View style={[styles.track, { backgroundColor: trackBg }]}>
          <View style={[styles.fill, { width: `${pct}%`, backgroundColor: fg }]} />
        </View>
        <Text style={[styles.time, { color: fg }]}>{fmt(pos > 0 || status.playing ? pos : dur)}</Text>
      </View>
      <Ionicons name="mic" size={13} color={fg} style={{ opacity: 0.55 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 168 },
  mid: { flex: 1, gap: 4 },
  track: { height: 3, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 3, borderRadius: 2 },
  time: { fontSize: 11, fontVariant: ['tabular-nums'] },
});
