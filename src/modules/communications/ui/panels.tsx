import Link from "next/link";
import type { ReactNode } from "react";
import {
  addFactAction,
  exportAction,
  restoreVersionAction,
} from "@/app/(app)/communications/actions";
import { InlineAction } from "@/components/forms/inline-action";
import { Badge } from "@/components/ui/primitives";
import { SOURCE_LABELS, STATUS_LABELS, type ContentSource, type VersionStatus } from "../types";
import { ago, SEVERITY_TONES, SOURCE_TONES, STATUS_TONES } from "./labels";

const CATEGORY_LABELS: Record<string, string> = {
  ACCURACY: "Accuracy",
  RELEVANCE: "Relevance",
  PERSONALIZATION: "Personalization",
  WRITING: "Writing",
  COMPLETENESS: "Completeness",
  LENGTH: "Length",
  CONSISTENCY: "Consistency",
};
const SEVERITY_LABELS: Record<string, string> = {
  PASS: "✓",
  INFO: "Note",
  WARNING: "Warning",
  CRITICAL: "Critical",
};

export function Section({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="border-border bg-surface-1 flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-fg text-sm font-semibold">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export interface FindingView {
  id: string;
  category: string;
  code: string;
  severity: string;
  message: string;
  recommendation: string | null;
}

export function ChecksPanel({
  findings,
  summary,
  stale,
}: {
  findings: FindingView[];
  summary: Record<string, number> | null;
  stale: boolean;
}) {
  if (!summary)
    return (
      <p className="text-fg-muted text-xs">
        Not checked yet. Run the check to see accuracy, relevance and writing findings.
      </p>
    );
  const order = ["CRITICAL", "WARNING", "INFO", "PASS"];
  const groups = Object.keys(CATEGORY_LABELS)
    .map((c) => ({
      c,
      items: findings
        .filter((f) => f.category === c)
        .sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity)),
    }))
    .filter((g) => g.items.length);
  return (
    <div className="flex flex-col gap-2 text-xs">
      <p>
        <span className="text-success">{summary.passed ?? 0} passed</span> ·{" "}
        <span className={summary.critical ? "text-danger font-medium" : ""}>
          {summary.critical ?? 0} critical
        </span>{" "}
        · {summary.warnings ?? 0} warnings · {summary.info ?? 0} notes
        {stale && <Badge tone="warning">content changed — re-run</Badge>}
      </p>
      {groups.map((g) => (
        <div key={g.c}>
          <p className="text-fg-muted font-medium">{CATEGORY_LABELS[g.c]}</p>
          <ul className="flex flex-col gap-1 pt-0.5">
            {g.items.map((f) => (
              <li key={f.id} className="flex items-start gap-1.5">
                <Badge tone={SEVERITY_TONES[f.severity]}>{SEVERITY_LABELS[f.severity]}</Badge>
                <span>
                  {f.message}
                  {f.recommendation && (
                    <span className="text-fg-subtle block">{f.recommendation}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export interface ClaimView {
  id: string;
  text: string;
  claimKind: string;
  status: string;
  reasons: string[];
  basis: string | null;
  sources: { kind: string; label: string; href: string | null }[];
}

const CLAIM_TONES: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  SUPPORTED: "success",
  PARTIALLY_SUPPORTED: "warning",
  UNSUPPORTED: "danger",
  UNKNOWN: "neutral",
};
const KIND_LABELS: Record<string, string> = {
  CANDIDATE: "About you",
  COMPANY: "About the company / role",
  USER_CONTEXT: "Your context",
};

export function ClaimsPanel({
  claims,
  communicationId,
  canAddFacts,
}: {
  claims: ClaimView[];
  communicationId: string;
  canAddFacts: boolean;
}) {
  if (!claims.length)
    return (
      <p className="text-fg-muted text-xs">
        No factual statements detected yet (run the check after writing).
      </p>
    );
  return (
    <ul className="flex flex-col gap-2 text-xs">
      {claims.map((c) => (
        <li key={c.id} className="border-border rounded-md border p-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={CLAIM_TONES[c.status]}>{c.status.replace("_", " ").toLowerCase()}</Badge>
            <span className="text-fg-subtle">{KIND_LABELS[c.claimKind] ?? c.claimKind}</span>
          </div>
          <p className="text-fg mt-1">“{c.text}”</p>
          {c.reasons.length > 0 && <p className="text-fg-subtle mt-0.5">{c.reasons.join(" ")}</p>}
          {c.sources.length > 0 && (
            <ul className="mt-1 flex flex-col gap-0.5">
              {c.sources.map((s, i) => (
                <li key={i} className="text-fg-muted">
                  ↳ {s.kind}:{" "}
                  {s.href ? (
                    <a
                      href={s.href}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="underline"
                    >
                      {s.label}
                    </a>
                  ) : (
                    s.label
                  )}
                </li>
              ))}
            </ul>
          )}
          {canAddFacts && c.claimKind === "CANDIDATE" && c.status !== "SUPPORTED" && (
            <div className="mt-1">
              <InlineAction
                action={addFactAction}
                hidden={{ claimId: c.id, communicationId }}
                confirm="Add this statement to your candidate facts? Only do this if it is true."
              >
                Add as candidate fact
              </InlineAction>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export interface VersionView {
  id: string;
  versionNumber: number;
  status: string;
  versionType: string;
  contentSource: string;
  createdAt: Date;
  parentVersionId: string | null;
  approved: boolean;
  provider: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  GENERATED: "AI generated",
  AI_ASSISTED: "AI assisted",
  MANUAL_EDIT: "Edited",
  RESTORED: "Restored",
  DUPLICATED: "Duplicated",
  IMPORTED: "Imported",
};

export function VersionHistory({
  versions,
  communicationId,
  selectedId,
  headId,
  canRestore,
}: {
  versions: VersionView[];
  communicationId: string;
  selectedId: string;
  headId: string | null;
  canRestore: boolean;
}) {
  return (
    <ol className="flex flex-col gap-1 text-xs">
      {versions.map((v) => (
        <li
          key={v.id}
          className={`flex flex-wrap items-center justify-between gap-1 rounded px-1.5 py-1 ${v.id === selectedId ? "bg-surface-2" : ""}`}
        >
          <span className="flex flex-wrap items-center gap-1">
            <Link
              href={`/communications/${communicationId}${v.id === headId ? "" : `?v=${v.id}`}`}
              className="font-medium hover:underline"
            >
              v{v.versionNumber}
            </Link>
            <span className="text-fg-muted">— {TYPE_LABELS[v.versionType] ?? v.versionType}</span>
            <Badge tone={STATUS_TONES[v.status as VersionStatus]}>
              {STATUS_LABELS[v.status as VersionStatus]}
            </Badge>
            <Badge tone={SOURCE_TONES[v.contentSource as ContentSource]}>
              {SOURCE_LABELS[v.contentSource as ContentSource]}
              {v.provider ? ` · ${v.provider}` : ""}
            </Badge>
            {v.approved && <Badge tone="success">active approval</Badge>}
            <span className="text-fg-subtle">{ago(v.createdAt)}</span>
          </span>
          <span className="flex items-center gap-1">
            {v.parentVersionId && (
              <Link
                href={`/communications/${communicationId}/compare?from=${v.parentVersionId}&to=${v.id}`}
                className="text-fg-muted underline"
              >
                compare
              </Link>
            )}
            {canRestore && v.id !== headId && (
              <InlineAction
                action={restoreVersionAction}
                hidden={{ versionId: v.id, communicationId }}
              >
                Restore
              </InlineAction>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

export interface ExportView {
  id: string;
  format: string;
  status: string;
  fileName: string | null;
  byteSize: number | null;
  matchesApproval: boolean;
  createdAt: Date;
  error: string | null;
}

export function ExportsPanel({
  kind,
  versionId,
  communicationId,
  exports,
}: {
  kind: "EMAIL" | "COVER_LETTER";
  versionId: string;
  communicationId: string;
  exports: ExportView[];
}) {
  const formats = kind === "EMAIL" ? ["TXT"] : ["PDF", "DOCX", "TXT"];
  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="flex flex-wrap items-center gap-1">
        {formats.map((f) => (
          <InlineAction
            key={f}
            action={exportAction}
            hidden={{ versionId, communicationId, format: f }}
            variant="secondary"
          >
            Export {f}
          </InlineAction>
        ))}
        {kind === "COVER_LETTER" && (
          <a
            href={`/api/v1/communications/versions/${versionId}/preview`}
            target="_blank"
            rel="noopener"
            className="text-fg-muted underline"
          >
            Exact PDF preview
          </a>
        )}
      </div>
      <p className="text-fg-subtle">
        Files are stored privately and downloaded through a short-lived link. Nothing is sent
        anywhere.
      </p>
      {exports.length > 0 && (
        <ul className="flex flex-col gap-1">
          {exports.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-1.5">
              <Badge
                tone={
                  e.status === "SUCCEEDED"
                    ? "success"
                    : e.status === "FAILED"
                      ? "danger"
                      : "neutral"
                }
              >
                {e.format}
              </Badge>
              {e.status === "SUCCEEDED" ? (
                <a href={`/api/v1/communications/exports/${e.id}/download`} className="underline">
                  {e.fileName}
                </a>
              ) : (
                <span className="text-danger">{e.error ?? e.status.toLowerCase()}</span>
              )}
              {e.byteSize ? (
                <span className="text-fg-subtle">
                  {Math.max(1, Math.round(e.byteSize / 1024))} KB
                </span>
              ) : null}
              {e.matchesApproval && <Badge tone="success">approved content</Badge>}
              <span className="text-fg-subtle">{ago(e.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
