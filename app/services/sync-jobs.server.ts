import type { AdPlatform } from "@prisma/client";
import { AdPlatformClientRegistry } from "./ad-platform.server";
import { prisma } from "./prisma.server";

const SYNC_LOOKBACK_DAYS = 3;

export async function enqueueHourlySync() {
  // In a real deployment, you would push jobs to a queueing system.
  // For now, we simply run the sync inline for all active connections.
  await runSyncForAllConnections();
}

export async function runSyncForAllConnections() {
  const connections = await prisma.adAccountConnection.findMany({
    where: { status: "active" },
  });

  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - SYNC_LOOKBACK_DAYS);

  for (const connection of connections) {
    await runSyncForConnection(connection.id, start, now);
  }
}

export async function runSyncForConnection(
  adAccountConnectionId: string,
  start: Date,
  end: Date,
) {
  const connection = await prisma.adAccountConnection.findUniqueOrThrow({
    where: { id: adAccountConnectionId },
  });

  const log = await prisma.syncLog.create({
    data: {
      adAccountConnectionId: connection.id,
      platform: connection.platform as AdPlatform,
    },
  });

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { adPlatformRegistry } = require("~/services/platform-registry.server") as {
      adPlatformRegistry: AdPlatformClientRegistry;
    };

    const clientFactory = adPlatformRegistry[connection.platform as AdPlatform];
    const client = clientFactory({
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken,
      accountId: connection.externalAccountId,
    });

    const insights = await client.fetchCampaignInsights({
      externalAccountId: connection.externalAccountId,
      dateRange: { start, end },
    });

    for (const insight of insights) {
      const campaign = await prisma.campaign.upsert({
        where: {
          adAccountConnectionId_platformCampaignId: {
            adAccountConnectionId: connection.id,
            platformCampaignId: insight.platformCampaignId,
          },
        },
        create: {
          tenantId: connection.tenantId,
          adAccountConnectionId: connection.id,
          platform: insight.platform,
          platformCampaignId: insight.platformCampaignId,
          name: insight.name,
          status: insight.status,
        },
        update: {
          name: insight.name,
          status: insight.status,
        },
      });

      await prisma.campaignMetricSnapshot.create({
        data: {
          campaignId: campaign.id,
          date: insight.date,
          hour: insight.hour,
          impressions: insight.impressions,
          clicks: insight.clicks,
          spend: insight.spend,
          conversions: insight.conversions,
          revenue: insight.revenue,
          ctr: calculateRate(insight.clicks, insight.impressions),
          cpc: calculateRatio(insight.spend, insight.clicks),
          cpm: calculateCpm(insight.spend, insight.impressions),
          cpa: calculateRatio(insight.spend, insight.conversions),
          roas: calculateRatio(insight.revenue, insight.spend),
          raw: insight.raw as unknown as object,
        },
      });
    }

    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status: "success",
        finishedAt: new Date(),
      },
    });

    await prisma.adAccountConnection.update({
      where: { id: connection.id },
      data: { lastSyncAt: new Date(), status: "active" },
    });
  } catch (error) {
    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        message: error instanceof Error ? error.message : "Unknown error",
      },
    });

    await prisma.adAccountConnection.update({
      where: { id: adAccountConnectionId },
      data: { status: "errored" },
    });

    throw error;
  }
}

function calculateRate(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return numerator / denominator;
}

function calculateRatio(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return numerator / denominator;
}

function calculateCpm(spend: number, impressions: number): number {
  if (!impressions) return 0;
  return (spend / impressions) * 1000;
}

