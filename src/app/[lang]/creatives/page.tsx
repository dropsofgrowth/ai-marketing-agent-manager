import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { CreativePreview } from "@/components/creatives/creative-preview";
import { GenerateCreativeForm } from "@/components/creatives/generate-form";
import { PublishDialog } from "@/components/creatives/publish-dialog";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import type { CreativeStatus } from "@/domain/types";
import { getI18n, type ServerI18n } from "@/i18n/server";
import { getIntegrations } from "@/integrations/registry";
import { getCurrentActor } from "@/server/auth/actor";
import { getStore } from "@/server/store";

export async function generateMetadata({ params }: PageProps<"/[lang]/creatives">): Promise<Metadata> {
  return { title: getI18n((await params).lang).dict.creatives.title };
}

const STATUS_TONE: Record<CreativeStatus, BadgeTone> = {
  DRAFT: "neutral",
  GENERATING: "accent",
  READY: "good",
  PENDING_APPROVAL: "warning",
  APPROVED: "accent",
  PUBLISHED: "good",
  FAILED: "critical",
};

export default async function CreativesPage({ params }: PageProps<"/[lang]/creatives">) {
  const i18n = getI18n((await params).lang);
  const { dict } = i18n;
  return (
    <>
      <PageHeader title={dict.creatives.title} description={dict.creatives.subtitle} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <Card className="self-start">
          <CardHeader title={dict.creatives.generateTitle} />
          <CardBody className="space-y-4">
            <Notice tone="warning">{dict.creatives.mockNotice}</Notice>
            <GenerateCreativeForm />
          </CardBody>
        </Card>
        <section aria-labelledby="library-title">
          <h2 id="library-title" className="mb-4 text-[15px] font-semibold text-ink">
            {dict.creatives.library}
          </h2>
          <Suspense
            fallback={
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 3 }, (_, i) => (
                  <Skeleton key={i} className="h-80 rounded-xl" />
                ))}
              </div>
            }
          >
            <CreativeLibrary i18n={i18n} />
          </Suspense>
        </section>
      </div>
    </>
  );
}

async function CreativeLibrary({ i18n }: { i18n: ServerI18n }) {
  await connection();
  const now = new Date();
  const { dict, fmt } = i18n;
  const actor = await getCurrentActor();
  const [creatives, campaigns] = await Promise.all([
    getStore().creatives.list(actor.workspaceId),
    getIntegrations().metaAds.listCampaigns(),
  ]);
  const publishTargets = campaigns.filter((c) => c.status !== "ARCHIVED").map((c) => ({ id: c.id, name: c.name }));

  if (creatives.length === 0) {
    return <p className="rounded-xl border border-dashed border-line-strong p-10 text-center text-sm text-ink-2">{dict.creatives.empty}</p>;
  }

  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {creatives.map((creative) => (
        <li key={creative.id}>
          <Card as="article" className="flex h-full flex-col overflow-hidden">
            <div className="bg-surface-2 p-3">
              <CreativePreview
                seedKey={creative.id}
                format={creative.format}
                aspectRatio={creative.aspectRatio}
                headline={creative.headline}
                label={dict.creatives.mockPreview}
                className="mx-auto max-h-64 max-w-full"
              />
            </div>
            <div className="flex flex-1 flex-col gap-3 p-4">
              <div className="space-y-1.5">
                <Badge tone={STATUS_TONE[creative.status]}>{dict.creatives.status[creative.status]}</Badge>
                <h3 className="text-sm font-semibold text-ink">{creative.title}</h3>
              </div>
              <p dir="auto" className="line-clamp-3 text-start text-xs text-ink-2">
                {creative.prompt}
              </p>
              <p className="text-xs text-ink-3">
                {dict.creatives.format[creative.format]} · <bdi>{creative.aspectRatio}</bdi> · {fmt.relative(creative.createdAt, now)}
              </p>
              {creative.status === "READY" ? (
                <div className="mt-auto pt-1">
                  <PublishDialog creative={{ id: creative.id, title: creative.title }} campaigns={publishTargets} />
                </div>
              ) : null}
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}
