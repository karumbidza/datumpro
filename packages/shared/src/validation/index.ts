/** Zod schemas — shared by the web API routes and the mobile client so request
 *  shapes are validated identically on both ends. */

import { z } from 'zod';
import { ORG_ROLES } from '../access/roles';
import { PROJECT_TYPES, CONSTRUCTION_TYPES, CURRENCIES, DURATION_UNITS } from '../domain/projects';
import { BOQ_INDUSTRIES, BOQ_TYPES } from '../domain/boq';
import { REQUEST_TYPES } from '../domain/requests';
import { REPORT_STATUSES, WEATHER_OPTIONS } from '../domain/monitoring';
import { PAYMENT_METHODS } from '../domain/finance';
import { TASK_PRIORITIES } from '../domain/tasks';

export * from './email';

/** Empty/whitespace optional strings become `undefined` so blank form fields
 *  don't write empty strings into the DB. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined));

/** Minimum password length, enforced identically on sign-up, password reset, and
 *  change-password. 8 is the NIST-800-63B floor; Supabase's leaked-password check
 *  (enabled on the dashboard) layers on top of this. */
export const PASSWORD_MIN_LENGTH = 8;

/** Returns a human-readable problem with a password, or null if it's acceptable.
 *  Deliberately length-only beyond the floor — composition rules (mixed case,
 *  symbols) push users toward shorter, more patterned passwords without adding
 *  real entropy, so we lean on length + the leaked-password check instead. */
export function passwordIssue(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  return null;
}

/** Company profile captured by the onboarding setup wizard. `name` is the only
 *  required field; the rest are an on-record profile that adds credibility. */
/** Optional email: blank → undefined, otherwise must look like an email. Used for
 *  the company contact address (distinct from the owner's login email). */
const optionalEmail = z
  .string()
  .trim()
  .max(160)
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined))
  .refine((v) => v === undefined || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
    message: 'Enter a valid company email.',
  });

export const createOrgSchema = z.object({
  name: z.string().trim().min(2).max(120),
  legalName: optionalText(160),
  country: optionalText(64), // ISO-2 or free text (e.g. "KE" or "Kenya")
  sector: optionalText(64),
  registrationNumber: optionalText(64),
  contactEmail: optionalEmail,
  contactPhone: optionalText(40),
});
export type CreateOrgInput = z.infer<typeof createOrgSchema>;

/** Full payload of the company setup wizard: the company profile plus the owner's
 *  display name (which seeds profiles.display_name so the app greets them by name,
 *  not their email) and an explicit Terms & Privacy acceptance that must be true.
 *  A company phone is required; the owner's login email is the contact email, so
 *  no separate company email is collected. */
export const orgSetupSchema = createOrgSchema.extend({
  fullName: z.string().trim().min(2, 'Enter your full name.').max(120),
  contactPhone: z
    .string()
    .trim()
    .min(7, 'Enter a company phone number.')
    .max(40)
    .regex(/^\+?[0-9()\-\s]{7,}$/, 'Enter a valid phone number.'),
  termsAccepted: z.literal(true, {
    errorMap: () => ({ message: 'Accept the Terms and Privacy Policy to continue.' }),
  }),
});
export type OrgSetupInput = z.infer<typeof orgSetupSchema>;

