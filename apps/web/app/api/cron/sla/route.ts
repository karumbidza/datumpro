import { NextResponse } from 'next/server';
import { runSlaScan } from '@/lib/jobs/sla';
import { cronAuthorized } from '@/lib/jobs/cron';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Scheduled SLA scan: flip overdue → breached, due-soon → at_risk, and email. */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const result = await runSlaScan();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
