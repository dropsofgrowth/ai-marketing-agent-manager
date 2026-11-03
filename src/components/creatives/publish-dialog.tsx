"use client";

import { Send } from "lucide-react";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, inputClass } from "@/components/ui/field";
import { ActionFeedback, SubmitButton } from "@/components/ui/form-controls";
import { Notice } from "@/components/ui/notice";
import { useActionWithToast } from "@/components/ui/toast";
import { useI18n } from "@/i18n/client";
import { requestCreativePublishAction } from "@/server/actions/approvals";

/** Files a CREATIVE_PUBLISH approval request. Nothing is uploaded anywhere. */
export function PublishDialog({
  creative,
  campaigns,
}: {
  creative: { id: string; title: string };
  campaigns: { id: string; name: string }[];
}) {
  const { dict, t } = useI18n();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const [state, formAction] = useActionWithToast(requestCreativePublishAction, { onSuccess: close });
  const d = dict.creatives.publishDialog;
  const id = `publish-${creative.id}`;

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Send aria-hidden className="size-3.5 rtl:-scale-x-100" />
        {dict.creatives.requestPublish}
      </Button>
      <Dialog open={open} onClose={close} title={t(d.title, { title: creative.title })}>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="creativeId" value={creative.id} />
          <Field label={d.campaign} htmlFor={`${id}-campaign`}>
            <select id={`${id}-campaign`} name="campaignId" required className={inputClass}>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={d.rationale} htmlFor={`${id}-why`}>
            <textarea id={`${id}-why`} name="rationale" rows={2} maxLength={1000} className={inputClass} />
          </Field>
          <Notice tone="safety">{d.notice}</Notice>
          <ActionFeedback result={state} />
          <div className="flex justify-end gap-2">
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
