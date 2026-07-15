'use client';

import { useEffect, useState } from 'react';
import type { RosterMember, ActivityItem } from '@/lib/data/chat-roster';
import type { MemberType, ProjectRole } from '@datumpro/shared/access';
import { ChevronLeft, ChevronRight, Phone, Mail, MessageCircle, X } from '@/components/icons';

const ONLINE = '#22c55e';
const OFFLINE = '#d4d4d8';

/** Role → pill label + colors (the app's role/badge palette). Owner/Admin come
 *  from member_type; everything else from the project role. */
function rolePill(role: ProjectRole, memberType: MemberType): { label: string; bg: string; text: string } {
  if (memberType === 'owner') return { label: 'Owner', bg: '#faf5ff', text: '#7e22ce' };
  if (memberType === 'admin') return { label: 'Admin', bg: '#faf5ff', text: '#7e22ce' };
  switch (role) {
    case 'pm':
      return { label: 'Project manager', bg: '#eff6ff', text: '#1d4ed8' };
    case 'contractor':
      return { label: 'Contractor', bg: '#fff7ed', text: '#c2410c' };
    case 'client':
      return { label: 'Client', bg: '#f0fdf4', text: '#15803d' };
    case 'contributor':
      return { label: 'Contributor', bg: '#f4f4f5', text: '#52525b' };
    default:
      return { label: 'Viewer', bg: '#f4f4f5', text: '#52525b' };
  }
}

const AVATAR_COLORS = ['#2563eb', '#7e22ce', '#c2410c', '#15803d', '#b45309', '#db2777', '#0891b2', '#4f46e5'];

function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return '?';
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1]!;
  return (first[0]! + last[0]!).toUpperCase();
}

/** "Active 40m ago" from a last_active_at timestamp (or "Offline" if unknown). */
function activeAgo(iso: string | null): string {
  if (!iso) return 'Offline';
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'Active just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `Active ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Active ${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `Active ${days}d ago`;
}

function Avatar({ member, size, online }: { member: RosterMember; size: number; online: boolean }) {
  const dot = size >= 64 ? 16 : 10;
  const border = size >= 64 ? 3 : 2;
  return (
    <span className="relative flex-shrink-0" style={{ width: size, height: size }}>
      {member.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={member.avatarUrl}
          alt={member.name}
          className="rounded-full object-cover"
          style={{ width: size, height: size, opacity: online ? 1 : 0.55 }}
        />
      ) : (
        <span
          className="flex items-center justify-center rounded-full font-semibold text-white"
          style={{
            width: size,
            height: size,
            background: avatarColor(member.userId),
            fontSize: size * 0.4,
            opacity: online ? 1 : 0.55,
          }}
        >
          {initials(member.name)}
        </span>
      )}
      <span
        className="absolute bottom-0 right-0 rounded-full"
        style={{
          width: dot,
          height: dot,
          background: online ? ONLINE : OFFLINE,
          border: `${border}px solid var(--rail-avatar-ring, #fff)`,
        }}
      />
    </span>
  );
}

interface RailCommon {
  members: RosterMember[];
  onlineIds: Set<string>;
  currentUserId: string;
  selectedId: string | null;
  onSelect: (userId: string) => void;
  onBack: () => void;
  onMessage: (member: RosterMember) => void;
  loadActivity: (userId: string) => Promise<ActivityItem[]>;
  /** Mobile only — closes the whole rail overlay. */
  onClose?: () => void;
}

export function PeopleRail(props: RailCommon) {
  const selected = props.selectedId ? props.members.find((m) => m.userId === props.selectedId) ?? null : null;
  return selected ? (
    <MemberDetail member={selected} {...props} />
  ) : (
    <MemberList {...props} />
  );
}

function MemberList({ members, onlineIds, currentUserId, onSelect, onClose }: RailCommon) {
  const online = members
    .filter((m) => onlineIds.has(m.userId))
    .sort((a, b) => Number(a.role !== 'pm') - Number(b.role !== 'pm'));
  const offline = members.filter((m) => !onlineIds.has(m.userId));

  return (
    <>
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3.5 dark:border-zinc-800">
        <h3 className="text-[13px] font-semibold text-zinc-900 dark:text-white">People</h3>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-zinc-400">{members.length}</span>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close people"
              className="-mr-1 flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 lg:hidden dark:hover:bg-zinc-800"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {online.length > 0 && (
          <>
            <p className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.05em] text-zinc-400">
              Active now · {online.length}
            </p>
            {online.map((m) => (
              <PersonRow
                key={m.userId}
                member={m}
                online
                isMe={m.userId === currentUserId}
                onClick={() => onSelect(m.userId)}
              />
            ))}
          </>
        )}
        {offline.length > 0 && (
          <>
            <p className="px-2 pb-1 pt-3.5 text-[10px] font-medium uppercase tracking-[0.05em] text-zinc-400">
              Offline · {offline.length}
            </p>
            {offline.map((m) => (
              <PersonRow
                key={m.userId}
                member={m}
                online={false}
                isMe={m.userId === currentUserId}
                onClick={() => onSelect(m.userId)}
              />
            ))}
          </>
        )}
        {members.length === 0 && (
          <p className="px-2 py-8 text-center text-[13px] text-zinc-400">No members yet.</p>
        )}
      </div>
    </>
  );
}

