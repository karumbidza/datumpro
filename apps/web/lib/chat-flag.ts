/** Chat v2 feature flag. On in dev/preview by default; production requires the
 *  env var to be set explicitly (flip NEXT_PUBLIC_CHAT_V2=1 on Vercel to launch,
 *  =0 to force-disable anywhere). Read at build/render time on the server. */
export function chatV2Enabled(): boolean {
  const v = process.env.NEXT_PUBLIC_CHAT_V2;
  if (v === '1') return true;
  if (v === '0') return false;
  return process.env.NODE_ENV !== 'production' || process.env.VERCEL_ENV === 'preview';
}
