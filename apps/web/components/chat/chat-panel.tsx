'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { sendMessage, markRead } from '@/app/(app)/projects/[projectId]/chat/actions';
import type { ChatMessage } from '@/lib/data/chat';
import { Button } from '@/components/ui/button';

interface Props {
  conversationId: string;
  currentUserId: string;
  meName: string;
  initialMessages: ChatMessage[];
  initialNames: Record<string, string>;
  othersReadSeq: number;
  canPost: boolean;
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
  initialNames,
  othersReadSeq,
  canPost,
  className = '',
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [names, setNames] = useState<Record<string, string>>(initialNames);
  const [othersRead, setOthersRead] = useState(othersReadSeq);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const lastSeqRef = useRef(initialMessages.at(-1)?.seq ?? 0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const idsRef = useRef<Set<string>>(new Set(initialMessages.map((m) => m.id)));

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const refreshSeen = useCallback(async () => {
    const { data } = await supabase
      .from('chat_read_state')
      .select('user_id, last_read_seq')
      .eq('conversation_id', conversationId);
    const max = ((data ?? []) as { user_id: string; last_read_seq: number }[])
      .filter((r) => r.user_id !== currentUserId)
      .reduce((m, r) => Math.max(m, r.last_read_seq), 0);
    setOthersRead((prev) => Math.max(prev, max));
  }, [supabase, conversationId, currentUserId]);

  const markReadNow = useCallback(async () => {
    if (lastSeqRef.current > 0) {
      await markRead(conversationId, lastSeqRef.current);
      void refreshSeen();
    }
  }, [conversationId, refreshSeen]);

  const fetchDelta = useCallback(async () => {
    const { data } = await supabase
      .from('messages')
      .select('id, seq, body, sender_id, created_at, edited_at, deleted_at, parent_message_id')
      .eq('conversation_id', conversationId)
      .gt('seq', lastSeqRef.current)
      .order('seq', { ascending: true });
    const rows = (data ?? []) as {
      id: string;
      seq: number;
      body: string | null;
      sender_id: string;
      created_at: string;
      edited_at: string | null;
      deleted_at: string | null;
      parent_message_id: string | null;
    }[];
    const fresh = rows.filter((r) => !idsRef.current.has(r.id));
    if (fresh.length === 0) return;

    // resolve any unknown sender names
    const unknown = [...new Set(fresh.map((r) => r.sender_id))].filter((id) => !names[id]);
    let nameMap = names;
    if (unknown.length > 0) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, display_name, email')
        .in('id', unknown);
      nameMap = { ...names };
      for (const p of (profs ?? []) as { id: string; display_name: string | null; email: string | null }[]) {
        nameMap[p.id] = p.display_name || p.email || 'Member';
      }
      setNames(nameMap);
    }

    for (const r of fresh) idsRef.current.add(r.id);
    lastSeqRef.current = Math.max(lastSeqRef.current, ...fresh.map((r) => r.seq));
    setMessages((prev) => [
      ...prev,
      ...fresh.map((r) => ({
        id: r.id,
        seq: r.seq,
        body: r.deleted_at ? null : r.body,
        senderId: r.sender_id,
        senderName: nameMap[r.sender_id] ?? 'Member',
        createdAt: r.created_at,
        editedAt: r.edited_at,
        deletedAt: r.deleted_at,
        parentMessageId: r.parent_message_id,
      })),
    ]);
    void markReadNow();
  }, [supabase, conversationId, names, markReadNow]);

  // Subscribe to the private channel; broadcast → delta fetch.
  useEffect(() => {
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.access_token) supabase.realtime.setAuth(session.access_token);
      channel = supabase.channel(`chat:${conversationId}`, { config: { private: true } });
      channel.on('broadcast', { event: 'message' }, () => {
        if (active) void fetchDelta();
      });
      channel.subscribe();
    })();
    void markReadNow();
    return () => {
      active = false;
      if (channel) supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body = input.trim();
    if (!body || sending) return;
    setSending(true);
    setInput('');
    try {
      const row = await sendMessage(conversationId, body);
      if (row) {
        idsRef.current.add(row.id);
        lastSeqRef.current = Math.max(lastSeqRef.current, row.seq);
        setMessages((prev) => [
          ...prev,
          {
            id: row.id,
            seq: row.seq,
            body,
            senderId: currentUserId,
            senderName: meName,
            createdAt: row.created_at,
            editedAt: null,
            deletedAt: null,
            parentMessageId: null,
          },
        ]);
      }
    } finally {
      setSending(false);
    }
  }

  const lastOwn = [...messages].reverse().find((m) => m.senderId === currentUserId);

  return (
    <div className={`flex flex-col ${className}`}>
      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-400">No messages yet — say hello.</p>
        ) : (
          messages.map((m) => {
            const mine = m.senderId === currentUserId;
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                    mine
                      ? 'bg-brand-500 text-white'
                      : 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                  }`}
                >
                  {!mine && <p className="mb-0.5 text-[11px] font-medium opacity-70">{m.senderName}</p>}
                  {m.deletedAt ? (
                    <p className="italic opacity-60">message deleted</p>
                  ) : (
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  )}
                  <p className={`mt-0.5 text-right text-[10px] ${mine ? 'text-white/70' : 'text-zinc-400'}`}>
                    {timeLabel(m.createdAt)}
                    {m.editedAt && ' · edited'}
                  </p>
                </div>
              </div>
            );
          })
        )}
        {lastOwn && (
          <p className="pr-1 text-right text-[10px] text-zinc-400">
            {othersRead >= lastOwn.seq ? 'Seen' : 'Sent'}
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      {canPost && (
        <form onSubmit={onSubmit} className="flex items-center gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message…"
            className="flex-1 rounded-full border border-zinc-200 bg-transparent px-4 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-700"
          />
          <Button type="submit" disabled={sending || !input.trim()}>
            Send
          </Button>
        </form>
      )}
    </div>
  );
}
