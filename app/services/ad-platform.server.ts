import type { AdPlatform } from "@prisma/client";

type DateRange = {
  start: Date;
  end: Date;
};

export type NormalizedCampaignInsight = {
  platform: AdPlatform;
  platformCampaignId: string;
  name: string;
  status: string;
  date: Date;
  hour?: number;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  revenue: number;
  raw: unknown;
};

export interface AdPlatformClient {
  readonly platform: AdPlatform;

  /**
   * Fetch campaign-level insights for the given ad account and date range.
   * Implementations should handle any platform-specific paging or batching.
   */
  fetchCampaignInsights(params: {
    externalAccountId: string;
    dateRange: DateRange;
  }): Promise<NormalizedCampaignInsight[]>;
}

export type AdPlatformClientFactory = (options: {
  accessToken: string | null;
  refreshToken: string | null;
  accountId: string;
}) => AdPlatformClient;

export type AdPlatformClientRegistry = Record<AdPlatform, AdPlatformClientFactory>;

export const createAdPlatformRegistry = (
  registry: Partial<AdPlatformClientRegistry>,
): AdPlatformClientRegistry => {
  return {
    FACEBOOK: requireFactory(registry.FACEBOOK, "FACEBOOK"),
    GOOGLE: requireFactory(registry.GOOGLE, "GOOGLE"),
    MICROSOFT: requireFactory(registry.MICROSOFT, "MICROSOFT"),
    CAPTERRA: requireFactory(registry.CAPTERRA, "CAPTERRA"),
    LINKEDIN: requireFactory(registry.LINKEDIN, "LINKEDIN"),
  };
};

function requireFactory(
  factory: AdPlatformClientFactory | undefined,
  platform: AdPlatform,
): AdPlatformClientFactory {
  if (!factory) {
    return () => {
      throw new Error(`AdPlatformClientFactory for ${platform} is not configured`);
    };
  }
  return factory;
}

