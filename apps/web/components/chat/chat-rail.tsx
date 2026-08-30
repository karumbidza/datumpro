'use client';

import { useState, type ComponentProps, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { PeopleRail } from '@/components/chat/people-rail';
import { FileText, ImageIcon, Download, X } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { inputCompactClass as inputClass } from '@/components/ui/form';
import type { ConversationFile, ChatAbout } from '@/lib/data/chat';
import { updateChatAbout } from '@/app/(app)/projects/[projectId]/chat/actions';

type RailTab = 'people' | 'files' | 'about';
type PeopleProps = Omit<ComponentProps<typeof PeopleRail>, 'onClose'>;

function fmtBytes(n: number | null): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const sectionLabel = 'text-[10px] font-medium uppercase tracking-[0.05em] text-zinc-400 dark:text-zinc-500';

function FilesRail({ files }: { files: ConversationFile[] }) {
  if (files.length === 0) {
    return <p className="p-4 text-sm text-zinc-400 dark:text-zinc-500">No files shared yet.</p>;
  }
  return (
    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
      {files.map((f) => {
        const isImage = f.kind === 'image';
        return (
          <li key={f.id} className="flex items-center gap-3 px-4 py-2.5">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              {isImage ? <ImageIcon size={16} /> : <FileText size={16} />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-zinc-800 dark:text-zinc-100">
                {f.filename || (isImage ? 'Image' : f.kind === 'video' ? 'Video' : f.kind === 'audio' ? 'Audio' : 'File')}
              </p>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                {f.senderName ? `${f.senderName} · ` : ''}
                {fmtDate(f.createdAt)}
                {f.sizeBytes ? ` · ${fmtBytes(f.sizeBytes)}` : ''}
              </p>
            </div>
            {f.url && (
              <a
                href={f.url}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                aria-label="Open file"
              >
                <Download size={16} />
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function AboutRail({
  projectId,
  conversationId,
  about,
  canEdit,
}: {
  projectId: string;
  conversationId: string;
  about: ChatAbout | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [topic, setTopic] = useState(about?.topic ?? '');
  const [description, setDescription] = useState(about?.description ?? '');
  const [note, setNote] = useState(about?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set('conversationId', conversationId);
      fd.set('projectId', projectId);
      if (topic.trim()) fd.set('topic', topic.trim());
      if (description.trim()) fd.set('description', description.trim());
      if (note.trim()) fd.set('note', note.trim());
      const res = await updateChatAbout(fd);
      if (!res.ok) throw new Error(res.error ?? 'Could not save');
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <form onSubmit={submit} className="space-y-3 p-4">
        <label className="block">
          <span className={sectionLabel}>Topic</span>
          <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="What this chat is focused on" className={`${inputClass} mt-1`} />
        </label>
        <label className="block">
          <span className={sectionLabel}>Description</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={`${inputClass} mt-1 resize-y`} />
        </label>
        <label className="block">
          <span className={sectionLabel}>Note</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. a reminder pinned for everyone" className={`${inputClass} mt-1`} />
        </label>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
          <button type="button" onClick={() => setEditing(false)} className="text-xs text-zinc-500 dark:text-zinc-400 hover:underline">
            Cancel
          </button>
        </div>
      </form>
    );
  }

  const empty = !about?.topic && !about?.description && !about?.note;
  return (
    <div className="space-y-4 p-4">
      {empty ? (
        <p className="text-sm text-zinc-400 dark:text-zinc-500">
          {canEdit ? 'No topic set yet. Add one so everyone knows what this chat is for.' : 'No topic set yet.'}
        </p>
      ) : (
        <>
          {about?.topic && (
            <div>
              <p className={sectionLabel}>Topic</p>
              <p className="mt-0.5 text-sm font-medium text-zinc-900 dark:text-white">{about.topic}</p>
            </div>
          )}
          {about?.description && (
            <div>
              <p className={sectionLabel}>Description</p>
              <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-300">{about.description}</p>
            </div>
          )}
          {about?.note && (
            <div>
              <p className={sectionLabel}>Note</p>
              <p className="mt-1 rounded-md bg-amber-50 px-2 py-1 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                {about.note}
              </p>
            </div>
          )}
        </>
      )}
      {(about?.createdByName || about?.createdAt) && (
        <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
          Created{about.createdByName ? ` by ${about.createdByName}` : ''}
          {about.createdAt ? ` on ${new Date(about.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}` : ''}
        </p>
      )}
      {canEdit && (
        <button type="button" onClick={() => setEditing(true)} className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
          Edit
        </button>
      )}
    </div>
  );
}

/** The chat right-rail: People (presence + detail), Shared files, and About Topic,
 *  swapped by a small tab strip. Reuses the existing 300px rail shell. */
export function ChatRail({
  people,
  projectId,
  conversationId,
  files,
  about,
  canEditAbout,
  onClose,
}: {
  people: PeopleProps;
  projectId: string;
  conversationId: string;
  files: ConversationFile[];
  about: ChatAbout | null;
  canEditAbout: boolean;
  onClose?: () => void;
}) {
  const [tab, setTab] = useState<RailTab>('people');
  const TABS: { key: RailTab; label: string }[] = [
    { key: 'people', label: 'People' },
    { key: 'files', label: `Files${files.length ? ` ${files.length}` : ''}` },
    { key: 'about', label: 'About' },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
              tab === t.key
                ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white'
                : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}
          >
            {t.label}
          </button>
        ))}
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
            <X size={16} />
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {tab === 'people' && <PeopleRail {...people} onClose={onClose} />}
        {tab === 'files' && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <FilesRail files={files} />
          </div>
        )}
        {tab === 'about' && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <AboutRail projectId={projectId} conversationId={conversationId} about={about} canEdit={canEditAbout} />
          </div>
        )}
      </div>
    </div>
  );
}
