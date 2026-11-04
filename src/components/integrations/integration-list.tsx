import { CheckCircle2, CircleDashed, FlaskConical, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { richT } from "@/i18n/rich";
import type { ServerI18n } from "@/i18n/server";
import type { IntegrationStatus } from "@/server/queries/integrations";

const icon = (Icon: typeof CheckCircle2) => <Icon aria-hidden className="size-3" />;

/** Primary badge: what data this provider currently supplies. */
function sourceBadge(s: IntegrationStatus, i18n: ServerI18n): { tone: BadgeTone; icon: ReactNode; label: string } {
  const d = i18n.dict.integrations;
  if (s.connection === "connected") return { tone: "good", icon: icon(CheckCircle2), label: `${d.modeLive} · ${d.connected}` };
  if (s.connection === "error") return { tone: "critical", icon: icon(TriangleAlert), label: d.reconnectNeeded };
  return { tone: "warning", icon: icon(FlaskConical), label: s.mode === "mock" ? d.demoData : d.modeLive };
}

export function IntegrationList({
  statuses,
  i18n,
  showMissing = false,
}: {
  statuses: IntegrationStatus[];
  i18n: ServerI18n;
  showMissing?: boolean;
}) {
  const { dict } = i18n;
  return (
    <ul className="divide-y divide-line">
      {statuses.map((s) => {
        const primary = sourceBadge(s, i18n);
        const showCredentialBadge = s.provider !== "SHOPIFY" || s.connection === "not_configured";
        return (
          <li key={s.provider} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">{dict.integrations[s.provider]}</p>
              <p className="text-xs text-ink-2">{dict.integrations.description[s.provider]}</p>
              {showMissing && s.missing.length ? (
                <p className="mt-1 text-xs break-words text-ink-3">
                  {richT(dict.settings.missingVars, {
                    vars: (
                      <span dir="ltr" className="font-mono text-[11px]">
                        {s.missing.join(", ")}
                      </span>
                    ),
                  })}
                </p>
              ) : null}
              {showMissing && !s.liveAdapterAvailable ? (
                <p className="mt-1 text-xs text-ink-3">{dict.integrations.liveAdapterPending}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge tone={primary.tone} icon={primary.icon}>
                {primary.label}
              </Badge>
              {s.provider === "SHOPIFY" && s.connection === "ready" ? (
                <Badge tone="accent" icon={icon(CircleDashed)}>
                  {dict.integrations.readyToConnect}
                </Badge>
              ) : null}
              {showCredentialBadge ? (
                <Badge
                  tone={s.credentialsPresent ? "good" : "neutral"}
                  icon={s.credentialsPresent ? icon(CheckCircle2) : icon(CircleDashed)}
                >
                  {s.credentialsPresent ? dict.integrations.credentialsPresent : dict.integrations.credentialsMissing}
                </Badge>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
