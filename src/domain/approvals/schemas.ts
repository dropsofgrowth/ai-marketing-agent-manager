import { z } from "zod";

import {
  ASPECT_RATIOS,
  AUTOMATION_KINDS,
  CREATIVE_FORMATS,
  type BudgetChangePayload,
  type CreativePublishPayload,
  type ExecutionResult,
} from "@/domain/types";

const minorAmount = z.number().int().nonnegative();

export const automationTriggerSchema = z.object({
  kind: z.enum(AUTOMATION_KINDS),
  roas: z.number(),
  spendMinor: minorAmount,
  lookbackDays: z.number().int().positive(),
  threshold: z.number(),
});

export const budgetChangePayloadSchema = z.object({
  campaignId: z.string().min(1),
  campaignName: z.string().min(1),
  currency: z.string().length(3),
  currentDailyBudgetMinor: minorAmount,
  proposedDailyBudgetMinor: minorAmount,
  changePercent: z.number(),
  trigger: automationTriggerSchema.optional(),
}) satisfies z.ZodType<BudgetChangePayload>;

export const creativePublishPayloadSchema = z.object({
  creativeId: z.string().min(1),
  creativeTitle: z.string().min(1),
  format: z.enum(CREATIVE_FORMATS),
  aspectRatio: z.enum(ASPECT_RATIOS),
  campaignId: z.string().min(1),
  campaignName: z.string().min(1),
  headline: z.string(),
  primaryText: z.string(),
  callToAction: z.string(),
}) satisfies z.ZodType<CreativePublishPayload>;

export const executionResultSchema = z.object({
  ok: z.boolean(),
  simulated: z.boolean(),
  operation: z.string(),
  message: z.string(),
  at: z.string(),
  liveRequestedButUnavailable: z.boolean().optional(),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
}) satisfies z.ZodType<ExecutionResult>;

// --- User input (server actions) --------------------------------------------

const trimmedOptionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const budgetChangeInputSchema = z.object({
  campaignId: z.string().trim().min(1).max(64),
  /** Proposed daily budget in MAJOR units as typed by the user (e.g. "275.50"). */
  proposedDailyBudget: z.coerce.number().positive().max(100_000_000),
  rationale: trimmedOptionalText(1000),
});

export const creativePublishInputSchema = z.object({
  creativeId: z.string().trim().min(1).max(64),
  campaignId: z.string().trim().min(1).max(64),
  rationale: trimmedOptionalText(1000),
});

export const reviewInputSchema = z.object({
  approvalId: z.string().trim().min(1).max(64),
  note: trimmedOptionalText(1000),
});

export const rejectInputSchema = z.object({
  approvalId: z.string().trim().min(1).max(64),
  note: z.string().trim().min(3).max(1000),
});

export const approvalIdInputSchema = z.object({
  approvalId: z.string().trim().min(1).max(64),
});

export const generateCreativeInputSchema = z.object({
  title: z.string().trim().min(2).max(120),
  prompt: z.string().trim().min(10).max(2000),
  format: z.enum(CREATIVE_FORMATS),
  aspectRatio: z.enum(ASPECT_RATIOS),
  headline: trimmedOptionalText(120),
  primaryText: trimmedOptionalText(500),
  callToAction: trimmedOptionalText(40),
});

export const toggleAutomationInputSchema = z.object({
  automationId: z.string().trim().min(1).max(64),
  enabled: z.enum(["true", "false"]).transform((v) => v === "true"),
});
