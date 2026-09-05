/** Client-side mirrors of the storage bucket size caps (enforced server-side on
 *  the buckets themselves). Checking before upload gives users a friendly error
 *  instead of a cryptic storage rejection after the bytes were already sent. */
export const MAX_PROJECT_MEDIA_BYTES = 50 * 1024 * 1024; // project-media bucket
export const MAX_CHAT_MEDIA_BYTES = 25 * 1024 * 1024; // chat-media bucket

const mb = (bytes: number) => Math.max(1, Math.round(bytes / (1024 * 1024)));

/** Returns a friendly error message when the file exceeds the cap, else null. */
export function uploadSizeError(
  file: { name: string; size: number },
  maxBytes: number,
): string | null {
  if (file.size <= maxBytes) return null;
  return `"${file.name}" is too large (${mb(file.size)} MB) — the limit is ${mb(maxBytes)} MB.`;
}
