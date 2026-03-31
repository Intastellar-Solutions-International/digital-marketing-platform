import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { AdPlatform } from "@prisma/client";
import { prisma } from "~/services/prisma.server";
import { runSyncForConnection } from "~/services/sync-jobs.server";

type LoaderData = {
  tenantExists: boolean;
  connections: {
    id: string;
    platform: AdPlatform;
    externalAccountId: string;
    externalAccountName: string;
    status: string;
    lastSyncAt: string | null;
  }[];
};

export async function loader({ request }: LoaderFunctionArgs) {
  // TODO: use authenticated tenant; for now just pick the first one
  const tenant = await prisma.tenant.findFirst();

  if (!tenant) {
    return json<LoaderData>({
      tenantExists: false,
      connections: [],
    });
  }

  const connections = await prisma.adAccountConnection.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: "desc" },
  });

  return json<LoaderData>({
    tenantExists: true,
    connections: connections.map((c) => ({
      id: c.id,
      platform: c.platform,
      externalAccountId: c.externalAccountId,
      externalAccountName: c.externalAccountName,
      status: c.status,
      lastSyncAt: c.lastSyncAt ? c.lastSyncAt.toISOString() : null,
    })),
  });
}

type ActionData = {
  error?: string;
};

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const intent = formData.get("_intent");

  // TODO: use authenticated tenant; for now just pick the first one
  const tenant = await prisma.tenant.findFirst();
  if (!tenant) {
    return json<ActionData>({ error: "No tenant found. Create a tenant first." }, { status: 400 });
  }

  if (intent === "sync") {
    const connectionId = formData.get("connectionId");
    if (!connectionId) {
      return json<ActionData>({ error: "Missing connection id." }, { status: 400 });
    }

    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate() - 3);

    try {
      await runSyncForConnection(String(connectionId), start, now);
      return redirect("/integrations");
    } catch (error) {
      return json<ActionData>(
        {
          error:
            error instanceof Error
              ? `Sync failed: ${error.message}`
              : "Sync failed due to an unknown error.",
        },
        { status: 500 },
      );
    }
  }

  if (intent === "create") {
    const platform = formData.get("platform");
    const externalAccountId = formData.get("externalAccountId");
    const externalAccountName = formData.get("externalAccountName");
    const currency = formData.get("currency");
    const timezone = formData.get("timezone");

    if (
      !platform ||
      !externalAccountId ||
      !externalAccountName ||
      !currency ||
      !timezone
    ) {
      return json<ActionData>({ error: "All fields are required." }, { status: 400 });
    }

    await prisma.adAccountConnection.create({
      data: {
        tenantId: tenant.id,
        platform: platform as AdPlatform,
        externalAccountId: String(externalAccountId),
        externalAccountName: String(externalAccountName),
        currency: String(currency),
        timezone: String(timezone),
        status: "active",
      },
    });

    return redirect("/integrations");
  }

  return json<ActionData>({ error: "Unknown action." }, { status: 400 });
}

export default function IntegrationsRoute() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();

  if (!data.tenantExists) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold">Connect your ad platforms</h1>
        <p className="mt-3 text-sm text-slate-600">
          You need to create a workspace (tenant) before connecting Facebook, Google, Microsoft,
          Capterra, or LinkedIn ad accounts.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl space-y-10 p-8">
      <header>
        <h1 className="text-2xl font-semibold">Ad platform connections</h1>
        <p className="mt-2 text-sm text-slate-600">
          Connect your advertising accounts so we can pull campaign performance into your unified
          dashboard. In a later step these forms will be replaced with full OAuth flows.
        </p>
      </header>

      <section className="grid gap-8 md:grid-cols-2">
        <div>
          <h2 className="text-sm font-medium text-slate-700">Existing connections</h2>
          <p className="mt-1 text-xs text-slate-500">
            Each connection links one external ad account to this workspace.
          </p>
          <div className="mt-4 space-y-3">
            {data.connections.map((c) => (
              <article
                key={c.id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      {c.externalAccountName}
                    </p>
                    <p className="text-xs text-slate-500">
                      {c.platform} · {c.externalAccountId}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-medium ${
                      c.status === "active"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {c.status}
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Last sync:{" "}
                  {c.lastSyncAt
                    ? new Date(c.lastSyncAt).toLocaleString()
                    : "Not synced yet"}
                </p>
                <Form method="post" className="mt-3">
                  <input type="hidden" name="_intent" value="sync" />
                  <input type="hidden" name="connectionId" value={c.id} />
                  <button
                    type="submit"
                    className="inline-flex items-center justify-center rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1"
                  >
                    Sync now
                  </button>
                </Form>
              </article>
            ))}
            {data.connections.length === 0 && (
              <p className="text-sm text-slate-500">
                No connections yet. Use the form on the right to add your first ad account.
              </p>
            )}
          </div>
        </div>

        <div>
          <h2 className="text-sm font-medium text-slate-700">Add a new connection</h2>
          <p className="mt-1 text-xs text-slate-500">
            Choose a platform and provide basic account details. For production, this will redirect
            you through the official OAuth consent screen of each provider.
          </p>

          <Form method="post" className="mt-4 space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <input type="hidden" name="_intent" value="create" />

            {actionData?.error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
                {actionData.error}
              </p>
            )}

            <div className="space-y-1">
              <label htmlFor="platform" className="text-xs font-medium text-slate-700">
                Platform
              </label>
              <select
                id="platform"
                name="platform"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
                defaultValue={AdPlatform.FACEBOOK}
              >
                <option value={AdPlatform.FACEBOOK}>Facebook Ads</option>
                <option value={AdPlatform.GOOGLE}>Google Ads</option>
                <option value={AdPlatform.MICROSOFT}>Microsoft Ads</option>
                <option value={AdPlatform.CAPTERRA}>Capterra Ads</option>
                <option value={AdPlatform.LINKEDIN}>LinkedIn Campaigns</option>
              </select>
            </div>

            <div className="space-y-1">
              <label
                htmlFor="externalAccountName"
                className="text-xs font-medium text-slate-700"
              >
                Account name
              </label>
              <input
                id="externalAccountName"
                name="externalAccountName"
                type="text"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
                placeholder="e.g. Main Google Ads account"
                required
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="externalAccountId"
                className="text-xs font-medium text-slate-700"
              >
                External account ID
              </label>
              <input
                id="externalAccountId"
                name="externalAccountId"
                type="text"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
                placeholder="e.g. 123-456-7890"
                required
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="currency" className="text-xs font-medium text-slate-700">
                Currency
              </label>
              <input
                id="currency"
                name="currency"
                type="text"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
                placeholder="e.g. USD, EUR"
                required
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="timezone" className="text-xs font-medium text-slate-700">
                Timezone
              </label>
              <input
                id="timezone"
                name="timezone"
                type="text"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
                placeholder="e.g. Europe/Berlin"
                required
              />
            </div>

            <button
              type="submit"
              className="mt-2 inline-flex w-full items-center justify-center rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1"
            >
              Connect account
            </button>
          </Form>
        </div>
      </section>
    </main>
  );
}

