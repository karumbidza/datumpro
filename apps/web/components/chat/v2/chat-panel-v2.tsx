'use client';

/**
 * Chat v2 — the shared conversation surface for BOTH chat levels (the project
 * channel and the task DM render this same component, so they stay identical).
 *
 * v2 vs v1, by decision (Allen, 2026-09-07):
 * - Single left-aligned column (team channel, not SMS): no right-aligned own
 *   messages, no coloured bubbles. A row is tinted only when it @mentions you.
 * - True threads, whole-channel visibility: replies live in a rail thread view
 *   and leave the main stream; parents show a reply-count chip.
 * - Enter sends (Shift+Enter breaks); drafts persist per conversation; sends are
 *   optimistic with a real offline queue ("Will send when back online").
 * - Rich content: photo grids with geotag/time overlays, waveform voice notes,
 *   work-item link chips (# typeahead) and @mentions.
 */

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  sendMessage,
  editMessage,
  deleteMessage,
  toggleReaction,
  markRead,
  searchMessages,
  loadEarlier,
  loadSince,
  loadOne,
  loadThread,
  searchLinkTargets,
  getMemberActivity,
  pinMessage,
  unpinMessage,
  type AttachmentInput,
  type LinkInput,
} from '@/app/(app)/projects/[projectId]/chat/actions';
import type {
  ChatAttachment,
  ChatMessage,
  ChatSearchResult,
  ConversationFile,
  ChatAbout,
  PinnedMessage,
  MessageLink,
  LinkTargetOption,
} from '@/lib/data/chat';
import type { RosterMember } from '@/lib/data/chat-roster';
import {
  MessageCircle,
  Paperclip,
  Mic,
  Square,
  X,
  Download,
  FileText,
  Search,
  Users,
  ChevronDown,
  ChevronLeft,
  Reply,
  Pin,
  Pencil,
  Trash2,
  CheckCheck,
  MapPin,
  ImageIcon,
  Hash,
  AtSign,
  PanelRight,
  WifiOff,
  Send,
} from '@/components/icons';
import { NotifyToggle } from '@/components/chat/notify-toggle';
import { ChatRail } from '@/components/chat/chat-rail';
import { Avatar, senderTint, rolePill } from '@/components/chat/identity';
import { VoiceNote } from '@/components/chat/v2/waveform';
import { MAX_CHAT_MEDIA_BYTES, uploadSizeError } from '@/lib/upload-limits';

/* ── Constants & small helpers ────────────────────────────────────────────── */

const EMOJIS = ['👍', '✅', '❤️', '😂', '🎉', '👏'];
const GROUP_GAP_MS = 5 * 60 * 1000;

function fullTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function sameDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}
function dayLabel(iso: string, nowMs: number | null): string {
  const d = new Date(iso);
  const abs = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  if (nowMs == null) return abs;
  const sd = (x: Date, y: Date) => x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
  const today = new Date(nowMs);
  const yst = new Date(nowMs);
  yst.setDate(today.getDate() - 1);
  if (sd(d, today)) return 'Today';
  if (sd(d, yst)) return 'Yesterday';
  return abs;
}
function kindFromMime(mime: string): AttachmentInput['kind'] {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}
function extFromName(name: string, mime: string): string {
  const dot = name.lastIndexOf('.');
  if (dot >= 0 && dot < name.length - 1) return name.slice(dot + 1).toLowerCase();
  const sub = mime.split('/')[1] ?? 'bin';
  return sub.split(';')[0] || 'bin';
}
function formatBytes(n: number | null): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
function imageDimensions(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
function highlight(text: string, query: string): React.ReactNode {
  const terms = query
    .replace(/["'()|]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !['or', 'and', 'not'].includes(t.toLowerCase()));
  if (terms.length === 0) return text;
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${escaped.join('|')})`, 'ig');
  return text.split(re).map((p, i) =>
    re.test(p) ? (
      <mark key={i} className="rounded bg-amber-200 px-0.5 text-inherit dark:bg-amber-500/40">
        {p}
      </mark>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

/* ── Link chips ───────────────────────────────────────────────────────────── */

const CHIP_ROUTE: Record<MessageLink['targetType'], (projectId: string, id: string) => string> = {
  task: (p, id) => `/projects/${p}/tasks/${id}`,
  snag: (p) => `/projects/${p}/snags`,
  rfi: (p) => `/projects/${p}/rfis`,
  payment: (p) => `/projects/${p}/payments`,
  drawing: (p) => `/projects/${p}/drawings`,
};
const CHIP_KIND_LABEL: Record<MessageLink['targetType'], string> = {
  task: 'Task',
  snag: 'Snag',
  rfi: 'RFI',
  payment: 'Payment',
  drawing: 'Drawing',
};

/** Status → dot tone, matching the register pages' palette. */
function statusTone(status: string | null): string {
  if (!status) return 'bg-zinc-400';
  if (/done|closed|answered|paid|approved|complete/i.test(status)) return 'bg-green-500';
  if (/block|overdue|reject|breach/i.test(status)) return 'bg-red-500';
  if (/await|submitted|review|pending|open/i.test(status)) return 'bg-amber-500';
  if (/active|progress|issued/i.test(status)) return 'bg-brand-500';
  return 'bg-zinc-400';
}

function LinkChip({ link, projectId }: { link: MessageLink; projectId: string }) {
  return (
    <Link
      href={CHIP_ROUTE[link.targetType](projectId, link.targetId)}
      className="inline-flex max-w-[260px] items-center gap-1.5 rounded-full border border-zinc-200 bg-white py-0.5 pl-2 pr-2.5 text-xs text-zinc-700 transition-colors hover:border-brand-400 hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-brand-500"
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusTone(link.status)}`} aria-hidden />
      <span className="shrink-0 font-medium text-zinc-500 dark:text-zinc-400">{CHIP_KIND_LABEL[link.targetType]}</span>
      <span className="truncate">{link.label}</span>
      {link.status && (
        <span className="shrink-0 text-[11px] capitalize text-zinc-500 dark:text-zinc-400">{link.status.replace(/_/g, ' ')}</span>
      )}
    </Link>
  );
}

/* ── Attachments ──────────────────────────────────────────────────────────── */

function GeoOverlay({ a }: { a: ChatAttachment }) {
  if (a.lat == null && !a.takenAt) return null;
  return (
    <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/60 to-transparent px-1.5 pb-1 pt-4 text-[10px] font-medium text-white">
      <span className="flex items-center gap-0.5 truncate tabular-nums">
        {a.lat != null && (
          <>
            <MapPin size={10} /> {a.lat.toFixed(2)}, {a.lng?.toFixed(2)}
          </>
        )}
      </span>
      {a.takenAt && <span className="shrink-0 tabular-nums">{shortTime(a.takenAt)}</span>}
    </span>
  );
}

/** Photos as a tidy grid (2-up mobile / 3-up desktop) with evidence overlays;
 *  voice as a waveform; files as compact cards. */
