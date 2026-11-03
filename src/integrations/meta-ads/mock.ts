import {
  MOCK_AD_ACCOUNT,
  campaignTotals,
  dailyAdMetrics,
  mockCampaigns,
} from "@/integrations/mock-data/catalog";
import { hashString } from "@/integrations/mock-data/random";
import type {
  CampaignInsights,
  DailyAdMetrics,
  MetaAdAccount,
  MetaAdsService,
  MetaCampaign,
  PublishCreativeCommand,
  UpdateBudgetCommand,
} from "@/integrations/meta-ads/types";
import type {
  DateRange,
  IntegrationInfo,
  MutationOptions,
  MutationResult,
} from "@/integrations/types";

function assertDryRun(options: MutationOptions) {
  // Belt and braces: the type already requires `true`, but never trust a cast.
  if (options?.dryRun !== true) {
    throw new Error("The mock Meta Ads adapter only supports dry runs.");
  }
}

/** Deterministic, side-effect-free Meta Ads adapter. Never performs network I/O. */
export class MockMetaAdsService implements MetaAdsService {
  readonly info: IntegrationInfo = { provider: "META_ADS", mode: "mock" };

  async getAdAccount(): Promise<MetaAdAccount> {
    return { ...MOCK_AD_ACCOUNT };
  }

  async listCampaigns(): Promise<MetaCampaign[]> {
    return mockCampaigns();
  }

  async getCampaign(campaignId: string): Promise<MetaCampaign | null> {
    return mockCampaigns().find((c) => c.id === campaignId) ?? null;
  }

  async getDailyInsights(range: DateRange, options?: { campaignId?: string }): Promise<DailyAdMetrics[]> {
    return dailyAdMetrics(range, options?.campaignId);
  }

  async getCampaignInsights(range: DateRange): Promise<CampaignInsights[]> {
    return mockCampaigns().map((c) => ({ campaignId: c.id, metrics: campaignTotals(c.id, range) }));
  }

  async updateCampaignBudget(command: UpdateBudgetCommand, options: MutationOptions): Promise<MutationResult> {
    assertDryRun(options);
    const campaign = await this.getCampaign(command.campaignId);
    if (!campaign) {
      return {
        ok: false,
        simulated: true,
        operation: "meta.campaign.update_budget",
        message: "Campaign not found in the mock ad account.",
      };
    }
    return {
      ok: true,
      simulated: true,
      operation: "meta.campaign.update_budget",
      message: "Simulated only — no request was sent to Meta.",
      details: {
        campaignId: campaign.id,
        fromDailyBudgetMinor: campaign.dailyBudgetMinor,
        toDailyBudgetMinor: command.newDailyBudgetMinor,
      },
    };
  }

  async publishCreative(command: PublishCreativeCommand, options: MutationOptions): Promise<MutationResult> {
    assertDryRun(options);
    const campaign = await this.getCampaign(command.campaignId);
    if (!campaign) {
      return {
        ok: false,
        simulated: true,
        operation: "meta.ad.create",
        message: "Campaign not found in the mock ad account.",
      };
    }
    const ref = `sim_ad_${hashString(`${command.campaignId}:${command.creative.id}`).toString(16)}`;
    return {
      ok: true,
      simulated: true,
      operation: "meta.ad.create",
      message: "Simulated only — no ad was created on Meta.",
      externalRef: ref,
      details: { campaignId: campaign.id, creativeId: command.creative.id, simulatedAdId: ref },
    };
  }
}
