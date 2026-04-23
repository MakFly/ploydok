// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";

export const OrganizationSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  is_default: z.boolean(),
  created_at: z.string().datetime(),
});
export type OrganizationSummary = z.infer<typeof OrganizationSummarySchema>;

export const OrganizationResponseSchema = z.object({
  organization: OrganizationSummarySchema,
});
export type OrganizationResponse = z.infer<typeof OrganizationResponseSchema>;

export const OrganizationsResponseSchema = z.object({
  organizations: z.array(OrganizationSummarySchema),
});
export type OrganizationsResponse = z.infer<typeof OrganizationsResponseSchema>;

export const CreateOrganizationBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
});
export type CreateOrganizationBody = z.infer<typeof CreateOrganizationBodySchema>;
