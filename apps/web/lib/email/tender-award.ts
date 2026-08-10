import 'server-only';

/**
 * Email templates for sealed-bid tender award notifications. Mirrors the tone
 * and inline style of tender-invite.ts.
 */

export function awardWinEmail(input: {
  orgName: string;
  tenderTitle: string;
  companyName: string;
}): { subject: string; html: string } {
  const { orgName, tenderTitle, companyName } = input;

  const subject = `You've been awarded: ${tenderTitle}`;

  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden">
        <tr><td style="padding:18px 24px;border-bottom:1px solid #f4f4f5;font-weight:700;font-size:15px;color:#18181b">DatumPro</td></tr>
        <tr><td style="padding:24px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="font-size:18px;font-weight:600;color:#18181b;padding-bottom:8px">Tender awarded</td></tr>
            <tr><td style="font-size:14px;color:#3f3f46;line-height:1.5;padding-bottom:14px">
              Congratulations, <strong>${companyName}</strong>! <strong>${orgName}</strong> has selected you for
              &ldquo;${tenderTitle}&rdquo; on DatumPro. They will be in touch with you shortly regarding next steps.
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:14px 24px;border-top:1px solid #f4f4f5;font-size:11px;color:#a1a1aa">
          You're receiving this because ${orgName} awarded you a sealed tender through DatumPro.
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`;

  return { subject, html };
}

export function awardRegretEmail(input: {
  orgName: string;
  tenderTitle: string;
  companyName: string;
}): { subject: string; html: string } {
  const { orgName, tenderTitle, companyName } = input;

  const subject = `Tender outcome: ${tenderTitle}`;

  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden">
        <tr><td style="padding:18px 24px;border-bottom:1px solid #f4f4f5;font-weight:700;font-size:15px;color:#18181b">DatumPro</td></tr>
        <tr><td style="padding:24px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="font-size:18px;font-weight:600;color:#18181b;padding-bottom:8px">Tender outcome</td></tr>
            <tr><td style="font-size:14px;color:#3f3f46;line-height:1.5;padding-bottom:14px">
              Dear <strong>${companyName}</strong>, thank you for taking the time to submit your bid for
              &ldquo;${tenderTitle}&rdquo; on DatumPro. After careful consideration, <strong>${orgName}</strong> has
              awarded this tender to another bidder on this occasion. We appreciate your participation and hope to see
              you bid again in the future.
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:14px 24px;border-top:1px solid #f4f4f5;font-size:11px;color:#a1a1aa">
          You're receiving this because you submitted a bid on a sealed tender through DatumPro.
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`;

  return { subject, html };
}
