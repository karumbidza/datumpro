import { ReviewDocument } from '@/components/documents/review-document';
import type { ContractorDocRow } from '@/lib/data/contractor-documents';

const STATUS_TONE: Record<string, string> = {
  submitted: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  verified: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400',
};

/** Inline compliance docs for one contractor member, with staff verify/reject.
 *  `canReview` gates the review controls (payment:record). */
export function MemberDocuments({ docs, canReview }: { docs: ContractorDocRow[]; canReview: boolean }) {
  if (docs.length === 0) {
    return <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">No compliance documents uploaded.</p>;
  }
  return (
    <ul className="mt-2 space-y-1.5">
      {docs.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">{d.title || d.docType.replace(/_/g, ' ')}</span>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${STATUS_TONE[d.status]}`}>{d.status}</span>
          {d.expiryDate && <span className="text-zinc-400 dark:text-zinc-500">exp {new Date(d.expiryDate).toLocaleDateString('en-GB')}</span>}
          {canReview && d.status === 'submitted' && <ReviewDocument id={d.id} status={d.status} />}
        </li>
      ))}
    </ul>
  );
}
