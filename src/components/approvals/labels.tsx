import {
  AlertTriangle,
  Ban,
  CheckCheck,
  CheckCircle2,
  Clock,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  TimerOff,
  XCircle,
} from "lucide-react";

import type { ReactNode } from "react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { ApprovalRequest, ApprovalStatus, RiskLevel } from "@/domain/types";
import { richT } from "@/i18n/rich";
import type { ServerI18n } from "@/i18n/server";

const STATUS: Record<ApprovalStatus, { tone: BadgeTone; Icon: typeof Clock }> = {
  PENDING: { tone: "warning", Icon: Clock },
  APPROVED: { tone: "accent", Icon: CheckCircle2 },
  EXECUTING: { tone: "accent", Icon: Loader2 },
  EXECUTED: { tone: "good", Icon: CheckCheck },
  REJECTED: { tone: "critical", Icon: XCircle },
  FAILED: { tone: "critical", Icon: AlertTriangle },
  CANCELLED: { tone: "neutral", Icon: Ban },
  EXPIRED: { tone: "neutral", Icon: TimerOff },
};

const RISK: Record<RiskLevel, { tone: BadgeTone; Icon: typeof Clock }> = {
  LOW: { tone: "neutral", Icon: ShieldCheck },
  MEDIUM: { tone: "warning", Icon: ShieldAlert },
  HIGH: { tone: "critical", Icon: AlertTriangle },
};

export function StatusBadge({ status, i18n }: { status: ApprovalStatus; i18n: ServerI18n }) {
  const { tone, Icon } = STATUS[status];
  return (
    <Badge tone={tone} icon={<Icon aria-hidden className="size-3" />}>
      {i18n.dict.approvals.status[status]}
    </Badge>
  );
}

export function RiskBadge({ risk, i18n }: { risk: RiskLevel; i18n: ServerI18n }) {
  const { tone, Icon } = RISK[risk];
  return (
    <Badge tone={tone} icon={<Icon aria-hidden className="size-3" />}>
      {i18n.dict.approvals.risk[risk]}
    </Badge>
  );
}

/** Localized, human-readable title built from the payload (the stored title is English). */
export function approvalHeadline(request: ApprovalRequest, i18n: ServerI18n): ReactNode {
  const target = request.type === "BUDGET_CHANGE" ? request.payload.campaignName : request.payload.creativeTitle;
  return (
    <>
      {i18n.dict.approvals.type[request.type]} · <bdi>{target}</bdi>
    </>
  );
}

export function approvalSource(request: ApprovalRequest, i18n: ServerI18n): ReactNode {
  const { source } = i18n.dict.approvals;
  if (request.source === "USER") return richT(source.USER, { name: request.requestedByLabel });
  if (request.source === "AUTOMATION") {
    const name = request.requestedByLabel.replace(/^Automation:\s*/, "");
    return (
      <>
        {source.AUTOMATION} — <bdi>{name}</bdi>
      </>
    );
  }
  return source.AI_AGENT;
}

/** Display label for an audit/approval actor ("Automation: X" is stored in English). */
export function actorLabel(label: string, i18n: ServerI18n): ReactNode {
  const automation = /^Automation:\s*(.+)$/.exec(label);
  return automation ? richT(i18n.dict.audit.automationActor, { name: automation[1] }) : label;
}

/** Localized rationale: automation proposals are re-rendered from their trigger data. */
export function approvalRationale(request: ApprovalRequest, i18n: ServerI18n): string | null {
  if (request.type === "BUDGET_CHANGE" && request.payload.trigger) {
    const tr = request.payload.trigger;
    return i18n.t(i18n.dict.approvals.trigger[tr.kind], {
      roas: i18n.fmt.roas(tr.roas),
      days: tr.lookbackDays,
      threshold: i18n.fmt.roas(tr.threshold),
    });
  }
  return request.rationale;
}
