import { NextResponse } from 'next/server';
import { adapterAuthorized } from '@/lib/admin/adapter-auth';

export const dynamic = 'force-dynamic';

export type LogLevel = 'info' | 'warn' | 'error';

export type LogEntry = {
  id: string;
  timestamp: string;
  level: LogLevel;
  source: string;
  message: string;
  details?: Record<string, unknown>;
};

/**
 * Log & Event Stream endpoint for Mission Control (Pulse).
 * Exposes recent application events, database warnings, and security alerts.
 */
export async function GET(req: Request) {
  if (!adapterAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const levelFilter = url.searchParams.get('level') ?? '';

  const now = new Date();
  const sampleLogs: LogEntry[] = [
    {
      id: 'log-101',
      timestamp: new Date(now.getTime() - 2 * 60 * 1000).toISOString(),
      level: 'info',
      source: 'auth.supabase',
      message: 'User session created via OAuth',
      details: { provider: 'email' },
    },
    {
      id: 'log-102',
      timestamp: new Date(now.getTime() - 15 * 60 * 1000).toISOString(),
      level: 'info',
      source: 'boq.import',
      message: 'Bill of Quantities spreadsheet imported successfully',
      details: { rowsProcessed: 142 },
    },
    {
      id: 'log-103',
      timestamp: new Date(now.getTime() - 45 * 60 * 1000).toISOString(),
      level: 'warn',
      source: 'database.pool',
      message: 'Database pool connection latency spike (210ms)',
      details: { poolUsagePct: 78 },
    },
    {
      id: 'log-104',
      timestamp: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
      level: 'error',
      source: 'pdf.generator',
      message: 'Failed to render PDF export for tender document #402',
      details: { reason: 'Font loading timeout' },
    },
  ];

  const filteredLogs = levelFilter
    ? sampleLogs.filter((l) => l.level === levelFilter.toLowerCase())
    : sampleLogs;

  return NextResponse.json({ logs: filteredLogs });
}
