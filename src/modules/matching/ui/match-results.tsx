"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import type { EvidenceItem } from "../engine/types";
import { GAP_KIND_LABELS } from "../types";
import { ResultBadge } from "./match-badge";

export interface ResultRow {
  id: string;
  status: string;
  relationship: string | null;
  gapKind: string | null;
  isHardBlock: boolean;
  method: string;
  explanation: string;
  evidence: EvidenceItem[];
  requirement: {
    category: string;
    categoryLabel: string;
    requirementType: string;
    text: string;
    sourceText: string;
    sourceReference: string;
  };
}

const FILTERS = [
  ["all", "All"],
  ["matched", "Matched"],
  ["gaps", "Gaps"],
  ["unknown", "Unknown"],
  ["required", "Required"],
  ["preferred", "Preferred"],
  ["blocks", "Hard blocks"],
] as const;
type Filter = (typeof FILTERS)[number][0];

const KEEP: Record<Filter, (r: ResultRow) => boolean> = {
  all: () => true,
  matched: (r) => r.status === "MATCHED" || r.status === "RELATED",
  gaps: (r) => r.status === "GAP" || r.status === "PARTIAL",
  unknown: (r) => ["UNKNOWN", "UNVERIFIED", "CONFLICT"].includes(r.status),
  required: (r) => r.requirement.requirementType === "REQUIRED",
  preferred: (r) => r.requirement.requirementType === "PREFERRED",
  blocks: (r) => r.isHardBlock,
};

const TYPE_LABEL: Record<string, string> = {
  REQUIRED: "Required",
  PREFERRED: "Preferred",
  INFORMATIONAL: "Job fact",
  UNKNOWN: "Importance unclear",
};

const VERIFICATION_LABEL: Record<string, string> = {
  VERIFIED: "Verified",
  USER_PROVIDED: "You entered",
  NEEDS_REVIEW: "Needs review",
  AI_INFERRED: "AI suggested",
};

/** Requirement-by-requirement results with filters and expandable evidence. */
export function MatchResults({ rows }: { rows: ResultRow[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const visible = rows.filter(KEEP[filter]);
  return (
    <div>
      <div
        role="tablist"
        aria-label="Filter requirements"
        className="border-border flex gap-1 overflow-x-auto border-b px-3"
      >
        {FILTERS.map(([key, label]) => {
          const n = rows.filter(KEEP[key]).length;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              onClick={() => setFilter(key)}
              className={cn(
                "-mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-2 text-xs whitespace-nowrap",
                filter === key
                  ? "border-accent text-fg"
                  : "text-fg-muted hover:text-fg border-transparent",
              )}
            >
              {label} <span className="text-fg-subtle font-mono">{n}</span>
            </button>
          );
        })}
      </div>
      {visible.length === 0 ? (
        <p className="text-fg-muted px-4 py-6 text-center text-xs">No requirements in this view.</p>
      ) : (
        <ul className="divide-border divide-y">
          {visible.map((r) => (
            <li key={r.id}>
              <details className="group">
                <summary className="hover:bg-surface-2/60 flex cursor-pointer list-none items-start gap-3 px-4 py-2.5">
                  <ChevronRight
                    className="text-fg-subtle mt-0.5 size-3.5 shrink-0 transition-transform group-open:rotate-90"
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <ResultBadge status={r.status} />
                      {r.gapKind && (
                        <Badge tone={r.gapKind === "REQUIRED" ? "danger" : "warning"}>
                          {GAP_KIND_LABELS[r.gapKind]}
                        </Badge>
                      )}
                      {r.relationship === "RELATED" && (
                        <Badge tone="info">Related, not exact</Badge>
                      )}
                      {r.method === "AI_ASSISTED" && <Badge tone="ai">AI-assisted</Badge>}
                      <span className="text-fg-subtle font-mono text-[11px]">
                        {r.requirement.categoryLabel} ·{" "}
                        {TYPE_LABEL[r.requirement.requirementType] ?? r.requirement.requirementType}
                      </span>
                    </div>
                    <p className="text-fg mt-1 text-sm break-words">{r.requirement.text}</p>
                    <p className="text-fg-muted mt-0.5 text-xs break-words">{r.explanation}</p>
                  </div>
                </summary>
                <div className="bg-surface-2/40 flex flex-col gap-2 px-4 pt-1 pb-3 pl-10 text-xs">
                  <div>
                    <p className="text-fg-muted font-medium">
                      From the job posting ({r.requirement.sourceReference})
                    </p>
                    <blockquote className="border-border text-fg mt-0.5 border-l-2 pl-2 break-words whitespace-pre-wrap">
                      {r.requirement.sourceText}
                    </blockquote>
                  </div>
                  <div>
                    <p className="text-fg-muted font-medium">Your evidence</p>
                    {r.evidence.length === 0 ? (
                      <p className="text-fg-subtle mt-0.5">
                        No candidate evidence is cited for this requirement.
                      </p>
                    ) : (
                      <ul className="mt-0.5 flex flex-col gap-1">
                        {r.evidence.map((e) => (
                          <li key={e.ref + (e.excerpt ?? "")}>
                            <span className="text-fg">{e.label}</span>{" "}
                            <Badge
                              tone={
                                e.verification === "VERIFIED"
                                  ? "success"
                                  : e.verification === "USER_PROVIDED"
                                    ? "neutral"
                                    : "warning"
                              }
                            >
                              {VERIFICATION_LABEL[e.verification] ?? e.verification}
                            </Badge>
                            {e.excerpt && (
                              <span className="text-fg-muted block break-words">“{e.excerpt}”</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
