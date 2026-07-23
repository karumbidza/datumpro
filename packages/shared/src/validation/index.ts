/** Zod schemas — shared by the web API routes and the mobile client so request
 *  shapes are validated identically on both ends. */

import { z } from 'zod';
import { ORG_ROLES } from '../access/roles';
import { PROJECT_TYPES, CONSTRUCTION_TYPES, CURRENCIES, DURATION_UNITS } from '../domain/projects';
import { REQUEST_TYPES } from '../domain/requests';
import { REPORT_STATUSES, WEATHER_OPTIONS } from '../domain/monitoring';
import { PAYMENT_METHODS } from '../domain/finance';
import { TASK_PRIORITIES } from '../domain/tasks';

export const createOrgSchema = z.object({
  name: z.string().trim().min(2).max(120),
});
export type CreateOrgInput = z.infer<typeof createOrgSchema>;

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

export const createProjectSchema = z.object({
  name: z.string().trim().min(2).max(160),
  // `code` is auto-generated server-side (collision-safe) — never trusted from the client.
  type: z.enum(PROJECT_TYPES).default('construction'),
  constructionType: z.enum(CONSTRUCTION_TYPES),
  clientId: z.string().uuid(),
  managerId: z.string().uuid(),
  startDate: z.string().date(),
  durationValue: z.number().int().positive().max(3650),
  durationUnit: z.enum(DURATION_UNITS).default('weeks'),
  calendarId: z.string().uuid(),
  currency: z.enum(CURRENCIES),
  contractValueCents: z.number().int().nonnegative().default(0),
  templateId: z.string().uuid().optional().nullable(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

/** Inline "New client" sub-form (name required; email/phone optional). */
export const createClientSchema = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().email().optional().or(z.literal('')),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
});
export type CreateClientInput = z.infer<typeof createClientSchema>;

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
