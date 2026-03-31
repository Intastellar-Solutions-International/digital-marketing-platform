import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { prisma } from "~/services/prisma.server";

type PlatformSummary = {
  platform: string;
  spend: number;
  conversions: number;
  revenue: number;
  roas: number;
};

type TopCampaign = {
  id: string;
  name: string;
  platform: string;
  spend: number;
  conversions: number;
  revenue: number;
  roas: number;
};

export async function loader({ request }: LoaderFunctionArgs) {
  // TODO: scope to current tenant once auth is implemented
  const tenant = await prisma.tenant.findFirst();

  if (!tenant) {
    return json({
      hasTenant: false,
    });
  }

  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - 7);

  const platformSummary = await prisma.$queryRaw<PlatformSummary[]>`
    SELECT
      "AdAccountConnection"."platform" as platform,
      SUM("CampaignMetricSnapshot"."spend") as spend,
      SUM("CampaignMetricSnapshot"."conversions") as conversions,
      SUM("CampaignMetricSnapshot"."revenue") as revenue,
      CASE
        WHEN SUM("CampaignMetricSnapshot"."spend") = 0 THEN 0
        ELSE SUM("CampaignMetricSnapshot"."revenue") / SUM("CampaignMetricSnapshot"."spend")
      END as roas
    FROM "CampaignMetricSnapshot"
    JOIN "Campaign" ON "CampaignMetricSnapshot"."campaignId" = "Campaign"."id"
    JOIN "AdAccountConnection" ON "Campaign"."adAccountConnectionId" = "AdAccountConnection"."id"
    WHERE "Campaign"."tenantId" = ${tenant.id}
      AND "CampaignMetricSnapshot"."date" >= ${start}
      AND "CampaignMetricSnapshot"."date" <= ${now}
    GROUP BY "AdAccountConnection"."platform";
  `;

  const topCampaigns = await prisma.$queryRaw<TopCampaign[]>`
    SELECT
      "Campaign"."id" as id,
      "Campaign"."name" as name,
      "Campaign"."platform" as platform,
      SUM("CampaignMetricSnapshot"."spend") as spend,
      SUM("CampaignMetricSnapshot"."conversions") as conversions,
      SUM("CampaignMetricSnapshot"."revenue") as revenue,
      CASE
        WHEN SUM("CampaignMetricSnapshot"."spend") = 0 THEN 0
        ELSE SUM("CampaignMetricSnapshot"."revenue") / SUM("CampaignMetricSnapshot"."spend")
      END as roas
    FROM "CampaignMetricSnapshot"
    JOIN "Campaign" ON "CampaignMetricSnapshot"."campaignId" = "Campaign"."id"
    WHERE "Campaign"."tenantId" = ${tenant.id}
      AND "CampaignMetricSnapshot"."date" >= ${start}
      AND "CampaignMetricSnapshot"."date" <= ${now}
    GROUP BY "Campaign"."id", "Campaign"."name", "Campaign"."platform"
    HAVING SUM("CampaignMetricSnapshot"."spend") > 0
    ORDER BY roas DESC
    LIMIT 5;
  `;

  const totals = platformSummary.reduce(
    (acc, row) => {
      acc.spend += Number(row.spend || 0);
      acc.conversions += Number(row.conversions || 0);
      acc.revenue += Number(row.revenue || 0);
      return acc;
    },
    { spend: 0, conversions: 0, revenue: 0 },
  );

  const blendedRoas = totals.spend === 0 ? 0 : totals.revenue / totals.spend;

  return json({
    hasTenant: true,
    rangeLabel: "Last 7 days",
    platformSummary,
    topCampaigns,
    totals: {
      spend: totals.spend,
      conversions: totals.conversions,
      revenue: totals.revenue,
      roas: blendedRoas,
    },
  });
}

export default function Index() {
  const data = useLoaderData<typeof loader>();

  if (!data.hasTenant) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <h1 className="text-3xl font-semibold">Digital marketing overview</h1>
        <p className="mt-4 text-slate-600">
          Get started by creating a tenant and connecting your ad platforms. Once connected, this
          dashboard will show a unified view of performance across Facebook, Google, Microsoft,
          Capterra, and LinkedIn.
        </p>
      </main>
    );
  }

  const { rangeLabel, totals, platformSummary, topCampaigns } = data;

  const maxRoas = topCampaigns.reduce((max, c) => (c.roas > max ? c.roas : max), 0) || 1;

  return (
    <main className="mx-auto max-w-6xl p-8 space-y-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Cross-channel performance overview</h1>
          <p className="mt-2 text-sm text-slate-600">
            Unified KPIs across Facebook, Google, Microsoft, Capterra, and LinkedIn to quickly see
            where your budget performs best.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/integrations"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1"
          >
            Add account
          </Link>
          <span className="rounded-full bg-slate-900 px-4 py-2 text-xs font-medium uppercase tracking-wide text-white">
            {rangeLabel}
          </span>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total spend</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            ${totals.spend.toFixed(0)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Total conversions
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {totals.conversions.toFixed(0)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Total revenue
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            ${totals.revenue.toFixed(0)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Blended ROAS
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {totals.roas.toFixed(2)}x
          </p>
        </div>
      </section>

      <section className="grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="text-sm font-medium text-slate-700">Platform comparison</h2>
          <p className="mt-1 text-xs text-slate-500">
            Quickly compare spend, conversions, and ROAS per platform.
          </p>
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Platform</th>
                  <th className="px-4 py-2 font-medium">Spend</th>
                  <th className="px-4 py-2 font-medium">Conversions</th>
                  <th className="px-4 py-2 font-medium">Revenue</th>
                  <th className="px-4 py-2 font-medium">ROAS</th>
                </tr>
              </thead>
              <tbody>
                {platformSummary.map((row) => (
                  <tr key={row.platform} className="border-t border-slate-100">
                    <td className="px-4 py-2 text-slate-700">{row.platform}</td>
                    <td className="px-4 py-2 tabular-nums">${row.spend.toFixed(0)}</td>
                    <td className="px-4 py-2 tabular-nums">{row.conversions.toFixed(0)}</td>
                    <td className="px-4 py-2 tabular-nums">${row.revenue.toFixed(0)}</td>
                    <td className="px-4 py-2 tabular-nums">{row.roas.toFixed(2)}x</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 className="text-sm font-medium text-slate-700">Best campaigns by ROAS</h2>
          <p className="mt-1 text-xs text-slate-500">
            Shows which campaigns across all platforms are currently driving the highest return on
            ad spend.
          </p>
          <div className="mt-4 space-y-3">
            {topCampaigns.map((c) => (
              <article
                key={c.id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-medium text-slate-800">{c.name}</h3>
                    <p className="text-xs text-slate-500">{c.platform}</p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums">{c.roas.toFixed(2)}x ROAS</p>
                </div>
                <div className="mt-3 h-2 w-full rounded-full bg-slate-100">
                  <div
                    className="h-2 rounded-full bg-emerald-500"
                    style={{ width: `${(c.roas / maxRoas) * 100}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
                  <span className="tabular-nums">Spend ${c.spend.toFixed(0)}</span>
                  <span className="tabular-nums">{c.conversions.toFixed(0)} conv.</span>
                  <span className="tabular-nums">Rev ${c.revenue.toFixed(0)}</span>
                </div>
              </article>
            ))}
            {topCampaigns.length === 0 && (
              <p className="text-sm text-slate-500">
                Once you have campaigns with spend and revenue, the best performers will appear
                here.
              </p>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}


