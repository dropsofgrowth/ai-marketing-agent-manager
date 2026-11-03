"use server";

import { generateCreativeInputSchema } from "@/domain/approvals/schemas";
import { getServices } from "@/server/services";

import type { ActionResult } from "./result";
import { formDataToObject, runAction } from "./run-action";

export async function generateCreativeAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction(async (actor) => {
    const input = generateCreativeInputSchema.parse(formDataToObject(formData));
    const creative = await getServices().creatives.generate(actor, input);
    return { code: "CREATIVE_GENERATED", params: { title: creative.title } };
  });
}
