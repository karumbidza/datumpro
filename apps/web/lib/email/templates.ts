import 'server-only';

/** Shared, dependency-free HTML email templates. Inline styles only (email
 *  clients ignore <style>), a single accent colour, and an optional CTA button. */

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

const BRAND = '#4f46e5';

function layout(opts: {
  heading: string;
  intro: string;
  bodyHtml?: string;
  ctaLabel?: string;
  ctaHref?: string;
  footnote?: string;
}): string {
  const { heading, intro, bodyHtml = '', ctaLabel, ctaHref, footnote } = opts;
  const cta =
    ctaLabel && ctaHref
      ? `<tr><td style="padding:8px 0 4px">
           <a href="${ctaHref}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:8px">${ctaLabel}</a>
         </td></tr>`
      : '';
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden">
        <tr><td style="padding:18px 24px;border-bottom:1px solid #f4f4f5;font-weight:700;font-size:15px;color:#18181b">DatumPro</td></tr>
        <tr><td style="padding:24px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="font-size:18px;font-weight:600;color:#18181b;padding-bottom:8px">${heading}</td></tr>
            <tr><td style="font-size:14px;color:#3f3f46;line-height:1.5;padding-bottom:14px">${intro}</td></tr>
            ${bodyHtml ? `<tr><td style="padding-bottom:14px">${bodyHtml}</td></tr>` : ''}
            ${cta}
          </table>
        </td></tr>
        <tr><td style="padding:14px 24px;border-top:1px solid #f4f4f5;font-size:11px;color:#a1a1aa">
          ${footnote ?? 'You’re receiving this because you use DatumPro for construction project delivery.'}
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`;
}

export function inviteEmail(opts: { orgName: string; inviterName: string; acceptUrl: string; role: string }) {
  return {
    subject: `You’re invited to ${opts.orgName} on DatumPro`,
    html: layout({
      heading: `Join ${opts.orgName}`,
      intro: `${opts.inviterName} invited you to collaborate on <strong>${opts.orgName}</strong> as ${opts.role}. Accept the invitation to get started.`,
      ctaLabel: 'Accept invitation',
      ctaHref: opts.acceptUrl,
      footnote: 'If you weren’t expecting this invitation you can safely ignore this email.',
    }),
  };
}

export function approvalDecisionEmail(opts: {
  requesterName: string;
  title: string;
  decision: 'approved' | 'rejected';
  deciderName: string;
  url: string;
  note?: string;
}) {
  const verb = opts.decision === 'approved' ? 'approved' : 'rejected';
  return {
    subject: `Your request “${opts.title}” was ${verb}`,
    html: layout({
      heading: `Request ${verb}`,
      intro: `${opts.deciderName} ${verb} your request <strong>${opts.title}</strong>.`,
      bodyHtml: opts.note
        ? `<div style="font-size:13px;color:#52525b;background:#f4f4f5;border-radius:8px;padding:10px">${opts.note}</div>`
        : '',
      ctaLabel: 'View request',
      ctaHref: opts.url,
    }),
  };
}

export function extensionDecisionEmail(opts: {
  taskTitle: string;
  decision: 'approved' | 'rejected';
  deciderName: string;
  url: string;
  newDate?: string;
}) {
  const verb = opts.decision === 'approved' ? 'approved' : 'declined';
  return {
    subject: `Extension ${verb}: ${opts.taskTitle}`,
    html: layout({
      heading: `Extension ${verb}`,
      intro: `${opts.deciderName} ${verb} the extension request on <strong>${opts.taskTitle}</strong>${
        opts.decision === 'approved' && opts.newDate ? `. New due date: <strong>${opts.newDate}</strong>` : ''
      }.`,
      ctaLabel: 'View task',
      ctaHref: opts.url,
    }),
  };
}

export function quoteAwardedEmail(opts: { taskTitle: string; orgName: string; url: string }) {
  return {
    subject: `You won the work: ${opts.taskTitle}`,
    html: layout({
      heading: 'Quote awarded',
      intro: `${opts.orgName} awarded you the task <strong>${opts.taskTitle}</strong>. You now have access to its private discussion and payment schedule.`,
      ctaLabel: 'Open task',
      ctaHref: opts.url,
    }),
  };
}

export function slaEmail(opts: {
  taskTitle: string;
  kind: 'at_risk' | 'breached';
  dueDate: string | null;
  url: string;
}) {
  const breached = opts.kind === 'breached';
  const due = opts.dueDate ? new Date(opts.dueDate).toLocaleDateString('en-GB') : 'soon';
  return {
    subject: breached ? `Overdue: ${opts.taskTitle}` : `Due soon: ${opts.taskTitle}`,
    html: layout({
      heading: breached ? 'Task overdue' : 'Task due soon',
      intro: breached
        ? `<strong>${opts.taskTitle}</strong> passed its due date (${due}) and isn’t finished yet. It’s now flagged as breached.`
        : `<strong>${opts.taskTitle}</strong> is due ${due}. It’s been flagged at risk so it doesn’t slip.`,
      ctaLabel: 'Open task',
      ctaHref: opts.url,
    }),
  };
}

export function digestEmail(opts: {
  name: string;
  openCount: number;
  overdue: { title: string; url: string }[];
  dueTodayCount: number;
  dashboardUrl: string;
}) {
  const list =
    opts.overdue.length > 0
      ? `<div style="font-size:13px;color:#52525b">Overdue:</div>
         <ul style="margin:6px 0 0;padding-left:18px;font-size:13px;color:#3f3f46">
           ${opts.overdue
             .map((o) => `<li><a href="${o.url}" style="color:#4f46e5;text-decoration:none">${o.title}</a></li>`)
             .join('')}
         </ul>`
      : '';
  return {
    subject: `Your DatumPro summary — ${opts.openCount} open task${opts.openCount === 1 ? '' : 's'}`,
    html: layout({
      heading: `Good morning, ${opts.name}`,
      intro: `You have <strong>${opts.openCount}</strong> open task${
        opts.openCount === 1 ? '' : 's'
      }${opts.dueTodayCount > 0 ? `, <strong>${opts.dueTodayCount}</strong> due today` : ''}${
        opts.overdue.length > 0 ? `, and <strong>${opts.overdue.length}</strong> overdue` : ''
      }.`,
      bodyHtml: list,
      ctaLabel: 'Open my tasks',
      ctaHref: opts.dashboardUrl,
      footnote: 'Daily summary from DatumPro. You can turn these off in your notification settings.',
    }),
  };
}

export { appUrl };
