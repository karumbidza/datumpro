/** Contractor compliance documents — tax clearances, company registration,
 *  insurance, bank confirmations. Filed by a contractor; verified by org staff. */

export const CONTRACTOR_DOC_TYPES = [
  'tax_clearance',
  'company_registration',
  'insurance',
  'bank_confirmation',
  'other',
] as const;
export type ContractorDocType = (typeof CONTRACTOR_DOC_TYPES)[number];

export const CONTRACTOR_DOC_TYPE_LABEL: Record<ContractorDocType, string> = {
  tax_clearance: 'Tax clearance',
  company_registration: 'Company registration',
  insurance: 'Insurance',
  bank_confirmation: 'Bank confirmation',
  other: 'Other',
};

export const CONTRACTOR_DOC_STATUSES = ['submitted', 'verified', 'rejected'] as const;
export type ContractorDocStatus = (typeof CONTRACTOR_DOC_STATUSES)[number];

export const CONTRACTOR_DOC_STATUS_LABEL: Record<ContractorDocStatus, string> = {
  submitted: 'Under review',
  verified: 'Verified',
  rejected: 'Rejected',
};
