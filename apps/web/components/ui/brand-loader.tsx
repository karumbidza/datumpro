/** Branded loading indicator — the DatumPro logo's connected-dots line chart,
 *  each node lighting up left-to-right (CSS-only, no client JS). Drop-in
 *  replacement for a spinner. */
const DOTS = [
  { cx: 112, cy: 330 },
  { cx: 208, cy: 236 },
  { cx: 304, cy: 300 },
  { cx: 400, cy: 182 },
];

export function BrandLoader({ size = 72, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      className={className}
      role="status"
      aria-label="Loading"
    >
      <polyline
        points={DOTS.map((d) => `${d.cx},${d.cy}`).join(' ')}
        fill="none"
        stroke="#3686b9"
        strokeWidth={22}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.3}
      />
      {DOTS.map((d, i) => (
        <circle
          key={i}
          cx={d.cx}
          cy={d.cy}
          r={30}
          fill="#3686b9"
          style={{ animation: 'brand-pulse 1.4s ease-in-out infinite', animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </svg>
  );
}
