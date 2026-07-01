import 'server-only';

/**
 * Transactional email via the Resend REST API (no SDK dependency — one fetch).
 *
 * Best-effort by design: if RESEND_API_KEY is unset (local/dev) it logs and
 * returns without throwing, and a send failure never bubbles into the caller's
 * write path. Callers `await sendEmail(...)` for ordering but ignore the result.
 */
export interface EmailInput {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

export interface EmailResult {
  ok: boolean;
  id?: string;
  skipped?: boolean;
  error?: string;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export async function sendEmail(input: EmailInput): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || 'DatumPro <onboarding@resend.dev>';
  if (!apiKey) {
    console.info('[email] RESEND_API_KEY unset — skipping send:', input.subject);
    return { ok: false, skipped: true };
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(input.to) ? input.to : [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text ?? stripHtml(input.html),
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[email] send failed', res.status, body);
      return { ok: false, error: `${res.status}` };
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, id: data.id };
  } catch (e) {
    console.error('[email] send error', e);
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}

/** Crude HTML→text fallback so every email has a plaintext part. */
function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
