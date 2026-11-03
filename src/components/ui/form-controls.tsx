"use client";

import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import type { ActionResult } from "@/server/actions/result";

import { buttonClass, type ButtonSize, type ButtonVariant } from "./button";

/** Submit button that disables itself while its form's action is pending. */
export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  size = "md",
  className,
  name,
  value,
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  const { dict } = useI18n();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      aria-busy={pending}
      className={buttonClass(variant, size, className)}
    >
      {pending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
      {pending ? (pendingLabel ?? dict.common.sending) : children}
    </button>
  );
}

/** Announces a server-action result (success or translated error) to all users. */
export function ActionFeedback({ result, className }: { result: ActionResult; className?: string }) {
  const { dict, t } = useI18n();
  if (result.status === "idle") return null;

  const isSuccess = result.status === "success";
  const message = isSuccess
    ? t(dict.success[result.code], result.params)
    : t(dict.errors[result.code], result.params);

  return (
    <p
      role={isSuccess ? "status" : "alert"}
      className={cn(
        "flex items-start gap-1.5 text-[13px]",
        isSuccess ? "text-good-ink" : "text-critical-ink",
        className,
      )}
    >
      {isSuccess ? (
        <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0" />
      ) : (
        <XCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
      )}
      <span>{message}</span>
    </p>
  );
}

/**
 * Whether the action flagged `field` as invalid. Validation messages from zod are
 * English-only, so fields are highlighted (aria-invalid) and the localized
 * form-level message from <ActionFeedback> explains what to do.
 */
export function hasFieldError(result: ActionResult, field: string): boolean {
  return result.status === "error" && Boolean(result.fieldErrors?.[field]?.length);
}
