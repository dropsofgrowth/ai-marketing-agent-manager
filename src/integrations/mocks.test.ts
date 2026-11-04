import { describe, expect, it } from "vitest";

import { MockMetaAdsService } from "@/integrations/meta-ads/mock";
import { MockShopifyService } from "@/integrations/shopify/mock";
import type { MutationOptions } from "@/integrations/types";
import { decryptSecret, encryptSecret } from "@/server/security/encryption";

const range = { from: "2026-10-01", to: "2026-10-30" };

describe("mock integrations", () => {
  it("are deterministic for the same range", async () => {
    const meta = new MockMetaAdsService();
    expect(await meta.getDailyInsights(range)).toEqual(await new MockMetaAdsService().getDailyInsights(range));
    const shop = new MockShopifyService();
    expect(await shop.getDailySales(range)).toEqual(await new MockShopifyService().getDailySales(range));
  });

  it("report mock mode", () => {
    expect(new MockMetaAdsService().info).toEqual({ provider: "META_ADS", mode: "mock" });
    expect(new MockShopifyService().info.mode).toBe("mock");
  });

  it("returns no delivery for paused campaigns", async () => {
    const insights = await new MockMetaAdsService().getCampaignInsights(range);
    expect(insights.find((i) => i.campaignId === "120210000000000006")?.metrics.spendMinor).toBe(0);
  });

  it("refuses anything but a dry run", async () => {
    const meta = new MockMetaAdsService();
    const notDryRun = { dryRun: false } as unknown as MutationOptions;
    await expect(
      meta.updateCampaignBudget({ campaignId: "120210000000000001", newDailyBudgetMinor: 1 }, notDryRun),
    ).rejects.toThrow(/dry runs/);
    const ok = await meta.updateCampaignBudget(
      { campaignId: "120210000000000001", newDailyBudgetMinor: 1 },
      { dryRun: true },
    );
    expect(ok).toMatchObject({ ok: true, simulated: true });
  });
});

describe("credential encryption", () => {
  const key = Buffer.alloc(32, 7).toString("base64");

  it("round-trips and binds the context", () => {
    const token = encryptSecret("secret-token", key, "connection:1");
    expect(token.startsWith("v1.")).toBe(true);
    expect(token).not.toContain("secret-token");
    expect(decryptSecret(token, key, "connection:1")).toBe("secret-token");
    expect(() => decryptSecret(token, key, "connection:2")).toThrow();
  });

  it("rejects malformed keys", () => {
    expect(() => encryptSecret("x", Buffer.alloc(16).toString("base64"), "c")).toThrow(/32 bytes/);
  });

  it("accepts only the full 16-byte tag and a 12-byte IV", () => {
    const [version, iv, tag, ciphertext] = encryptSecret("secret-token", key, "c").split(".");
    const tagBytes = Buffer.from(tag, "base64url");
    const ivBytes = Buffer.from(iv, "base64url");
    expect([tagBytes.length, ivBytes.length]).toEqual([16, 12]);
    // A truncated (but otherwise genuine) GCM tag would weaken authentication: refused.
    for (const short of [4, 8, 12, 15]) {
      const truncated = [version, iv, tagBytes.subarray(0, short).toString("base64url"), ciphertext].join(".");
      expect(() => decryptSecret(truncated, key, "c"), `${short}-byte tag`).toThrow(/format/);
    }
    const longIv = [version, Buffer.concat([ivBytes, Buffer.alloc(4)]).toString("base64url"), tag, ciphertext].join(".");
    expect(() => decryptSecret(longIv, key, "c")).toThrow(/format/);
  });
});
