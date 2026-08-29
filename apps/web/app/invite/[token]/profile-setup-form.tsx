'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { completeProfileAndAccept } from './actions';
import { SubmitButton } from '@/components/ui/submit-button';
import { FormError } from '@/components/ui/form-error';
import { Check } from '@/components/icons';

import { inputClass, labelClass, Req } from '@/components/ui/form';

const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;

/** firstname.lastname from whatever name material we have. */
function suggestUsername(seed: string): string {
  const cleaned = seed
    .toLowerCase()
    .replace(/@.*$/, '')
    .replace(/[^a-z0-9\s._-]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .join('.');
  return cleaned.replace(/^[._-]+|[._-]+$/g, '').slice(0, 30);
}

/** Square-crop + resize a picked image, re-encoded as WebP (canvas re-encode
 *  also strips EXIF — site selfies carry GPS). */
async function toSquareWebp(file: File, size: number, quality: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process the image.'))), 'image/webp', quality);
  });
}

/** Deterministic avatar colour from the user id — the initials fallback. */
const AVATAR_COLORS = ['#2563eb', '#7c3aed', '#0d9488', '#db2777', '#ea580c', '#4f46e5', '#16a34a', '#b45309'];
export function avatarColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length] ?? '#2563eb';
}

export function ProfileSetupForm({
  token,
  email,
  userId,
  initialName,
  roleLabel,
  roleHint,
  orgName,
  isContractor,
}: {
  token: string;
  email: string;
  userId: string;
  initialName: string;
  roleLabel: string;
  roleHint: string;
  orgName: string;
  isContractor: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [state, formAction] = useActionState(completeProfileAndAccept, {});

  const [fullName, setFullName] = useState(initialName);
  const [username, setUsername] = useState(() => suggestUsername(initialName || email));
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [availability, setAvailability] = useState<'checking' | 'free' | 'taken' | 'invalid' | null>(null);

  // Avatar state — files upload on pick so submit stays a plain form action.
  const [avatarUrl, setAvatarUrl] = useState('');
  const [thumbUrl, setThumbUrl] = useState('');
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  // Auto-suggest tracks the name until the person edits the handle themselves.
  useEffect(() => {
    if (!usernameTouched) setUsername(suggestUsername(fullName || email));
  }, [fullName, email, usernameTouched]);

  // Debounced live availability tick.
  useEffect(() => {
    if (!username) {
      setAvailability(null);
      return;
    }
    if (!USERNAME_RE.test(username)) {
      setAvailability('invalid');
      return;
    }
    setAvailability('checking');
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc('username_available', { p_username: username });
      setAvailability(error ? null : data ? 'free' : 'taken');
    }, 350);
    return () => clearTimeout(t);
  }, [username, supabase]);

  async function handlePickedFile(file: File | undefined | null) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setAvatarError('Photo is over 5MB — pick a smaller one.');
      return;
    }
    setAvatarBusy(true);
    setAvatarError(null);
    try {
      const [full, thumb] = await Promise.all([toSquareWebp(file, 512, 0.82), toSquareWebp(file, 96, 0.8)]);
      const base = `${userId}`;
      const up = async (path: string, blob: Blob) => {
        const { error } = await supabase.storage
          .from('avatars')
          .upload(path, blob, { upsert: true, contentType: 'image/webp' });
        if (error) throw new Error(error.message);
        return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
      };
      const [fullUrl, thumbPublicUrl] = await Promise.all([
        up(`${base}/avatar.webp`, full),
        up(`${base}/thumb.webp`, thumb),
      ]);
      // Cache-bust locally; the stored URL stays clean (renderers append avatar_updated_at).
      setAvatarUrl(fullUrl);
      setThumbUrl(thumbPublicUrl);
    } catch (e) {
      setAvatarError(e instanceof Error ? e.message : 'Upload failed — try again.');
    } finally {
      setAvatarBusy(false);
    }
  }

  const initials = (fullName || email)
    .split(/[\s.@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

  const availabilityLine =
    availability === 'checking' ? (
      <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">Checking…</p>
    ) : availability === 'free' ? (
      <p className="mt-1 flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
        <Check size={12} /> {username} is available
      </p>
    ) : availability === 'taken' ? (
      <p className="mt-1 text-xs text-red-600 dark:text-red-400">{username} is taken — try another.</p>
    ) : availability === 'invalid' ? (
      <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">3–30 characters: a–z, 0–9, dots, dashes, underscores.</p>
    ) : null;

  return (
    <form action={formAction} className="mt-4 space-y-4">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="avatarUrl" value={avatarUrl} />
      <input type="hidden" name="avatarThumbUrl" value={thumbUrl} />

      <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-300">
        <strong className="text-zinc-900 dark:text-white">{roleLabel}:</strong> {roleHint}
      </div>

      <FormError error={state.error} />

      <div>
        <label className={labelClass}>Email</label>
        <input
          readOnly
          disabled
          value={email}
          tabIndex={-1}
          aria-label="Invited email (locked)"
          className={`${inputClass} pointer-events-none cursor-not-allowed select-none bg-zinc-50 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-500`}
        />
        <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">Locked — it's the address that was invited.</p>
      </div>

      <div>
        <label className={labelClass}>Username<Req /></label>
        <input
          name="username"
          required
          autoFocus
          value={username}
          onChange={(e) => {
            setUsernameTouched(true);
            // Strip anything the username rule (^[a-z0-9._-]{3,30}$) forbids — most
            // often a space — so the field can never hold an invalid value that
            // silently disables Join.
            setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''));
          }}
          className={inputClass}
          autoComplete="off"
          spellCheck={false}
        />
        {availabilityLine}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Full name<Req /></label>
          <input
            name="fullName"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Phone<Req /></label>
          <input
            name="phone"
            required
            type="tel"
            placeholder="+263 77 …"
            className={inputClass}
          />
        </div>
      </div>
      <p className="-mt-2 text-xs text-zinc-400 dark:text-zinc-500">WhatsApp number preferred — site notifications fall back to it.</p>

      <div>
        <label className={labelClass}>
          Profile photo <span className="font-normal text-zinc-400 dark:text-zinc-500">(optional)</span>
        </label>
        <div className="flex items-center gap-4">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt="Your profile photo"
              className="rounded-full object-cover"
              style={{ width: 52, height: 52 }}
              width={52}
              height={52}
            />
          ) : (
            <span
              className="flex items-center justify-center rounded-full text-lg font-semibold text-white"
              style={{ background: avatarColor(userId), width: 52, height: 52 }}
            >
              {initials || '?'}
            </span>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={avatarBusy}
              onClick={() => fileRef.current?.click()}
              className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
            >
              {avatarBusy ? 'Uploading…' : 'Upload'}
            </button>
            <button
              type="button"
              disabled={avatarBusy}
              onClick={() => cameraRef.current?.click()}
              className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
            >
              Take photo
            </button>
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => handlePickedFile(e.target.files?.[0])} />
        <input ref={cameraRef} type="file" accept="image/*" capture="user" className="hidden" onChange={(e) => handlePickedFile(e.target.files?.[0])} />
        <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
          {avatarError ?? 'Skipped? Your initials on this colour stand in everywhere.'}
        </p>
      </div>

      {isContractor && (
        <div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Company<Req /></label>
              <input name="companyName" required className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>
                Trade <span className="font-normal text-zinc-400 dark:text-zinc-500">(optional)</span>
              </label>
              <input name="trade" className={inputClass} />
            </div>
          </div>
          <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">Shown because this invite is for a contractor.</p>
        </div>
      )}

      <div className="pt-1">
        <SubmitButton pendingText="Joining…" disabled={availability === 'taken' || availability === 'invalid' || avatarBusy}>
          Join {orgName}
        </SubmitButton>
      </div>
    </form>
  );
}
