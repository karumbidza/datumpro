'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  getMemberActivity,
  type AttachmentInput,
} from '@/app/(app)/projects/[projectId]/chat/actions';
import type { ChatAttachment, ChatMessage, ChatSearchResult } from '@/lib/data/chat';
import type { RosterMember } from '@/lib/data/chat-roster';
import { Button } from '@/components/ui/button';
import { MessageCircle, Paperclip, Mic, Square, X, Download, FileText, Search, Users } from '@/components/icons';
import { NotifyToggle } from '@/components/chat/notify-toggle';
import { PeopleRail } from '@/components/chat/people-rail';

const EMOJIS = ['👍', '❤️', '😂', '🎉', '✅'];
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB per file

interface Props {
  conversationId: string;
  orgId: string;
  projectId: string;
  currentUserId: string;
  meName: string;
  initialMessages: ChatMessage[];
  othersReadSeq: number;
  canPost: boolean;
  canModerate?: boolean;
  title?: string;
  subtitle?: string;
  className?: string;
  /** Roster for the People rail. When provided, the panel renders the two-pane
   *  layout (conversation + presence rail). Omit for a bare conversation. */
  members?: RosterMember[];
}

type AttachmentKind = AttachmentInput['kind'];

interface PendingAttachment {
  localId: string;
  kind: AttachmentKind;
  file: Blob;
  filename: string;
  mime: string;
  sizeBytes: number;
  ext: string;
  previewUrl: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
}

function fullTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function kindFromMime(mime: string): AttachmentKind {
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

/** Highlight the query's bare words inside a result snippet (client-side, cosmetic
 *  only — the actual matching is done by Postgres). Quotes/operators are ignored. */
function highlight(text: string, query: string): React.ReactNode {
  const terms = query
    .replace(/["'()|]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !['or', 'and', 'not'].includes(t.toLowerCase()));
  if (terms.length === 0) return text;
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${escaped.join('|')})`, 'ig');
  const parts = text.split(re);
  return parts.map((p, i) =>
    re.test(p) ? (
      <mark key={i} className="rounded bg-amber-200 px-0.5 text-inherit dark:bg-amber-500/40">
        {p}
      </mark>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

/** Read pixel dimensions of an image blob (best-effort). */
function imageDimensions(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Inline render for a persisted attachment (signed URL from the data layer). */
function AttachmentView({ a }: { a: ChatAttachment }) {
  if (!a.url) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-400 dark:border-zinc-700">
        <FileText size={14} /> {a.filename ?? 'Attachment'} · unavailable
      </div>
    );
  }
  if (a.kind === 'image') {
    return (
      <a href={a.url} target="_blank" rel="noreferrer" className="block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={a.url}
          alt={a.filename ?? 'image'}
          className="max-h-64 max-w-full rounded-lg border border-zinc-200 object-cover dark:border-zinc-700"
        />
      </a>
    );
  }
  if (a.kind === 'video') {
    return <video src={a.url} controls className="max-h-64 max-w-full rounded-lg" />;
  }
  if (a.kind === 'audio') {
    return <audio src={a.url} controls className="w-56 max-w-full" />;
  }
  return (
    <a
      href={a.url}
      target="_blank"
      rel="noreferrer"
      download={a.filename ?? undefined}
      className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-700 hover:border-brand-400 dark:border-zinc-700 dark:text-zinc-200"
    >
      <FileText size={16} className="shrink-0 text-zinc-400" />
      <span className="max-w-[180px] truncate">{a.filename ?? 'Document'}</span>
      {a.sizeBytes ? <span className="text-zinc-400">· {formatBytes(a.sizeBytes)}</span> : null}
      <Download size={14} className="ml-auto shrink-0 text-zinc-400" />
    </a>
  );
}

export function ChatPanel({
  conversationId,
  orgId,
  projectId,
  currentUserId,
  meName,
  initialMessages,
  othersReadSeq,
  canPost,
  canModerate = false,
  title,
  subtitle,
  className = '',
  members,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [othersRead, setOthersRead] = useState(othersReadSeq);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: string; name: string; snippet: string } | null>(null);
  const [typing, setTyping] = useState<Record<string, string>>({});
  const [onlineIds, setOnlineIds] = useState<Set<string>>(() => new Set());
  const [railOpen, setRailOpen] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ChatSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [hasMore, setHasMore] = useState(initialMessages.length >= 50);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastSeqRef = useRef(initialMessages.at(-1)?.seq ?? 0);
  const earliestSeqRef = useRef(initialMessages[0]?.seq ?? 0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const shouldScrollRef = useRef(true); // scroll to bottom on first paint
  const prependAnchor = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const lastTypingSent = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recChunks = useRef<Blob[]>([]);
  const recTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const recStart = useRef(0);
  const pendingRef = useRef<PendingAttachment[]>([]);
  const msgById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  // Keep a ref of pending so the unmount cleanup can revoke object URLs.
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  const broadcast = useCallback((event: string, payload: Record<string, unknown>) => {
    channelRef.current?.send({ type: 'broadcast', event, payload });
  }, []);

  /** Upsert messages by id and keep the list seq-sorted. `scroll` requests a
   *  jump to the newest row once the DOM updates (new/own messages only). */
  const applyMessages = useCallback((incoming: ChatMessage[], scroll: boolean) => {
    if (incoming.length === 0) return;
    setMessages((prev) => {
      const map = new Map(prev.map((m) => [m.id, m]));
      for (const m of incoming) map.set(m.id, m);
      return [...map.values()].sort((a, b) => a.seq - b.seq);
    });
    if (scroll) shouldScrollRef.current = true;
  }, []);

  /** Pull only messages newer than our cursor (new-message + reconnect delta),
   *  then advance the read cursor. Replaces the old full-window reload. */
  const syncNew = useCallback(async () => {
    // Drain in pages so a long offline gap (> one page) never leaves a hole.
    for (let guard = 0; guard < 20; guard++) {
      const fresh = await loadSince(conversationId, lastSeqRef.current);
      if (fresh.length === 0) break;
      applyMessages(fresh, true);
      lastSeqRef.current = Math.max(lastSeqRef.current, fresh.at(-1)!.seq);
      if (fresh.length < 200) break; // page not full → caught up
    }
    if (lastSeqRef.current > 0) {
      await markRead(conversationId, lastSeqRef.current);
      broadcast('read', { userId: currentUserId, seq: lastSeqRef.current });
    }
  }, [conversationId, currentUserId, broadcast, applyMessages]);

  /** Refetch a single visible message after an edit / delete / reaction. */
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
          // INSERT → fetch just the new tail; UPDATE (edit/delete) → refetch that row.
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
          // Keep the full online set (self included) so the People rail can show
          // "You" as active; the header's "N online" derives an others-count.
          const ids = new Set<string>();
          for (const arr of Object.values(state)) for (const m of arr) if (m.user_id) ids.add(m.user_id);
          setOnlineIds(ids);
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            void channel.track({ user_id: currentUserId, name: meName });
            // Initial sync AND reconnect resync land here — pull anything missed.
            if (active) void syncNew();
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

  // Scroll to newest only when a new/own message asked for it; edits, reactions
  // and prepends (load-earlier) leave the viewport where it is.
  useLayoutEffect(() => {
    if (prependAnchor.current != null && scrollRef.current) {
      // Keep the first previously-visible row pinned after prepending older ones.
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight - prependAnchor.current;
      prependAnchor.current = null;
      return;
    }
    if (shouldScrollRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      shouldScrollRef.current = false;
    }
  }, [messages]);

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

  // Unmount: revoke any pending previews and tear down an in-flight recording.
  useEffect(() => {
    return () => {
      pendingRef.current.forEach((a) => URL.revokeObjectURL(a.previewUrl));
      if (recTimer.current) clearInterval(recTimer.current);
      if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    };
  }, []);

  // Debounced full-text search over the conversation.
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

  function onInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const now = Date.now();
    if (now - lastTypingSent.current > 1500) {
      lastTypingSent.current = now;
      broadcast('typing', { userId: currentUserId, name: meName });
    }
  }

  /** Upload one blob to the conversation-keyed chat-media path, returning the
   *  attachment metadata to persist. Storage RLS authorizes the write. */
  const uploadOne = useCallback(
    async (a: PendingAttachment): Promise<AttachmentInput> => {
      const path = `${orgId}/${projectId}/chat/${conversationId}/${crypto.randomUUID()}.${a.ext}`;
      const { error } = await supabase.storage
        .from('chat-media')
        .upload(path, a.file, { contentType: a.mime, upsert: false });
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
      };
    },
    [supabase, orgId, projectId, conversationId],
  );

  async function submit() {
    const body = input.trim();
    const toSend = pending;
    if ((!body && toSend.length === 0) || sending) return;
    setSending(true);
    setUploadError(null);
    const parent = replyTo?.id;
    try {
      const uploaded = toSend.length > 0 ? await Promise.all(toSend.map(uploadOne)) : undefined;
      await sendMessage(conversationId, body, parent, uploaded);
      setInput('');
      setReplyTo(null);
      toSend.forEach((a) => URL.revokeObjectURL(a.previewUrl));
      setPending([]);
      shouldScrollRef.current = true;
      await syncNew();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setSending(false);
    }
  }

  const addFiles = useCallback((files: FileList | File[]) => {
    setUploadError(null);
    const next: PendingAttachment[] = [];
    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE_BYTES) {
        setUploadError(`"${file.name}" exceeds the 50 MB limit.`);
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
      });
    }
    if (next.length === 0) return;
    setPending((p) => [...p, ...next]);
    // Fill in image dimensions asynchronously.
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
        const previewUrl = URL.createObjectURL(blob);
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
            previewUrl,
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
    recorderRef.current?.state !== 'inactive' && recorderRef.current?.stop();
  }

  async function onReact(id: string, emoji: string) {
    await toggleReaction(id, emoji);
    broadcast('reaction', { messageId: id });
    await applyOne(id);
  }

  async function saveEdit() {
    if (!editingId) return;
    const id = editingId;
    await editMessage(id, editingBody);
    setEditingId(null);
    await applyOne(id);
  }

  const lastOwn = [...messages].reverse().find((m) => m.senderId === currentUserId);
  const typingNames = Object.values(typing);

  // Presence-derived counts. `onlineOthers` (excludes self) drives the legacy
  // green indicator; `onlineCount` (roster ∩ online) drives the People rail pill.
  const onlineOthers = onlineIds.size - (onlineIds.has(currentUserId) ? 1 : 0);
  const roster = members ?? null;
  const onlineCount = roster ? roster.filter((m) => onlineIds.has(m.userId)).length : onlineOthers;

  const focusComposer = useCallback((member: RosterMember) => {
    setRailOpen(false);
    setSelectedMemberId(null);
    // @-mention-free: just drop focus in the composer so a reply can be typed.
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

  return (
    <div className={`flex min-h-0 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 ${className}`}>
      <div className="flex min-w-0 flex-1 flex-col">
      {title && (
        <header className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <MessageCircle size={18} className="text-zinc-500" />
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">
            {title} <span className="text-zinc-400">({messages.length})</span>
          </h2>
          <div className="ml-auto flex items-center gap-2">
            {roster ? (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {roster.length} members · {onlineCount} online
              </span>
            ) : (
              onlineOthers > 0 && (
                <span className="flex items-center gap-1 text-[11px] text-green-600 dark:text-green-400">
                  ● {onlineOthers} online
                </span>
              )
            )}
            {railProps && (
              <button
                type="button"
                onClick={() => setRailOpen(true)}
                title="People"
                aria-label="Show people"
                className="flex items-center gap-1 rounded p-1 text-zinc-400 hover:bg-zinc-100 lg:hidden dark:hover:bg-zinc-800"
              >
                <Users size={16} />
                {onlineCount > 0 && (
                  <span className="text-[11px] font-medium text-green-600">{onlineCount}</span>
                )}
              </button>
            )}
            <NotifyToggle />
            <button
              type="button"
              onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
              title={searchOpen ? 'Close search' : 'Search messages'}
              className={`rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                searchOpen ? 'text-brand-600' : 'text-zinc-400'
              }`}
            >
              {searchOpen ? <X size={16} /> : <Search size={16} />}
            </button>
          </div>
        </header>
      )}

      {searchOpen && (
        <div className="border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
          <div className="flex items-center gap-2 rounded-lg border border-zinc-200 px-2 focus-within:border-brand-500 dark:border-zinc-700">
            <Search size={14} className="text-zinc-400" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
              placeholder="Search this conversation…"
              className="w-full bg-transparent py-1.5 text-sm outline-none"
            />
            {searchQuery && (
              <button type="button" onClick={() => setSearchQuery('')} className="text-zinc-400 hover:text-zinc-600">
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      )}
      {subtitle && (
        <p className="border-b border-zinc-100 px-4 py-1.5 text-[11px] text-zinc-400 dark:border-zinc-800">
          {subtitle}
        </p>
      )}

      {searchOpen && searchResults !== null ? (
        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {searching && searchResults.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-400">Searching…</p>
          ) : searchResults.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-400">
              No messages match “{searchQuery.trim()}”.
            </p>
          ) : (
            <>
              <p className="text-[11px] uppercase tracking-wide text-zinc-400">
                {searchResults.length} match{searchResults.length === 1 ? '' : 'es'}
              </p>
              {searchResults.map((r) => (
                <div
                  key={r.id}
                  className="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800"
                >
                  <p className="mb-1 flex items-center gap-1.5 text-[11px] text-zinc-400">
                    <span className="font-medium text-zinc-600 dark:text-zinc-300">{r.senderName}</span>
                    <span>· {fullTime(r.createdAt)}</span>
                  </p>
                  <p className="whitespace-pre-wrap break-words text-sm text-zinc-800 dark:text-zinc-200">
                    {highlight(r.body, searchQuery)}
                  </p>
                </div>
              ))}
            </>
          )}
        </div>
      ) : (
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {hasMore && messages.length > 0 && (
          <div className="flex justify-center pb-1">
            <button
              type="button"
              onClick={onLoadEarlier}
              disabled={loadingEarlier}
              className="rounded-full border border-zinc-200 px-3 py-1 text-[11px] text-zinc-500 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {loadingEarlier ? 'Loading…' : 'Load earlier messages'}
            </button>
          </div>
        )}
        {messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-400">No messages yet — start the discussion.</p>
        ) : (
          messages.map((m) => {
            const mine = m.senderId === currentUserId;
            const parent = m.parentMessageId ? msgById.get(m.parentMessageId) : null;
            return (
              <div key={m.id} className={`group flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                <p className="mb-1 flex items-center gap-1.5 text-[11px] text-zinc-400">
                  <span className="font-medium text-zinc-600 dark:text-zinc-300">{m.senderName}</span>
                  <span>· {fullTime(m.createdAt)}</span>
                  {m.editedAt && !m.deletedAt && <span>· edited</span>}
                </p>

                {parent && (
                  <p className={`mb-1 max-w-[80%] truncate border-l-2 border-zinc-300 pl-2 text-[11px] text-zinc-400 ${mine ? 'text-right' : ''}`}>
                    ↩ {parent.senderName}: {(parent.body ?? 'message').slice(0, 48)}
                  </p>
                )}

                {(editingId === m.id || m.deletedAt || m.body) && (
                  <div
                    className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                      mine
                        ? 'bg-brand-50 text-zinc-900 dark:bg-brand-500/15 dark:text-zinc-100'
                        : 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                    }`}
                  >
                    {editingId === m.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          value={editingBody}
                          onChange={(e) => setEditingBody(e.target.value)}
                          className="w-48 rounded bg-white/60 px-1 text-sm outline-none dark:bg-zinc-900"
                          autoFocus
                        />
                        <button onClick={saveEdit} className="text-xs text-brand-600 underline">save</button>
                        <button onClick={() => setEditingId(null)} className="text-xs opacity-60">cancel</button>
                      </div>
                    ) : m.deletedAt ? (
                      <p className="italic opacity-60">message deleted</p>
                    ) : (
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                    )}
                  </div>
                )}

                {!m.deletedAt && m.attachments.length > 0 && (
                  <div className={`mt-1 flex max-w-[80%] flex-col gap-1 ${mine ? 'items-end' : 'items-start'}`}>
                    {m.attachments.map((a) => (
                      <AttachmentView key={a.id} a={a} />
                    ))}
                  </div>
                )}

                {m.reactions.length > 0 && (
                  <div className={`mt-1 flex flex-wrap gap-1 ${mine ? 'justify-end' : ''}`}>
                    {m.reactions.map((r) => (
                      <button
                        key={r.emoji}
                        onClick={() => onReact(m.id, r.emoji)}
                        className={`rounded-full border px-1.5 py-0.5 text-[11px] ${
                          r.mine ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10' : 'border-zinc-200 dark:border-zinc-700'
                        }`}
                      >
                        {r.emoji} {r.count}
                      </button>
                    ))}
                  </div>
                )}

                {!m.deletedAt && (
                  <div className={`mt-0.5 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 ${mine ? 'justify-end' : ''}`}>
                    {EMOJIS.map((e) => (
                      <button key={e} onClick={() => onReact(m.id, e)} className="text-sm hover:scale-110" title="React">
                        {e}
                      </button>
                    ))}
                    <button
                      onClick={() => setReplyTo({ id: m.id, name: m.senderName, snippet: m.body ?? '' })}
                      className="text-[11px] text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                    >
                      Reply
                    </button>
                    {mine && (
                      <button
                        onClick={() => {
                          setEditingId(m.id);
                          setEditingBody(m.body ?? '');
                        }}
                        className="text-[11px] text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                      >
                        Edit
                      </button>
                    )}
                    {(mine || canModerate) && (
                      <button
                        onClick={() => deleteMessage(m.id).then(() => applyOne(m.id))}
                        className="text-[11px] text-zinc-400 hover:text-red-500"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
        {lastOwn && !lastOwn.deletedAt && (
          <p className="pr-1 text-right text-[10px] text-zinc-400">
            {othersRead >= lastOwn.seq ? 'Seen' : 'Sent'}
          </p>
        )}
        <div ref={bottomRef} />
      </div>
      )}

      {typingNames.length > 0 && (
        <p className="px-4 pb-1 text-[11px] italic text-zinc-400">
          {typingNames.join(', ')} {typingNames.length === 1 ? 'is' : 'are'} typing…
        </p>
      )}

      {canPost && (
        <div className="p-3">
          {replyTo && (
            <div className="mb-2 flex items-center justify-between rounded bg-zinc-100 px-2 py-1 text-[11px] text-zinc-500 dark:bg-zinc-800">
              <span className="truncate">↩ Replying to {replyTo.name}: {replyTo.snippet.slice(0, 40)}</span>
              <button type="button" onClick={() => setReplyTo(null)} className="ml-2">✕</button>
            </div>
          )}

          {pending.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {pending.map((a) => (
                <div
                  key={a.localId}
                  className="relative flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-1.5 pr-6 text-[11px] dark:border-zinc-700 dark:bg-zinc-900"
                >
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
                  <button
                    type="button"
                    onClick={() => removePending(a.localId)}
                    className="absolute right-1 top-1 text-zinc-400 hover:text-red-500"
                    aria-label="Remove attachment"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {uploadError && <p className="mb-2 text-[11px] text-red-500">{uploadError}</p>}

          <div className="rounded-lg border border-zinc-200 focus-within:border-brand-500 dark:border-zinc-700">
            <textarea
              ref={composerRef}
              value={input}
              onChange={onInputChange}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void submit();
                }
              }}
              rows={2}
              placeholder="Write a comment…"
              className="w-full resize-none bg-transparent px-3 py-2 text-sm outline-none"
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
            <div className="flex items-center justify-between px-2 pb-2">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sending || recording}
                  title="Attach a file"
                  className="p-1 text-zinc-400 hover:text-zinc-700 disabled:opacity-40 dark:hover:text-zinc-200"
                >
                  <Paperclip size={16} />
                </button>
                {recording ? (
                  <button
                    type="button"
                    onClick={stopRecording}
                    title="Stop recording"
                    className="flex items-center gap-1 rounded p-1 text-red-500"
                  >
                    <Square size={16} />
                    <span className="text-[11px] tabular-nums">
                      {Math.floor(recSeconds / 60)}:{String(recSeconds % 60).padStart(2, '0')}
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={startRecording}
                    disabled={sending}
                    title="Record a voice note"
                    className="p-1 text-zinc-400 hover:text-zinc-700 disabled:opacity-40 dark:hover:text-zinc-200"
                  >
                    <Mic size={16} />
                  </button>
                )}
              </div>
              <Button
                type="button"
                onClick={submit}
                disabled={sending || recording || (!input.trim() && pending.length === 0)}
              >
                {sending ? 'Sending…' : 'Post'}
              </Button>
            </div>
          </div>
          <p className="mt-1 text-[10px] text-zinc-400">Press ⌘/Ctrl + Enter to post.</p>
        </div>
      )}
      </div>

      {railProps && (
        <>
          {/* Desktop rail — always visible ≥ lg */}
          <aside className="hidden min-h-0 w-[300px] flex-shrink-0 flex-col border-l border-zinc-200 bg-white lg:flex dark:border-zinc-800 dark:bg-zinc-950">
            <PeopleRail {...railProps} />
          </aside>

          {/* Mobile — slide-over sheet from the right */}
          {railOpen && (
            <div className="fixed inset-0 z-40 flex lg:hidden">
              <button
                type="button"
                aria-label="Close people"
                onClick={() => setRailOpen(false)}
                className="flex-1 bg-black/30"
              />
              <aside className="flex w-full max-w-[340px] flex-col bg-white shadow-xl dark:bg-zinc-950">
                <PeopleRail {...railProps} onClose={() => setRailOpen(false)} />
              </aside>
            </div>
          )}
        </>
      )}
    </div>
  );
}
