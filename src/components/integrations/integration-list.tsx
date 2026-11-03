import { CheckCircle2, CircleDashed, FlaskConical } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { ServerI18n } from "@/i18n/server";
import type { IntegrationStatus } from "@/server/queries/integrations";

export function IntegrationList({
  statuses,
  i18n,
  showMissing = false,
}: {
  statuses: IntegrationStatus[];
  i18n: ServerI18n;
  showMissing?: boolean;
}) {
  const { dict, t } = i18n;
  return (
    <ul className="divide-y divide-line">
      {statuses.map((s) => (
        <li key={s.provider} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">{dict.integrations[s.provider]}</p>
            <p className="text-xs text-ink-2">{dict.integrations.description[s.provider]}</p>
            {showMissing && s.missing.length ? (
              <p className="mt-1 text-xs text-ink-3" dir="ltr">
                {t(dict.settings.missingVars, { vars: s.missing.join(", ") })}
              </p>
            ) : null}
            {showMissing ? <p className="mt-1 text-xs text-ink-3">{dict.integrations.liveAdapterPending}</p> : null}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="warning" icon={<FlaskConical aria-hidden className="size-3" />}>
              {s.mode === "mock" ? dict.integrations.modeMock : dict.integrations.modeLive}
            </Badge>
            <Badge
              tone={s.credentialsPresent ? "good" : "neutral"}
              icon={
                s.credentialsPresent ? (
                  <CheckCircle2 aria-hidden className="size-3" />
                ) : (
                  <CircleDashed aria-hidden className="size-3" />
                )
              }
            >
              {s.credentialsPresent ? dict.integrations.credentialsPresent : dict.integrations.credentialsMissing}
            </Badge>
          </div>
        </li>
      ))}
    </ul>
  );
}
