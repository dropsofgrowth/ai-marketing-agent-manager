"use client";

import { Sparkles } from "lucide-react";
import { useCallback, useState } from "react";

import { Field, inputClass } from "@/components/ui/field";
import { ActionFeedback, SubmitButton, hasFieldError } from "@/components/ui/form-controls";
import { useActionWithToast } from "@/components/ui/toast";
import { ASPECT_RATIOS, CREATIVE_FORMATS } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { generateCreativeAction } from "@/server/actions/creatives";

const CTAS = ["SHOP_NOW", "LEARN_MORE", "SIGN_UP", "GET_OFFER"] as const;

export function GenerateCreativeForm() {
  const { dict } = useI18n();
  const f = dict.creatives.fields;
  // Re-mount the form after a successful generation to clear its fields.
  const [formKey, setFormKey] = useState(0);
  const reset = useCallback(() => setFormKey((k) => k + 1), []);
  const [state, formAction] = useActionWithToast(generateCreativeAction, { onSuccess: reset });
  const invalid = (field: string) => (hasFieldError(state, field) ? true : undefined);

  return (
    <form key={formKey} action={formAction} className="space-y-4">
      <Field label={f.title} htmlFor="cr-title">
        <input
          id="cr-title"
          name="title"
          required
          minLength={2}
          maxLength={120}
          placeholder={f.titlePlaceholder}
          aria-invalid={invalid("title")}
          className={inputClass}
        />
      </Field>
      <Field label={f.prompt} htmlFor="cr-prompt">
        <textarea
          id="cr-prompt"
          name="prompt"
          required
          minLength={10}
          maxLength={2000}
          rows={4}
          placeholder={f.promptPlaceholder}
          aria-invalid={invalid("prompt")}
          className={inputClass}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={f.format} htmlFor="cr-format">
          <select id="cr-format" name="format" defaultValue="IMAGE" className={inputClass}>
            {CREATIVE_FORMATS.map((format) => (
              <option key={format} value={format}>
                {dict.creatives.format[format]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={f.aspectRatio} htmlFor="cr-ratio">
          <select id="cr-ratio" name="aspectRatio" defaultValue="4:5" className={inputClass} dir="ltr">
            {ASPECT_RATIOS.map((ratio) => (
              <option key={ratio} value={ratio}>
                {ratio}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label={f.headline} htmlFor="cr-headline">
        <input id="cr-headline" name="headline" maxLength={120} className={inputClass} />
      </Field>
      <Field label={f.primaryText} htmlFor="cr-text">
        <textarea id="cr-text" name="primaryText" rows={2} maxLength={500} className={inputClass} />
      </Field>
      <Field label={f.callToAction} htmlFor="cr-cta">
        <select id="cr-cta" name="callToAction" defaultValue="SHOP_NOW" className={inputClass}>
          {CTAS.map((cta) => (
            <option key={cta} value={cta}>
              {dict.creatives.cta[cta]}
            </option>
          ))}
        </select>
      </Field>
      <ActionFeedback result={state} />
      <SubmitButton pendingLabel={dict.creatives.generating} className="w-full">
        <Sparkles aria-hidden className="size-4" />
        {dict.creatives.generate}
      </SubmitButton>
    </form>
  );
}
