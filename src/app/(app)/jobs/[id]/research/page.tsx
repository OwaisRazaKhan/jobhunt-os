import { ArrowLeft, Building2, Download, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { z } from "zod";
import { buttonClass } from "@/components/ui/button";
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { getJobResearchView } from "@/modules/research/research.service";
import type { CompletenessDimension, Depth, JobBrief } from "@/modules/research/types";
import {
  DeleteNoteButton,
  ManualSourceForm,
  NoteForm,
  ResearchProgress,
  StartResearch,
} from "@/modules/research/ui/research-controls";
import {
  ClaimList,
  CompletenessList,
  day,
  ResearchStatusBadge,
  SafeUrl,
  SourcesTable,
  stamp,
  StatsGrid,
  type ClaimView,
} from "@/modules/research/ui/research-parts";
import { AppError } from "@/server/errors";
import { requireActorOrRedirect } from "@/server/session";

export const metadata: Metadata = { title: "Research · JOBHUNT OS" };
export const dynamic = "force-dynamic";
/** Research runs continue after the response (after()). */
export const maxDuration = 300;

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <div className="px-4 pb-2">{children}</div>
    </Card>
  );
}

function Missing() {
  return (
    <div className="flex flex-col gap-5">
      <Link href="/jobs" className={buttonClass("ghost", "sm", "self-start")}>
        <ArrowLeft className="size-3.5" aria-hidden /> All jobs
      </Link>
      <Card>
        <EmptyState
          icon={<SearchX className="size-6" />}
          title="Not found"
          description="This job or research version does not exist or is not yours."
        />
      </Card>
    </div>
  );
}

