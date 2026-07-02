import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Liveness probe for uptime monitors / deploy checks. */
export function GET() {
  return NextResponse.json({ ok: true, service: 'datumpro-web', time: new Date().toISOString() });
}
