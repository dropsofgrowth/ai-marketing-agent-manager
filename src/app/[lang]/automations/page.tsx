import { ShieldCheck, Workflow } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { AutomationToggle, RunAutomationsButton } from "@/components/automations/automation-controls";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import type { Automation } from "@/domain/types";
import { getI18n, type ServerI18n } from "@/i18n/server";
import { getCurrentActor } from "@/server/auth/actor";
import { getStore } from "@/server/store";

export async function generateMetadata({ params }: PageProps<"/[lang]/automations">): Promise<Metadata> {
  return { title: getI18n((await params).lang).dict.automations.title };
}

export default async function AutomationsPage({ params }: PageProps<"/[lang]/automations">) {
  const i18n = getI18n((await params).lang);
  const { dict } = i18n;
  return (
    <>
      <PageHeader title={dict.automations.title} description={dict.automations.subtitle} actions={<RunAutomationsButton />} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Suspense fallback={<Skeleton className="h-64 rounded-xl" />}>
          <AutomationList i18n={i18n} />
        </Suspense>
        <Card className="self-start">
          <CardHeader title={dict.automations.howItWorks} />
          <CardBody>
            <ol className="space-y-3 text-sm text-ink-2">
              {dict.automations.steps.map((step, index) => (
                <li key={step} className="flex gap-3">
                  <span className="tabular grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold text-ink">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function ruleDescription(automation: Automation, i18n: ServerI18n) {
  const { fmt, t, dict } = i18n;
  const c = automation.config;
  const spend = fmt.currency(c.minSpendMinor, "USD");
  return automation.kind === "scale_winners"
    ? t(dict.automations.rules.scale_winners, {
        roas: fmt.roas(automation.config.minRoas),
        days: c.lookbackDays,
        spend,
        pct: automation.config.increasePercent,
      })
    : t(dict.automations.rules.cut_losers, {
        roas: fmt.roas(automation.config.maxRoas),
        days: c.lookbackDays,
        spend,
        pct: automation.config.decreasePercent,
      });
}

async function AutomationList({ i18n }: { i18n: ServerI18n }) {
  await connection();
  const now = new Date();
  const { dict, fmt, t } = i18n;
  const actor = await getCurrentActor();
  const automations = await getStore().automations.list(actor.workspaceId);

  return (
    <ul className="space-y-4">
      {automations.map((automation) => (
        <li key={automation.id}>
          <Card as="article" className="p-4 sm:p-5">
            <div className="flex flex-wrap items-start gap-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-ink">
                <Workflow aria-hidden className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[15px] font-semibold text-ink">{automation.name}</h2>
                  <Badge tone={automation.enabled ? "good" : "neutral"}>
                    {automation.enabled ? dict.automations.enabled : dict.automations.disabled}
                  </Badge>
                  <Badge tone="neutral">{dict.automations.kinds[automation.kind]}</Badge>
                </div>
                <p className="mt-2 text-sm text-ink">{ruleDescription(automation, i18n)}</p>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
                  <span className="inline-flex items-center gap-1">
                    <ShieldCheck aria-hidden className="size-3.5 text-accent-ink" />
                    {dict.automations.proposeOnly}
                  </span>
                  <span>
                    {automation.lastEvaluatedAt
                      ? t(dict.automations.lastRun, { time: fmt.relative(automation.lastEvaluatedAt, now) })
                      : dict.automations.neverRun}
                  </span>
                </div>
              </div>
              <AutomationToggle automationId={automation.id} enabled={automation.enabled} name={automation.name} />
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}