export const inviteMemberSchema = z.object({
  email: z.string().trim().email(),
  role: z.enum(ORG_ROLES),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

/** A contractor's payment request (buy-side). Optionally links to a scheduled
 *  draw; carries an optional uploaded invoice document. */
export const paymentRequestSchema = z.object({
  projectId: z.string().uuid(),
  // A payment request is always against an approved task/plan the caller is
  // assigned to, and must carry an invoice.
  taskId: z.string().uuid(),
  title: z.string().trim().min(2).max(160),
  amountCents: z.number().int().positive(),
  note: z.string().trim().max(1000).optional().nullable(),
  invoicePath: z.string().trim().min(1).max(500),
  invoiceName: z.string().trim().min(1).max(255),
});
export type PaymentRequestInput = z.infer<typeof paymentRequestSchema>;

export const createProjectSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    // `code` is auto-generated server-side (collision-safe) — never trusted from the client.
    type: z.enum(PROJECT_TYPES).default('construction'),
    constructionType: z.enum(CONSTRUCTION_TYPES),
    description: z.string().trim().max(2000).optional().or(z.literal('')),
    priority: z.enum(TASK_PRIORITIES).default('medium'),
    clientId: z.string().uuid(),
    managerId: z.string().uuid(),
    teamMemberIds: z.array(z.string().uuid()).max(100).default([]),
    startDate: z.string().date(),
    durationValue: z.number().int().positive().max(3650),
    durationUnit: z.enum(DURATION_UNITS).default('weeks'),
    calendarId: z.string().uuid(),
    currency: z.enum(CURRENCIES),
    contractValueCents: z.number().int().nonnegative().default(0),
    templateId: z.string().uuid().optional().nullable(),
    // BOQ step: start the project from an existing bill (tasks generated at
    // budget rates), draft a new linked bill, or neither.
    boqMode: z.enum(['none', 'existing', 'create']).default('none'),
    boqId: z.string().uuid().optional().nullable(),
  })
  .refine((d) => d.boqMode !== 'existing' || !!d.boqId, {
    message: 'Pick the BOQ to use for this project.',
    path: ['boqId'],
  });
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

/** Invitee profile setup on the invite-acceptance screen (snag spec §1.3).
 *  Phone is required — WhatsApp is the reliable channel for site teams. Company
 *  and trade are optional (invitations don't carry a party type yet). */
export const profileSetupSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,30}$/, 'Username must be 3–30 characters: a–z, 0–9, dots, dashes, underscores.'),
  fullName: z.string().trim().min(2, 'Enter your full name.').max(120),
  phone: z
    .string()
    .trim()
    .min(7, 'Enter a phone number (WhatsApp preferred).')
    .max(40)
    .regex(/^\+?[0-9()\-\s]{7,}$/, 'Enter a valid phone number.'),
  companyName: z.string().trim().max(160).optional().or(z.literal('')),
  trade: z.string().trim().max(80).optional().or(z.literal('')),
  avatarUrl: z.string().trim().max(600).optional().or(z.literal('')),
  avatarThumbUrl: z.string().trim().max(600).optional().or(z.literal('')),
});
export type ProfileSetupInput = z.infer<typeof profileSetupSchema>;

/** Inline "New client" sub-form (name required; email/phone optional). */
export const createClientSchema = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().email().optional().or(z.literal('')),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
});
export type CreateClientInput = z.infer<typeof createClientSchema>;

/** New BOQ header — the "Start a new BOQ" form. Only the name is required; a bill
 *  can be an unnamed-client template. Sections and items are added in the builder. */
export const createBoqSchema = z.object({
  name: z.string().trim().min(2).max(200),
  boqType: z.enum(BOQ_TYPES),

  clientName: z.string().trim().max(200).optional().or(z.literal('')),
  industry: z.enum(BOQ_INDUSTRIES).optional(),
  reference: z.string().trim().max(80).optional().or(z.literal('')),
  location: z.string().trim().max(160).optional().or(z.literal('')),
  boqDate: z.string().date().optional().or(z.literal('')),
  currency: z.enum(CURRENCIES).default('USD'),
});
export type CreateBoqInput = z.infer<typeof createBoqSchema>;

export const createRequestSchema = z.object({
  projectId: z.string().uuid(),
  type: z.enum(REQUEST_TYPES),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(5000).optional(),
  amountCents: z.number().int().nonnegative().optional(),
});
export type CreateRequestInput = z.infer<typeof createRequestSchema>;

export const createSiteReportSchema = z.object({
  projectId: z.string().uuid(),
  reportDate: z.string().date(),
  progressPct: z.number().int().min(0).max(100).default(0),
  narrative: z.string().trim().max(5000).optional(),
  weather: z.enum(WEATHER_OPTIONS).optional(),
  gpsLat: z.number().min(-90).max(90).optional(),
  gpsLng: z.number().min(-180).max(180).optional(),
  status: z.enum(REPORT_STATUSES).default('draft'),
});
export type CreateSiteReportInput = z.infer<typeof createSiteReportSchema>;

