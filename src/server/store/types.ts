import type {
  ApprovalRequest,
  ApprovalStatus,
  ApprovalType,
  AuditLogEntry,
  Automation,
  Creative,
  CreativeStatus,
} from "@/domain/types";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type NewApprovalRequest = DistributiveOmit<
  ApprovalRequest,
  | "id"
  | "status"
  | "version"
  | "createdAt"
  | "updatedAt"
  | "reviewedById"
  | "reviewNote"
  | "reviewedAt"
  | "executionMode"
  | "executedAt"
  | "executionResult"
>;

export type ApprovalPatch = {
  status: ApprovalStatus;
} & Partial<
  Pick<
    ApprovalRequest,
    "reviewedById" | "reviewNote" | "reviewedAt" | "executionMode" | "executedAt" | "executionResult"
  >
>;

export type NewCreative = Omit<Creative, "id" | "createdAt" | "updatedAt">;
export type NewAuditLogEntry = Omit<AuditLogEntry, "id" | "createdAt">;

export interface ApprovalRepository {
  list(
    workspaceId: string,
    filter?: { statuses?: readonly ApprovalStatus[]; limit?: number },
  ): Promise<ApprovalRequest[]>;
  get(workspaceId: string, id: string): Promise<ApprovalRequest | null>;
  /** The open (PENDING/APPROVED/EXECUTING) request for a target, if any. */
  findOpenForTarget(
    workspaceId: string,
    type: ApprovalType,
    targetExternalId: string,
    creativeId?: string | null,
  ): Promise<ApprovalRequest | null>;
  create(input: NewApprovalRequest): Promise<ApprovalRequest>;
  /**
   * Compare-and-set status transition. Returns null when the row is no longer in
   * `from` at `expectedVersion` (someone else changed it first).
   */
  transition(
    workspaceId: string,
    id: string,
    args: { from: ApprovalStatus; expectedVersion: number; patch: ApprovalPatch },
  ): Promise<ApprovalRequest | null>;
  countByStatus(workspaceId: string): Promise<Record<ApprovalStatus, number>>;
}

export interface CreativeRepository {
  list(workspaceId: string): Promise<Creative[]>;
  get(workspaceId: string, id: string): Promise<Creative | null>;
  create(input: NewCreative): Promise<Creative>;
  setStatus(workspaceId: string, id: string, status: CreativeStatus): Promise<void>;
}

export interface AutomationRepository {
  list(workspaceId: string): Promise<Automation[]>;
  get(workspaceId: string, id: string): Promise<Automation | null>;
  setEnabled(workspaceId: string, id: string, enabled: boolean): Promise<Automation | null>;
  markEvaluated(workspaceId: string, id: string, at: Date): Promise<void>;
}

export interface AuditRepository {
  record(entry: NewAuditLogEntry): Promise<void>;
  list(workspaceId: string, options?: { limit?: number }): Promise<AuditLogEntry[]>;
}

export type StoreKind = "postgres" | "memory";

export interface DataStore {
  readonly kind: StoreKind;
  readonly approvals: ApprovalRepository;
  readonly creatives: CreativeRepository;
  readonly automations: AutomationRepository;
  readonly audit: AuditRepository;
  /** Runs `fn` atomically (a database transaction for Postgres). */
  transaction<T>(fn: (tx: DataStore) => Promise<T>): Promise<T>;
  /** Throws when the backing store is unreachable. */
  ping(): Promise<void>;
}

export function emptyStatusCounts(): Record<ApprovalStatus, number> {
  return {
    PENDING: 0,
    APPROVED: 0,
    REJECTED: 0,
    CANCELLED: 0,
    EXPIRED: 0,
    EXECUTING: 0,
    EXECUTED: 0,
    FAILED: 0,
  };
}
