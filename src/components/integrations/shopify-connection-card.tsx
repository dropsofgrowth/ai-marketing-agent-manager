import { CheckCircle2, CircleDashed, Settings2, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import {
  ConnectShopifyButton,
  DisconnectShopifyButton,
  VerifyShopifyButton,
} from "@/components/integrations/shopify-connection-actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import type { ShopifyConnectResult } from "@/domain/shopify-connect";
import { richT } from "@/i18n/rich";
import type { ServerI18n } from "@/i18n/server";
import type { ShopifyConnectionView } from "@/server/integrations/shopify";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <dt className="shrink-0 text-sm text-ink-2">{label}</dt>
      <dd className="min-w-0 text-sm font-medium break-words text-ink sm:text-end">{children}</dd>
    </div>
  );
}

/** Setting names / URLs: always LTR and monospace, even in Arabic. */
function Code({ children }: { children: ReactNode }) {
  return (
    <span dir="ltr" className="font-mono text-[12px] break-all">
      {children}
    </span>
  );
}

function errorText(code: string, i18n: ServerI18n): string {
  const errors = i18n.dict.errors as Record<string, string>;
  return errors[code] ?? errors.UNEXPECTED;
}

function StatusBadge({ view, i18n }: { view: ShopifyConnectionView; i18n: ServerI18n }) {
  const s = i18n.dict.shopifyConnect;
  switch (view.state) {
    case "connected":
      return (
        <Badge tone="good" icon={<CheckCircle2 aria-hidden className="size-3" />}>
          {s.statusConnected}
        </Badge>
      );
    case "error":
      return (
        <Badge tone="critical" icon={<TriangleAlert aria-hidden className="size-3" />}>
          {s.statusError}
        </Badge>
      );
    case "ready":
      return (
        <Badge tone="neutral" icon={<CircleDashed aria-hidden className="size-3" />}>
          {s.statusReady}
        </Badge>
      );
    default:
      return (
        <Badge tone="warning" icon={<Settings2 aria-hidden className="size-3" />}>
          {s.statusSetup}
        </Badge>
      );
  }
}

/**
 * Settings card for the read-only Shopify connection. Shows only non-secret
 * metadata (store, granted scopes, dates); tokens never leave the server.
 */
export function ShopifyConnectionCard({
  view,
  result,
  canManage,
  i18n,
}: {
  view: ShopifyConnectionView;
  /** Outcome of the OAuth callback (from `?shopify=`), if the user just came back. */
  result: ShopifyConnectResult | null;
  canManage: boolean;
  i18n: ServerI18n;
}) {
  const { dict, fmt } = i18n;
  const s = dict.shopifyConnect;

  return (
    <Card id="shopify" className="scroll-mt-24 xl:col-span-2">
      <CardHeader title={s.title} description={s.description} action={<StatusBadge view={view} i18n={i18n} />} />
      <CardBody className="space-y-4">
        {result ? (
          <Notice tone={result === "connected" ? "success" : "critical"} role="alert">
            {s.results[result]}
          </Notice>
        ) : null}

        {view.state === "not_configured" ? (
          <Notice tone="warning">{richT(s.notConfigured, { vars: <Code>{view.missing.join(", ")}</Code> })}</Notice>
        ) : null}
        {view.state === "storage_required" ? (
          <Notice tone="warning">{richT(s.storageRequired, { vars: <Code>{view.missing.join(", ")}</Code> })}</Notice>
        ) : null}
        {view.state === "app_url_insecure" ? <Notice tone="warning">{s.appUrlInsecure}</Notice> : null}

        {view.state === "ready" ? (
          <>
            <p className="text-sm text-ink-2">{richT(s.ready, { store: <Code>{view.shopDomain}</Code> })}</p>
            <dl>
              <Row label={s.callbackUrl}>
                <Code>{view.redirectUri}</Code>
              </Row>
            </dl>
            {canManage ? <ConnectShopifyButton /> : null}
          </>
        ) : null}

        {view.state === "error" ? (
          <>
            <Notice tone="critical">{errorText(view.code, i18n)}</Notice>
            <dl className="divide-y divide-line">
              <Row label={s.store}>
                {view.shopName ? <bdi>{view.shopName}</bdi> : null} <Code>{view.shopDomain}</Code>
              </Row>
              <Row label={s.lastChecked}>{view.lastSyncedAt ? fmt.dateTime(view.lastSyncedAt) : s.never}</Row>
            </dl>
            {canManage ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                <ConnectShopifyButton reconnect />
                <DisconnectShopifyButton />
              </div>
            ) : null}
          </>
        ) : null}

        {view.state === "connected" ? (
          <>
            {view.warning ? (
              <Notice tone="warning">{richT(s.warning, { reason: errorText(view.warning, i18n) })}</Notice>
            ) : null}
            <dl className="divide-y divide-line">
              <Row label={s.store}>
                <span className="inline-flex flex-wrap items-center justify-end gap-x-2">
                  {view.shopName ? <bdi>{view.shopName}</bdi> : null}
                  <Code>{view.shopDomain}</Code>
                </span>
              </Row>
              <Row label={s.permissions}>
                <span className="inline-flex flex-wrap justify-end gap-1">
                  {view.scopes.map((scope) => (
                    <Badge key={scope} tone="neutral">
                      <Code>{scope}</Code>
                    </Badge>
                  ))}
                </span>
              </Row>
              <Row label={s.connectedAt}>{view.connectedAt ? fmt.dateTime(view.connectedAt) : s.never}</Row>
              <Row label={s.lastChecked}>{view.lastSyncedAt ? fmt.dateTime(view.lastSyncedAt) : s.never}</Row>
              <Row label={s.renewal}>
                {view.refreshTokenExpiresAt
                  ? richT(s.renewalAuto, { date: fmt.date(view.refreshTokenExpiresAt) })
                  : view.accessTokenExpiresAt
                    ? s.renewalAutoShort
                    : s.renewalNonExpiring}
              </Row>
            </dl>
            {!view.hasAllOrders || !view.hasInventory ? (
              <ul className="list-disc space-y-1 ps-5 text-xs text-ink-2">
                {!view.hasAllOrders ? <li>{s.historyLimited}</li> : null}
                {!view.hasInventory ? <li>{s.inventoryLimited}</li> : null}
              </ul>
            ) : null}
            {canManage ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                <VerifyShopifyButton />
                <DisconnectShopifyButton />
              </div>
            ) : null}
          </>
        ) : null}

        <Notice tone="safety">{s.readOnly}</Notice>
      </CardBody>
    </Card>
  );
}
