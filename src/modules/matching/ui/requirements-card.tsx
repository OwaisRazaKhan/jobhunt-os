import { ListChecks } from "lucide-react";
import { Badge, Card, CardHeader, EmptyState, type Tone } from "@/components/ui/primitives";
import type { RequirementKind, RequirementType } from "../requirements/extract";

/**
 * The job's structured requirements, grouped by type. Every item shows its verbatim source
 * wording and where it came from. Nothing here refers to the candidate (that is matching).
 */

export interface RequirementItem {
  id: string;
  category: string;
  requirementType: string;
  text: string;
  sourceText: string;
  sourceReference: string;
  confidence: number;
  extractionMethod: string;
}

const GROUPS: { type: RequirementType; title: string; tone: Tone; help: string }[] = [
  {
    type: "REQUIRED",
    title: "Required",
    tone: "danger",
    help: "Stated as required, or a condition of the job",
  },
  {
    type: "PREFERRED",
    title: "Preferred",
    tone: "info",
    help: "Nice to have — missing it is not a blocker",
  },
  {
    type: "UNKNOWN",
    title: "Unclear importance",
    tone: "warning",
    help: "Mentioned as a qualification without saying required or preferred",
  },
  {
    type: "INFORMATIONAL",
    title: "Job facts",
    tone: "neutral",
    help: "Details of the job (salary, listed location, seniority wording)",
  },
];

export const CATEGORY_LABELS: Record<RequirementKind, string> = {
  SKILL: "Skill",
  EXPERIENCE: "Experience",
  EDUCATION: "Education",
  LOCATION: "Location",
  WORK_MODE: "Work mode",
  EMPLOYMENT: "Employment",
  SALARY: "Salary",
  AUTHORIZATION: "Authorization",
  LANGUAGE: "Language",
  CERTIFICATION: "Certification",
  DOMAIN: "Domain",
  PORTFOLIO: "Portfolio",
  OTHER: "Other",
};

function sourceLabel(ref: string) {
  if (ref.startsWith("description:L"))
    return `Job description, line ${ref.slice("description:L".length)}`;
  if (ref.startsWith("job.")) return `Job field: ${ref.slice(4).replaceAll("_", " ")}`;
  return ref;
}

export function RequirementsCard({
  requirements,
  set,
  problem = null,
}: {
  requirements: RequirementItem[];
  set: { version: number; extractorVersion: string; createdAt: Date } | null;
  /** Requirements could not be loaded: a pending database migration, or another error */
  problem?: "migration" | "error" | null;
}) {
  if (problem) {
    return (
      <Card>
        <CardHeader title="Job requirements" />
        <div role="alert" className="flex flex-col gap-1 px-4 py-4 text-sm">
          {problem === "migration" ? (
            <>
              <p className="text-warning font-medium">The database needs an update.</p>
              <p className="text-fg-muted">
                Requirements use tables from a newer migration that has not been applied yet. Run{" "}
                <code className="text-fg font-mono text-xs">npm run db:migrate:deploy</code> and
                restart the app.
              </p>
            </>
          ) : (
            <p className="text-fg-muted">
              Requirements could not be loaded right now. The rest of this job is unaffected —
              reload to try again.
            </p>
          )}
        </div>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader
        title="Job requirements"
        count={requirements.length}
        description={
          set
            ? `Extracted from this job's own text by ${set.extractorVersion} (set v${set.version}, ${set.createdAt.toISOString().slice(0, 10)}). Only what the job states — nothing inferred.`
            : "Structured requirements extracted from this job."
        }
      />
      {requirements.length === 0 ? (
        <EmptyState
          icon={<ListChecks className="size-6" />}
          title="No structured requirements found"
          description="This job does not contain enough structured requirements for a reliable match."
        />
      ) : (
        <div className="divide-border divide-y">
          {GROUPS.map((g) => {
            const items = requirements.filter((r) => r.requirementType === g.type);
            if (items.length === 0) return null;
            return (
              <section key={g.type} className="px-4 py-3" aria-label={`${g.title} requirements`}>
                <h3 className="flex items-center gap-2 text-xs font-semibold">
                  {g.title}{" "}
                  <span className="text-fg-subtle font-mono font-normal">{items.length}</span>
                </h3>
                <p className="text-fg-subtle text-[11px]">{g.help}</p>
                <ul className="mt-2 flex flex-col gap-1">
                  {items.map((r) => (
                    <li key={r.id}>
                      <details className="group rounded-md">
                        <summary className="hover:bg-surface-2 flex cursor-pointer list-none items-start gap-2 rounded-md px-1 py-1 text-xs">
                          <Badge tone={g.tone} className="shrink-0">
                            {CATEGORY_LABELS[r.category as RequirementKind] ?? r.category}
                          </Badge>
                          <span className="text-fg min-w-0 break-words">{r.text}</span>
                          <span className="text-fg-subtle ml-auto shrink-0 text-[11px] group-open:hidden">
                            source
                          </span>
                        </summary>
                        <div className="border-border mt-1 ml-1 border-l-2 py-1 pl-3 text-[11px]">
                          <p className="text-fg-muted break-words whitespace-pre-wrap">
                            “{r.sourceText}”
                          </p>
                          <p className="text-fg-subtle mt-0.5 font-mono">
                            {sourceLabel(r.sourceReference)} · {r.extractionMethod.toLowerCase()} ·
                            confidence {Math.round(r.confidence * 100)}%
                          </p>
                        </div>
                      </details>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </Card>
  );
}
