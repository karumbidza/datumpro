/**
 * Fixed-window rate limiter for the edge middleware. Dependency-free and
 * Edge-runtime safe (only fetch + Map + Date.now).
 *
 * Durable, cross-instance limiting uses Upstash Redis over its REST API when
 * UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set. Without them it
 * falls back to an in-memory counter — best-effort only, since each serverless
 * instance has its own memory (fine for dev/single-instance; set Upstash, or use
 * a platform WAF, for real protection in production).
 */
export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Epoch ms when the current window resets. */
  reset: number;
}

const memory = new Map<string, { count: number; reset: number }>();

/** INCR the key and set its TTL on first write. Returns the post-increment count,
 *  or null if Upstash isn't configured / the call failed (caller falls back). */
async function upstashIncr(key: string, windowSec: number): Promise<number | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const res = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      // INCR, then set expiry only if not already set (NX) so the window is fixed.
      body: JSON.stringify([
        ['INCR', key],
        ['EXPIRE', key, String(windowSec), 'NX'],
      ]),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ result?: number }>;
    const count = data?.[0]?.result;
    return typeof count === 'number' ? count : null;
  } catch {
    return null; // network/Upstash hiccup must never block a request
  }
}

export async function rateLimit(id: string, limit: number, windowSec: number): Promise<RateLimitResult> {
  const now = Date.now();
  const key = `rl:${id}`;

  const upstashCount = await upstashIncr(key, windowSec);
  if (upstashCount !== null) {
    return {
      ok: upstashCount <= limit,
      limit,
      remaining: Math.max(0, limit - upstashCount),
      reset: now + windowSec * 1000,
    };
  }

  // In-memory fallback (per-instance).
  const entry = memory.get(key);
  if (!entry || entry.reset <= now) {
    memory.set(key, { count: 1, reset: now + windowSec * 1000 });
    return { ok: true, limit, remaining: limit - 1, reset: now + windowSec * 1000 };
  }
  entry.count += 1;
  // Opportunistic cleanup so the map can't grow unbounded on a long-lived isolate.
  if (memory.size > 5000) {
    for (const [k, v] of memory) if (v.reset <= now) memory.delete(k);
  }
  return { ok: entry.count <= limit, limit, remaining: Math.max(0, limit - entry.count), reset: entry.reset };
}

/** First client IP from the platform's forwarding headers. */
export function clientIp(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return headers.get('x-real-ip') || headers.get('cf-connecting-ip') || 'unknown';
}
