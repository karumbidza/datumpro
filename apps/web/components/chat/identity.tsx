import type { MemberType, ProjectRole } from '@datumpro/shared/access';

const ONLINE = '#22c55e';
const OFFLINE = '#d4d4d8';

/** Deterministic avatar hues. `senderIndex` maps a user id onto this palette AND
 *  onto BUBBLE_TINTS below — same index — so a person's avatar, name and message
 *  bubble all share one colour. */
const AVATAR_COLORS = ['#2563eb', '#7e22ce', '#c2410c', '#15803d', '#b45309', '#db2777', '#0891b2', '#4f46e5'];

export function senderIndex(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % AVATAR_COLORS.length;
}

export function avatarColor(id: string): string {
  return AVATAR_COLORS[senderIndex(id)]!;
}

/** Per-person bubble tint, index-aligned with AVATAR_COLORS. `name` tints the
 *  sender label; `bubble` tints the message background (light in light-mode,
 *  translucent in dark). Literal class strings so Tailwind's scanner keeps them. */
export const BUBBLE_TINTS: { name: string; bubble: string }[] = [
  { name: 'text-blue-700 dark:text-blue-300', bubble: 'bg-blue-50 dark:bg-blue-500/15' },
  { name: 'text-purple-700 dark:text-purple-300', bubble: 'bg-purple-50 dark:bg-purple-500/15' },
  { name: 'text-orange-700 dark:text-orange-300', bubble: 'bg-orange-50 dark:bg-orange-500/15' },
  { name: 'text-green-700 dark:text-green-300', bubble: 'bg-green-50 dark:bg-green-500/15' },
  { name: 'text-amber-700 dark:text-amber-300', bubble: 'bg-amber-50 dark:bg-amber-500/15' },
  { name: 'text-pink-700 dark:text-pink-300', bubble: 'bg-pink-50 dark:bg-pink-500/15' },
  { name: 'text-cyan-700 dark:text-cyan-300', bubble: 'bg-cyan-50 dark:bg-cyan-500/15' },
  { name: 'text-indigo-700 dark:text-indigo-300', bubble: 'bg-indigo-50 dark:bg-indigo-500/15' },
];

export function senderTint(id: string): { name: string; bubble: string } {
  return BUBBLE_TINTS[senderIndex(id)]!;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return '?';
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1]!;
  return (first[0]! + last[0]!).toUpperCase();
}

/** Role → pill label + tone classes (theme-aware). Owner/Admin come from
 *  member_type; everything else from the project role. Used by the People rail
 *  (as a pill) and the message identity line (label only). */
export function rolePill(role: ProjectRole, memberType: MemberType): { label: string; cls: string } {
  if (memberType === 'owner' || memberType === 'admin') {
    return {
      label: memberType === 'owner' ? 'Owner' : 'Admin',
      cls: 'bg-purple-50 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400',
    };
  }
  switch (role) {
    case 'pm':
      return { label: 'Project manager', cls: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400' };
    case 'contractor':
      return { label: 'Contractor', cls: 'bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400' };
    case 'client':
      return { label: 'Client', cls: 'bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-400' };
    case 'contributor':
      return { label: 'Contributor', cls: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300' };
    default:
      return { label: 'Viewer', cls: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400' };
  }
}

/** Profile picture, or deterministic coloured initials as a fallback. When
 *  `online` is supplied a presence dot is drawn (People rail); omit it for a
 *  bare avatar (message identity line). */
export function Avatar({
  name,
  avatarUrl,
  userId,
  size,
  online,
}: {
  name: string;
  avatarUrl?: string | null;
  userId: string;
  size: number;
  /** Presence dot: pass a boolean to draw it (green/grey); omit for no dot. */
  online?: boolean;
}) {
  const showDot = online !== undefined;
  const dot = size >= 64 ? 16 : 10;
  const border = size >= 64 ? 3 : 2;
  const dimmed = online === false;
  return (
    <span className="relative flex-shrink-0" style={{ width: size, height: size }}>
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt={name}
          className="rounded-full object-cover"
          style={{ width: size, height: size, opacity: dimmed ? 0.55 : 1 }}
        />
      ) : (
        <span
          className="flex items-center justify-center rounded-full font-semibold text-white"
          style={{
            width: size,
            height: size,
            background: avatarColor(userId),
            fontSize: size * 0.4,
            opacity: dimmed ? 0.55 : 1,
          }}
        >
          {initials(name)}
        </span>
      )}
      {showDot && (
        <span
          className="absolute bottom-0 right-0 rounded-full"
          style={{
            width: dot,
            height: dot,
            background: online ? ONLINE : OFFLINE,
            border: `${border}px solid var(--rail-avatar-ring, #fff)`,
          }}
        />
      )}
    </span>
  );
}
