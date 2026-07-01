import { NextResponse } from 'next/server';
import { runDailyDigest } from '@/lib/jobs/digest';
import { cronAuthorized } from '@/lib/jobs/cron';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Scheduled per-person daily digest of open assigned tasks. */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const result = await runDailyDigest();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
