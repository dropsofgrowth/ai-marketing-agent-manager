import { ArrowRight, Info } from "lucide-react";

import { CreativePreview } from "@/components/creatives/creative-preview";
import { Card } from "@/components/ui/card";
import { isExpired } from "@/domain/approvals/state-machine";
import type { ApprovalRequest } from "@/domain/types";
import type { ServerI18n } from "@/i18n/server";

import { ApprovalActions } from "./approval-actions";
import { RiskBadge, StatusBadge, approvalHeadline, approvalRationale, approvalSource } from "./labels";

function BudgetDiff({ request, i18n }: { request: Extract<ApprovalRequest, { type: "BUDGET_CHANGE" }>; i18n: ServerI18n }) {
  const { payload } = request;
  const { fmt, dict } = i18n;
  return (
    <dl className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-lg bg-surface-2 px-3 py-3 sm:px-4">
      <div>
        <dt className="text-xs text-ink-2">{dict.approvals.fields.current}</dt>
        <dd className="tabular text-lg font-semibold text-ink-2">
          {fmt.currency(payload.currentDailyBudgetMinor, payload.currency)}
          <span className="ms-1 text-xs font-normal">{dict.common.perDay}</span>
        </dd>
      </div>
      <ArrowRight aria-hidden className="size-4 text-ink-3 rtl:rotate-180" />
      <div>
        <dt className="text-xs text-ink-2">{dict.approvals.fields.proposed}</dt>
        <dd className="tabular text-lg font-semibold text-ink">
          {fmt.currency(payload.proposedDailyBudgetMinor, payload.currency)}
          <span className="ms-1 text-xs font-normal text-ink-2">{dict.common.perDay}</span>
        </dd>
      </div>
      <div className="col-span-3 text-xs text-ink-2">
        {dict.approvals.fields.change}:{" "}
        <bdi className="tabular font-semibold text-ink">
          {fmt.percent(payload.changePercent / 100, { signed: true })}
        </bdi>
        {" · "}
        {dict.approvals.fields.campaign}: <span className="text-ink">{payload.campaignName}</span>
      </div>
    </dl>
  );
}

function CreativeSummary({
  request,
  i18n,
}: {
  request: Extract<ApprovalRequest, { type: "CREATIVE_PUBLISH" }>;
  i18n: ServerI18n;
}) {
  const { payload } = request;
  const { dict } = i18n;
  return (
    <div className="flex gap-4 rounded-lg bg-surface-2 p-3">
      <CreativePreview
        seedKey={payload.creativeId}
        format={payload.format}
        aspectRatio={payload.aspectRatio}
        label={dict.common.mock}
        compact
        className="w-20 shrink-0 self-start"
      />
      <dl className="min-w-0 space-y-1.5 text-sm">
        <div>
          <dt className="text-xs text-ink-2">{dict.approvals.fields.campaign}</dt>
          <dd className="text-ink">{payload.campaignName}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-2">{dict.approvals.fields.headline}</dt>
          <dd className="text-ink">{payload.headline || dict.common.none}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-2">{dict.creatives.fields.format}</dt>
          <dd className="text-ink">
            {dict.creatives.format[payload.format]} · {payload.aspectRatio}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function ApprovalCard({ request, i18n, now }: { request: ApprovalRequest; i18n: ServerI18n; now: Date }) {
  const { dict, fmt, t } = i18n;
  const rationale = approvalRationale(request, i18n);
  const expired = request.status === "PENDING" && isExpired(request.expiresAt, now);
  const result = request.executionResult;

  return (
    <Card as="article" className="flex flex-col gap-4 p-4 sm:p-5" aria-labelledby={`apr-${request.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={expired ? "EXPIRED" : request.status} i18n={i18n} />
        <RiskBadge risk={request.riskLevel} i18n={i18n} />
        <span className="ms-auto text-xs text-ink-2">
          {t(dict.approvals.fields.created, { time: fmt.relative(request.createdAt, now) })}
        </span>
      </div>

      <div>
        <h3 id={`apr-${request.id}`} className="text-[15px] font-semibold text-ink">
          {approvalHeadline(request, i18n)}
        </h3>
        <p className="mt-0.5 text-xs text-ink-2">{approvalSource(request, i18n)}</p>
      </div>

      {request.type === "BUDGET_CHANGE" ? (
        <BudgetDiff request={request} i18n={i18n} />
      ) : (
        <CreativeSummary request={request} i18n={i18n} />
      )}

      {rationale ? (
        <div className="text-sm">
          <p className="text-xs text-ink-2">{dict.approvals.fields.rationale}</p>
          <p dir="auto" className="mt-0.5 text-start text-ink">
            {rationale}
          </p>
        </div>
      ) : null}

      {request.reviewNote ? (
        <div className="text-sm">
          <p className="text-xs text-ink-2">
            {dict.approvals.fields.reviewNote}
            {request.reviewedAt ? ` · ${t(dict.approvals.fields.reviewedBy, { time: fmt.relative(request.reviewedAt, now) })}` : ""}
          </p>
          <p dir="auto" className="mt-0.5 text-start text-ink">
            {request.reviewNote}
          </p>
        </div>
      ) : null}

      {result ? (
        <div className="flex items-start gap-2 rounded-lg border border-line px-3 py-2 text-xs text-ink-2">
          <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <div>
            <p className="font-medium text-ink">
              {result.simulated ? dict.approvals.simulatedResult : result.message}
              {request.executedAt ? ` · ${t(dict.approvals.fields.executed, { time: fmt.relative(request.executedAt, now) })}` : ""}
            </p>
            {result.liveRequestedButUnavailable ? <p className="mt-0.5">{dict.approvals.liveUnavailable}</p> : null}
            {!result.ok ? <p className="mt-0.5 text-critical-ink">{result.message}</p> : null}
          </div>
        </div>
      ) : null}

      {request.status === "PENDING" && request.expiresAt && !expired ? (
        <p className="text-xs text-ink-2">{t(dict.approvals.fields.expires, { time: fmt.relative(request.expiresAt, now) })}</p>
      ) : null}

      {!expired ? (
        <div className="mt-auto border-t border-line pt-4">
          <ApprovalActions approvalId={request.id} status={request.status} />
        </div>
      ) : null}
    </Card>
  );
}