function PersonRow({
  member,
  online,
  isMe,
  onClick,
}: {
  member: RosterMember;
  online: boolean;
  isMe: boolean;
  onClick: () => void;
}) {
  const pill = rolePill(member.role, member.memberType);
  const sub = online ? pill.label : activeAgo(member.lastActiveAt);
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[44px] w-full items-center gap-2.5 rounded-lg p-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
    >
      <span style={{ ['--rail-avatar-ring' as string]: '#fff' }}>
        <Avatar member={member} size={32} online={online} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-100">
          {member.name}
          {isMe && <span className="text-zinc-400"> (You)</span>}
        </span>
        <span className="block truncate text-[11px] text-zinc-400">{sub}</span>
      </span>
      <ChevronRight size={15} className="flex-shrink-0 text-zinc-300" />
    </button>
  );
}

function MemberDetail({
  member,
  onlineIds,
  currentUserId,
  onBack,
  onMessage,
  loadActivity,
  onClose,
}: RailCommon & { member: RosterMember }) {
  const online = onlineIds.has(member.userId);
  const pill = rolePill(member.role, member.memberType);
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);

  useEffect(() => {
    let active = true;
    setActivity(null);
    loadActivity(member.userId)
      .then((items) => active && setActivity(items))
      .catch(() => active && setActivity([]));
    return () => {
      active = false;
    };
  }, [member.userId, loadActivity]);

  return (
    <>
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-3 dark:border-zinc-800">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to people"
          className="flex h-[30px] w-[30px] items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <ChevronLeft size={18} />
        </button>
        <span className="text-[13px] font-semibold text-zinc-900 dark:text-white">People</span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close people"
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 lg:hidden dark:hover:bg-zinc-800"
          >
            <X size={16} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Identity */}
        <div className="flex flex-col items-center gap-2 border-b border-zinc-100 px-5 py-6 dark:border-zinc-800">
          <span style={{ ['--rail-avatar-ring' as string]: '#fff' }}>
            <Avatar member={member} size={72} online={online} />
          </span>
          <p className="text-base font-semibold text-zinc-900 dark:text-white">
            {member.name}
            {member.userId === currentUserId && <span className="text-zinc-400"> (You)</span>}
          </p>
          <p className={`text-xs ${online ? 'text-green-600' : 'text-zinc-400'}`}>
            {online ? 'Active now' : activeAgo(member.lastActiveAt)}
          </p>
          <span
            className="rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize"
            style={{ background: pill.bg, color: pill.text }}
          >
            {pill.label}
          </span>

          <div className="mt-2 flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => onMessage(member)}
              title="Message"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-white hover:bg-brand-700"
            >
              <MessageCircle size={16} />
            </button>
            <a
              href={member.phone ? `tel:${member.phone}` : undefined}
              aria-disabled={!member.phone}
              title={member.phone ? 'Call' : 'No phone number'}
              className={`flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-700 ${
                member.phone ? 'text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800' : 'pointer-events-none text-zinc-300'
              }`}
            >
              <Phone size={16} />
            </a>
            <a
              href={member.email ? `mailto:${member.email}` : undefined}
              aria-disabled={!member.email}
              title={member.email ? 'Email' : 'No email'}
              className={`flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-700 ${
                member.email ? 'text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800' : 'pointer-events-none text-zinc-300'
              }`}
            >
              <Mail size={16} />
            </a>
          </div>
        </div>

        {/* Contact */}
        {(member.phone || member.email) && (
          <div className="border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.05em] text-zinc-400">Contact</p>
            {member.phone && (
              <p className="flex items-center gap-2 py-1 text-[13px] text-zinc-700 dark:text-zinc-300">
                <Phone size={15} className="flex-shrink-0 text-zinc-400" /> {member.phone}
              </p>
            )}
            {member.email && (
              <p className="flex items-center gap-2 py-1 text-[13px] text-zinc-700 dark:text-zinc-300">
                <Mail size={15} className="flex-shrink-0 text-zinc-400" />
                <span className="truncate">{member.email}</span>
              </p>
            )}
          </div>
        )}

        {/* On this project */}
        <div className="border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.05em] text-zinc-400">On this project</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-zinc-50 px-3 py-2.5 dark:bg-zinc-900">
              <p className="text-xl font-semibold tabular-nums text-zinc-900 dark:text-white">{member.openTasks}</p>
              <p className="text-[11px] text-zinc-500">Open tasks</p>
            </div>
            <div className="rounded-lg bg-zinc-50 px-3 py-2.5 dark:bg-zinc-900">
              <p className="text-xl font-semibold tabular-nums text-zinc-900 dark:text-white">{member.doneTasks}</p>
              <p className="text-[11px] text-zinc-500">Completed</p>
            </div>
          </div>
        </div>

        {/* Recent activity */}
        <div className="px-5 py-4">
          <p className="mb-3 text-[10px] font-medium uppercase tracking-[0.05em] text-zinc-400">Recent activity</p>
          {activity === null ? (
            <p className="text-[12px] text-zinc-400">Loading…</p>
          ) : activity.length === 0 ? (
            <p className="text-[12px] text-zinc-400">No recent activity on this project.</p>
          ) : (
            <ul className="flex flex-col gap-3 border-l border-zinc-200 pl-3.5 dark:border-zinc-800">
              {activity.map((a) => (
                <li key={a.id} className="relative">
                  <span
                    className="absolute -left-[18px] top-1.5 h-[7px] w-[7px] rounded-full bg-zinc-300 dark:bg-zinc-600"
                  />
                  <p className="text-[13px] text-zinc-700 dark:text-zinc-300">{a.text}</p>
                  <p className="text-[11px] text-zinc-400">{relTimestamp(a.at)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

function relTimestamp(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}
