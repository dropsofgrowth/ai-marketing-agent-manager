"use client";

import { RefreshCw } from "lucide-react";

import { SubmitButton } from "@/components/ui/form-controls";
import { useActionWithToast } from "@/components/ui/toast";
import { useI18n } from "@/i18n/client";
import { evaluateAutomationsAction, toggleAutomationAction } from "@/server/actions/automations";

export function AutomationToggle({ automationId, enabled, name }: { automationId: string; enabled: boolean; name: string }) {
  const { dict } = useI18n();
  const [, formAction] = useActionWithToast(toggleAutomationAction);
  return (
    <form action={formAction}>
      <input type="hidden" name="automationId" value={automationId} />
      <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
      <SubmitButton variant="secondary" size="sm" className="min-w-24">
        <span className="sr-only">{name}: </span>
        {enabled ? dict.automations.disable : dict.automations.enable}
      </SubmitButton>
    </form>
  );
}

export function RunAutomationsButton() {
  const { dict } = useI18n();
  const [, formAction] = useActionWithToast(evaluateAutomationsAction);
  return (
    <form action={formAction}>
      <SubmitButton pendingLabel={dict.automations.running}>
        <RefreshCw aria-hidden className="size-4" />
        {dict.automations.runNow}
      </SubmitButton>
    </form>
  );
}
