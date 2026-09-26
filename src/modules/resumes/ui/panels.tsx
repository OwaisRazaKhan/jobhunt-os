import Link from "next/link";
import { Badge, Card, CardHeader } from "@/components/ui/primitives";
import type { KeywordResult, RequirementAlignment } from "../alignment";
import type { ChangeSet } from "../tailor";
import {
  ago,
  ALIGNMENT_LABELS,
  ALIGNMENT_TONES,
  SEVERITY_LABELS,
  SEVERITY_TONES,
  STATUS_TONES,
  VERSION_TYPE_LABELS,
} from "./labels";
import { STATUS_LABELS, type VersionStatus } from "../resume.service";

const KIND_TONES = {
  REORDERED: "info",
  HIDDEN: "neutral",
  SHOWN: "success",
  REWRITTEN: "ai",
  SUMMARY: "ai",
  SECTION_ORDER: "info",
} as const;

/** Tailoring change set: every change with its reason; rejected/needs-review AI proposals. */
export function ChangeSetPanel({
  changeSet,
  compareHref,
}: {
  changeSet: ChangeSet;
  compareHref: string | null;
}) {
  return (
    <Card>
      <CardHeader
        title="Tailoring changes"
        count={changeSet.changes.length}
        description={`${changeSet.method === "AI_ASSISTED" ? `AI-assisted (${changeSet.provider}:${changeSet.model}), validated against your facts` : "Deterministic tailoring (no AI wording)"}. Review before use.`}
        actions={
          compareHref ? (
            <Link href={compareHref} className="text-accent text-xs hover:underline">
              Side-by-side
            </Link>
          ) : undefined
        }
      />
      <div className="flex flex-col gap-3 px-4 py-3 text-xs">
        {changeSet.warnings.map((w) => (
          <p key={w} className="text-fg-muted">
            ⚠ {w}
          </p>
        ))}
        {changeSet.changes.length === 0 && (
          <p className="text-fg-muted">
            No changes were needed — the source already fits this job as well as your facts allow.
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {changeSet.changes.map((c, i) => (
            <li key={`${c.itemId}-${i}`} className="border-border rounded-md border p-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={KIND_TONES[c.kind]}>{c.kind.replace("_", " ").toLowerCase()}</Badge>
                <span className="text-fg font-medium">{c.label}</span>
              </div>
              {c.kind === "REWRITTEN" || c.kind === "SUMMARY" ? (
                <div className="mt-1 grid gap-1 sm:grid-cols-2">
                  <p className="text-fg-muted decoration-danger/50 line-through">
                    {c.before ?? "—"}
                  </p>
                  <p className="text-fg">{c.after}</p>
                </div>
              ) : (
                (c.before || c.after) && (
                  <p className="text-fg-muted mt-1">
                    {c.before ?? "—"} → {c.after ?? "—"}
                  </p>
                )
              )}
              <p className="text-fg-muted mt-1">{c.reason}</p>
            </li>
          ))}
        </ul>
        {changeSet.needsReview.length > 0 && (
          <div>
            <p className="text-warning font-medium">
              Needs your review — not applied ({changeSet.needsReview.length})
            </p>
            <ul className="mt-1 flex flex-col gap-1.5">
              {changeSet.needsReview.map((r, i) => (
                <li key={i} className="border-warning/30 rounded-md border p-2">
                  <p className="text-fg">“{r.proposed}”</p>
                  <p className="text-fg-muted mt-0.5">{r.reasons.join(" ")}</p>
                  <p className="text-fg-subtle mt-0.5">
                    You can copy the parts you can support into the editor yourself.
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
        {changeSet.rejected.length > 0 && (
          <details>
            <summary className="text-fg-muted cursor-pointer">
              Rejected by claim validation ({changeSet.rejected.length})
            </summary>
            <ul className="mt-1 flex flex-col gap-1.5">
              {changeSet.rejected.map((r, i) => (
                <li key={i} className="border-danger/30 rounded-md border p-2">
                  <p className="text-fg-muted line-through">“{r.proposed}”</p>
                  <p className="text-danger mt-0.5">{r.reasons.join(" ")}</p>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Card>
  );
}

interface FindingRow {
  id: string;
  category: string;
  code: string;
  severity: string;
  message: string;
  recommendation: string | null;
}

const CATEGORY_ORDER = [
  "PROVENANCE",
  "STRUCTURE",
  "CONTENT",
  "ALIGNMENT",
  "READABILITY",
  "FORMATTING",
];
const CATEGORY_LABELS: Record<string, string> = {
  PROVENANCE: "Fact grounding",
  STRUCTURE: "Structure",
  CONTENT: "Content",
  ALIGNMENT: "Target alignment",
  READABILITY: "Readability",
  FORMATTING: "Formatting (ATS-friendly structure)",
};
const SEVERITY_ORDER = ["ISSUE", "WARNING", "OPPORTUNITY", "INFO", "PASS"];

export function CheckResults({
  summary,
  findings,
  stale,
  createdAt,
  jobTitle,
}: {
  summary: {
    passed: number;
    issues: number;
    warnings: number;
    opportunities: number;
    pages: number | null;
    alignment: RequirementAlignment[] | null;
    keywords: KeywordResult[] | null;
  };
  findings: FindingRow[];
  stale: boolean;
  createdAt: Date;
  jobTitle: string | null;
}) {
  const byCategory = CATEGORY_ORDER.map((c) => ({
    c,
    items: findings
      .filter((f) => f.category === c)
      .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)),
  })).filter((g) => g.items.length);
  return (
    <div className="flex flex-col gap-3 text-xs">
      <p className="text-fg">
        <span className="text-success font-medium">{summary.passed} checks passed</span> ·{" "}
        <span className={summary.issues ? "text-danger font-medium" : "text-fg-muted"}>
          {summary.issues} issues
        </span>{" "}
        ·{" "}
        <span className={summary.warnings ? "text-warning font-medium" : "text-fg-muted"}>
          {summary.warnings} to review
        </span>{" "}
        · <span className="text-accent">{summary.opportunities} alignment opportunities</span>
        {summary.pages != null && (
          <span className="text-fg-muted">
            {" "}
            · PDF: {summary.pages} page{summary.pages === 1 ? "" : "s"}
          </span>
        )}
      </p>
      <p className="text-fg-subtle">
        Checked {ago(createdAt)}
        {jobTitle ? ` against “${jobTitle}”` : " (no target job)"}. This is an evidence-based
        review, not an ATS score — no tool can guarantee how an applicant tracking system or
        recruiter will treat a resume.
      </p>
      {stale && <p className="text-warning">The resume changed after this check — run it again.</p>}
      {byCategory.map(({ c, items }) => (
        <div key={c}>
          <p className="text-fg mb-1 font-medium">{CATEGORY_LABELS[c]}</p>
          <ul className="flex flex-col gap-1">
            {items.map((f) => (
              <li key={f.id} className="flex items-start gap-2">
                <Badge tone={SEVERITY_TONES[f.severity]} className="mt-0.5 shrink-0">
                  {SEVERITY_LABELS[f.severity]}
                </Badge>
                <span>
                  <span className="text-fg">{f.message}</span>
                  {f.recommendation && (
                    <span className="text-fg-muted block">→ {f.recommendation}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {summary.alignment && summary.alignment.length > 0 && (
        <details>
          <summary className="text-fg cursor-pointer font-medium">
            Requirement alignment (
            {summary.alignment.filter((a) => a.status !== "NOT_RELEVANT").length})
          </summary>
          <table className="mt-1 w-full text-left">
            <thead className="text-fg-subtle">
              <tr>
                <th className="py-1 pr-2 font-normal">Requirement</th>
                <th className="py-1 pr-2 font-normal">Type</th>
                <th className="py-1 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {summary.alignment
                .filter((a) => a.status !== "NOT_RELEVANT")
                .map((a) => (
                  <tr key={a.requirementId} className="border-border border-t align-top">
                    <td className="py-1 pr-2">
                      <span className="text-fg">{a.text}</span>
                      <span className="text-fg-muted block">{a.note}</span>
                    </td>
                    <td className="text-fg-muted py-1 pr-2">{a.requirementType.toLowerCase()}</td>
                    <td className="py-1">
                      <Badge tone={ALIGNMENT_TONES[a.status]}>{ALIGNMENT_LABELS[a.status]}</Badge>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </details>
      )}
      {summary.keywords && summary.keywords.length > 0 && (
        <details>
          <summary className="text-fg cursor-pointer font-medium">
            Job terms ({summary.keywords.length})
          </summary>
          <ul className="mt-1 flex flex-wrap gap-1">
            {summary.keywords.map((k) => (
              <li key={`${k.skillKey ?? k.keyword}`}>
                <Badge
                  tone={ALIGNMENT_TONES[k.status]}
                  title={
                    k.status === "MISSING"
                      ? `${k.keyword} appears in the job but not in your verified profile — it will not be added.`
                      : k.status === "PARTIALLY_MATCHED"
                        ? "Supported by your facts but not shown in this resume."
                        : k.status === "UNSUPPORTED"
                          ? "In the resume without supporting facts."
                          : "In the resume and supported by your facts."
                  }
                >
                  {k.keyword} · {ALIGNMENT_LABELS[k.status]}
                </Badge>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function VersionList({
  resumeId,
  versions,
  currentId,
  selectedId,
}: {
  resumeId: string;
  versions: {
    id: string;
    versionNumber: number;
    status: string;
    versionType: string;
    title: string;
    updatedAt: Date;
    aiAssisted: boolean;
    approvals: { id: string }[];
    changeSummary: unknown;
  }[];
  currentId: string | null;
  selectedId: string | null;
}) {
  return (
    <ul className="divide-border divide-y text-xs">
      {versions.map((v) => {
        const summary = (v.changeSummary ?? {}) as { lines?: string[] };
        return (
          <li key={v.id} className="flex flex-col gap-1 px-4 py-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Link
                href={
                  v.id === currentId ? `/resumes/${resumeId}` : `/resumes/${resumeId}?v=${v.id}`
                }
                className="text-fg font-medium hover:underline"
                aria-current={v.id === selectedId ? "true" : undefined}
              >
                v{v.versionNumber}
              </Link>
              <Badge>{VERSION_TYPE_LABELS[v.versionType] ?? v.versionType}</Badge>
              <Badge tone={STATUS_TONES[v.status as VersionStatus]}>
                {STATUS_LABELS[v.status as VersionStatus]}
              </Badge>
              {v.approvals.length > 0 && <Badge tone="success">approval active</Badge>}
              {v.aiAssisted && <Badge tone="ai">AI-assisted</Badge>}
              {v.id === currentId && <Badge tone="accent">latest</Badge>}
            </div>
            <p className="text-fg-muted">
              {v.title} · {ago(v.updatedAt)}
            </p>
            {summary.lines && summary.lines.length > 0 && (
              <p className="text-fg-subtle">{summary.lines.slice(0, 3).join(" · ")}</p>
            )}
            {currentId && v.id !== currentId && (
              <Link
                href={`/resumes/${resumeId}/compare?from=${v.id}&to=${currentId}`}
                className="text-accent self-start hover:underline"
              >
                Compare with latest
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
