import { Package } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import {
  ASSET_LABELS,
  PACKAGE_STATUSES,
  PACKAGE_STATUS_LABELS,
  type AssetType,
  type PackageStatus,
} from "@/modules/communications/package";
import { listPackages } from "@/modules/communications/package.service";
import { ago, PACKAGE_STATUS_TONES } from "@/modules/communications/ui/labels";
import { requireActorOrRedirect } from "@/server/session";

export const metadata: Metadata = { title: "Communication packages · JOBHUNT OS" };
export const dynamic = "force-dynamic";

export default async function PackagesPage({ searchParams }: PageProps<"/communication-packages">) {
  const actor = await requireActorOrRedirect();
  const raw = (await searchParams).status;
  const status = PACKAGE_STATUSES.find((s) => s === raw) ?? null;
  const packages = await listPackages(actor, { status });
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Documents"
        title="Communication packages"
        description="The exact approved resume, email and cover letter prepared for one job, checked for readiness. A package that is ready for application is the input to the application step — it is never submitted or sent from here."
        actions={
          <Link href="/jobs" className={buttonClass("secondary", "sm")}>
            Start from a job
          </Link>
        }
      />
      <Alert tone="info" title="Ready for application ≠ applied">
        “Ready for application” means the assets are prepared and approved. Applications (Phase 8)
        are not part of this step.
      </Alert>
      <nav aria-label="Filter packages" className="flex flex-wrap gap-1.5">
        {[null, ...PACKAGE_STATUSES].map((s) => (
          <Link
            key={s ?? "all"}
            href={s ? `/communication-packages?status=${s}` : "/communication-packages"}
            aria-current={s === status ? "page" : undefined}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs",
              s === status
                ? "border-accent/40 bg-accent/10 text-accent"
                : "border-border text-fg-muted hover:text-fg",
            )}
          >
            {s ? PACKAGE_STATUS_LABELS[s] : "Active"}
          </Link>
        ))}
      </nav>
      <Card>
        <CardHeader
          title={status ? PACKAGE_STATUS_LABELS[status] : "Active packages"}
          description={`${packages.length} package${packages.length === 1 ? "" : "s"}`}
        />
        {packages.length === 0 ? (
          <EmptyState
            icon={<Package className="size-6" aria-hidden />}
            title="No packages here"
            description="Open a job and choose “Create communication package” once you have an approved resume (and email / cover letter if you want them)."
          />
        ) : (
          <ul className="divide-border divide-y">
            {packages.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0 text-sm">
                  <Link
                    href={`/communication-packages/${p.id}`}
                    className="text-fg font-medium hover:underline"
                  >
                    {p.title}
                  </Link>
                  <p className="text-fg-muted text-xs">
                    {p.channel === "EMAIL" ? "Email application" : "Portal application"} ·{" "}
                    {p.assets.map((a) => ASSET_LABELS[a.assetType as AssetType]).join(" + ") ||
                      "no assets"}{" "}
                    · updated {ago(p.updatedAt)}
                  </p>
                </div>
                <Badge tone={PACKAGE_STATUS_TONES[p.status as PackageStatus]}>
                  {PACKAGE_STATUS_LABELS[p.status as PackageStatus]}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
