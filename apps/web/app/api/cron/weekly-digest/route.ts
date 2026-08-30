import { NextResponse } from 'next/server';
import { runWeeklyDigest } from '@/lib/jobs/weekly-digest';
import { cronAuthorized } from '@/lib/jobs/cron';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Scheduled Monday "your week" Work Pulse digest, per member per org. */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const result = await runWeeklyDigest();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
