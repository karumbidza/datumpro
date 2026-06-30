/** Zod schemas — shared by the web API routes and the mobile client so request
 *  shapes are validated identically on both ends. */

import { z } from 'zod';
import { ORG_ROLES } from '../access/roles';
import { PROJECT_TYPES } from '../domain/projects';
import { REQUEST_TYPES } from '../domain/requests';
import { REPORT_STATUSES, WEATHER_OPTIONS } from '../domain/monitoring';

export const createOrgSchema = z.object({
  name: z.string().trim().min(2).max(120),
});
export type CreateOrgInput = z.infer<typeof createOrgSchema>;

export const inviteMemberSchema = z.object({
  email: z.string().trim().email(),
  role: z.enum(ORG_ROLES),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const createProjectSchema = z.object({
  name: z.string().trim().min(2).max(160),
  code: z.string().trim().max(40).optional(),
  type: z.enum(PROJECT_TYPES).default('construction'),
  clientName: z.string().trim().max(160).optional(),
  contractValueCents: z.number().int().nonnegative().default(0),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

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
