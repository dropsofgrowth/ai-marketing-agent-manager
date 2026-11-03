import { DomainError } from "@/domain/errors";
import type { ApprovalStatus } from "@/domain/types";

/**
 * Approval lifecycle.
 *
 *   PENDING ──approve──▶ APPROVED ──claim──▶ EXECUTING ──▶ EXECUTED | FAILED
 *      │                    │
 *      ├─reject─▶ REJECTED  └─cancel─▶ CANCELLED
 *      ├─cancel─▶ CANCELLED
 *      └─(ttl)──▶ EXPIRED
 *
 * There is deliberately no edge from PENDING to EXECUTED: nothing runs without an
 * explicit human approval, and approval itself never executes anything. Execution
 * first claims the request (APPROVED → EXECUTING, version-checked) so two
 * concurrent clicks can never run the same change twice.
 */
const TRANSITIONS: Record<ApprovalStatus, readonly ApprovalStatus[]> = {
  PENDING: ["APPROVED", "REJECTED", "CANCELLED", "EXPIRED"],
  APPROVED: ["EXECUTING", "CANCELLED"],
  EXECUTING: ["EXECUTED", "FAILED"],
  REJECTED: [],
  CANCELLED: [],
  EXPIRED: [],
  EXECUTED: [],
  FAILED: [],
};

/** Statuses that block a second request for the same target. */
export const OPEN_APPROVAL_STATUSES: readonly ApprovalStatus[] = ["PENDING", "APPROVED", "EXECUTING"];

export function canTransition(from: ApprovalStatus, to: ApprovalStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: ApprovalStatus, to: ApprovalStatus): void {
  if (!canTransition(from, to)) {
    throw new DomainError("INVALID_TRANSITION", { from, to });
  }
}

export function isTerminal(status: ApprovalStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export function isExpired(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && expiresAt.getTime() <= now.getTime();
}
