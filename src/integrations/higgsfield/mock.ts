import type {
  GenerationJob,
  GenerationModel,
  GenerationRequest,
  HiggsfieldService,
} from "@/integrations/higgsfield/types";
import { hashString } from "@/integrations/mock-data/random";
import type { IntegrationInfo } from "@/integrations/types";

const MODELS: GenerationModel[] = [
  { id: "mock-image", name: "Mock image model", formats: ["IMAGE"] },
  { id: "mock-video", name: "Mock video model", formats: ["VIDEO"] },
];

/**
 * Side-effect-free stand-in for Higgsfield AI. Jobs "complete" instantly and have
 * no asset URL; the UI renders a deterministic preview from the job seed instead.
 */
export class MockHiggsfieldService implements HiggsfieldService {
  readonly info: IntegrationInfo = { provider: "HIGGSFIELD", mode: "mock" };

  private readonly jobs = new Map<string, GenerationJob>();

  async listModels(): Promise<GenerationModel[]> {
    return MODELS.map((m) => ({ ...m, formats: [...m.formats] }));
  }

  async createGeneration(request: GenerationRequest): Promise<GenerationJob> {
    const seed = hashString(`${request.format}:${request.aspectRatio}:${request.prompt}`);
    const job: GenerationJob = {
      jobId: `mock_job_${crypto.randomUUID()}`,
      status: "completed",
      model: request.format === "VIDEO" ? "mock-video" : "mock-image",
      assetUrl: null,
      thumbnailUrl: null,
      seed,
      durationSeconds: request.format === "VIDEO" ? 8 : null,
      createdAt: new Date().toISOString(),
    };
    this.jobs.set(job.jobId, job);
    return { ...job };
  }

  async getGeneration(jobId: string): Promise<GenerationJob | null> {
    const job = this.jobs.get(jobId);
    return job ? { ...job } : null;
  }
}
