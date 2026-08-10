import 'server-only';

/**
 * Email template for sealed-bid tender invitations. Mirrors the tone and inline
 * style of the member invite email (apps/web/lib/email/templates.ts).
 */

const BRAND = '#4f46e5';

export function tenderInviteEmail(input: {
  orgName: string;
  tenderTitle: string;
  companyName: string;
  acceptUrl: string;
}): { subject: string; html: string } {
  const { orgName, tenderTitle, companyName, acceptUrl } = input;

  const subject = `You're invited to bid: ${tenderTitle}`;

  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden">
        <tr><td style="padding:18px 24px;border-bottom:1px solid #f4f4f5;font-weight:700;font-size:15px;color:#18181b">DatumPro</td></tr>
        <tr><td style="padding:24px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="font-size:18px;font-weight:600;color:#18181b;padding-bottom:8px">Sealed bid invitation</td></tr>
            <tr><td style="font-size:14px;color:#3f3f46;line-height:1.5;padding-bottom:14px">
              <strong>${orgName}</strong> has invited <strong>${companyName}</strong> to submit a sealed bid for
              &ldquo;${tenderTitle}&rdquo; on DatumPro. Use the button below to review the bill of quantities
              and submit your bid before the tender closes.
            </td></tr>
            <tr><td style="padding:8px 0 4px">
              <a href="${acceptUrl}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:8px">View &amp; submit bid</a>
            </td></tr>
            <tr><td style="font-size:12px;color:#71717a;padding-top:14px">
              This link is unique to ${companyName} — please do not forward it to others. If you weren't expecting this invitation you can safely ignore this email.
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:14px 24px;border-top:1px solid #f4f4f5;font-size:11px;color:#a1a1aa">
          You're receiving this because ${orgName} invited you to bid on a sealed tender through DatumPro.
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`;

  return { subject, html };
}
