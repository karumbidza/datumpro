import Link from 'next/link';
import { redirect } from 'next/navigation';
import { can } from '@datumpro/shared/access';
import {
  CONTRACTOR_DOC_TYPE_LABEL,
  CONTRACTOR_DOC_STATUS_LABEL,
  type ContractorDocStatus,
} from '@datumpro/shared/domain';
import { getActiveContext } from '@/lib/data/org';
import { listOrgDocuments, type ContractorDocumentRow } from '@/lib/data/contractor-documents';
import { ReviewDocument } from '@/components/documents/review-document';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

const DOC_TONE: Record<ContractorDocStatus, 'neutral' | 'blue' | 'green' | 'amber'> = {
  submitted: 'amber',
  verified: 'green',
  rejected: 'neutral',
};

export default async function OrgDocumentsPage() {
  const ctx = await getActiveContext();
  if (!ctx?.active) redirect('/sign-in');
  // Staff-only (owner/admin/finance); RLS enforces the same.
  if (!can(ctx.active.role, 'payment:record')) redirect('/dashboard');

  const docs = await listOrgDocuments(ctx.active.orgId);

  // Group by contractor for a readable review list.
  const byContractor = new Map<string, { name: string; docs: ContractorDocumentRow[] }>();
  for (const d of docs) {
    const g = byContractor.get(d.contractorId) ?? { name: d.contractorName ?? 'Contractor', docs: [] };
    g.docs.push(d);
    byContractor.set(d.contractorId, g);
  }
  const pending = docs.filter((d) => d.status === 'submitted').length;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/org" className="text-xs text-zinc-500 hover:underline">
        ← Organization
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Contractor documents</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Tax clearances and company documents your contractors have filed
        {pending > 0 ? ` · ${pending} awaiting review` : ''}.
      </p>

      {docs.length === 0 ? (
        <Card className="mt-6">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No documents submitted yet.</p>
        </Card>
      ) : (
        <div className="mt-6 space-y-6">
          {[...byContractor.entries()].map(([id, group]) => (
            <section key={id}>
              <h2 className="mb-2 text-sm font-semibold">{group.name}</h2>
              <Card className="p-0">
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {group.docs.map((d) => (
                    <li key={d.id} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {d.title || CONTRACTOR_DOC_TYPE_LABEL[d.docType]}
                          </p>
                          <p className="text-xs text-zinc-400">
                            {CONTRACTOR_DOC_TYPE_LABEL[d.docType]}
                            {d.expiryDate ? ` · expires ${d.expiryDate}` : ''}
                            {d.fileUrl && (
                              <>
                                {' · '}
                                <a href={d.fileUrl} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline dark:text-brand-400">
                                  view
                                </a>
                              </>
                            )}
                          </p>
                        </div>
                        <Badge tone={DOC_TONE[d.status]}>{CONTRACTOR_DOC_STATUS_LABEL[d.status]}</Badge>
                      </div>
                      <ReviewDocument id={d.id} status={d.status} />
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
