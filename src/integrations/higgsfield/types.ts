import type { AspectRatio, CreativeFormat } from "@/domain/types";
import type { IntegrationInfo } from "@/integrations/types";

export type GenerationModel = {
  id: string;
  name: string;
  formats: CreativeFormat[];
};

export type GenerationRequest = {
  prompt: string;
  format: CreativeFormat;
  aspectRatio: AspectRatio;
};

export type GenerationJob = {
  jobId: string;
  status: "queued" | "processing" | "completed" | "failed";
  model: string;
  /** Final asset URL. `null` for mock jobs — the UI renders a generated preview. */
  assetUrl: string | null;
  thumbnailUrl: string | null;
  seed: number;
  durationSeconds: number | null;
  createdAt: string;
};

/**
 * Higgsfield AI contract (image/video generation). Generating a creative has no
 * public side effect; publishing it to an ad account goes through approvals.
 */
export interface HiggsfieldService {
  readonly info: IntegrationInfo;

  listModels(): Promise<GenerationModel[]>;
  createGeneration(request: GenerationRequest): Promise<GenerationJob>;
  getGeneration(jobId: string): Promise<GenerationJob | null>;
}
