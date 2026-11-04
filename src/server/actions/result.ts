import type { DomainErrorCode } from "@/domain/errors";

export type SuccessCode =
  | "BUDGET_REQUESTED"
  | "PUBLISH_REQUESTED"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED"
  | "EXECUTED_SIMULATED"
  | "EXECUTION_FAILED"
  | "CREATIVE_GENERATED"
  | "AUTOMATION_TOGGLED"
  | "AUTOMATIONS_EVALUATED"
  | "SHOPIFY_VERIFIED"
  | "SHOPIFY_DISCONNECTED";

export type ErrorCode = DomainErrorCode | "UNEXPECTED";

/** Serializable result returned by every server action (consumed by useActionState). */
export type ActionResult =
  | { status: "idle" }
  | { status: "success"; code: SuccessCode; params?: Record<string, string | number> }
  | {
      status: "error";
      code: ErrorCode;
      params?: Record<string, string | number>;
      fieldErrors?: Record<string, string[]>;
    };

export const IDLE: ActionResult = { status: "idle" };
