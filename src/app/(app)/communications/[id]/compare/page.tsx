import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClass } from "@/components/ui/button";
import { Badge, PageHeader } from "@/components/ui/primitives";
import { isUuid } from "@/lib/ids";
import { compareCommunicationVersions } from "@/modules/communications/communication.service";
import { AppError } from "@/server/errors";
import { requireActorOrRedirect } from "@/server/session";

export const metadata: Metadata = { title: "Compare versions · JOBHUNT OS" };
export const dynamic = "force-dynamic";

const TONES = {
  ADDED: "success",
  REMOVED: "danger",
  CHANGED: "warning",
  REORDERED: "info",
  UNCHANGED: "neutral",
} as const;

export default async function ComparePage({
  params,
  searchParams,
}: PageProps<"/communications/[id]/compare">) {
  const actor = await requireActorOrRedirect();
  const { id } = await params;
  const sp = await searchParams;
  const from = typeof sp.from === "string" ? sp.from : "";
  const to = typeof sp.to === "string" ? sp.to : "";
  if (!isUuid(id) || !isUuid(from) || !isUuid(to)) notFound();
  let result;
  try {
    result = await compareCommunicationVersions(actor, from, to);
  } catch (error) {
    if (
      error instanceof AppError &&
      (error.code === "NOT_FOUND" || error.code === "VALIDATION_ERROR")
    )
      notFound();
    throw error;
  }
  if (result.communication.id !== id) notFound();
  const { entries, summary } = result;
  const changed = entries.filter((e) => e.kind !== "UNCHANGED");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Compare versions"
        title={result.communication.title}
        description={`v${result.from.versionNumber} → v${result.to.versionNumber} · ${summary.added} added · ${summary.removed} removed · ${summary.changed} changed · ${summary.reordered} reordered`}
        actions={
          <Link href={`/communications/${id}`} className={buttonClass("secondary", "sm")}>
            Back to communication
          </Link>
        }
      />
      {changed.length === 0 && <p className="text-fg-muted text-sm">No differences.</p>}
      <div className="flex flex-col gap-3">
        {entries.map((e, i) => (
          <div key={i} className="border-border rounded-lg border">
            <div className="border-border flex items-center gap-2 border-b px-3 py-1.5 text-xs">
              <Badge tone={TONES[e.kind]}>{e.kind.toLowerCase()}</Badge>
              <span className="text-fg-muted">{e.label}</span>
            </div>
            <div className="grid gap-0 text-sm md:grid-cols-2">
              <div className="border-border px-3 py-2 md:border-r">
                <p className="text-fg-subtle mb-1 text-[11px]">v{result.from.versionNumber}</p>
                {e.words ? (
                  <p className="whitespace-pre-wrap">
                    {e.words
                      .filter((w) => w.kind !== "added")
                      .map((w, j) => (
                        <span
                          key={j}
                          className={
                            w.kind === "removed" ? "bg-danger/15 text-danger line-through" : ""
                          }
                        >
                          {w.text}
                        </span>
                      ))}
                  </p>
                ) : (
                  <p
                    className={`whitespace-pre-wrap ${e.kind === "REMOVED" ? "bg-danger/10" : ""}`}
                  >
                    {e.before ?? "—"}
                  </p>
                )}
              </div>
              <div className="px-3 py-2">
                <p className="text-fg-subtle mb-1 text-[11px]">v{result.to.versionNumber}</p>
                {e.words ? (
                  <p className="whitespace-pre-wrap">
                    {e.words
                      .filter((w) => w.kind !== "removed")
                      .map((w, j) => (
                        <span
                          key={j}
                          className={w.kind === "added" ? "bg-success/15 text-success" : ""}
                        >
                          {w.text}
                        </span>
                      ))}
                  </p>
                ) : (
                  <p className={`whitespace-pre-wrap ${e.kind === "ADDED" ? "bg-success/10" : ""}`}>
                    {e.after ?? "—"}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
