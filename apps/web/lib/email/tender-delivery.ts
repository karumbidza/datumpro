import 'server-only';

/** Email to the winning contractor when their awarded tender is exported to a
 *  delivery project and tasks are assigned. Best-effort; mirrors tender-award.ts. */
export function deliveryAssignedEmail(input: {
  orgName: string;
  projectName: string;
  taskCount: number;
}): { subject: string; html: string } {
  const { orgName, projectName, taskCount } = input;
  const subject = `Work assigned: ${projectName}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden">
        <tr><td style="padding:18px 24px;border-bottom:1px solid #f4f4f5;font-weight:700;font-size:15px;color:#18181b">DatumPro</td></tr>
        <tr><td style="padding:24px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="font-size:18px;font-weight:600;color:#18181b;padding-bottom:8px">Your work is ready</td></tr>
            <tr><td style="font-size:14px;color:#3f3f46;line-height:1.5;padding-bottom:14px">
              <strong>${orgName}</strong> has assigned you the works for &ldquo;${projectName}&rdquo; on DatumPro
              (${taskCount} task${taskCount === 1 ? '' : 's'}). Log in to view your tasks, see the agreed costs,
              and tick off each item as you complete it.
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:14px 24px;border-top:1px solid #f4f4f5;font-size:11px;color:#a1a1aa">
          You're receiving this because ${orgName} assigned you work through DatumPro.
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`;
  return { subject, html };
}
