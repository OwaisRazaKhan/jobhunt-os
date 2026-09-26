import { ArrowLeft, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { z } from "zod";
import { buttonClass } from "@/components/ui/button";
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { countryName } from "@/modules/candidate/labels";
import { optionLabel } from "@/modules/candidate/options";
import { getCompanyResearchView } from "@/modules/research/research.service";
import type { CompletenessDimension, Depth } from "@/modules/research/types";
import {
  CompanyTargetForm,
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

export const metadata: Metadata = { title: "Company · JOBHUNT OS" };
export const dynamic = "force-dynamic";
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
      <Link href="/companies" className={buttonClass("ghost", "sm", "self-start")}>
        <ArrowLeft className="size-3.5" aria-hidden /> All companies
      </Link>
      <Card>
        <EmptyState
          icon={<SearchX className="size-6" />}
          title="Company not found"
          description="This company does not exist or has no jobs you can see."
        />
      </Card>
    </div>
  );
}

export default async function CompanyPage({ params, searchParams }: PageProps<"/companies/[id]">) {
  const actor = await requireActorOrRedirect();
  const { id } = await params;
  const version = (await searchParams).version;
  if (!z.uuid().safeParse(id).success) return <Missing />;
  const versionId =
    typeof version === "string" && z.uuid().safeParse(version).success ? version : undefined;
  const view = await getCompanyResearchView(actor, id, versionId).catch((error) => {
    if (error instanceof AppError && error.code === "NOT_FOUND") return null;
    throw error;
  });
  if (!view) return <Missing />;
  const { company, research: r } = view;
  const claims = (r?.claims ?? []) as unknown as ClaimView[];
  const of = (...sections: string[]) =>
    claims.filter((c) => sections.includes(c.section) && c.verification !== "REJECTED");
  const brief = (r?.brief ?? {}) as {
    unknowns?: string[];
    officialLinks?: { kind: string; url: string }[];
  };
  const completeness =
    ((r?.completeness ?? {}) as { dimensions?: CompletenessDimension[] }).dimensions ?? [];
  const depth = (r?.depth ?? view.policy.defaultDepth) as Depth;
  // Website shown with where it came from: you, the shared catalog, or the last research run.
  const website = view.target?.websiteUrl ?? company.officialWebsite ?? r?.websiteUrl ?? null;
  const websiteLabel = view.target?.websiteUrl
    ? "confirmed by you"
    : company.officialWebsite
      ? `${company.websiteConfidence.toLowerCase()} · from ${company.websiteSource?.toLowerCase().replace("_", " ")}`
      : `${r?.websiteConfidence.toLowerCase()} · used by your last research (from the job URL)`;
  const current = r?.isCurrent && ["FRESH", "AGING"].includes(view.freshness.freshness);

  return (
    <div className="flex flex-col gap-5">
      <Link href="/companies" className={buttonClass("ghost", "sm", "self-start")}>
        <ArrowLeft className="size-3.5" aria-hidden /> All companies
      </Link>
      <PageHeader
        eyebrow="Company"
        title={company.name}
        description={
          website ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <SafeUrl url={website} />
              <Badge>{websiteLabel}</Badge>
            </span>
          ) : (
            <span className="text-warning">
              Company website could not be confidently identified.
            </span>
          )
        }
      />
      {view.similar.length > 0 && (
        <Alert tone="info" title="Company match uncertain">
          Similar names exist and were not merged:{" "}
          {view.similar.map((s, i) => (
            <span key={s.id}>
              {i > 0 && ", "}
              <Link href={`/companies/${s.id}`} className="text-info hover:underline">
                {s.name}
              </Link>
            </span>
          ))}
          . Jobs are never moved between companies automatically.
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_330px]">
        <div className="flex min-w-0 flex-col gap-5">
          {view.activeRun && (
            <Card>
              <CardHeader title="Researching…" />
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
                description="Research this company from its official sources. The result is reused for all your jobs here."
                action={
                  <StartResearch
                    kind="company"
                    targetId={company.id}
                    defaultDepth={depth}
                    label="Research company"
                  />
                }
              />
            </Card>
          )}
          {r && (
            <>
              {!r.isCurrent && (
                <Alert tone="info" title={`Viewing version ${r.version} (not current)`}>
                  <Link href={`/companies/${company.id}`} className="text-info hover:underline">
                    Open the current version
                  </Link>
                </Alert>
              )}
              {r.isCurrent && view.freshness.freshness === "STALE" && (
                <Alert tone="warning" title="This research is stale">
                  {view.freshness.reasons.join(" · ")}
                </Alert>
              )}
              <Section title="Summary" description="What the sources say the company does.">
                <ClaimList
                  claims={of("WHAT_THEY_DO", "MARKETS")}
                  empty="What the company does could not be confirmed from the available sources."
                />
              </Section>
              <Section
                title="Industry & facts"
                description="Only when a source states them — never estimated."
              >
                <ClaimList
                  claims={of("INDUSTRY", "FACTS")}
                  empty="No structured facts were stated in the sources."
                />
              </Section>
              {claims.some((c) => c.claimType === "CONFLICTING") && (
                <Section
                  title="Conflicting information"
                  description="Sources disagree. Both are kept; higher-quality sources are listed first in each evidence drawer."
                >
                  <ClaimList claims={claims.filter((c) => c.claimType === "CONFLICTING")} />
                </Section>
              )}
              <Section title="Products & services">
                <ClaimList
                  claims={of("PRODUCTS")}
                  empty="No products or services were listed on the fetched official pages."
                  compact
                />
              </Section>
              <Section
                title="Relevant activity"
                description="Dated items; older than 12 months are marked historical."
              >
                <ClaimList
                  claims={of("ACTIVITY")}
                  empty="No relevant recent public activity was found in the available sources."
                />
              </Section>
              <Section
                title="Signals"
                description="Interpretations from official headings and headlines."
              >
                <ClaimList
                  claims={of("TECHNOLOGY_SIGNAL", "MARKETING_SIGNAL", "GROWTH_SIGNAL")}
                  empty="No signals detected."
                />
              </Section>
              {of("AI_SYNTHESIS").length > 0 && (
                <Section
                  title="AI synthesis"
                  description="Pending your review; validated against cited evidence."
                >
                  <ClaimList claims={of("AI_SYNTHESIS")} />
                </Section>
              )}
              <Section title="Unknown / needs verification">
                <ul className="text-fg-muted list-disc py-2 pl-4 text-xs">
                  {(brief.unknowns ?? []).map((u) => (
                    <li key={u}>{u}</li>
                  ))}
                </ul>
              </Section>
              <Card>
                <CardHeader title="Sources (this research run)" />
                <SourcesTable rows={view.runSources as never} />
              </Card>
            </>
          )}
          <Card>
            <CardHeader title={`Jobs from ${company.name} (${view.jobs.length})`} />
            {view.jobs.length === 0 ? (
              <p className="text-fg-muted px-4 py-3 text-xs">No jobs.</p>
            ) : (
              <ul className="divide-border divide-y">
                {view.jobs.map((j) => (
                  <li
                    key={j.id}
                    className="flex flex-col gap-0.5 px-4 py-2 text-xs sm:flex-row sm:items-center sm:justify-between"
                  >
                    <Link href={`/jobs/${j.id}`} className="text-fg font-medium hover:underline">
                      {j.title}
                    </Link>
                    <span className="text-fg-muted">
                      {[j.city ?? j.locationRaw, j.countryCode ? countryName(j.countryCode) : null]
                        .filter(Boolean)
                        .join(", ")}{" "}
                      · {optionLabel(j.remoteStatus)} · {optionLabel(j.employmentType)} ·{" "}
                      {j.status.toLowerCase()} · {j.postedAt ? day(j.postedAt) : "posted —"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          {r && (
            <Card>
              <CardHeader title="Research status" />
              <div className="flex flex-col gap-3 px-4 py-3">
                <ResearchStatusBadge
                  status={r.status}
                  freshness={r.isCurrent ? view.freshness.freshness : undefined}
                />
                <p className="text-fg-subtle font-mono text-[11px]">
                  v{r.version} · {r.depth.toLowerCase()} · last research {stamp(r.researchedAt)}
                </p>
                <StatsGrid stats={r.stats as never} />
                {current && <Badge tone="success">Current research available</Badge>}
                {r.isCurrent && !view.activeRun && (
                  <StartResearch
                    kind="refresh"
                    targetId={company.id}
                    researchId={r.id}
                    defaultDepth={depth}
                    label={current ? "Refresh anyway" : "Refresh research"}
                    variant={current ? "secondary" : "primary"}
                  />
                )}
              </div>
            </Card>
          )}
          {r && completeness.length > 0 && (
            <Card>
              <CardHeader
                title="Completeness"
                description="Deterministic checklist — not a score."
              />
              <div className="px-4 py-3">
                <CompletenessList dimensions={completeness} />
              </div>
            </Card>
          )}
          <Card>
            <CardHeader
              title="Website & careers page"
              description="Confirm the official website when it is unknown or wrong."
            />
            <div className="px-4 py-3">
              <CompanyTargetForm
                companyId={company.id}
                websiteUrl={view.target?.websiteUrl ?? ""}
                careersUrl={view.target?.careersUrl ?? ""}
              />
            </div>
          </Card>
          {brief.officialLinks && brief.officialLinks.length > 0 && (
            <Card>
              <CardHeader title="Official links (fetched)" />
              <ul className="flex flex-col gap-1 px-4 py-3 text-xs">
                {brief.officialLinks.map((l) => (
                  <li key={l.url}>
                    <SafeUrl url={l.url} />{" "}
                    <span className="text-fg-subtle">
                      {l.kind.replace("OFFICIAL_", "").toLowerCase()}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {view.history.length > 0 && (
            <Card>
              <CardHeader title="History" />
              <ul className="divide-border divide-y">
                {view.history.map((h) => (
                  <li key={h.id} className="px-4 py-2 text-xs">
                    <Link
                      href={
                        h.isCurrent
                          ? `/companies/${company.id}`
                          : `/companies/${company.id}?version=${h.id}`
                      }
                      className="flex justify-between hover:underline"
                    >
                      <span className="text-fg">
                        v{h.version} · {h.status.toLowerCase().replace("_", " ")}
                      </span>
                      <span className="text-fg-subtle font-mono text-[11px]">
                        {day(h.researchedAt)}
                      </span>
                    </Link>
                    {h.isCurrent && <Badge tone="accent">current</Badge>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <CardHeader title="Add a source" />
            <div className="flex flex-col gap-2 px-4 py-3">
              <ManualSourceForm companyId={company.id} />
              {view.manualSources.map((s) => (
                <p key={s.id} className="text-xs">
                  <SafeUrl url={s.url} label={s.title ?? undefined} />
                  <span className="text-fg-subtle block font-mono text-[11px]">
                    {s.fetchStatus.toLowerCase()} · added {day(s.addedAt)}
                  </span>
                </p>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader title="Private notes" description="USER_NOTE — only you can see these." />
            <div className="flex flex-col gap-2 px-4 py-3">
              <NoteForm companyId={company.id} />
              <ul className="divide-border divide-y">
                {view.notes.map((n) => (
                  <li key={n.id} className="py-2 text-xs">
                    <Badge>User note</Badge>
                    <p className="text-fg mt-1 break-words whitespace-pre-wrap">{n.body}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-fg-subtle font-mono text-[11px]">
                        {stamp(n.createdAt)}
                      </span>
                      <DeleteNoteButton noteId={n.id} companyId={company.id} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
