import "server-only";

import { refresh } from "next/cache";
import { z } from "zod";

import { isDomainError } from "@/domain/errors";
import type { Actor } from "@/domain/types";
import { getCurrentActor } from "@/server/auth/actor";

import type { ActionResult, SuccessCode } from "./result";

export function formDataToObject(formData: FormData): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$ACTION")) result[key] = value;
  }
  return result;
}

/**
 * Shared server-action wrapper:
 * - resolves the actor (authorization is enforced again inside each service);
 * - maps expected DomainErrors / validation errors to translatable codes;
 * - logs unexpected errors server-side and returns a generic code (no stack traces
 *   or internal messages reach the browser);
 * - refreshes the router so server components re-read fresh data.
 */
export async function runAction(
  fn: (actor: Actor) => Promise<{ code: SuccessCode; params?: Record<string, string | number> }>,
): Promise<ActionResult> {
  try {
    const actor = await getCurrentActor();
    const { code, params } = await fn(actor);
    refresh();
    return { status: "success", code, params };
  } catch (error) {
    if (isDomainError(error)) {
      if (error.code === "EXPIRED" || error.code === "CONFLICT") refresh();
      return { status: "error", code: error.code, params: error.params };
    }
    if (error instanceof z.ZodError) {
      return {
        status: "error",
        code: "INVALID_INPUT",
        fieldErrors: z.flattenError(error).fieldErrors as Record<string, string[]>,
      };
    }
    console.error("[server-action] unexpected error", error);
    return { status: "error", code: "UNEXPECTED" };
  }
}
