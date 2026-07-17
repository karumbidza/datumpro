import { NextResponse } from 'next/server';
import { runProgressSnapshot } from '@/lib/jobs/snapshots';
import { cronAuthorized } from '@/lib/jobs/cron';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Nightly burn-up capture: snapshots each in-flight project's % so the overview
 *  can render a progress-over-time trend. */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const result = await runProgressSnapshot();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
