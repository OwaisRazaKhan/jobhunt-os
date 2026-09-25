import { FileSearch, FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonClass } from "@/components/ui/button";
import { Alert, Badge, Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { optionLabel } from "@/modules/candidate/options";
import { FactSection, SkillsSection } from "@/modules/candidate/ui/fact-sections";
import {
  AboutCard,
  CandidateHeader,
  CompletenessCard,
  PreferencesCard,
  ReadinessCard,
  WarningsCard,
} from "@/modules/candidate/ui/profile-panels";
import { requireActorOrRedirect } from "@/server/session";
import { loadCandidate } from "./load";

export const metadata: Metadata = { title: "Candidate · JOBHUNT OS" };
export const dynamic = "force-dynamic";

const STATUS_TONE = {
  UPLOADED: "neutral",
  PROCESSING: "info",
  PROCESSED: "success",
  FAILED: "danger",
} as const;

export default async function CandidatePage() {
  const actor = await requireActorOrRedirect();
  const { overview, context, countryOptions } = await loadCandidate(actor);
  if (!overview.profile && overview.documents.length === 0) redirect("/welcome");

  return (
    <div className="flex flex-col gap-5">
      <CandidateHeader overview={overview} context={context} />

      {overview.pendingReview > 0 && (
        <Alert
          tone="warning"
          title={`${overview.pendingReview} extracted fact${overview.pendingReview === 1 ? "" : "s"} waiting for review`}
        >
          Nothing from your documents is added to your profile until you approve it.{" "}
          <Link href="/candidate/review" className="text-accent hover:underline">
            Open the review center →
          </Link>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-5">
          <AboutCard overview={overview} />
          <FactSection
            kind="experience"
            rows={overview.experiences}
            achievements={overview.achievements}
            context={context}
          />
          <FactSection kind="education" rows={overview.education} context={context} />
          <SkillsSection skills={overview.skills} context={context} />
          <FactSection kind="project" rows={overview.projects} context={context} />
          <FactSection
            kind="achievement"
            rows={overview.achievements.filter((a) => !a.experienceId)}
            context={context}
          />
          <FactSection kind="portfolio" rows={overview.portfolio} context={context} />
          <FactSection kind="certification" rows={overview.certifications} context={context} />
          <FactSection kind="language" rows={overview.languages} context={context} />
          <PreferencesCard overview={overview} countries={countryOptions} />
          <FactSection kind="authorization" rows={overview.authorizations} context={context} />
        </div>

        <aside className="flex flex-col gap-5 lg:sticky lg:top-6 lg:self-start">
          <ReadinessCard overview={overview} />
          <CompletenessCard overview={overview} />
          <WarningsCard overview={overview} />
          <Card id="documents">
            <CardHeader
              title="Documents"
              count={overview.documents.length}
              actions={
                <Link href="/candidate/documents" className={buttonClass("ghost", "sm")}>
                  <FileText className="size-3.5" aria-hidden /> Library
                </Link>
              }
            />
            {overview.documents.length === 0 ? (
              <EmptyState
                title="No documents yet"
                description="Import a CV to extract facts for review."
                action={
                  <Link href="/candidate/documents" className={buttonClass("secondary", "sm")}>
                    Import CV
                  </Link>
                }
              />
            ) : (
              <ul className="divide-border divide-y">
                {overview.documents.map((doc) => (
                  <li key={doc.id}>
                    <Link
                      href={`/candidate/documents/${doc.id}`}
                      className="hover:bg-surface-2 flex items-center justify-between gap-2 px-4 py-2 text-xs"
                    >
                      <span className="min-w-0">
                        <span className="text-fg block truncate">{doc.fileName}</span>
                        <span className="text-fg-subtle">{optionLabel(doc.documentType)}</span>
                      </span>
                      <Badge tone={STATUS_TONE[doc.status]}>{optionLabel(doc.status)}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Link href="/candidate/review" className={buttonClass("secondary", "md", "w-full")}>
            <FileSearch className="size-4" aria-hidden /> Fact review center
          </Link>
        </aside>
      </div>
    </div>
  );
}
