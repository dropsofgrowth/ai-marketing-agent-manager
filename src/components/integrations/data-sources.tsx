import { CheckCircle2, FlaskConical, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { richT } from "@/i18n/rich";
import type { ServerI18n } from "@/i18n/server";
import type { DataMode, StoreSourceInfo } from "@/server/queries/performance";

/**
 * Always-visible label saying where a page's numbers come from, so demo figures
 * are never mistaken for the merchant's real store (and vice versa).
 */
export function DataSources({
  store,
  ads,
  i18n,
}: {
  store?: StoreSourceInfo;
  ads?: DataMode;
  i18n: ServerI18n;
}) {
  const { dict, locale } = i18n;
  const d = dict.dataSource;
  const icon = (Icon: typeof CheckCircle2) => <Icon aria-hidden className="size-3" />;

  return (
    <div role="group" aria-label={d.label} className="flex flex-wrap items-center gap-1.5">
      <span className="me-0.5 text-xs text-ink-2">{d.label}:</span>
      {store?.mode === "live" ? (
        <Badge tone="good" icon={icon(CheckCircle2)} wrap>
          {richT(d.shopifyLive, { store: store.shopName })}
        </Badge>
      ) : null}
      {store?.mode === "demo" ? (
        <Badge tone="warning" icon={icon(FlaskConical)}>
          {d.shopifyDemo}
        </Badge>
      ) : null}
      {store?.mode === "error" ? (
        <Badge tone="critical" icon={icon(TriangleAlert)}>
          {d.shopifyError}
        </Badge>
      ) : null}
      {ads ? (
        <Badge tone={ads === "live" ? "good" : "warning"} icon={icon(ads === "live" ? CheckCircle2 : FlaskConical)}>
          {ads === "live" ? d.metaLive : d.metaDemo}
        </Badge>
      ) : null}
      {store && store.mode !== "live" ? (
        <Link
          href={`/${locale}/settings#shopify`}
          className="ms-1 inline-flex min-h-8 items-center text-xs font-medium text-accent-ink underline-offset-2 hover:underline pointer-coarse:min-h-10"
        >
          {store.mode === "demo" ? d.connect : d.fix}
        </Link>
      ) : null}
    </div>
  );
}
