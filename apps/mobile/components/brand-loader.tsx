import { useEffect, useMemo, useRef } from 'react';
import { View, Animated, StyleSheet, Easing } from 'react-native';
import { type Colors } from '../lib/theme';
import { useTheme } from '../lib/theme-context';

/** Dot centres tracing the DatumPro logo's up-trending line chart, in a 76×44 box. */
const DOTS = [
  { x: 8, y: 36 },
  { x: 30, y: 16 },
  { x: 50, y: 28 },
  { x: 68, y: 8 },
];

function segment(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  return { len, angle, left: midX - len / 2, top: midY - 1 };
}
const LINES = [segment(DOTS[0]!, DOTS[1]!), segment(DOTS[1]!, DOTS[2]!), segment(DOTS[2]!, DOTS[3]!)];

/** Branded loading indicator: the logo's connected-dots chart, each node lighting
 *  up left-to-right in a loop as if the line is "filling in". Drop-in for an
 *  ActivityIndicator. */
export function BrandLoader({ size = 1 }: { size?: number }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const v0 = useRef(new Animated.Value(0.25)).current;
  const v1 = useRef(new Animated.Value(0.25)).current;
  const v2 = useRef(new Animated.Value(0.25)).current;
  const v3 = useRef(new Animated.Value(0.25)).current;
  const values = [v0, v1, v2, v3];

  useEffect(() => {
    const pulse = (v: Animated.Value, i: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 170),
          Animated.timing(v, { toValue: 1, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.25, duration: 260, easing: Easing.in(Easing.quad), useNativeDriver: true }),
          Animated.delay((DOTS.length - 1 - i) * 170),
        ]),
      );
    const anims = values.map((v, i) => pulse(v, i));
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={[styles.box, { transform: [{ scale: size }] }]}>
      {LINES.map((l, i) => (
        <View
          key={`l${i}`}
          style={[
            styles.line,
            { width: l.len, left: l.left, top: l.top, transform: [{ rotate: `${l.angle}deg` }] },
          ]}
        />
      ))}
      {DOTS.map((d, i) => (
        <Animated.View
          key={`d${i}`}
          style={[styles.dot, { left: d.x - 5, top: d.y - 5, opacity: values[i]! }]}
        />
      ))}
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    box: { width: 76, height: 44 },
    line: { position: 'absolute', height: 2, borderRadius: 1, backgroundColor: c.brand, opacity: 0.35 },
    dot: {
      position: 'absolute',
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: c.brand,
    },
  });