export const createInvoiceSchema = z.object({
  projectId: z.string().uuid(),
  dueDate: z.string().date(),
  paymentTerms: z.string().trim().max(120).optional(),
  lines: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(300),
        quantity: z.number().positive(),
        unitPriceCents: z.number().int().nonnegative(),
        budgetLineId: z.string().uuid().optional(),
      }),
    )
    .min(1),
});
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

export const createTaskSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(5000).optional(),
  priority: z.enum(TASK_PRIORITIES).default('medium'),
  assigneeId: z.string().uuid().optional(),
  milestoneId: z.string().uuid().optional(),
  plannedStartDate: z.string().date().optional(),
  plannedEndDate: z.string().date().optional(),
  dueDate: z.string().date().optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

/** Completion sign-off — decision C: notes + at least one photo + declaration. */
export const submitTaskSchema = z.object({
  completionNotes: z.string().trim().min(10, 'Describe what was completed'),
  photos: z.array(z.string()).min(1, 'At least one photo is required'),
  declaration: z.literal(true, { errorMap: () => ({ message: 'You must confirm the declaration' }) }),
});
export type SubmitTaskInput = z.infer<typeof submitTaskSchema>;

export const createBudgetLineSchema = z.object({
  projectId: z.string().uuid(),
  description: z.string().trim().min(1).max(300),
  code: z.string().trim().max(40).optional(),
  category: z.string().trim().max(80).optional(),
  unit: z.string().trim().max(40).optional(),
  quantity: z.number().positive().default(1),
  rateCents: z.number().int().nonnegative().default(0),
});
export type CreateBudgetLineInput = z.infer<typeof createBudgetLineSchema>;

export const createVariationSchema = z.object({
  projectId: z.string().uuid(),
  description: z.string().trim().min(1).max(2000),
  reference: z.string().trim().max(60).optional(),
  costImpactCents: z.number().int().default(0), // may be negative
  timeImpactDays: z.number().int().default(0),
});
export type CreateVariationInput = z.infer<typeof createVariationSchema>;

export const recordPaymentSchema = z.object({
  invoiceId: z.string().uuid(),
  amountCents: z.number().int().positive(),
  method: z.enum(PAYMENT_METHODS).default('paynow'),
  reference: z.string().trim().max(120).optional(),
});
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

/** Put a BOQ out to sealed tender. */
export const createTenderSchema = z.object({
  boqId: z.string().uuid(),
  title: z.string().trim().min(2).max(160),
  closeAt: z.string().datetime().optional().nullable(),
});
export type CreateTenderInput = z.infer<typeof createTenderSchema>;

/** Invite a bidding company — existing member (userId set) or new by email. */
export const inviteBidderSchema = z.object({
  tenderId: z.string().uuid(),
  companyName: z.string().trim().min(2).max(160),
  email: z.string().trim().email(),
  userId: z.string().uuid().optional().nullable(),
});
export type InviteBidderInput = z.infer<typeof inviteBidderSchema>;

/** A bidder saving one line's rate. */
export const saveBidRateSchema = z.object({
  token: z.string().min(10),
  boqItemId: z.string().uuid(),
  rateCents: z.number().int().min(0),
  noBid: z.boolean().optional(),
  note: z.string().trim().max(500).optional().nullable(),
  /** Proposed working days for this line — sealed with the rate. */
  durationDays: z.number().int().min(0).max(3650).optional().nullable(),
});
export type SaveBidRateInput = z.infer<typeof saveBidRateSchema>;

/** Bulk save from the Excel round-trip — the RPC re-validates every line. */
export const saveBidLinesSchema = z.object({
  token: z.string().min(10),
  lines: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        rateCents: z.number().int().min(0),
        durationDays: z.number().int().min(0).max(3650).optional().nullable(),
      }),
    )
    .min(1)
    .max(2000),
});
export type SaveBidLinesInput = z.infer<typeof saveBidLinesSchema>;