export default async function JobResearchPage({
  params,
  searchParams,
}: PageProps<"/jobs/[id]/research">) {
  const actor = await requireActorOrRedirect();
  const { id } = await params;
  const version = (await searchParams).version;
  if (!z.uuid().safeParse(id).success) return <Missing />;
  const versionId =
    typeof version === "string" && z.uuid().safeParse(version).success ? version : undefined;
  const view = await getJobResearchView(actor, id, versionId).catch((error) => {
    if (error instanceof AppError && error.code === "NOT_FOUND") return null;
    throw error;
  });
  if (!view) return <Missing />;
  const { job, research: r, companyResearch: c } = view;
  const claims = (r?.claims ?? []) as unknown as ClaimView[];
  const cClaims = (c?.claims ?? []) as unknown as ClaimView[];
  const of = (list: ClaimView[], ...sections: string[]) =>
    list.filter((x) => sections.includes(x.section) && x.verification !== "REJECTED");
  const brief = (r?.brief ?? {}) as Partial<JobBrief>;
  const cBrief = (c?.brief ?? {}) as {
    unknowns?: string[];
    officialLinks?: { kind: string; url: string }[];
  };
  const completeness =
    ((r?.completeness ?? {}) as { dimensions?: CompletenessDimension[] }).dimensions ?? [];
  const rejectedAi = claims.filter((x) => x.verification === "REJECTED");
  const depth = (r?.depth ?? view.policy.defaultDepth) as Depth;

  return (
    <div className="flex flex-col gap-5">
      <Link href={`/jobs/${job.id}`} className={buttonClass("ghost", "sm", "self-start")}>
        <ArrowLeft className="size-3.5" aria-hidden /> Back to job
      </Link>
      <PageHeader
        eyebrow={`Research · ${job.company.name}`}
        title={job.title}
        description="Evidence-first research: facts are quoted from sources, interpretations are labelled, unknowns stay unknown. Nothing here is written about you, and no resume or application text is produced."
        actions={
          <Link href={`/companies/${job.companyId}`} className={buttonClass("secondary", "sm")}>
            <Building2 className="size-3.5" aria-hidden /> Open company
          </Link>
        }
      />

      {view.activeRun && (
        <Card>
          <CardHeader
            title="Researching job…"
            description="Each step appears when it has actually been completed."
          />
          <div className="px-4 py-3">
            <ResearchProgress runId={view.activeRun.id} />
          </div>
        </Card>
      )}

      {!r && !view.activeRun && (
        <Card>
          <EmptyState
            icon={<SearchX className="size-6" />}
            title="Research not run"
            description="Research this job to collect evidence from the listing and the company's official sources."
            action={
              <StartResearch
                kind="job"
                targetId={job.id}
                defaultDepth={depth}
                label="Research this job"
              />
            }
          />
        </Card>
      )}

      {r && (
        <>
          {!r.isCurrent && (
            <Alert tone="info" title={`Viewing version ${r.version} (not current)`}>
              <Link href={`/jobs/${job.id}/research`} className="text-info hover:underline">
                Open the current version
              </Link>
            </Alert>
          )}
          {r.isCurrent && view.freshness.freshness === "STALE" && (
            <Alert tone="warning" title="This research is stale">
              {view.freshness.reasons.join(" · ")}. Refreshing keeps this version in the history.
            </Alert>
          )}
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_330px]">
            <div className="flex min-w-0 flex-col gap-5">
              <Section
                title="Company"
                description={
                  c
                    ? `Company research v${c.version} · ${day(c.researchedAt)}${c.id === view.companyCurrent?.id ? "" : " (an older company version)"}`
                    : "No company research"
                }
              >
                {c?.websiteUrl ? (
                  <p className="py-2 text-xs">
                    <span className="text-fg-muted">Official website: </span>
                    <SafeUrl url={c.websiteUrl} />{" "}
                    <Badge>{c.websiteConfidence.toLowerCase()}</Badge>
                  </p>
                ) : (
                  <Alert tone="warning">
                    Company website could not be confidently identified. Confirm it on the company
                    page.
                  </Alert>
                )}
                <ClaimList
                  claims={of(cClaims, "WHAT_THEY_DO", "MARKETS", "INDUSTRY")}
                  empty="What the company does could not be confirmed from the available sources."
                />
                <ClaimList claims={of(cClaims, "PRODUCTS")} />
              </Section>
              <Section
                title="Recent relevant activity"
                description="Dated announcements from official newsroom / blog and sources you added."
              >
                <ClaimList
                  claims={of(cClaims, "ACTIVITY")}
                  empty="No relevant recent public activity was found in the available sources."
                />
              </Section>
              {cClaims.some((x) => x.claimType === "CONFLICTING") && (
                <Section
                  title="Conflicting information"
                  description="Sources disagree. Every version is kept; nothing is chosen for you."
                >
                  <ClaimList claims={cClaims.filter((x) => x.claimType === "CONFLICTING")} />
                </Section>
              )}
              <Section title="Role" description="Quoted from the posting.">
                <ClaimList claims={of(claims, "ROLE_SUMMARY", "ROLE_PURPOSE")} />
              </Section>
              <Section title="Key responsibilities">
                <ClaimList
                  claims={of(claims, "RESPONSIBILITY")}
                  empty="No responsibilities section was found in the posting."
                  compact
                />
              </Section>
              <Section
                title="What the employer emphasizes"
                description="Interpretations derived from how often the posting mentions each theme."
              >
                <ClaimList claims={of(claims, "PRIORITY")} empty="No clear emphasis detected." />
              </Section>
              <Section
                title="Requirements & conditions"
                description="From the deterministic requirement extractor (Phase 4) with the posting's wording."
              >
                <ClaimList
                  claims={claims.filter((x) => x.section.startsWith("REQ_"))}
                  empty="No structured requirements were found."
                  compact
                />
              </Section>
              <Section title="Application instructions">
                <ClaimList
                  claims={of(claims, "APPLICATION")}
                  empty="No specific application instructions were found."
                  compact
                />
              </Section>
              <Section
                title="Important terminology"
                description="Employer terms from the posting (never added to your skills)."
              >
                <div className="flex flex-wrap gap-1 py-2">
                  {(brief.importantTerms ?? []).map((t) => (
                    <Badge key={t.term}>
                      {t.term} <span className="text-fg-subtle">×{t.count}</span>
                    </Badge>
                  ))}
                  {!brief.importantTerms?.length && (
                    <p className="text-fg-subtle text-xs">No notable terms.</p>
                  )}
                </div>
              </Section>
              <Section
                title="Relevant company context"
                description="Company evidence related to the role's focus (interpretation)."
              >
                <ClaimList claims={of(claims, "RELEVANT_CONTEXT", "MANUAL_SOURCE")} />
              </Section>
              {(of(claims, "AI_SYNTHESIS").length > 0 || rejectedAi.length > 0) && (
                <Section
                  title="AI synthesis"
                  description="Validated against the cited evidence. Kept claims are pending your review; unsupported claims are rejected."
                >
                  <ClaimList
                    claims={of(claims, "AI_SYNTHESIS")}
                    empty="No AI claims passed validation."
                  />
                  {rejectedAi.length > 0 && (
                    <details className="py-2">
                      <summary className="text-fg-muted cursor-pointer text-xs">
                        Rejected AI claims ({rejectedAi.length})
                      </summary>
                      <ClaimList claims={rejectedAi} compact />
                    </details>
                  )}
                </Section>
              )}
              <Section title="Unknown / needs verification">
                <ul className="text-fg-muted list-disc py-2 pl-4 text-xs">
                  {[...(brief.openQuestions ?? []), ...(cBrief.unknowns ?? [])].map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </Section>
              <Card>
                <CardHeader
                  title="Sources (this run)"
                  description="Every source attempted, including failures and why."
                />
                <SourcesTable rows={view.runSources as never} />
              </Card>
            </div>

            <div className="flex flex-col gap-5">
              <Card>
                <CardHeader title="Status" />
                <div className="flex flex-col gap-3 px-4 py-3">
                  <ResearchStatusBadge
                    status={r.status}
                    freshness={r.isCurrent ? view.freshness.freshness : undefined}
                  />
                  <p className="text-fg-subtle font-mono text-[11px]">
                    Job research v{r.version} · {r.depth.toLowerCase()} · {stamp(r.researchedAt)}
                    {r.companyResearchVersion
                      ? ` · company v${r.companyResearchVersion}`
                      : ""} · {r.engineVersion}
                  </p>
                  <StatsGrid stats={r.stats as never} />
                  {r.isCurrent && !view.activeRun && (
                    <StartResearch
                      kind="refresh"
                      targetId={job.id}
                      researchId={r.id}
                      defaultDepth={depth}
                      label="Refresh research"
                      showRefreshCompany
                      variant={view.freshness.freshness === "STALE" ? "primary" : "secondary"}
                    />
                  )}
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={`/api/v1/research/jobs/${job.id}/export?format=md`}
                      className={buttonClass("ghost", "sm")}
                    >
                      <Download className="size-3.5" aria-hidden /> Markdown
                    </a>
                    <a
                      href={`/api/v1/research/jobs/${job.id}/export?format=json`}
                      className={buttonClass("ghost", "sm")}
                    >
                      <Download className="size-3.5" aria-hidden /> JSON
                    </a>
                  </div>
                </div>
              </Card>
              <Card>
                <CardHeader
                  title="Completeness"
                  description="Deterministic checklist — not a score."
                />
                <div className="px-4 py-3">
                  <CompletenessList dimensions={completeness} />
                </div>
              </Card>
              <Card>
                <CardHeader title="History" description="Every research version is kept." />
                <ul className="divide-border divide-y">
                  {view.history.map((h) => {
                    const ch = h.changes as {
                      firstVersion?: boolean;
                      added?: number;
                      removed?: number;
                    };
                    return (
                      <li key={h.id} className="px-4 py-2 text-xs">
                        <Link
                          href={
                            h.isCurrent
                              ? `/jobs/${job.id}/research`
                              : `/jobs/${job.id}/research?version=${h.id}`
                          }
                          className="flex justify-between gap-2 hover:underline"
                        >
                          <span className="text-fg">
                            v{h.version} · {h.status.toLowerCase().replace("_", " ")}
                          </span>
                          <span className="text-fg-subtle font-mono text-[11px]">
                            {day(h.researchedAt)}
                          </span>
                        </Link>
                        <span className="text-fg-subtle flex items-center gap-1 font-mono text-[11px]">
                          {h.depth.toLowerCase()}
                          {ch.firstVersion
                            ? " · first version"
                            : ` · +${ch.added ?? 0} / −${ch.removed ?? 0} claims`}
                          {h.isCurrent && <Badge tone="accent">current</Badge>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </Card>
              <Card>
                <CardHeader
                  title="Add a source"
                  description="A public page you found (e.g. an official announcement)."
                />
                <div className="flex flex-col gap-2 px-4 py-3">
                  <ManualSourceForm jobId={job.id} />
                  {view.manualSources.length > 0 && (
                    <ul className="flex flex-col gap-1 text-xs">
                      {view.manualSources.map((s) => (
                        <li key={s.id}>
                          <SafeUrl url={s.url} label={s.title ?? undefined} />
                          <span className="text-fg-subtle block font-mono text-[11px]">
                            {s.fetchStatus.toLowerCase()} · added {day(s.addedAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Card>
              <Card>
                <CardHeader
                  title="Private notes"
                  description="USER_NOTE — only you can see these."
                />
                <div className="flex flex-col gap-2 px-4 py-3">
                  <NoteForm jobId={job.id} />
                  <ul className="divide-border divide-y">
                    {view.notes.map((n) => (
                      <li key={n.id} className="py-2 text-xs">
                        <Badge>User note</Badge>
                        <p className="text-fg mt-1 break-words whitespace-pre-wrap">{n.body}</p>
                        <div className="flex items-center justify-between">
                          <span className="text-fg-subtle font-mono text-[11px]">
                            {stamp(n.createdAt)}
                          </span>
                          <DeleteNoteButton noteId={n.id} jobId={job.id} />
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