function Attachments({ atts }: { atts: ChatAttachment[] }) {
  const images = atts.filter((a) => a.kind === 'image' && a.url);
  const rest = atts.filter((a) => a.kind !== 'image' || !a.url);
  return (
    <div className="flex flex-col gap-1.5">
      {images.length === 1 && (
        <a href={images[0]!.url!} target="_blank" rel="noreferrer" className="relative block w-fit overflow-hidden rounded-lg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={images[0]!.url!} alt={images[0]!.filename ?? 'Site photo'} className="max-h-72 max-w-full rounded-lg border border-zinc-200 object-cover dark:border-zinc-700" />
          <GeoOverlay a={images[0]!} />
        </a>
      )}
      {images.length > 1 && (
        <div className="grid w-full max-w-md grid-cols-2 gap-1 sm:grid-cols-3">
          {images.map((a) => (
            <a key={a.id} href={a.url!} target="_blank" rel="noreferrer" className="relative block aspect-square overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.url!} alt={a.filename ?? 'Site photo'} className="h-full w-full object-cover" />
              <GeoOverlay a={a} />
            </a>
          ))}
        </div>
      )}
      {rest.map((a) => {
        if (!a.url) {
          return (
            <div key={a.id} className="flex w-fit items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              <FileText size={14} /> {a.filename ?? 'Attachment'} · unavailable
            </div>
          );
        }
        if (a.kind === 'video') return <video key={a.id} src={a.url} controls className="max-h-72 max-w-full rounded-lg" />;
        if (a.kind === 'audio') return <VoiceNote key={a.id} url={a.url} durationSeconds={a.durationSeconds} />;
        return (
          <a
            key={a.id}
            href={a.url}
            target="_blank"
            rel="noreferrer"
            download={a.filename ?? undefined}
            className="flex w-fit items-center gap-2.5 rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-700 transition-colors hover:border-brand-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 dark:border-zinc-700 dark:text-zinc-200"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              <FileText size={15} />
            </span>
            <span className="min-w-0">
              <span className="block max-w-[220px] truncate font-medium">{a.filename ?? 'Document'}</span>
              <span className="text-zinc-500 dark:text-zinc-400">
                {(a.mime?.split('/')[1] ?? 'file').toUpperCase()}
                {a.sizeBytes ? ` · ${formatBytes(a.sizeBytes)}` : ''}
              </span>
            </span>
            <Download size={14} className="ml-2 shrink-0 text-zinc-400 dark:text-zinc-500" />
          </a>
        );
      })}
    </div>
  );
}

/* ── Local outbox (optimistic + offline queue) ────────────────────────────── */

interface OutboxItem {
  localId: string;
  body: string;
  links: { input: LinkInput; label: string }[];
  mentions: string[];
  parentMessageId?: string;
  state: 'sending' | 'queued' | 'failed';
  createdAt: string;
}

function outboxKey(conversationId: string) {
  return `dp-chat-outbox-${conversationId}`;
}
function draftKey(conversationId: string) {
  return `dp-chat-draft-${conversationId}`;
}

/* ── Menu item (unchanged from v1) ────────────────────────────────────────── */

function MenuItem({ icon, label, onClick, danger, active }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean; active?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs transition hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
        danger ? 'text-red-600 dark:text-red-400' : active ? 'text-brand-600 dark:text-brand-400' : 'text-zinc-700 dark:text-zinc-200'
      }`}
    >
      <span className="shrink-0 opacity-80">{icon}</span>
      {label}
    </button>
  );
}


/** Everything a message row needs from the panel. Passed as one object so the
 *  row component itself stays a stable module-level type. */
interface RowCtx {
  now: number | null;
  newDividerSeq: number | null;
  currentUserId: string;
  projectId: string;
  rosterById: Map<string, RosterMember>;
  liveReplyCount: Map<string, number>;
  editingId: string | null;
  editingBody: string;
  setEditingBody: (v: string) => void;
  setEditingId: (v: string | null) => void;
  saveEdit: () => void;
  othersRead: number;
  openMenuId: string | null;
  setOpenMenuId: React.Dispatch<React.SetStateAction<string | null>>;
  onReact: (id: string, emoji: string) => void;
  openThread: (id: string) => void;
  pinnedSet: Set<string>;
  togglePin: (id: string) => void;
  canModerate: boolean;
  applyOne: (id: string) => Promise<void>;
}

/* ── Message row (module scope: a stable component type — defining this
   inside the panel remounted every row per keystroke, making waveforms
   flicker while typing) ───────────────────────────────────────────────────────── */

function MessageRow({ m, prev, inThread, ctx }: { m: ChatMessage; prev: ChatMessage | null; inThread?: boolean; ctx: RowCtx }) {
  const mine = m.senderId === ctx.currentUserId;
  const mentionsMe = m.mentionedUserIds.includes(ctx.currentUserId);
  const showDate = !inThread && (!prev || !sameDay(prev.createdAt, m.createdAt));
  const showHeader =
    showDate || !prev || prev.senderId !== m.senderId || new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > GROUP_GAP_MS;
  const meta = ctx.rosterById.get(m.senderId);
  const tint = senderTint(m.senderId);
  const company = meta?.company ?? null;
  const role = meta ? rolePill(meta.role, meta.memberType).label : null;
  const replies = Math.max(m.replyCount, ctx.liveReplyCount.get(m.id) ?? 0);
  const side = mine ? 'items-end' : 'items-start';

  return (
    <Fragment>
      {showDate && (
        <div className="my-5 text-center" role="separator" aria-label={dayLabel(m.createdAt, ctx.now)}>
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{dayLabel(m.createdAt, ctx.now)}</span>
        </div>
      )}
      {!inThread && ctx.newDividerSeq != null && m.seq === ctx.newDividerSeq && (
        <div className="my-3 flex items-center gap-3" role="separator" aria-label="New messages">
          <span className="h-px flex-1 bg-red-300 dark:bg-red-500/50" />
          <span className="text-[11px] font-semibold text-red-600 dark:text-red-400">New</span>
          <span className="h-px flex-1 bg-red-300 dark:bg-red-500/50" />
        </div>
      )}
      <div className={`group relative flex gap-2.5 ${mine ? 'flex-row-reverse' : ''} ${showHeader && !showDate ? 'mt-4' : showDate ? '' : 'mt-1'}`}>
        {/* Gutter: others get an avatar on the group header; grouped follow-ups
            show the time on hover. Own messages have no gutter (Teams). */}
        {!mine && (
          <div className="w-8 flex-shrink-0 self-end pb-0.5">
            {showHeader ? (
              <Avatar name={m.senderName} avatarUrl={meta?.avatarUrl} userId={m.senderId} size={30} />
            ) : (
              <span className="hidden text-[10px] tabular-nums leading-4 text-zinc-500 group-hover:block dark:text-zinc-400">
                {shortTime(m.createdAt)}
              </span>
            )}
          </div>
        )}

        <div className={`flex min-w-0 max-w-[min(72ch,85%)] flex-col ${side}`}>
          {showHeader && (
            <p className={`mb-1 flex flex-wrap items-baseline gap-x-1.5 text-[11px] leading-4 text-zinc-500 dark:text-zinc-400 ${mine ? 'flex-row-reverse' : ''}`}>
              {mine ? (
                <span className="tabular-nums" title={fullTime(m.createdAt)}>
                  {shortTime(m.createdAt)}
                </span>
              ) : (
                <>
                  <span className={`text-[13px] font-semibold ${tint.name}`}>{m.senderName}</span>
                  {company && <span>{company}</span>}
                  {role && <span>· {role}</span>}
                  <span className="tabular-nums" title={fullTime(m.createdAt)}>
                    · {shortTime(m.createdAt)}
                  </span>
                </>
              )}
              {m.editedAt && !m.deletedAt && <span>· edited</span>}
            </p>
          )}

          {editingRow(ctx, m) ? (
            <div className="flex w-full items-center gap-1.5">
              <input
                value={ctx.editingBody}
                onChange={(e) => ctx.setEditingBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') ctx.saveEdit();
                  if (e.key === 'Escape') ctx.setEditingId(null);
                }}
                className="w-full max-w-md rounded-lg border border-brand-400 bg-white px-3 py-2 text-[15px] outline-none dark:border-brand-500 dark:bg-zinc-900"
                autoFocus
              />
              <button onClick={ctx.saveEdit} className="text-xs font-medium text-brand-600 hover:underline">
                Save
              </button>
              <button onClick={() => ctx.setEditingId(null)} className="text-xs text-zinc-500 hover:underline">
                Cancel
              </button>
            </div>
          ) : m.deletedAt ? (
            <p className={`rounded-lg px-3.5 py-2 text-[15px] italic ${bubbleCls(mine, false)} text-zinc-500 dark:text-zinc-400`}>message deleted</p>
          ) : (
            m.body && (
              <div className={`rounded-lg px-3.5 py-2 ${bubbleCls(mine, mentionsMe)}`}>
                <p className="whitespace-pre-wrap break-words text-[15px] leading-[1.5] text-zinc-900 dark:text-zinc-100">{m.body}</p>
              </div>
            )
          )}

          {!m.deletedAt && m.attachments.length > 0 && (
            <div className={`mt-1 flex flex-col ${side}`}>
              <Attachments atts={m.attachments} />
            </div>
          )}

          {!m.deletedAt && m.links.length > 0 && (
            <div className={`mt-1.5 flex flex-wrap gap-1.5 ${mine ? 'justify-end' : ''}`}>
              {m.links.map((l) => (
                <LinkChip key={l.id} link={l} projectId={ctx.projectId} />
              ))}
            </div>
          )}

          {(m.reactions.length > 0 || (!inThread && replies > 0)) && (
            <div className={`mt-1 flex flex-wrap items-center gap-1.5 ${mine ? 'justify-end' : ''}`}>
              {m.reactions.map((r) => (
                <button
                  key={r.emoji}
                  onClick={() => ctx.onReact(m.id, r.emoji)}
                  aria-label={`${r.emoji} ${r.count} — toggle reaction`}
                  className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition-colors ${
                    r.mine
                      ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-500/50 dark:bg-brand-500/15 dark:text-brand-300'
                      : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300'
                  }`}
                >
                  <span>{r.emoji}</span>
                  <span className="tabular-nums">{r.count}</span>
                </button>
              ))}
              {!inThread && replies > 0 && (
                <button
                  type="button"
                  onClick={() => ctx.openThread(m.id)}
                  className="flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-xs font-medium text-brand-700 transition-colors hover:border-brand-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-brand-300"
                >
                  <MessageCircle size={11} />
                  {replies} {replies === 1 ? 'reply' : 'replies'}
                </button>
              )}
            </div>
          )}

          {/* Delivery state under own bubbles, Teams-style. */}
          {mine && !m.deletedAt && !editingRow(ctx, m) && (
            <span className="mt-0.5 flex items-center" title={ctx.othersRead >= m.seq ? 'Read' : 'Sent'}>
              <CheckCheck size={13} className={ctx.othersRead >= m.seq ? 'text-sky-500' : 'text-zinc-400 dark:text-zinc-500'} />
              <span className="sr-only">{ctx.othersRead >= m.seq ? 'Read by others' : 'Sent'}</span>
            </span>
          )}
        </div>

        {/* Hover toolbar: six reactions, reply, overflow. */}
        {!m.deletedAt && !editingRow(ctx, m) && (
          <div
            data-msg-menu
            className={`absolute -top-3.5 z-20 hidden items-center gap-0.5 rounded-full border border-zinc-200 bg-white px-1 py-0.5 shadow-sm group-hover:flex dark:border-zinc-700 dark:bg-zinc-900 ${
              mine ? 'left-2' : 'right-2'
            }`}
          >
            {EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => ctx.onReact(m.id, e)}
                aria-label={`React ${e}`}
                className="rounded-full p-0.5 text-sm leading-none transition-transform hover:scale-125 motion-reduce:transition-none"
              >
                {e}
              </button>
            ))}
            {!inThread && (
              <button
                type="button"
                onClick={() => ctx.openThread(m.id)}
                aria-label="Reply in thread"
                className="rounded-full p-1 text-zinc-500 hover:text-brand-600 dark:text-zinc-400"
              >
                <Reply size={13} />
              </button>
            )}
            <button
              type="button"
              onClick={() => ctx.setOpenMenuId((cur) => (cur === m.id ? null : m.id))}
              aria-label="More actions"
              aria-haspopup="menu"
              aria-expanded={ctx.openMenuId === m.id}
              className="rounded-full p-1 text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              <ChevronDown size={13} />
            </button>
          </div>
        )}
        {ctx.openMenuId === m.id && (
          <div
            data-msg-menu
            role="menu"
            className={`absolute top-4 z-30 w-40 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 ${
              mine ? 'left-2' : 'right-2'
            }`}
          >
            <MenuItem
              icon={<Pin size={14} />}
              label={ctx.pinnedSet.has(m.id) ? 'Unpin' : 'Pin'}
              active={ctx.pinnedSet.has(m.id)}
              onClick={() => {
                ctx.togglePin(m.id);
                ctx.setOpenMenuId(() => null);
              }}
            />
            {mine && (
              <MenuItem
                icon={<Pencil size={14} />}
                label="Edit"
                onClick={() => {
                  ctx.setEditingId(m.id);
                  ctx.setEditingBody(m.body ?? '');
                  ctx.setOpenMenuId(() => null);
                }}
              />
            )}
            {(mine || ctx.canModerate) && (
              <MenuItem
                icon={<Trash2 size={14} />}
                label="Delete"
                danger
                onClick={() => {
                  void deleteMessage(m.id).then(() => ctx.applyOne(m.id));
                  ctx.setOpenMenuId(() => null);
                }}
              />
            )}
          </div>
        )}
      </div>
    </Fragment>
  );
}

