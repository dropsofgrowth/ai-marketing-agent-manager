import type { CreativeFormat } from "@/domain/types";
import type {
  DateRange,
  IntegrationInfo,
  MutationOptions,
  MutationResult,
} from "@/integrations/types";

export type MetaCampaignStatus = "ACTIVE" | "PAUSED" | "ARCHIVED";
export type MetaCampaignObjective = "SALES" | "TRAFFIC" | "AWARENESS" | "LEADS" | "ENGAGEMENT";

export type MetaAdAccount = {
  id: string;
  name: string;
  currency: string;
  timezone: string;
};

export type MetaCampaign = {
  id: string;
  name: string;
  status: MetaCampaignStatus;
  objective: MetaCampaignObjective;
  dailyBudgetMinor: number;
  currency: string;
  startDate: string;
};

/** Raw delivery metrics. Derived ratios (CTR, ROAS, CPA) are computed in lib/metrics. */
export type AdMetrics = {
  spendMinor: number;
  impressions: number;
  clicks: number;
  purchases: number;
  purchaseValueMinor: number;
};

export type DailyAdMetrics = AdMetrics & { date: string };

export type CampaignInsights = {
  campaignId: string;
  metrics: AdMetrics;
};

export type UpdateBudgetCommand = {
  campaignId: string;
  newDailyBudgetMinor: number;
};

export type PublishCreativeCommand = {
  campaignId: string;
  creative: {
    id: string;
    title: string;
    format: CreativeFormat;
    headline: string;
    primaryText: string;
    callToAction: string;
    assetUrl: string | null;
  };
};

/**
 * Meta Ads (Marketing API) contract. A live implementation will wrap the Graph API;
 * the mock implementation returns deterministic sample data.
 */
export interface MetaAdsService {
  readonly info: IntegrationInfo;

  getAdAccount(): Promise<MetaAdAccount>;
  listCampaigns(): Promise<MetaCampaign[]>;
  getCampaign(campaignId: string): Promise<MetaCampaign | null>;
  /** Account-level metrics per day, or a single campaign's when `campaignId` is set. */
  getDailyInsights(range: DateRange, options?: { campaignId?: string }): Promise<DailyAdMetrics[]>;
  /** Per-campaign totals over the range. */
  getCampaignInsights(range: DateRange): Promise<CampaignInsights[]>;

  /** Only ever invoked by the approval executor for an APPROVED request. */
  updateCampaignBudget(command: UpdateBudgetCommand, options: MutationOptions): Promise<MutationResult>;
  /** Only ever invoked by the approval executor for an APPROVED request. */
  publishCreative(command: PublishCreativeCommand, options: MutationOptions): Promise<MutationResult>;
}
