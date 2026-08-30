import { createAdminClient } from '@/lib/supabase/admin';
import { verifyWeeklyUnsubToken } from '@/lib/jobs/digest-token';

export const dynamic = 'force-dynamic';

function page(message: string, ok: boolean): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Weekly digest</title></head>
  <body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
    <div style="max-width:440px;margin:64px auto;background:#fff;border:1px solid #e4e4e7;border-radius:12px;padding:28px;text-align:center">
      <div style="font-weight:700;color:#18181b;margin-bottom:12px">DatumPro</div>
      <div style="font-size:15px;color:${ok ? '#16a34a' : '#3f3f46'};line-height:1.5">${message}</div>
    </div>
  </body></html>`;
  return new Response(html, { status: ok ? 200 : 400, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

/** One-click unsubscribe from the weekly digest — the link in the email footer.
 *  Stateless: the token carries a signed (userId, orgId), so no session is needed. */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token') ?? '';
  const claims = verifyWeeklyUnsubToken(token);
  if (!claims) {
    return page('This unsubscribe link is invalid or has expired. You can manage the weekly digest from your account settings.', false);
  }

  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from('org_members')
      .update({ weekly_digest_opt_in: false })
      .eq('org_id', claims.orgId)
      .eq('user_id', claims.userId);
    if (error) throw error;
  } catch {
    return page('Something went wrong. Please try again, or turn the digest off in your account settings.', false);
  }

  return page('You’ve been unsubscribed from the weekly digest. You can turn it back on any time in your account settings.', true);
}
