import type {
  ApprovalRequest,
  ApprovalStatus,
  ApprovalType,
  AuditLogEntry,
  Automation,
  ConnectionStatus,
  Creative,
  CreativeStatus,
  IntegrationConnection,
  IntegrationProviderId,
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

/** Statuses that make a connection the workspace's current one for its provider. */
export const CURRENT_CONNECTION_STATUSES: readonly ConnectionStatus[] = ["CONNECTED", "ERROR"];

export type SaveConnectionInput = {
  workspaceId: string;
  provider: IntegrationProviderId;
  externalAccountId: string;
  displayName: string | null;
  scopes: string[];
  /** Ciphertext from encryptSecret(); the store rejects anything else. */
  encryptedCredentials: string;
  credentialsKeyVersion: number;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  connectedAt: Date;
  lastSyncedAt: Date;
};

export type ConnectionPatch = Partial<
  Pick<
    IntegrationConnection,
    | "status"
    | "displayName"
    | "scopes"
    | "encryptedCredentials"
    | "credentialsKeyVersion"
    | "accessTokenExpiresAt"
    | "refreshTokenExpiresAt"
    | "lastSyncedAt"
    | "lastError"
  >
>;

export interface ConnectionRepository {
  /** The current (CONNECTED or ERROR) connection for a provider, if any. */
  getCurrent(workspaceId: string, provider: IntegrationProviderId): Promise<IntegrationConnection | null>;
  /**
   * Atomically stores a freshly authorized connection as CONNECTED. Any other
   * current connection for the same provider is revoked and its credentials wiped.
   */
  saveConnected(input: SaveConnectionInput): Promise<IntegrationConnection>;
  update(workspaceId: string, id: string, patch: ConnectionPatch): Promise<IntegrationConnection | null>;
  /**
   * Runs `fn` while holding an exclusive lock on the connection row
   * (`SELECT … FOR UPDATE` in PostgreSQL) so only one server instance refreshes a
   * rotating token at a time. `fn` receives the row as re-read under the lock and
   * a repository bound to the same transaction.
   */
  withLock<T>(
    workspaceId: string,
    id: string,
    fn: (current: IntegrationConnection | null, tx: ConnectionRepository) => Promise<T>,
  ): Promise<T>;
}

/** Defense in depth (mirrors the DB CHECK): only versioned ciphertext may be stored. */
export function assertCiphertext(value: string | null | undefined): void {
  if (value !== null && value !== undefined && !/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Refusing to store credentials that are not encrypted.");
  }
}

export type StoreKind = "postgres" | "memory";

export interface DataStore {
  readonly kind: StoreKind;
  readonly approvals: ApprovalRepository;
  readonly creatives: CreativeRepository;
  readonly automations: AutomationRepository;
  readonly audit: AuditRepository;
  readonly connections: ConnectionRepository;
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
