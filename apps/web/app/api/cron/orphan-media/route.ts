import { NextResponse } from 'next/server';
import { runOrphanMediaSweep } from '@/lib/jobs/orphan-media';
import { cronAuthorized } from '@/lib/jobs/cron';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Daily sweep of orphaned BoQ/invoice files (failed-upload stragglers). */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const result = await runOrphanMediaSweep();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
