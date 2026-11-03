import { assertPermission } from "@/domain/permissions";
import type { Actor, AspectRatio, CreativeFormat } from "@/domain/types";
import type { Integrations } from "@/integrations/registry";
import type { DataStore } from "@/server/store/types";

export function createCreativeService(deps: { store: DataStore; integrations: Integrations }) {
  const { store, integrations } = deps;

  return {
    /**
     * Generates a creative via Higgsfield (mock in phase 1) and saves it as READY.
     * Generating has no public side effect; publishing requires an approval.
     */
    async generate(
      actor: Actor,
      input: {
        title: string;
        prompt: string;
        format: CreativeFormat;
        aspectRatio: AspectRatio;
        headline?: string;
        primaryText?: string;
        callToAction?: string;
      },
    ) {
      assertPermission(actor, "creative.generate");
      const job = await integrations.higgsfield.createGeneration({
        prompt: input.prompt,
        format: input.format,
        aspectRatio: input.aspectRatio,
      });

      const creative = await store.creatives.create({
        workspaceId: actor.workspaceId,
        title: input.title,
        prompt: input.prompt,
        format: input.format,
        aspectRatio: input.aspectRatio,
        status: job.status === "completed" ? "READY" : job.status === "failed" ? "FAILED" : "GENERATING",
        providerJobId: job.jobId,
        assetUrl: job.assetUrl,
        thumbnailUrl: job.thumbnailUrl,
        headline: input.headline ?? null,
        primaryText: input.primaryText ?? null,
        callToAction: input.callToAction ?? "SHOP_NOW",
        metadata: {
          mock: integrations.higgsfield.info.mode === "mock",
          seed: job.seed,
          model: job.model,
          durationSeconds: job.durationSeconds,
        },
        createdById: actor.userId,
      });

      await store.audit.record({
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        actorLabel: actor.name,
        action: "creative.generated",
        entityType: "creative",
        entityId: creative.id,
        metadata: { title: creative.title, format: creative.format, mock: integrations.higgsfield.info.mode === "mock" },
      });
      return creative;
    },
  };
}

export type CreativeService = ReturnType<typeof createCreativeService>;
