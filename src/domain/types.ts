/**
 * Shared domain types. These mirror the Prisma enums but are defined here so the
 * domain, the in-memory store and the UI never depend on generated database code.
 */

export const INTEGRATION_PROVIDERS = ["META_ADS", "SHOPIFY", "HIGGSFIELD"] as const;
export type IntegrationProviderId = (typeof INTEGRATION_PROVIDERS)[number];

export const MEMBER_ROLES = ["OWNER", "ADMIN", "APPROVER", "EDITOR", "VIEWER"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const APPROVAL_TYPES = ["BUDGET_CHANGE", "CREATIVE_PUBLISH"] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];

export const APPROVAL_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
  "EXPIRED",
  "EXECUTING",
  "EXECUTED",
  "FAILED",
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const REQUEST_SOURCES = ["USER", "AUTOMATION", "AI_AGENT"] as const;
export type RequestSource = (typeof REQUEST_SOURCES)[number];

export const EXECUTION_MODES = ["SIMULATED", "LIVE"] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

export const CREATIVE_STATUSES = [
  "DRAFT",
  "GENERATING",
  "READY",
  "PENDING_APPROVAL",
  "APPROVED",
  "PUBLISHED",
  "FAILED",
] as const;
export type CreativeStatus = (typeof CREATIVE_STATUSES)[number];

export const CREATIVE_FORMATS = ["IMAGE", "VIDEO"] as const;
export type CreativeFormat = (typeof CREATIVE_FORMATS)[number];

export const ASPECT_RATIOS = ["1:1", "4:5", "9:16", "16:9"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export type AutomationTriggerSnapshot = {
  kind: AutomationKind;
  roas: number;
  spendMinor: number;
  lookbackDays: number;
  threshold: number;
};

export type BudgetChangePayload = {
  campaignId: string;
  campaignName: string;
  currency: string;
  currentDailyBudgetMinor: number;
  proposedDailyBudgetMinor: number;
  /** Signed percentage, e.g. 20 for +20 %, -30 for −30 %. */
  changePercent: number;
  /** Present when an automation proposed the change. */
  trigger?: AutomationTriggerSnapshot;
};

export type CreativePublishPayload = {
  creativeId: string;
  creativeTitle: string;
  format: CreativeFormat;
  aspectRatio: AspectRatio;
  campaignId: string;
  campaignName: string;
  headline: string;
  primaryText: string;
  callToAction: string;
};

export type ExecutionResult = {
  ok: boolean;
  /** Always true in phase 1 — nothing is sent to an external platform. */
  simulated: boolean;
  operation: string;
  message: string;
  at: string;
  /** True when LIVE_EXECUTION_ENABLED was set but no live adapter exists. */
  liveRequestedButUnavailable?: boolean;
  details?: Record<string, string | number | boolean | null>;
};

type ApprovalBase = {
  id: string;
  workspaceId: string;
  status: ApprovalStatus;
  title: string;
  rationale: string | null;
  riskLevel: RiskLevel;
  source: RequestSource;
  sourceRef: string | null;
  provider: IntegrationProviderId;
  targetExternalId: string;
  targetName: string;
  creativeId: string | null;
  requestedById: string | null;
  requestedByLabel: string;
  reviewedById: string | null;
  reviewNote: string | null;
  reviewedAt: Date | null;
  executionMode: ExecutionMode | null;
  executedAt: Date | null;
  executionResult: ExecutionResult | null;
  expiresAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export type BudgetChangeApproval = ApprovalBase & {
  type: "BUDGET_CHANGE";
  payload: BudgetChangePayload;
};

export type CreativePublishApproval = ApprovalBase & {
  type: "CREATIVE_PUBLISH";
  payload: CreativePublishPayload;
};

export type ApprovalRequest = BudgetChangeApproval | CreativePublishApproval;

export type Creative = {
  id: string;
  workspaceId: string;
  title: string;
  prompt: string;
  format: CreativeFormat;
  aspectRatio: AspectRatio;
  status: CreativeStatus;
  providerJobId: string | null;
  assetUrl: string | null;
  thumbnailUrl: string | null;
  headline: string | null;
  primaryText: string | null;
  callToAction: string | null;
  metadata: Record<string, string | number | boolean | null> | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export const AUTOMATION_KINDS = ["scale_winners", "cut_losers"] as const;
export type AutomationKind = (typeof AUTOMATION_KINDS)[number];

export type ScaleWinnersConfig = {
  minRoas: number;
  minSpendMinor: number;
  increasePercent: number;
  lookbackDays: number;
};

export type CutLosersConfig = {
  maxRoas: number;
  minSpendMinor: number;
  decreasePercent: number;
  lookbackDays: number;
};

type AutomationBase = {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  enabled: boolean;
  /** Always true: automations can only propose, never execute. */
  requiresApproval: true;
  lastEvaluatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type Automation =
  | (AutomationBase & { kind: "scale_winners"; config: ScaleWinnersConfig })
  | (AutomationBase & { kind: "cut_losers"; config: CutLosersConfig });

export type AuditLogEntry = {
  id: string;
  workspaceId: string;
  actorId: string | null;
  actorLabel: string;
  action: AuditAction;
  entityType: "approval" | "creative" | "automation" | "integration";
  entityId: string;
  metadata: Record<string, string | number | boolean | null> | null;
  createdAt: Date;
};

export const CONNECTION_STATUSES = ["NOT_CONFIGURED", "MOCK", "CONNECTED", "ERROR", "REVOKED"] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

/**
 * A connected external account. `encryptedCredentials` is AES-256-GCM ciphertext
 * and must only ever be decrypted server-side; never pass this type to the UI
 * (use a view model without the ciphertext instead).
 */
export type IntegrationConnection = {
  id: string;
  workspaceId: string;
  provider: IntegrationProviderId;
  status: ConnectionStatus;
  externalAccountId: string | null;
  displayName: string | null;
  scopes: string[];
  encryptedCredentials: string | null;
  credentialsKeyVersion: number | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  connectedAt: Date | null;
  lastSyncedAt: Date | null;
  lastError: string | null;
  /** Server instance currently refreshing the token, and until when its claim holds. */
  refreshLeaseId: string | null;
  refreshLeaseUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export const AUDIT_ACTIONS = [
  "approval.created",
  "approval.approved",
  "approval.rejected",
  "approval.cancelled",
  "approval.expired",
  "approval.executed",
  "approval.failed",
  "creative.generated",
  "automation.enabled",
  "automation.disabled",
  "automation.evaluated",
  "integration.connected",
  "integration.disconnected",
  "integration.verified",
  "integration.error",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type Actor = {
  userId: string;
  workspaceId: string;
  name: string;
  role: MemberRole;
};
