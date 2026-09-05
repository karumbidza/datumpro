/** Client-side mirrors of the storage bucket size caps (enforced server-side on
 *  the buckets themselves). Checking before upload gives users a friendly error
 *  instead of a cryptic storage rejection after the bytes were already sent. */
export const MAX_PROJECT_MEDIA_BYTES = 50 * 1024 * 1024; // project-media bucket
export const MAX_CHAT_MEDIA_BYTES = 25 * 1024 * 1024; // chat-media bucket

/** Decoded byte size of a base64 payload, without decoding it. */
export function base64Bytes(base64: string): number {
  const pad = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - pad;
}

const mb = (bytes: number) => Math.max(1, Math.round(bytes / (1024 * 1024)));

/** Throws a friendly Error when a base64 payload exceeds the bucket cap. The
 *  callers' existing catch → Alert flows surface the message to the user. */
export function assertUploadSize(base64: string, maxBytes: number, label = 'This file'): void {
  const bytes = base64Bytes(base64);
  if (bytes > maxBytes) {
    throw new Error(`${label} is too large (${mb(bytes)} MB) — the limit is ${mb(maxBytes)} MB.`);
  }
}
