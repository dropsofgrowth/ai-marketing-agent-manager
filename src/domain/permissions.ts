import { DomainError } from "@/domain/errors";
import type { Actor, MemberRole } from "@/domain/types";

export type Permission =
  | "approval.request"
  | "approval.review"
  | "approval.execute"
  | "approval.cancel"
  | "creative.generate"
  | "automation.manage"
  /** Connect, verify or disconnect external accounts (stores encrypted credentials). */
  | "integration.manage";

const ROLE_PERMISSIONS: Record<MemberRole, readonly Permission[]> = {
  OWNER: [
    "approval.request",
    "approval.review",
    "approval.execute",
    "approval.cancel",
    "creative.generate",
    "automation.manage",
    "integration.manage",
  ],
  ADMIN: [
    "approval.request",
    "approval.review",
    "approval.execute",
    "approval.cancel",
    "creative.generate",
    "automation.manage",
    "integration.manage",
  ],
  APPROVER: ["approval.review", "approval.execute", "approval.cancel"],
  EDITOR: ["approval.request", "approval.cancel", "creative.generate"],
  VIEWER: [],
};

export function hasPermission(role: MemberRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function assertPermission(actor: Actor, permission: Permission): void {
  if (!hasPermission(actor.role, permission)) {
    throw new DomainError("FORBIDDEN", { permission });
  }
}
