"use client";

import { Play } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { ActionFeedback, SubmitButton } from "@/components/ui/form-controls";
import { useActionWithToast } from "@/components/ui/toast";
import type { ApprovalStatus } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { approveAction, cancelAction, executeAction, rejectAction } from "@/server/actions/approvals";

/**
 * Review controls for one request. Approve / Reject / Withdraw only record a
 * decision; "Run simulation" is a separate explicit step for APPROVED requests.
 */
export function ApprovalActions({ approvalId, status }: { approvalId: string; status: ApprovalStatus }) {
  const { dict } = useI18n();
  const [rejecting, setRejecting] = useState(false);
  const [approveState, approve] = useActionWithToast(approveAction);
  const [rejectState, reject] = useActionWithToast(rejectAction);
  const [cancelState, cancel] = useActionWithToast(cancelAction);
  const [executeState, execute] = useActionWithToast(executeAction);

  if (status !== "PENDING" && status !== "APPROVED") return null;
  const lastError = [approveState, rejectState, cancelState, executeState].find((s) => s.status === "error");

  return (
    <div className="space-y-3">
      {status === "PENDING" && rejecting ? (
        <form action={reject} className="space-y-2">
          <input type="hidden" name="approvalId" value={approvalId} />
          <label htmlFor={`reject-${approvalId}`} className="sr-only">
            {dict.approvals.rejectPlaceholder}
          </label>
          <textarea
            id={`reject-${approvalId}`}
            name="note"
            required
            minLength={3}
            maxLength={1000}
            rows={2}
            autoFocus
            placeholder={dict.approvals.rejectPlaceholder}
            aria-invalid={rejectState.status === "error" ? true : undefined}
            className={inputClass}
          />
          <div className="flex flex-wrap gap-2">
            <SubmitButton variant="danger" size="sm">
              {dict.approvals.confirmReject}
            </SubmitButton>
            <Button variant="ghost" size="sm" onClick={() => setRejecting(false)}>
              {dict.common.cancel}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {status === "PENDING" ? (
            <>
              <form action={approve}>
                <input type="hidden" name="approvalId" value={approvalId} />
                <SubmitButton size="sm">{dict.approvals.approve}</SubmitButton>
              </form>
              <Button variant="danger" size="sm" onClick={() => setRejecting(true)}>
                {dict.approvals.reject}
              </Button>
            </>
          ) : (
            <form action={execute}>
              <input type="hidden" name="approvalId" value={approvalId} />
              <SubmitButton size="sm">
                <Play aria-hidden className="size-3.5" />
                {dict.approvals.execute}
              </SubmitButton>
            </form>
          )}
          <form action={cancel}>
            <input type="hidden" name="approvalId" value={approvalId} />
            <SubmitButton variant="ghost" size="sm">
              {dict.approvals.cancel}
            </SubmitButton>
          </form>
        </div>
      )}
      {lastError ? <ActionFeedback result={lastError} /> : null}
    </div>
  );
}
