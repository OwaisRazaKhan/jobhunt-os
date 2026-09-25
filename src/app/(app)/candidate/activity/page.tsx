import type { Metadata } from "next";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { listActivity } from "@/modules/candidate";
import { requireActorOrRedirect } from "@/server/session";

export const metadata: Metadata = { title: "Activity · JOBHUNT OS" };
export const dynamic = "force-dynamic";

const LABELS: Record<string, string> = {
  profile_created: "Profile created",
  profile_updated: "Profile updated",
  profile_verified: "Basic information verified",
  onboarding_updated: "Onboarding progress saved",
  onboarding_completed: "Onboarding completed",
  education_created: "Education added",
  education_updated: "Education updated",
  experience_created: "Experience added",
  experience_updated: "Experience updated",
  achievement_created: "Achievement added",
  achievement_updated: "Achievement updated",
  skill_created: "Skill added",
  skill_updated: "Skill updated",
  project_created: "Project added",
  project_updated: "Project updated",
  certification_created: "Certification added",
  certification_updated: "Certification updated",
  portfolio_created: "Portfolio item added",
  portfolio_updated: "Portfolio updated",
  language_created: "Language added",
  language_updated: "Language updated",
  authorization_created: "Work authorization added",
  authorization_updated: "Work authorization updated",
  fact_verified: "Fact verified",
  fact_deleted: "Fact deleted",
  fact_restored: "Fact restored",
  preference_updated: "Preferences changed",
  target_locations_updated: "Target locations changed",
  document_uploaded: "Document uploaded",
  document_processed: "Document processed",
  document_processing_failed: "Document processing failed",
  document_deleted: "Document deleted",
  document_downloaded: "Document downloaded",
  fact_created: "Possible facts extracted for review",
  fact_approved: "Extracted fact approved",
  fact_edited: "Extracted fact edited & approved",
  fact_rejected: "Extracted fact rejected",
  data_exported: "Data exported",
};

function detail(action: string, metadata: unknown): string {
  const m = (metadata ?? {}) as Record<string, unknown>;
  if (Array.isArray(m.fields) && m.fields.length) return `Fields: ${m.fields.join(", ")}`;
  if (action === "document_processed")
    return `${m.candidates ?? 0} possible facts · AI ${String(m.aiStatus ?? "").toLowerCase()}`;
  if (action === "fact_created") return `${m.count ?? 0} facts to review`;
  if (typeof m.category === "string") return `${m.category}${m.verified ? " · verified" : ""}`;
  if (typeof m.sourceType === "string") return m.sourceType.toLowerCase().replace(/_/g, " ");
  if (typeof m.step === "string") return `Step: ${m.step} (${String(m.action)})`;
  return "";
}

export default async function ActivityPage() {
  const actor = await requireActorOrRedirect();
  const entries = await listActivity(actor, 200);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Candidate"
        title="Activity"
        description="Your private audit trail. Values are never stored here — only what changed."
      />
      <Card>
        {entries.length === 0 ? (
          <EmptyState title="No activity yet" />
        ) : (
          <ol className="relative px-4 py-3">
            {entries.map((entry) => (
              <li key={entry.id} className="relative flex gap-3 pb-4 pl-5 last:pb-0">
                <span
                  className="bg-border-strong absolute top-1.5 left-0 size-2 rounded-full"
                  aria-hidden
                />
                <span className="bg-border absolute top-4 bottom-0 left-[3px] w-px" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-fg text-sm">{LABELS[entry.action] ?? entry.action}</p>
                  {detail(entry.action, entry.metadata) && (
                    <p className="text-fg-muted text-xs">{detail(entry.action, entry.metadata)}</p>
                  )}
                </div>
                <time
                  dateTime={entry.createdAt.toISOString()}
                  className="text-fg-subtle shrink-0 font-mono text-[11px]"
                >
                  {entry.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                </time>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
