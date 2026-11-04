import { CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";

import { IntegrationList } from "@/components/integrations/integration-list";
import { ShopifyConnectionCard } from "@/components/integrations/shopify-connection-card";
import { AppSettings } from "@/components/settings/app-settings";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { SectionSkeleton } from "@/components/ui/skeleton";
import { hasPermission } from "@/domain/permissions";
import { isShopifyConnectResult } from "@/domain/shopify-connect";
import { LOCALE_NAMES } from "@/i18n/config";
import { getI18n, type ServerI18n } from "@/i18n/server";
import { getCurrentActor } from "@/server/auth/actor";
import { getEnv } from "@/server/env";
import { getShopifyConnectionView } from "@/server/integrations/shopify";
import { getIntegrationStatuses } from "@/server/queries/integrations";
import { getApprovalConfig } from "@/server/services";
import { DEMO_WORKSPACE } from "@/server/store/demo-data";
import { getStore } from "@/server/store";

export async function generateMetadata({ params }: PageProps<"/[lang]/settings">): Promise<Metadata> {
  return { title: getI18n((await params).lang).dict.settings.title };
}

export default async function SettingsPage({ params, searchParams }: PageProps<"/[lang]/settings">) {
  const i18n = getI18n((await params).lang);
  return (
    <>
      <PageHeader title={i18n.dict.settings.title} description={i18n.dict.settings.subtitle} />
      <Suspense fallback={<SectionSkeleton label={i18n.dict.common.loading} tiles={0} />}>
        <SettingsContent i18n={i18n} searchParams={searchParams} />
      </Suspense>
    </>
  );
}

/** Label/value row: stacked on phones, side by side from `sm`. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <dt className="text-sm text-ink-2">{label}</dt>
      <dd className="min-w-0 text-sm font-medium text-ink sm:text-end">{children}</dd>
    </div>
  );
}

function YesNo({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return ok ? (
    <Badge tone="good" icon={<CheckCircle2 aria-hidden className="size-3" />}>
      {yes}
    </Badge>
  ) : (
    <Badge tone="neutral" icon={<CircleDashed aria-hidden className="size-3" />}>
      {no}
    </Badge>
  );
}

async function SettingsContent({
  i18n,
  searchParams,
}: {
  i18n: ServerI18n;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const { dict, fmt, t } = i18n;
  const s = dict.settings;
  const env = getEnv();
  const config = getApprovalConfig();
  const store = getStore();
  const rawResult = (await searchParams).shopify;
  // Only known result codes are rendered; anything else in the URL is ignored.
  const shopifyResult = isShopifyConnectResult(rawResult) ? rawResult : null;
  const [actor, shopifyView, statuses] = await Promise.all([
    getCurrentActor(),
    getShopifyConnectionView(),
    getIntegrationStatuses(),
  ]);
  let storageOk = true;
  try {
    await store.ping();
  } catch {
    storageOk = false;
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <Card className="xl:col-span-2">
        <CardHeader title={s.app} description={s.appHint} />
        <CardBody>
          <AppSettings />
        </CardBody>
      </Card>

      <ShopifyConnectionCard
        view={shopifyView}
        result={shopifyResult}
        canManage={hasPermission(actor.role, "integration.manage")}
        i18n={i18n}
      />

      <Card className="xl:col-span-2">
        <CardHeader title={s.integrations} description={s.integrationsHint} />
        <CardBody>
          <IntegrationList statuses={statuses} i18n={i18n} showMissing />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={s.safety} />
        <CardBody>
          <dl className="divide-y divide-line">
            <Row label={s.liveExecution}>
              <Badge tone={env.LIVE_EXECUTION_ENABLED ? "warning" : "good"} wrap>
                {env.LIVE_EXECUTION_ENABLED ? s.liveRequested : s.liveDisabled}
              </Badge>
            </Row>
            <Row label={s.maxIncrease}>
              <bdi className="tabular">+{fmt.number(config.guardrails.maxIncreasePercent)}%</bdi>
            </Row>
            <Row label={s.maxDecrease}>
              <bdi className="tabular">−{fmt.number(config.guardrails.maxDecreasePercent)}%</bdi>
            </Row>
            <Row label={s.dailyCap}>
              <span className="tabular">{fmt.currency(config.guardrails.maxDailyBudgetMinor, DEMO_WORKSPACE.currency)}</span>
            </Row>
            <Row label={s.ttl}>{t(s.hours, { n: config.ttlHours })}</Row>
            <Row label={s.fourEyes}>{config.requireSeparateApprover ? s.on : s.off}</Row>
          </dl>
        </CardBody>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader title={s.storage} />
          <CardBody className="space-y-3">
            <dl>
              <Row label={store.kind === "postgres" ? s.storagePostgres : s.storageMemory}>
                {storageOk ? (
                  <Badge tone="good" icon={<CheckCircle2 aria-hidden className="size-3" />}>
                    {s.storageOk}
                  </Badge>
                ) : (
                  <Badge tone="critical" icon={<XCircle aria-hidden className="size-3" />}>
                    {s.storageError}
                  </Badge>
                )}
              </Row>
            </dl>
            {store.kind === "memory" ? <p className="text-xs text-ink-2">{s.storageMemoryHint}</p> : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={s.security} />
          <CardBody className="space-y-4">
            <dl className="divide-y divide-line">
              <Row label={s.basicAuth}>
                <YesNo ok={Boolean(env.DASHBOARD_BASIC_AUTH_USER && env.DASHBOARD_BASIC_AUTH_PASSWORD)} yes={s.configured} no={s.notConfigured} />
              </Row>
              <Row label={s.encryptionKey}>
                <YesNo ok={Boolean(env.CREDENTIALS_ENCRYPTION_KEY)} yes={s.configured} no={s.notConfigured} />
              </Row>
            </dl>
            <Notice tone="warning">{s.authNotice}</Notice>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={s.workspace} />
          <CardBody>
            <dl className="divide-y divide-line">
              <Row label={s.workspaceName}>{DEMO_WORKSPACE.name}</Row>
              <Row label={s.currency}>{DEMO_WORKSPACE.currency}</Row>
              <Row label={s.language}>{LOCALE_NAMES[i18n.locale]}</Row>
            </dl>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
