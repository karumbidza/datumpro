'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  loadMessages,
  sendMessage,
  editMessage,
  deleteMessage,
  toggleReaction,
  markRead,
} from '@/app/(app)/projects/[projectId]/chat/actions';
import type { ChatMessage } from '@/lib/data/chat';
import { Button } from '@/components/ui/button';

const EMOJIS = ['👍', '❤️', '😂', '🎉', '✅'];

interface Props {
  conversationId: string;
  currentUserId: string;
  meName: string;
  initialMessages: ChatMessage[];
  othersReadSeq: number;
  canPost: boolean;
  canModerate?: boolean;
  className?: string;
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ChatPanel({
  conversationId,
  currentUserId,
  meName,
  initialMessages,
  othersReadSeq,
  canPost,
  canModerate = false,
  className = '',
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
  const [onlineOthers, setOnlineOthers] = useState(0);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastSeqRef = useRef(initialMessages.at(-1)?.seq ?? 0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const typingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const lastTypingSent = useRef(0);
  const msgById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  const broadcast = useCallback((event: string, payload: Record<string, unknown>) => {
    channelRef.current?.send({ type: 'broadcast', event, payload });
  }, []);

  const refresh = useCallback(async () => {
    const msgs = await loadMessages(conversationId);
    setMessages(msgs);
    const maxSeq = msgs.at(-1)?.seq ?? 0;
    lastSeqRef.current = Math.max(lastSeqRef.current, maxSeq);
    if (maxSeq > 0) {
      await markRead(conversationId, maxSeq);
      broadcast('read', { userId: currentUserId, seq: maxSeq });
    }
  }, [conversationId, currentUserId, broadcast]);

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

  // Realtime private channel: signalling (data via server actions on each event).
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
        .on('broadcast', { event: 'message' }, () => active && void refresh())
        .on('broadcast', { event: 'reaction' }, () => active && void refresh())
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
          ids.delete(currentUserId);
          setOnlineOthers(ids.size);
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') void channel.track({ user_id: currentUserId, name: meName });
        });
      channelRef.current = channel;
    })();
    void refresh();
    return () => {
      active = false;
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // Presence heartbeat for the offline indicator.
  useEffect(() => {
    const iv = setInterval(() => {
      void supabase.from('profiles').update({ last_active_at: new Date().toISOString() }).eq('id', currentUserId);
    }, 30_000);
    return () => clearInterval(iv);
  }, [supabase, currentUserId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setInput(e.target.value);
    const now = Date.now();
    if (now - lastTypingSent.current > 1500) {
      lastTypingSent.current = now;
      broadcast('typing', { userId: currentUserId, name: meName });
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body = input.trim();
    if (!body || sending) return;
    setSending(true);
    setInput('');
    const parent = replyTo?.id;
    setReplyTo(null);
    try {
      await sendMessage(conversationId, body, parent);
      await refresh();
    } finally {
      setSending(false);
    }
  }

  async function onReact(id: string, emoji: string) {
    await toggleReaction(id, emoji);
    broadcast('reaction', { messageId: id });
    await refresh();
  }

  async function saveEdit() {
    if (!editingId) return;
    await editMessage(editingId, editingBody);
    setEditingId(null);
    await refresh();
  }

  const lastOwn = [...messages].reverse().find((m) => m.senderId === currentUserId);
  const typingNames = Object.values(typing);

  return (
    <div className={`flex flex-col ${className}`}>
      {onlineOthers > 0 && (
        <div className="border-b border-zinc-100 px-4 py-1.5 text-[11px] text-green-600 dark:border-zinc-800 dark:text-green-400">
          ● {onlineOthers} online
        </div>
      )}

      <div className="flex-1 space-y-1 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-400">No messages yet — say hello.</p>
        ) : (
          messages.map((m) => {
            const mine = m.senderId === currentUserId;
            const parent = m.parentMessageId ? msgById.get(m.parentMessageId) : null;
            return (
              <div key={m.id} className={`group flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className="max-w-[78%]">
                  {parent && (
                    <p className={`mb-0.5 truncate border-l-2 border-zinc-300 pl-2 text-[11px] text-zinc-400 ${mine ? 'text-right' : ''}`}>
                      ↩ {parent.senderName}: {(parent.body ?? 'message').slice(0, 40)}
                    </p>
                  )}
                  <div
                    className={`rounded-2xl px-3 py-2 text-sm ${
                      mine ? 'bg-brand-500 text-white' : 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                    }`}
                  >
                    {!mine && <p className="mb-0.5 text-[11px] font-medium opacity-70">{m.senderName}</p>}
                    {editingId === m.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          value={editingBody}
                          onChange={(e) => setEditingBody(e.target.value)}
                          className="w-48 rounded bg-white/20 px-1 text-sm outline-none"
                          autoFocus
                        />
                        <button onClick={saveEdit} className="text-xs underline">save</button>
                        <button onClick={() => setEditingId(null)} className="text-xs opacity-70">cancel</button>
                      </div>
                    ) : m.deletedAt ? (
                      <p className="italic opacity-60">message deleted</p>
                    ) : (
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                    )}
                    <p className={`mt-0.5 text-right text-[10px] ${mine ? 'text-white/70' : 'text-zinc-400'}`}>
                      {timeLabel(m.createdAt)}
                      {m.editedAt && !m.deletedAt && ' · edited'}
                    </p>
                  </div>

                  {/* reaction chips */}
                  {m.reactions.length > 0 && (
                    <div className={`mt-1 flex flex-wrap gap-1 ${mine ? 'justify-end' : ''}`}>
                      {m.reactions.map((r) => (
                        <button
                          key={r.emoji}
                          onClick={() => onReact(m.id, r.emoji)}
                          className={`rounded-full border px-1.5 py-0.5 text-[11px] ${
                            r.mine
                              ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10'
                              : 'border-zinc-200 dark:border-zinc-700'
                          }`}
                        >
                          {r.emoji} {r.count}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* hover action bar */}
                  {!m.deletedAt && (
                    <div className={`mt-0.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 ${mine ? 'justify-end' : ''}`}>
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
                          onClick={() => deleteMessage(m.id).then(refresh)}
                          className="text-[11px] text-zinc-400 hover:text-red-500"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                </div>
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

      {typingNames.length > 0 && (
        <p className="px-4 pb-1 text-[11px] italic text-zinc-400">
          {typingNames.join(', ')} {typingNames.length === 1 ? 'is' : 'are'} typing…
        </p>
      )}

      {canPost && (
        <form onSubmit={onSubmit} className="border-t border-zinc-200 p-3 dark:border-zinc-800">
          {replyTo && (
            <div className="mb-2 flex items-center justify-between rounded bg-zinc-100 px-2 py-1 text-[11px] text-zinc-500 dark:bg-zinc-800">
              <span className="truncate">↩ Replying to {replyTo.name}: {replyTo.snippet.slice(0, 40)}</span>
              <button type="button" onClick={() => setReplyTo(null)} className="ml-2">✕</button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              value={input}
              onChange={onInputChange}
              placeholder="Message…"
              className="flex-1 rounded-full border border-zinc-200 bg-transparent px-4 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-700"
            />
            <Button type="submit" disabled={sending || !input.trim()}>
              Send
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
