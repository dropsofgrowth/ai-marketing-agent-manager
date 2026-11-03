"use client";

import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, inputClass } from "@/components/ui/field";
import { ActionFeedback, SubmitButton, hasFieldError } from "@/components/ui/form-controls";
import { Notice } from "@/components/ui/notice";
import { useActionWithToast } from "@/components/ui/toast";
import { currencyDigits, fromMinorUnits, percentChange, toMinorUnits } from "@/domain/money";
import { useI18n } from "@/i18n/client";
import { requestBudgetChangeAction } from "@/server/actions/approvals";

export type BudgetGuardrailsView = {
  maxIncreasePercent: number;
  maxDecreasePercent: number;
  maxDailyBudgetMinor: number;
};

/** Opens a form that files a BUDGET_CHANGE approval request. It never edits the budget. */
export function BudgetChangeDialog({
  campaign,
  guardrails,
  block = false,
}: {
  campaign: { id: string; name: string; currency: string; dailyBudgetMinor: number };
  guardrails: BudgetGuardrailsView;
  /** Full-width trigger (phone record lists). */
  block?: boolean;
}) {
  const { dict, fmt, t } = useI18n();
  const [open, setOpen] = useState(false);
  const currentMajor = fromMinorUnits(campaign.dailyBudgetMinor, campaign.currency);
  const [proposed, setProposed] = useState(String(currentMajor));
  const close = useCallback(() => setOpen(false), []);
  const [state, formAction] = useActionWithToast(requestBudgetChangeAction, { onSuccess: close });

  const proposedMinor = toMinorUnits(Number(proposed) || 0, campaign.currency);
  const change = percentChange(campaign.dailyBudgetMinor, proposedMinor);
  const outOfBounds =
    proposedMinor <= 0 ||
    change > guardrails.maxIncreasePercent ||
    -change > guardrails.maxDecreasePercent ||
    proposedMinor > guardrails.maxDailyBudgetMinor;
  const d = dict.metaAds.budgetDialog;
  const inputId = `budget-${campaign.id}`;

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} className={block ? "w-full" : undefined}>
        {dict.metaAds.requestBudgetChange}
      </Button>
      <Dialog open={open} onClose={close} title={d.title}>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="campaignId" value={campaign.id} />
          <dl className="grid grid-cols-2 gap-3 rounded-lg bg-surface-2 px-4 py-3 text-sm">
            <div className="col-span-2">
              <dt className="text-xs text-ink-2">{d.campaign}</dt>
              <dd className="font-medium text-ink">{campaign.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-2">{d.current}</dt>
              <dd className="tabular font-medium text-ink">{fmt.currency(campaign.dailyBudgetMinor, campaign.currency)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-2">{d.change}</dt>
              <dd className={outOfBounds ? "tabular font-medium text-critical-ink" : "tabular font-medium text-ink"}>
                <bdi>{fmt.percent(change / 100, { signed: true })}</bdi>
              </dd>
            </div>
          </dl>

          <Field
            label={t(d.proposed, { currency: campaign.currency })}
            htmlFor={inputId}
            hint={t(d.limits, {
              inc: guardrails.maxIncreasePercent,
              dec: guardrails.maxDecreasePercent,
              cap: fmt.currency(guardrails.maxDailyBudgetMinor, campaign.currency),
            })}
          >
            <input
              id={inputId}
              name="proposedDailyBudget"
              type="number"
              inputMode="decimal"
              min={1}
              step={1 / 10 ** currencyDigits(campaign.currency)}
              required
              value={proposed}
              onChange={(e) => setProposed(e.target.value)}
              aria-invalid={outOfBounds || hasFieldError(state, "proposedDailyBudget") ? true : undefined}
              className={`${inputClass} tabular`}
              dir="ltr"
            />
          </Field>

          <Field label={d.rationale} htmlFor={`${inputId}-why`}>
            <textarea
              id={`${inputId}-why`}
              name="rationale"
              rows={2}
              maxLength={1000}
              placeholder={d.rationalePlaceholder}
              className={inputClass}
            />
          </Field>

          <Notice tone="safety">{d.notice}</Notice>
          <ActionFeedback result={state} />

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end [&>*]:w-full sm:[&>*]:w-auto">
            <Button variant="ghost" onClick={close}>
              {dict.common.cancel}
            </Button>
            <SubmitButton>{d.submit}</SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}
