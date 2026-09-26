import { Mail } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  LIST_FILTERS,
  listCommunications,
  type ListFilter,
} from "@/modules/communications/communication.service";
import {
  SOURCE_LABELS,
  STATUS_LABELS,
  TYPE_LABELS,
  type CommunicationType,
  type ContentSource,
  type VersionStatus,
} from "@/modules/communications/types";
import { ago, SOURCE_TONES, STATUS_TONES } from "@/modules/communications/ui/labels";
import { requireActorOrRedirect } from "@/server/session";

export const metadata: Metadata = { title: "Communication Studio · JOBHUNT OS" };
export const dynamic = "force-dynamic";

const FILTER_LABELS: Record<ListFilter, string> = {
  all: "All",
  emails: "Emails",
  "cover-letters": "Cover letters",
  drafts: "Drafts",
  review: "Ready for review",
  approved: "Approved",
  archived: "Archived",
};

export default async function CommunicationsPage({ searchParams }: PageProps<"/communications">) {
  const actor = await requireActorOrRedirect();
  const raw = (await searchParams).filter;
  const filter = LIST_FILTERS.find((f) => f === raw) ?? "all";
  const items = await listCommunications(actor, filter);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Documents"
        title="Communication Studio"
        description="Application emails and cover letters prepared from your verified facts and sourced company research. Nothing is ever sent from here — you copy or export an approved version and send it yourself."
        actions={
          <>
            <Link href="/communications/new" className={buttonClass("primary", "sm")}>
              New email
            </Link>
            <Link
              href="/communications/new?kind=cover-letter"
              className={buttonClass("secondary", "sm")}
            >
              New cover letter
            </Link>
            <Link href="/communication-packages" className={buttonClass("secondary", "sm")}>
              Packages
            </Link>
            <Link href="/communications/recipients" className={buttonClass("ghost", "sm")}>
              Recipients
            </Link>
            <Link href="/communications/preferences" className={buttonClass("ghost", "sm")}>
              Preferences
            </Link>
            <Link href="/communications/signatures" className={buttonClass("ghost", "sm")}>
              Signatures
            </Link>
          </>
        }
      />

      <Alert tone="info" title="Prepared, never sent">
        JOBHUNT OS has no email connection. Communications are drafts you review, approve and
        export; statements are checked against your facts, and approved versions are locked.
      </Alert>

      <nav aria-label="Filter communications" className="flex flex-wrap gap-1.5">
        {LIST_FILTERS.map((f) => (
          <Link
            key={f}
            href={f === "all" ? "/communications" : `/communications?filter=${f}`}
            aria-current={f === filter ? "page" : undefined}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs",
              f === filter
                ? "border-accent/40 bg-accent/10 text-accent"
                : "border-border text-fg-muted hover:text-fg",
            )}
          >
            {FILTER_LABELS[f]}
          </Link>
        ))}
      </nav>

      <Card>
        <CardHeader
          title={FILTER_LABELS[filter]}
          description={`${items.length} communication${items.length === 1 ? "" : "s"}`}
        />
        {items.length === 0 ? (
          <EmptyState
            icon={<Mail className="size-6" aria-hidden />}
            title={filter === "all" ? "No communications yet" : "Nothing in this view"}
            description={
              filter === "all"
                ? "Emails and cover letters you prepare for a job will appear here, each with its full version history. Start from a job (Write application email / cover letter) or use the buttons above."
                : "Try another filter."
            }
          />
        ) : (
          <ul className="divide-border divide-y">
            {items.map((c) => {
              const v = c.currentVersion;
              return (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0 text-sm">
                    <Link
                      href={`/communications/${c.id}`}
                      className="text-fg truncate font-medium hover:underline"
                    >
                      {c.title}
                    </Link>
                    <p className="text-fg-muted text-xs">
                      {TYPE_LABELS[c.communicationType as CommunicationType]}
                      {c.job ? ` · ${c.job.title}` : ""}
                      {c.company ? ` · ${c.company.name}` : ""}
                      {c.recipientName ? ` · to ${c.recipientName}` : ""} · v{v?.versionNumber ?? 0}{" "}
                      · {c._count.versions} version
                      {c._count.versions === 1 ? "" : "s"} · updated {ago(c.updatedAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {v && (
                      <Badge tone={SOURCE_TONES[v.contentSource as ContentSource]}>
                        {SOURCE_LABELS[v.contentSource as ContentSource]}
                      </Badge>
                    )}
                    {c.status === "ARCHIVED" ? (
                      <Badge>Archived</Badge>
                    ) : (
                      v && (
                        <Badge tone={STATUS_TONES[v.status as VersionStatus]}>
                          {STATUS_LABELS[v.status as VersionStatus]}
                        </Badge>
                      )
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