/** Teams-style bubble surfaces: quiet grey for others, brand-tinted for own;
 *  a message that @mentions you gets a brand ring so it still stands out. */
function bubbleCls(mine: boolean, mentionsMe: boolean): string {
  const base = mine ? 'bg-brand-50 dark:bg-brand-500/15' : 'bg-zinc-100 dark:bg-zinc-800/70';
  return mentionsMe ? `${base} ring-1 ring-brand-400/70` : base;
}

function editingRow(ctx: RowCtx, m: ChatMessage): boolean {
  return ctx.editingId === m.id;
}

/* ── Thread rail content ───────────────────────────────────────────────── */

function ThreadRail({
ctx,
parent,
replies,
canPost,
value,
onChange,
sending,
onSend,
onClose,
}: {
ctx: RowCtx;
parent: ChatMessage;
replies: ChatMessage[];
canPost: boolean;
value: string;
onChange: (v: string) => void;
sending: boolean;
onSend: () => void;
onClose: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-zinc-200 px-3 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => onClose()}
          aria-label="Close thread"
          className="flex items-center gap-1 rounded-md p-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <ChevronLeft size={16} /> Back
        </button>
        <span className="text-sm font-semibold">Thread</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <MessageRow m={parent} prev={null} inThread ctx={ctx} />
        {replies.length > 0 && (
          <div className="my-2 flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
            {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
          </div>
        )}
        {replies.map((r, i) => (
          <MessageRow key={r.id} m={r} prev={i > 0 ? replies[i - 1]! : null} inThread ctx={ctx} />
        ))}
      </div>
      {canPost && (
        <div className="border-t border-zinc-200 p-2.5 dark:border-zinc-800">
          <div className="flex items-end gap-2 rounded-lg border border-zinc-300 focus-within:border-brand-600 dark:border-zinc-700">
            <textarea
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onSend();
                }
              }}
              rows={1}
              placeholder="Reply in thread…"
              aria-label="Reply in thread"
              className="max-h-28 w-full resize-none bg-transparent px-2.5 py-2 text-sm outline-none"
            />
            <button
              type="button"
              onClick={onSend}
              disabled={sending || !value.trim()}
              aria-label="Send reply"
              className="m-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-600 text-white transition-colors hover:bg-brand-700 disabled:opacity-40"
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


/* ── Empty state ───────────────────────────────────────────────────────── */

function EmptyState({
title,
people,
canPost,
projectId,
onlineIds,
onSharePhoto,
onMention,
}: {
title?: string;
people: RosterMember[];
canPost: boolean;
projectId: string;
onlineIds: Set<string>;
onSharePhoto: () => void;
onMention: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-10 text-center">
      <p className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
        {title ?? 'This conversation'}
        {people.length > 0 && <span className="font-normal text-zinc-500 dark:text-zinc-400"> · {people.length} people</span>}
      </p>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Post the first site update.</p>
      {canPost && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={onSharePhoto}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 transition-colors hover:border-brand-400 hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 dark:border-zinc-700 dark:text-zinc-200"
          >
            <ImageIcon size={14} /> Share a photo
          </button>
          <Link
            href={`/projects/${projectId}/diary`}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 transition-colors hover:border-brand-400 hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 dark:border-zinc-700 dark:text-zinc-200"
          >
            <FileText size={14} /> Post a site diary note
          </Link>
          <button
            type="button"
            onClick={onMention}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 transition-colors hover:border-brand-400 hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 dark:border-zinc-700 dark:text-zinc-200"
          >
            <AtSign size={14} /> Mention a contractor
          </button>
        </div>
      )}
      {people.length > 0 && (
        <div className="mt-8 flex items-center justify-center -space-x-1.5">
          {people.slice(0, 8).map((p) => (
            <span key={p.userId} title={p.name} className="rounded-full ring-2 ring-white dark:ring-zinc-950">
              <Avatar name={p.name} avatarUrl={p.avatarUrl} userId={p.userId} size={28} online={onlineIds.has(p.userId)} />
            </span>
          ))}
          {people.length > 8 && <span className="pl-3 text-xs text-zinc-500 dark:text-zinc-400">+{people.length - 8}</span>}
        </div>
      )}
    </div>
  );
}


