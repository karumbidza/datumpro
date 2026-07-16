import { NextResponse } from 'next/server';
import { runRemindersScan } from '@/lib/jobs/reminders';
import { cronAuthorized } from '@/lib/jobs/cron';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Daily reminders: subtask steps due-soon/overdue, and tasks still awaiting a
 *  contractor's acceptance. Nudges the responsible person (in-app + email + push). */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const result = await runRemindersScan();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
