import { ArrowRight, Building2, FileSearch } from "lucide-react";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Alert, Badge, Card, CardHeader } from "@/components/ui/primitives";
import type { getJobResearchView } from "../research.service";
import type { BriefItem, Depth, JobBrief } from "../types";
import { ResearchProgress, StartResearch } from "./research-controls";
import { day, ResearchStatusBadge } from "./research-parts";

type View = Awaited<ReturnType<typeof getJobResearchView>>;

function Items({
  title,
  items,
  max = 3,
}: {
  title: string;
  items: BriefItem[] | undefined;
  max?: number;
}) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="text-fg-muted mb-0.5 text-[11px] font-medium">{title}</p>
      <ul className="flex flex-col gap-0.5 text-xs">
        {items.slice(0, max).map((i) => (
          <li key={i.claimIds[0] ?? i.text} className="text-fg break-words">
            {i.type === "INTERPRETATION" && <span className="text-info">interpretation · </span>}
            {i.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Job Detail → Research card. Everything shown comes from stored research + claims. */
export function ResearchCard({
  view,
  problem,
}: {
  view: View | null;
  problem?: "migration" | "error" | null;
}) {
  const header = (
    <CardHeader
      title="Research"
      description="Evidence from the job listing and the company's own sources."
    />
  );
  if (problem || !view)
    return (
      <Card>
        {header}
        <div className="px-4 py-3">
          <Alert tone="warning">
            {problem === "migration"
              ? "The database needs an update. Run npm run db:migrate:deploy, then reload."
              : "Research could not be loaded right now. Your data is safe — please try again."}
          </Alert>
        </div>
      </Card>
    );
  const depth = view.policy.defaultDepth as Depth;
  if (view.activeRun)
    return (
      <Card>
        {header}
        <div className="px-4 py-3">
          <p className="text-fg mb-2 text-xs font-medium">Researching job…</p>
          <ResearchProgress runId={view.activeRun.id} />
        </div>
      </Card>
    );
  const r = view.research;
  if (!r)
    return (
      <Card>
        {header}
        <div className="flex flex-col gap-3 px-4 py-3">
          <ResearchStatusBadge status="NOT_STARTED" />
          <p className="text-fg-muted text-xs">
            Research reads the job listing and the company&apos;s official pages, stores every claim
            with its source, and marks unknowns as unknown. It never writes resumes or applications.
          </p>
          <StartResearch
            kind="job"
            targetId={view.job.id}
            defaultDepth={depth}
            label="Research this job"
          />
        </div>
      </Card>
    );
  const brief = r.brief as Partial<JobBrief>;
  const stats = r.stats as Record<string, number>;
  return (
    <Card>
      {header}
      <div className="flex flex-col gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ResearchStatusBadge status={r.status} freshness={view.freshness.freshness} />
          <span className="text-fg-subtle font-mono text-[11px]">
            v{r.version} · {day(r.researchedAt)}
          </span>
        </div>
        {view.freshness.freshness === "STALE" && (
          <Alert tone="warning" title="Stale research">
            {view.freshness.reasons.join(" · ")}
          </Alert>
        )}
        <p className="text-xs">
          <span className="text-fg-muted">Company: </span>
          <Link href={`/companies/${view.job.companyId}`} className="text-fg hover:underline">
            {view.job.company.name}
          </Link>
          {view.companyResearch?.websiteUrl ? (
            <span className="text-fg-subtle">
              {" "}
              · {view.companyResearch.websiteUrl.replace(/^https?:\/\//, "")} (
              {view.companyResearch.websiteConfidence.toLowerCase()})
            </span>
          ) : (
            <span className="text-warning block">
              Company website could not be confidently identified.
            </span>
          )}
        </p>
        <Items title="Role" items={brief.roleSummary} max={1} />
        <Items
          title="Why the role exists (as stated)"
          items={brief.rolePurpose?.filter(
            (i) => i.type !== "UNKNOWN" && !brief.roleSummary?.some((s) => s.text === i.text),
          )}
          max={2}
        />
        <Items title="Role priorities" items={brief.rolePriorities} />
        <Items
          title="Relevant company context"
          items={brief.relevantPublicContext?.filter((i) => i.type !== "UNKNOWN")}
          max={2}
        />
        {brief.importantTerms && brief.importantTerms.length > 0 && (
          <div>
            <p className="text-fg-muted mb-1 text-[11px] font-medium">
              Important terms (from the posting)
            </p>
            <div className="flex flex-wrap gap-1">
              {brief.importantTerms.slice(0, 10).map((t) => (
                <Badge key={t.term}>
                  {t.term} <span className="text-fg-subtle">×{t.count}</span>
                </Badge>
              ))}
            </div>
          </div>
        )}
        {brief.openQuestions && brief.openQuestions.length > 0 && (
          <div>
            <p className="text-fg-muted mb-0.5 text-[11px] font-medium">
              Unknown / needs verification
            </p>
            <ul className="text-fg-muted list-disc pl-4 text-xs">
              {brief.openQuestions.slice(0, 4).map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-fg-subtle font-mono text-[11px]">
          {stats.sourcesFound ?? 0} sources ({stats.authoritative ?? 0} authoritative) ·{" "}
          {stats.claimsVerified ?? 0} claims verified · {stats.conflicts ?? 0} conflicts ·{" "}
          {r.depth.toLowerCase()}
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href={`/jobs/${view.job.id}/research`} className={buttonClass("secondary", "sm")}>
            <FileSearch className="size-3.5" aria-hidden /> View sources & evidence{" "}
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
          <Link href={`/companies/${view.job.companyId}`} className={buttonClass("ghost", "sm")}>
            <Building2 className="size-3.5" aria-hidden /> Open company
          </Link>
        </div>
        <StartResearch
          kind="refresh"
          targetId={view.job.id}
          researchId={r.id}
          defaultDepth={r.depth as Depth}
          label="Refresh research"
          showRefreshCompany
          variant={view.freshness.freshness === "STALE" ? "primary" : "secondary"}
        />
      </div>
    </Card>
  );
}