/* ── Props ────────────────────────────────────────────────────────────────── */

interface PendingAttachment {
  localId: string;
  kind: AttachmentInput['kind'];
  file: Blob;
  filename: string;
  mime: string;
  sizeBytes: number;
  ext: string;
  previewUrl: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  takenAt?: string | null;
}

interface Props {
  conversationId: string;
  orgId: string;
  projectId: string;
  currentUserId: string;
  meName: string;
  initialMessages: ChatMessage[];
  othersReadSeq: number;
  /** The caller's own read cursor at page load — drives the "New" divider. */
  myReadSeq?: number;
  canPost: boolean;
  canModerate?: boolean;
  title?: string;
  subtitle?: string;
  className?: string;
  members?: RosterMember[];
  sharedFiles?: ConversationFile[];
  about?: ChatAbout | null;
  pinnedMessages?: PinnedMessage[];
  pinnedMessageIds?: string[];
  showRegisterLinks?: boolean;
  /** Rendered above the composer — the "Today on site" strip on project chat. */
  todayStrip?: React.ReactNode;
}

/* ── The panel ────────────────────────────────────────────────────────────── */

export function ChatPanelV2({
  conversationId,
  orgId,
  projectId,
  currentUserId,
  meName,
  initialMessages,
  othersReadSeq,
  myReadSeq = 0,
  canPost,
  canModerate = false,
  title,
  subtitle,
  className = '',
  members,
  sharedFiles,
  about,
  pinnedMessages,
  pinnedMessageIds,
  showRegisterLinks,
  todayStrip,
}: Props) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const pinnedSet = useMemo(() => new Set(pinnedMessageIds ?? []), [pinnedMessageIds]);

  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [othersRead, setOthersRead] = useState(othersReadSeq);
  const [input, setInput] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [typing, setTyping] = useState<Record<string, string>>({});
  const [onlineIds, setOnlineIds] = useState<Set<string>>(() => new Set());
  const [railOpen, setRailOpen] = useState(false); // mobile sheet
  const [railVisible, setRailVisible] = useState(true); // desktop Details toggle
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [pendingLinks, setPendingLinks] = useState<{ input: LinkInput; label: string; status: string | null }[]>([]);
  const [pendingMentions, setPendingMentions] = useState<{ userId: string; name: string }[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ChatSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [hasMore, setHasMore] = useState(initialMessages.length >= 50);
  const [now, setNow] = useState<number | null>(null);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [offline, setOffline] = useState(false);
  const [thread, setThread] = useState<string | null>(null); // parent message id
  const [threadInput, setThreadInput] = useState('');
  const [threadSending, setThreadSending] = useState(false);
  const [hintSeen, setHintSeen] = useState(true);
  const [justSent, setJustSent] = useState(false);
  // Typeahead popup ('#' work items / '@' people)
  const [ta, setTa] = useState<{ mode: 'link' | 'mention'; query: string; tokenStart: number } | null>(null);
  const [taOptions, setTaOptions] = useState<(LinkTargetOption | { userId: string; name: string; company: string | null })[]>([]);
  const [taIndex, setTaIndex] = useState(0);

  useEffect(() => setNow(Date.now()), []);

  // Draft + hint + queued outbox: restore once per conversation.
  useEffect(() => {
    try {
      setInput(localStorage.getItem(draftKey(conversationId)) ?? '');
      setHintSeen(localStorage.getItem('dp-chat-hint-seen') === '1');
      const raw = localStorage.getItem(outboxKey(conversationId));
      if (raw) {
        const items = (JSON.parse(raw) as OutboxItem[]).map((i) => ({ ...i, state: 'queued' as const }));
        setOutbox(items);
      }
    } catch {
      /* storage unavailable — drafts simply don't persist */
    }
    setOffline(typeof navigator !== 'undefined' && !navigator.onLine);
  }, [conversationId]);

  // Persist ONLY queued items (sending/failed are transient).
  const persistOutbox = useCallback(
    (items: OutboxItem[]) => {
      try {
        const queued = items.filter((i) => i.state === 'queued');
        if (queued.length === 0) localStorage.removeItem(outboxKey(conversationId));
        else localStorage.setItem(outboxKey(conversationId), JSON.stringify(queued));
      } catch {
        /* ignore */
      }
    },
    [conversationId],
  );

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastSeqRef = useRef(initialMessages.at(-1)?.seq ?? 0);
  const earliestSeqRef = useRef(initialMessages[0]?.seq ?? 0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const shouldScrollRef = useRef(true);
  const prependAnchor = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const typingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const lastTypingSent = useRef(0);
  const reactPending = useRef<Set<string>>(new Set());
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recChunks = useRef<Blob[]>([]);
  const recTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const recStart = useRef(0);
  const pendingRef = useRef<PendingAttachment[]>([]);
  const flushingRef = useRef(false);
  const outboxRef = useRef<OutboxItem[]>([]);
  useEffect(() => {
    outboxRef.current = outbox;
  }, [outbox]);

  const msgById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const rosterById = useMemo(() => new Map((members ?? []).map((m) => [m.userId, m])), [members]);

  // The stream shows top-level messages only; replies live in their thread.
  const streamMessages = useMemo(() => messages.filter((m) => !m.parentMessageId), [messages]);
  const liveReplyCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of messages) if (m.parentMessageId) counts.set(m.parentMessageId, (counts.get(m.parentMessageId) ?? 0) + 1);
    return counts;
  }, [messages]);

  // "New" divider: first not-own message beyond the read cursor at page load.
  const newDividerSeq = useMemo(() => {
    if (!myReadSeq) return null;
    const first = initialMessages.find((m) => m.seq > myReadSeq && m.senderId !== currentUserId);
    return first?.seq ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  const broadcast = useCallback((event: string, payload: Record<string, unknown>) => {
    channelRef.current?.send({ type: 'broadcast', event, payload });
  }, []);

  const applyMessages = useCallback((incoming: ChatMessage[], scroll: boolean) => {
    if (incoming.length === 0) return;
    setMessages((prev) => {
      const map = new Map(prev.map((m) => [m.id, m]));
      for (const m of incoming) map.set(m.id, m);
      return [...map.values()].sort((a, b) => a.seq - b.seq);
    });
    if (scroll) shouldScrollRef.current = true;
  }, []);

  const syncNew = useCallback(async () => {
    for (let guard = 0; guard < 20; guard++) {
      const fresh = await loadSince(conversationId, lastSeqRef.current);
      if (fresh.length === 0) break;
      applyMessages(fresh, true);
      lastSeqRef.current = Math.max(lastSeqRef.current, fresh.at(-1)!.seq);
      if (fresh.length < 200) break;
    }
    if (lastSeqRef.current > 0) {
      await markRead(conversationId, lastSeqRef.current);
      broadcast('read', { userId: currentUserId, seq: lastSeqRef.current });
    }
  }, [conversationId, currentUserId, broadcast, applyMessages]);

  const applyOne = useCallback(
    async (id: string) => {
      const m = await loadOne(conversationId, id);
      if (m) applyMessages([m], false);
    },
    [conversationId, applyMessages],
  );

  const showTyping = useCallback(
    (p: { userId?: string; name?: string } | undefined) => {
      if (!p?.userId || p.userId === currentUserId) return;
      setTyping((t) => ({ ...t, [p.userId!]: p.name || 'Someone' }));
      clearTimeout(typingTimers.current[p.userId]);
      typingTimers.current[p.userId] = setTimeout(() => {
        setTyping((t) => {
          const n = { ...t };
          delete n[p.userId!];
          return n;
        });
      }, 3000);
    },
    [currentUserId],
  );

  /* Offline / online transitions drive the queue. */
  const flushOutbox = useCallback(async () => {
    if (flushingRef.current) return;
    flushingRef.current = true;
    try {
      const items = outboxRef.current;
      for (const item of items.filter((i) => i.state === 'queued' || i.state === 'failed')) {
        setOutbox((cur) => {
          const next = cur.map((i) => (i.localId === item.localId ? { ...i, state: 'sending' as const } : i));
          persistOutbox(next);
          return next;
        });
        try {
          await sendMessage(
            conversationId,
            item.body,
            item.parentMessageId,
            undefined,
            item.links.map((l) => l.input),
            item.mentions,
          );
          setOutbox((cur) => {
            const next = cur.filter((i) => i.localId !== item.localId);
            persistOutbox(next);
            return next;
          });
        } catch {
          setOutbox((cur) => {
            const next = cur.map((i) => (i.localId === item.localId ? { ...i, state: 'queued' as const } : i));
            persistOutbox(next);
            return next;
          });
          break; // still offline — stop, retry on the next online event
        }
      }
      await syncNew();
    } finally {
      flushingRef.current = false;
    }
  }, [conversationId, persistOutbox, syncNew]);

  useEffect(() => {
    const onOnline = () => {
      setOffline(false);
      void flushOutbox();
    };
    const onOffline = () => setOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [flushOutbox]);

  /* Realtime channel — identical mechanics to v1. */
  useEffect(() => {
    let active = true;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.access_token) supabase.realtime.setAuth(session.access_token);
      const channel = supabase.channel(`chat:${conversationId}`, {
        config: { private: true, broadcast: { self: false }, presence: { key: currentUserId } },
      });
      channel
        .on('broadcast', { event: 'message' }, ({ payload }) => {
          if (!active) return;
          if (payload?.op === 'UPDATE' && payload?.id) void applyOne(String(payload.id));
          else void syncNew();
        })
        .on('broadcast', { event: 'reaction' }, ({ payload }) => {
          if (active && payload?.messageId) void applyOne(String(payload.messageId));
        })
        .on('broadcast', { event: 'typing' }, ({ payload }) => active && showTyping(payload))
        .on('broadcast', { event: 'read' }, ({ payload }) => {
          if (active && payload?.userId !== currentUserId) {
            setOthersRead((p) => Math.max(p, Number(payload?.seq) || 0));
          }
        })
        .on('presence', { event: 'sync' }, () => {
          const state = channel.presenceState() as Record<string, { user_id?: string }[]>;
          const ids = new Set<string>();
          for (const arr of Object.values(state)) for (const m of arr) if (m.user_id) ids.add(m.user_id);
          setOnlineIds(ids);
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            void channel.track({ user_id: currentUserId, name: meName });
            if (active) {
              void syncNew();
              void flushOutbox();
            }
          }
        });
      channelRef.current = channel;
    })();
    return () => {
      active = false;
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    const iv = setInterval(() => {
      void supabase.from('profiles').update({ last_active_at: new Date().toISOString() }).eq('id', currentUserId);
    }, 30_000);
    return () => clearInterval(iv);
  }, [supabase, currentUserId]);

  useLayoutEffect(() => {
    if (prependAnchor.current != null && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight - prependAnchor.current;
      prependAnchor.current = null;
      return;
    }
    if (shouldScrollRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      shouldScrollRef.current = false;
    }
  }, [messages, outbox]);

  async function onLoadEarlier() {
    if (loadingEarlier || !hasMore) return;
    setLoadingEarlier(true);
    if (scrollRef.current) prependAnchor.current = scrollRef.current.scrollHeight;
    try {
      const older = await loadEarlier(conversationId, earliestSeqRef.current);
      if (older.length) {
        earliestSeqRef.current = older[0]!.seq;
        applyMessages(older, false);
      }
      if (older.length < 50) setHasMore(false);
    } finally {
      setLoadingEarlier(false);
    }
  }

  useEffect(() => {
    return () => {
      pendingRef.current.forEach((a) => URL.revokeObjectURL(a.previewUrl));
      if (recTimer.current) clearInterval(recTimer.current);
      if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    };
  }, []);

  /* Search (debounced FTS, unchanged). */
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    let active = true;
    const t = setTimeout(async () => {
      try {
        const res = await searchMessages(conversationId, q);
        if (active) setSearchResults(res);
      } finally {
        if (active) setSearching(false);
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [searchQuery, conversationId]);

  function closeSearch() {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults(null);
  }

  /* Escape closes the thread; ArrowUp in an empty composer edits your last message. */
  useEffect(() => {
    if (!thread) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setThread(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [thread]);

  /* Close message menus on outside click / Escape. */
  useEffect(() => {
    if (!openMenuId) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('[data-msg-menu]')) setOpenMenuId(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenuId(null);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMenuId]);

  /* ── Typeahead ─────────────────────────────────────────────────────────── */

  const detectToken = useCallback((value: string, caret: number) => {
    const upto = value.slice(0, caret);
    const at = Math.max(upto.lastIndexOf('@'), upto.lastIndexOf('#'));
    if (at < 0) return null;
    const token = upto.slice(at + 1);
    if (/\s/.test(token)) return null; // token broken by whitespace
    if (at > 0 && !/\s/.test(upto[at - 1]!)) return null; // mid-word @/#
    return { mode: upto[at] === '@' ? ('mention' as const) : ('link' as const), query: token, tokenStart: at };
  }, []);

  useEffect(() => {
    if (!ta) return;
    if (ta.mode === 'mention') {
      const q = ta.query.toLowerCase();
      const opts = (members ?? [])
        .filter((m) => m.userId !== currentUserId)
        .filter((m) => !q || m.name.toLowerCase().includes(q) || (m.company ?? '').toLowerCase().includes(q))
        .slice(0, 6)
        .map((m) => ({ userId: m.userId, name: m.name, company: m.company }));
      setTaOptions(opts);
      setTaIndex(0);
      return;
    }
    let active = true;
    const t = setTimeout(async () => {
      try {
        const res = await searchLinkTargets(projectId, ta.query);
        if (active) {
          setTaOptions(res);
          setTaIndex(0);
        }
      } catch {
        if (active) setTaOptions([]);
      }
    }, 200);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [ta, members, currentUserId, projectId]);

  function pickTaOption(opt: (typeof taOptions)[number]) {
    if (!ta) return;
    const before = input.slice(0, ta.tokenStart);
    const after = input.slice(ta.tokenStart + 1 + ta.query.length);
    if ('userId' in opt) {
      const first = opt.name.split(/\s+/)[0] ?? opt.name;
      setInput(`${before}@${first} ${after}`);
      setPendingMentions((p) => (p.some((m) => m.userId === opt.userId) ? p : [...p, { userId: opt.userId, name: opt.name }]));
    } else {
      setInput(`${before}${after}`);
      setPendingLinks((p) =>
        p.some((l) => l.input.targetId === opt.targetId && l.input.targetType === opt.targetType)
          ? p
          : [...p, { input: { targetType: opt.targetType, targetId: opt.targetId }, label: opt.label, status: opt.status }],
      );
    }
    setTa(null);
    composerRef.current?.focus();
  }

  /* ── Composer ──────────────────────────────────────────────────────────── */

  function onInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setInput(value);
    try {
      if (value) localStorage.setItem(draftKey(conversationId), value);
      else localStorage.removeItem(draftKey(conversationId));
    } catch {
      /* ignore */
    }
    setTa(detectToken(value, e.target.selectionStart ?? value.length));
    // Auto-grow to 6 lines.
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 6 * 22 + 16)}px`;
    const t = Date.now();
    if (t - lastTypingSent.current > 1500) {
      lastTypingSent.current = t;
      broadcast('typing', { userId: currentUserId, name: meName });
    }
  }

  const uploadOne = useCallback(
    async (a: PendingAttachment): Promise<AttachmentInput> => {
      const path = `${orgId}/${projectId}/chat/${conversationId}/${crypto.randomUUID()}.${a.ext}`;
      const { error } = await supabase.storage.from('chat-media').upload(path, a.file, { contentType: a.mime, upsert: false });
      if (error) throw new Error(error.message);
      return {
        kind: a.kind,
        storagePath: path,
        mime: a.mime,
        filename: a.filename,
        sizeBytes: a.sizeBytes,
        durationSeconds: a.durationSeconds ?? null,
        width: a.width ?? null,
        height: a.height ?? null,
        takenAt: a.takenAt ?? null,
      };
    },
    [supabase, orgId, projectId, conversationId],
  );

  async function submit() {
    const body = input.trim();
    const toSend = pending;
    const links = pendingLinks;
    const mentions = pendingMentions.map((m) => m.userId);
    if (!body && toSend.length === 0 && links.length === 0) return;

    const localId = crypto.randomUUID();
    const item: OutboxItem = {
      localId,
      body,
      links: links.map((l) => ({ input: l.input, label: l.label })),
      mentions,
      state: 'sending',
      createdAt: new Date().toISOString(),
    };

    // Optimistic reset: the composer clears immediately; the message shows in
    // the stream as "sending…" until the server round-trip lands it.
    setInput('');
    setPendingLinks([]);
    setPendingMentions([]);
    setPending([]);
    setUploadError(null);
    try {
      localStorage.removeItem(draftKey(conversationId));
      if (!hintSeen) {
        localStorage.setItem('dp-chat-hint-seen', '1');
        setHintSeen(true);
      }
    } catch {
      /* ignore */
    }
    if (composerRef.current) composerRef.current.style.height = 'auto';

    // Attachments cannot be queued offline — the bytes need a connection now.
    if ((offline || !navigator.onLine) && toSend.length > 0) {
      setPending(toSend);
      setUploadError('Photos and files need a connection — text will queue, attachments won’t. Try again when you’re back online.');
      setInput(body);
      return;
    }

    setOutbox((cur) => [...cur, item]);
    shouldScrollRef.current = true;

    try {
      const uploaded = toSend.length > 0 ? await Promise.all(toSend.map(uploadOne)) : undefined;
      await sendMessage(conversationId, body, undefined, uploaded, links.map((l) => l.input), mentions);
      toSend.forEach((a) => URL.revokeObjectURL(a.previewUrl));
      setOutbox((cur) => cur.filter((i) => i.localId !== localId));
      setJustSent(true);
      setTimeout(() => setJustSent(false), 1500);
      await syncNew();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Send failed';
      const network = /fetch|network|failed to fetch|load failed/i.test(msg) || !navigator.onLine;
      if (network && toSend.length === 0) {
        setOffline(!navigator.onLine);
        setOutbox((cur) => {
          const next = cur.map((i) => (i.localId === localId ? { ...i, state: 'queued' as const } : i));
          persistOutbox(next);
          return next;
        });
      } else {
        setOutbox((cur) => cur.map((i) => (i.localId === localId ? { ...i, state: 'failed' as const } : i)));
        setUploadError(msg);
        if (toSend.length > 0) setPending(toSend);
      }
    }
  }

  function onComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (ta && taOptions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setTaIndex((i) => (i + 1) % taOptions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setTaIndex((i) => (i - 1 + taOptions.length) % taOptions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pickTaOption(taOptions[taIndex]!);
        return;
      }
      if (e.key === 'Escape') {
        setTa(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
      return;
    }
    if (e.key === 'ArrowUp' && !input) {
      const lastOwn = [...messages].reverse().find((m) => m.senderId === currentUserId && !m.deletedAt && m.body);
      if (lastOwn) {
        e.preventDefault();
        setEditingId(lastOwn.id);
        setEditingBody(lastOwn.body ?? '');
      }
    }
  }

  const addFiles = useCallback((files: FileList | File[]) => {
    setUploadError(null);
    const next: PendingAttachment[] = [];
    for (const file of Array.from(files)) {
      const sizeErr = uploadSizeError(file, MAX_CHAT_MEDIA_BYTES);
      if (sizeErr) {
        setUploadError(sizeErr);
        continue;
      }
      const mime = file.type || 'application/octet-stream';
      const kind = kindFromMime(mime);
      next.push({
        localId: crypto.randomUUID(),
        kind,
        file,
        filename: file.name,
        mime,
        sizeBytes: file.size,
        ext: extFromName(file.name, mime),
        previewUrl: URL.createObjectURL(file),
        // Browsers strip EXIF GPS from File APIs; capture time is the honest
        // metadata we do have on the web (mobile app supplies coordinates).
        takenAt: kind === 'image' && file.lastModified ? new Date(file.lastModified).toISOString() : null,
      });
    }
    if (next.length === 0) return;
    setPending((p) => [...p, ...next]);
    for (const a of next) {
      if (a.kind === 'image') {
        void imageDimensions(a.previewUrl).then((dim) => {
          if (!dim) return;
          setPending((p) => p.map((x) => (x.localId === a.localId ? { ...x, ...dim } : x)));
        });
      }
    }
  }, []);

  function removePending(localId: string) {
    setPending((p) => {
      const target = p.find((x) => x.localId === localId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return p.filter((x) => x.localId !== localId);
    });
  }

  async function startRecording() {
    setUploadError(null);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setUploadError('Voice recording is not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recChunks.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && recChunks.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (recTimer.current) clearInterval(recTimer.current);
        const type = rec.mimeType || 'audio/webm';
        const blob = new Blob(recChunks.current, { type });
        const seconds = Math.round((Date.now() - recStart.current) / 1000);
        setPending((p) => [
          ...p,
          {
            localId: crypto.randomUUID(),
            kind: 'audio',
            file: blob,
            filename: `voice-note.${type.includes('webm') ? 'webm' : 'ogg'}`,
            mime: type,
            sizeBytes: blob.size,
            ext: type.includes('webm') ? 'webm' : 'ogg',
            previewUrl: URL.createObjectURL(blob),
            durationSeconds: seconds,
          },
        ]);
        setRecording(false);
        setRecSeconds(0);
      };
      recorderRef.current = rec;
      recStart.current = Date.now();
      rec.start();
      setRecording(true);
      setRecSeconds(0);
      recTimer.current = setInterval(() => setRecSeconds((s) => s + 1), 1000);
    } catch {
      setUploadError('Microphone access was denied.');
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state !== 'inactive') recorderRef.current?.stop();
  }

  async function onReact(id: string, emoji: string) {
    const key = `${id}:${emoji}`;
    if (reactPending.current.has(key)) return;
    reactPending.current.add(key);
    try {
      await toggleReaction(id, emoji);
      broadcast('reaction', { messageId: id });
      await applyOne(id);
    } finally {
      reactPending.current.delete(key);
    }
  }

  async function saveEdit() {
    if (!editingId) return;
    const id = editingId;
    await editMessage(id, editingBody);
    setEditingId(null);
    await applyOne(id);
  }

  const togglePin = useCallback(
    async (messageId: string) => {
      const fd = new FormData();
      fd.set('messageId', messageId);
      fd.set('projectId', projectId);
      await (pinnedSet.has(messageId) ? unpinMessage(fd) : pinMessage(fd));
      router.refresh();
    },
    [projectId, pinnedSet, router],
  );

  /* ── Thread ────────────────────────────────────────────────────────────── */

  const openThread = useCallback(
    (parentId: string) => {
      setThread(parentId);
      setRailVisible(true);
      setRailOpen(true); // mobile sheet
      void loadThread(conversationId, parentId).then((replies) => applyMessages(replies, false));
    },
    [conversationId, applyMessages],
  );

  async function submitThreadReply() {
    const body = threadInput.trim();
    if (!body || !thread || threadSending) return;
    setThreadSending(true);
    try {
      await sendMessage(conversationId, body, thread);
      setThreadInput('');
      await syncNew();
      void loadThread(conversationId, thread).then((replies) => applyMessages(replies, false));
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Reply failed');
    } finally {
      setThreadSending(false);
    }
  }

  /* ── Derived ───────────────────────────────────────────────────────────── */

  const typingNames = Object.values(typing);
  const onlineOthers = onlineIds.size - (onlineIds.has(currentUserId) ? 1 : 0);
  const roster = members ?? null;
  const onlineCount = roster ? roster.filter((m) => onlineIds.has(m.userId)).length : onlineOthers;

  const focusComposer = useCallback((member: RosterMember) => {
    setRailOpen(false);
    setSelectedMemberId(null);
    composerRef.current?.focus();
    void member;
  }, []);

  const railProps = roster
    ? {
        members: roster,
        onlineIds,
        currentUserId,
        selectedId: selectedMemberId,
        onSelect: setSelectedMemberId,
        onBack: () => setSelectedMemberId(null),
        onMessage: focusComposer,
        loadActivity: (userId: string) => getMemberActivity(projectId, userId),
      }
    : null;

  const threadParent = thread ? msgById.get(thread) : null;
  const threadReplies = thread ? messages.filter((m) => m.parentMessageId === thread) : [];

  /* Row context: plain object, rebuilt per render — the component TYPES above
     are stable, so rows update in place instead of remounting. */
  const rowCtx: RowCtx = {
    now,
    newDividerSeq,
    currentUserId,
    projectId,
    rosterById,
    liveReplyCount,
    editingId,
    editingBody,
    setEditingBody,
    setEditingId,
    saveEdit: () => void saveEdit(),
    othersRead,
    openMenuId,
    setOpenMenuId,
    onReact: (id, emoji) => void onReact(id, emoji),
    openThread,
    pinnedSet,
    togglePin: (id) => void togglePin(id),
    canModerate,
    applyOne,
  };

  /* ── Render ────────────────────────────────────────────────────────────── */

  return (
    <div className={`flex min-h-0 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 ${className}`}>
      <div className="flex min-w-0 flex-1 flex-col">
        {title && (
          <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
            <MessageCircle size={18} className="text-zinc-500 dark:text-zinc-400" />
            <h2 className="truncate text-sm font-semibold text-zinc-900 dark:text-white">{title}</h2>
            <div className="ml-auto flex items-center gap-1.5">
              {offline && (
                <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-400">
                  <WifiOff size={11} /> Offline
                </span>
              )}
              {roster ? (
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {roster.length} members · {onlineCount} online
                </span>
              ) : (
                onlineOthers > 0 && (
                  <span className="flex items-center gap-1 text-[11px] text-green-600 dark:text-green-400">● {onlineOthers} online</span>
                )
              )}
              {railProps && (
                <button
                  type="button"
                  onClick={() => setRailOpen(true)}
                  aria-label="Show details"
                  className="flex items-center gap-1 rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 lg:hidden dark:hover:bg-zinc-800"
                >
                  <Users size={16} />
                </button>
              )}
              <NotifyToggle />
              <button
                type="button"
                onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
                aria-label={searchOpen ? 'Close search' : 'Search messages'}
                title={searchOpen ? 'Close search' : 'Search messages'}
                className={`rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${searchOpen ? 'text-brand-600' : 'text-zinc-500 dark:text-zinc-400'}`}
              >
                {searchOpen ? <X size={16} /> : <Search size={16} />}
              </button>
              {railProps && (
                <button
                  type="button"
                  onClick={() => setRailVisible((v) => !v)}
                  aria-label={railVisible ? 'Hide details' : 'Show details'}
                  aria-pressed={railVisible}
                  title="Details"
                  className={`hidden rounded p-1 hover:bg-zinc-100 lg:block dark:hover:bg-zinc-800 ${railVisible ? 'text-brand-600' : 'text-zinc-500 dark:text-zinc-400'}`}
                >
                  <PanelRight size={16} />
                </button>
              )}
            </div>
          </header>
        )}

        {searchOpen && (
          <div className="border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
            <div className="flex items-center gap-2 rounded-lg border border-zinc-200 px-2 focus-within:border-brand-600 dark:border-zinc-700">
              <Search size={14} className="text-zinc-500 dark:text-zinc-400" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
                placeholder="Search this conversation…"
                className="w-full bg-transparent py-1.5 text-sm outline-none"
              />
              {searchQuery && (
                <button type="button" onClick={() => setSearchQuery('')} aria-label="Clear search" className="text-zinc-500 hover:text-zinc-700 dark:text-zinc-400">
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        )}
        {subtitle && (
          <p className="border-b border-zinc-100 px-4 py-1.5 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">{subtitle}</p>
        )}

        {searchOpen && searchResults !== null ? (
          <div className="flex-1 space-y-2 overflow-y-auto p-4">
            {searching && searchResults.length === 0 ? (
              <p className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">Searching…</p>
            ) : searchResults.length === 0 ? (
              <p className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">No messages match “{searchQuery.trim()}”.</p>
            ) : (
              <>
                <p className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {searchResults.length} match{searchResults.length === 1 ? '' : 'es'}
                </p>
                {searchResults.map((r) => (
                  <div key={r.id} className="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800">
                    <p className="mb-1 flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                      <span className="font-medium text-zinc-700 dark:text-zinc-300">{r.senderName}</span>
                      <span className="tabular-nums">· {fullTime(r.createdAt)}</span>
                    </p>
                    <p className="whitespace-pre-wrap break-words text-sm text-zinc-800 dark:text-zinc-200">{highlight(r.body, searchQuery)}</p>
                  </div>
                ))}
              </>
            )}
          </div>
        ) : (
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
            {hasMore && streamMessages.length > 0 && (
              <div className="flex justify-center pb-2">
                <button
                  type="button"
                  onClick={onLoadEarlier}
                  disabled={loadingEarlier}
                  className="rounded-full border border-zinc-200 px-3 py-1 text-[11px] text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                  {loadingEarlier ? 'Loading…' : 'Load earlier messages'}
                </button>
              </div>
            )}
            {streamMessages.length === 0 && outbox.length === 0 ? (
              <EmptyState
                title={title}
                people={roster ?? []}
                canPost={canPost}
                projectId={projectId}
                onlineIds={onlineIds}
                onSharePhoto={() => photoInputRef.current?.click()}
                onMention={() => {
                  setInput((v) => (v.endsWith('@') || v === '' ? `${v}@` : `${v} @`));
                  composerRef.current?.focus();
                  setTa({ mode: 'mention', query: '', tokenStart: input.length });
                }}
              />
            ) : (
              streamMessages.map((m, i) => <MessageRow key={m.id} m={m} prev={i > 0 ? streamMessages[i - 1]! : null} ctx={rowCtx} />)
            )}

            {/* Outbox: optimistic sends and the offline queue, in stream order. */}
            {outbox.map((o) => (
              <div key={o.localId} className="mt-3 flex flex-col items-end opacity-90">
                <p className="mb-1 flex items-center gap-1 text-[11px] leading-4">
                  {o.state === 'sending' && <span className="text-zinc-500 dark:text-zinc-400">sending…</span>}
                  {o.state === 'queued' && (
                    <span className="flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400">
                      <WifiOff size={10} /> Will send when back online
                    </span>
                  )}
                  {o.state === 'failed' && <span className="font-medium text-red-600 dark:text-red-400">failed — will retry</span>}
                </p>
                {o.body && (
                  <div className="max-w-[min(72ch,85%)] rounded-lg bg-brand-50 px-3.5 py-2 dark:bg-brand-500/15">
                    <p className="whitespace-pre-wrap break-words text-[15px] leading-[1.5] text-zinc-900 dark:text-zinc-100">{o.body}</p>
                  </div>
                )}
                {o.links.length > 0 && (
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{o.links.map((l) => l.label).join(' · ')}</p>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}

        {typingNames.length > 0 && (
          <div className="flex items-center gap-2 px-4 pb-1">
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-400 [animation-delay:-0.3s] motion-reduce:animate-none dark:bg-zinc-500" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-400 [animation-delay:-0.15s] motion-reduce:animate-none dark:bg-zinc-500" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-400 motion-reduce:animate-none dark:bg-zinc-500" />
            </span>
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
              {typingNames.join(', ')} {typingNames.length === 1 ? 'is' : 'are'} typing…
            </span>
          </div>
        )}

        {todayStrip}

        {canPost && (
          <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
            {pending.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {pending.map((a) => (
                  <div key={a.localId} className="relative flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-1.5 pr-6 text-[11px] dark:border-zinc-700 dark:bg-zinc-900">
                    {a.kind === 'image' ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.previewUrl} alt={a.filename} className="h-10 w-10 rounded object-cover" />
                    ) : a.kind === 'audio' ? (
                      <span className="flex items-center gap-1 text-zinc-600 dark:text-zinc-300">
                        <Mic size={14} /> Voice note{a.durationSeconds ? ` · ${a.durationSeconds}s` : ''}
                      </span>
                    ) : (
                      <span className="flex max-w-[160px] items-center gap-1 truncate text-zinc-600 dark:text-zinc-300">
                        <FileText size={14} /> {a.filename}
                      </span>
                    )}
                    <button type="button" onClick={() => removePending(a.localId)} className="absolute right-1 top-1 text-zinc-500 hover:text-red-500 dark:text-zinc-400" aria-label="Remove attachment">
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {pendingLinks.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {pendingLinks.map((l) => (
                  <span key={`${l.input.targetType}:${l.input.targetId}`} className="flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 py-0.5 pl-2 pr-1 text-xs text-brand-800 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-brand-300">
                    <span className={`h-1.5 w-1.5 rounded-full ${statusTone(l.status)}`} aria-hidden />
                    <span className="max-w-[200px] truncate">{l.label}</span>
                    <button
                      type="button"
                      onClick={() => setPendingLinks((p) => p.filter((x) => x !== l))}
                      aria-label={`Remove link ${l.label}`}
                      className="rounded-full p-0.5 hover:bg-brand-100 dark:hover:bg-brand-500/20"
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {uploadError && <p className="mb-2 text-[11px] text-red-600 dark:text-red-400">{uploadError}</p>}

            <div className="relative rounded-lg border border-zinc-300 focus-within:border-brand-600 dark:border-zinc-700">
              {/* Typeahead popup */}
              {ta && taOptions.length > 0 && (
                <div role="listbox" aria-label={ta.mode === 'mention' ? 'People' : 'Work items'} className="absolute bottom-full left-2 z-30 mb-1 w-80 max-w-[calc(100%-1rem)] overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                  {taOptions.map((opt, i) => (
                    <button
                      key={'userId' in opt ? opt.userId : `${opt.targetType}:${opt.targetId}`}
                      type="button"
                      role="option"
                      aria-selected={i === taIndex}
                      onMouseEnter={() => setTaIndex(i)}
                      onClick={() => pickTaOption(opt)}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${i === taIndex ? 'bg-brand-50 dark:bg-brand-500/15' : ''}`}
                    >
                      {'userId' in opt ? (
                        <>
                          <Avatar name={opt.name} userId={opt.userId} size={20} />
                          <span className="truncate font-medium">{opt.name}</span>
                          {opt.company && <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">{opt.company}</span>}
                        </>
                      ) : (
                        <>
                          <span className={`h-2 w-2 shrink-0 rounded-full ${statusTone(opt.status)}`} aria-hidden />
                          <span className="shrink-0 text-xs font-medium text-zinc-500 dark:text-zinc-400">{CHIP_KIND_LABEL[opt.targetType]}</span>
                          <span className="truncate">{opt.label}</span>
                        </>
                      )}
                    </button>
                  ))}
                </div>
              )}

              <textarea
                ref={composerRef}
                value={input}
                onChange={onInputChange}
                onKeyDown={onComposerKeyDown}
                rows={1}
                placeholder={`Message ${title ?? 'the team'}…`}
                aria-label={`Message ${title ?? 'the team'}`}
                className="max-h-40 w-full resize-none bg-transparent px-3 py-2.5 text-[15px] outline-none"
              />
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <div className="flex items-center justify-between px-2 pb-2">
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    disabled={recording}
                    aria-label="Attach a photo"
                    title="Attach a photo"
                    className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                  >
                    <ImageIcon size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={recording}
                    aria-label="Attach a file"
                    title="Attach a file"
                    className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                  >
                    <Paperclip size={16} />
                  </button>
                  {recording ? (
                    <button type="button" onClick={stopRecording} aria-label="Stop recording" className="flex items-center gap-1 rounded p-1.5 text-red-600">
                      <Square size={16} />
                      <span className="text-[11px] tabular-nums">
                        {Math.floor(recSeconds / 60)}:{String(recSeconds % 60).padStart(2, '0')}
                      </span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={startRecording}
                      aria-label="Record a voice note"
                      title="Record a voice note"
                      className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                    >
                      <Mic size={16} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setInput((v) => (v === '' || v.endsWith(' ') ? `${v}#` : `${v} #`));
                      composerRef.current?.focus();
                      setTa({ mode: 'link', query: '', tokenStart: input.length + (input === '' || input.endsWith(' ') ? 0 : 1) });
                    }}
                    aria-label="Link a task, snag, RFI, payment or drawing"
                    title="Link a work item (#)"
                    className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                  >
                    <Hash size={16} />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  {justSent && <span className="text-[11px] text-zinc-500 dark:text-zinc-400">sent</span>}
                  <button
                    type="button"
                    onClick={submit}
                    disabled={recording || (!input.trim() && pending.length === 0 && pendingLinks.length === 0)}
                    className="flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                  >
                    <Send size={13} /> Send
                  </button>
                </div>
              </div>
            </div>
            {!hintSeen && (
              <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">Enter sends · Shift+Enter for a new line · # links a work item · @ mentions</p>
            )}
          </div>
        )}
      </div>

      {railProps && (
        <>
          {/* Desktop rail (Details toggle). The thread takes it over while open. */}
          {railVisible && (
            <aside aria-label="Conversation details" className="hidden min-h-0 w-[300px] flex-shrink-0 flex-col border-l border-zinc-200 bg-white lg:flex dark:border-zinc-800 dark:bg-zinc-950">
              {thread && threadParent ? (
                <ThreadRail
                  ctx={rowCtx}
                  parent={threadParent}
                  replies={threadReplies}
                  canPost={canPost}
                  value={threadInput}
                  onChange={setThreadInput}
                  sending={threadSending}
                  onSend={() => void submitThreadReply()}
                  onClose={() => setThread(null)}
                />
              ) : (
                <ChatRail
                  people={railProps}
                  projectId={projectId}
                  conversationId={conversationId}
                  files={sharedFiles ?? []}
                  about={about ?? null}
                  canEditAbout={canModerate}
                  pinned={pinnedMessages ?? []}
                  onUnpin={togglePin}
                  onFind={() => setSearchOpen(true)}
                  showRegisterLinks={showRegisterLinks}
                  hideQuickActions
                />
              )}
            </aside>
          )}

          {/* Mobile sheet */}
          {railOpen && (
            <div className="fixed inset-0 z-40 flex lg:hidden">
              <button type="button" aria-label="Close panel" onClick={() => setRailOpen(false)} className="flex-1 bg-black/30" />
              <aside aria-label="Conversation details" className="flex w-full max-w-[340px] flex-col bg-white shadow-xl dark:bg-zinc-950">
                {thread && threadParent ? (
                  <ThreadRail
                    ctx={rowCtx}
                    parent={threadParent}
                    replies={threadReplies}
                    canPost={canPost}
                    value={threadInput}
                    onChange={setThreadInput}
                    sending={threadSending}
                    onSend={() => void submitThreadReply()}
                    onClose={() => setThread(null)}
                  />
                ) : (
                  <ChatRail
                    people={railProps}
                    projectId={projectId}
                    conversationId={conversationId}
                    files={sharedFiles ?? []}
                    about={about ?? null}
                    canEditAbout={canModerate}
                    pinned={pinnedMessages ?? []}
                    onUnpin={togglePin}
                    onFind={() => {
                      setRailOpen(false);
                      setSearchOpen(true);
                    }}
                    onClose={() => setRailOpen(false)}
                    showRegisterLinks={showRegisterLinks}
                    hideQuickActions
                  />
                )}
              </aside>
            </div>
          )}
        </>
      )}
    </div>
  );
}
