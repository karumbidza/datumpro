'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

type Msg = {
  id: string;
  sender: 'requester' | 'operator';
  senderLabel: string | null;
  body: string;
  createdAt: string;
};

/** Tenant-admin support chat. Talks only to this app's /api/support bridge, which
 *  forwards to Pulse. Polls every 5s for operator replies. */
export function SupportChat({ orgId }: { orgId: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      const res = await fetch(`/api/support?orgId=${encodeURIComponent(orgId)}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages ?? []);
        setError(null);
      } else if (res.status === 503) {
        setError('Support isn’t available right now.');
      }
    } catch {
      /* transient — keep last state */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId, body: text }),
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages ?? []);
        setBody('');
        setError(null);
      } else {
        setError('Could not send. Please try again.');
      }
    } catch {
      setError('Could not send. Please try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-[60vh] flex-col rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {loading ? (
          <p className="text-sm text-zinc-400">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-zinc-400">
            No messages yet. Send us a note and our team will reply here.
          </p>
        ) : (
          messages.map((m) => {
            const mine = m.sender === 'requester';
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className="max-w-[80%]">
                  <div
                    className={`rounded-2xl px-3.5 py-2 text-sm ${
                      mine
                        ? 'bg-brand-600 text-white'
                        : 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  </div>
                  <p className={`mt-0.5 text-[11px] text-zinc-400 ${mine ? 'text-right' : ''}`}>
                    {mine ? 'You' : 'Support'} · {new Date(m.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      {error && <p className="px-4 pb-1 text-xs text-red-500">{error}</p>}

      <form onSubmit={send} className="flex items-end gap-2 border-t border-zinc-100 p-3 dark:border-zinc-800">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder="Message support…"
          className="min-h-0 flex-1 resize-y rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-800"
        />
        <button
          type="submit"
          disabled={sending || !body.trim()}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
