import { NextResponse } from 'next/server';
import { adapterAuthorized } from '@/lib/admin/adapter-auth';

export const dynamic = 'force-dynamic';

export type FeatureFlag = {
  key: string;
  name: string;
  enabled: boolean;
  description: string;
};

// In-memory feature flag cache for system overrides
const flagState: Record<string, boolean> = {
  maintenance_mode: false,
  ai_boq_copilot: true,
  strict_mfa: false,
};

/**
 * Feature Flags endpoint for Mission Control (Pulse).
 * GET returns active flag states; POST allows Pulse to override global flags.
 */
export async function GET(req: Request) {
  if (!adapterAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const flags: FeatureFlag[] = [
    {
      key: 'maintenance_mode',
      name: 'System Maintenance Mode',
      enabled: Boolean(flagState.maintenance_mode),
      description: 'Restrict access to read-only mode for scheduled maintenance',
    },
    {
      key: 'ai_boq_copilot',
      name: 'AI BOQ Estimator Copilot',
      enabled: Boolean(flagState.ai_boq_copilot),
      description: 'Enable generative AI assistance during Bill of Quantities breakdown',
    },
    {
      key: 'strict_mfa',
      name: 'Enforce Mandatory MFA',
      enabled: Boolean(flagState.strict_mfa),
      description: 'Require Two-Factor Authentication for all project managers',
    },
  ];

  return NextResponse.json({ flags });
}

export async function POST(req: Request) {
  if (!adapterAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { key?: string; enabled?: boolean };
  if (!body.key || typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'key (string) and enabled (boolean) required' }, { status: 400 });
  }

  flagState[body.key] = body.enabled;
  return NextResponse.json({ ok: true, key: body.key, enabled: body.enabled });
}
