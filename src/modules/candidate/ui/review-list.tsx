"use client";

import { AlertTriangle, Check, Copy, Pencil, X } from "lucide-react";
import { useActionState, useMemo, useState } from "react";
import { ActionForm } from "@/components/forms/action-form";
import type { FieldContext } from "@/components/forms/field-control";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/primitives";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { cn } from "@/lib/cn";
import {
  approveCandidateAction,
  approveEditedCandidateAction,
  bulkReviewAction,
  rejectCandidateAction,
} from "@/app/(app)/candidate/actions";
import { SECTION_FIELDS, SECTION_META, type FieldDef } from "../form-fields";
import { factLabel } from "../labels";
import { formatDateRange, optionLabel } from "../options";
import { isSectionKind } from "../schemas";
import { ConfidenceMeter, MethodBadge, VerificationBadge } from "./badges";

export interface ReviewCandidate {
  id: string;
  category: string;
  payload: Record<string, unknown>;
  excerpt: string | null;
  confidence: number;
  method: "RULE" | "AI";
  duplicateOf: { kind?: string; label?: string; score?: number } | null;
  documentName: string;
  bulkIssue: string | null;
}

const PROFILE_FIELD_LABELS: Record<string, string> = {
  fullName: "Full name",
  headline: "Headline",
  professionalEmail: "Professional email",
  phone: "Phone",
  linkedinUrl: "LinkedIn URL",
  githubUrl: "GitHub URL",
  websiteUrl: "Website",
  summary: "Summary",
};

function categoryLabel(c: ReviewCandidate) {
  if (c.category === "profile")
    return `Profile · ${PROFILE_FIELD_LABELS[String(c.payload.field)] ?? String(c.payload.field)}`;
  return isSectionKind(c.category) ? `Possible ${SECTION_META[c.category].singular}` : c.category;
}

function editFields(c: ReviewCandidate): FieldDef[] {
  if (c.category === "profile") {
    const field = String(c.payload.field);
    return [
      {
        name: "value",
        label: PROFILE_FIELD_LABELS[field] ?? field,
        type: field === "summary" ? "textarea" : "text",
        wide: true,
        required: true,
      },
    ];
  }
  return isSectionKind(c.category) ? SECTION_FIELDS[c.category] : [];
}

function Details({ c }: { c: ReviewCandidate }) {
  const p = c.payload;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  const dates = formatDateRange(
    s(p.startDate) || s(p.issueDate),
    s(p.endDate),
    p.isCurrent === true,
  );
  const list = [
    ...((p.responsibilities as string[]) ?? []),
    ...((p.technologies as string[]) ?? []),
  ];
  const extras = [
    dates,
    s(p.location),
    p.category && c.category === "skill" ? optionLabel(s(p.category)) : "",
    p.proficiency && c.category === "language" ? optionLabel(s(p.proficiency)) : "",
  ].filter(Boolean);
  return (
    <div className="mt-1">
      <p className="text-fg text-sm font-medium break-words">
        {c.category === "profile"
          ? s(p.value)
          : isSectionKind(c.category)
            ? factLabel(c.category, p)
            : ""}
      </p>
      {extras.length > 0 && (
        <p className="text-fg-subtle mt-0.5 font-mono text-[11px]">{extras.join(" · ")}</p>
      )}
      {list.length > 0 && (
        <ul className="text-fg-muted mt-1 list-disc pl-4 text-xs">
          {list.slice(0, 4).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReviewCard({
  c,
  context,
  selected,
  onToggle,
}: {
  c: ReviewCandidate;
  context: FieldContext;
  selected: boolean;
  onToggle: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [approveState, approve, approving] = useActionState(
    approveCandidateAction,
    INITIAL_ACTION_STATE,
  );
  const [rejectState, reject, rejecting] = useActionState(
    rejectCandidateAction,
    INITIAL_ACTION_STATE,
  );
  const error = approveState.error ?? rejectState.error;
  const editValues = c.category === "profile" ? { value: c.payload.value } : c.payload;

  return (
    <li
      className={cn(
        "bg-surface-1 rounded-lg border p-3 transition-colors",
        selected ? "border-accent/60" : "border-border",
      )}
    >
      <div className="flex gap-3">
        <div className="pt-0.5">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            disabled={Boolean(c.bulkIssue)}
            title={c.bulkIssue ?? "Select for bulk action"}
            aria-label={`Select ${categoryLabel(c)}`}
            className="size-4 accent-[var(--accent)] disabled:opacity-30"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-fg-subtle font-mono text-[11px] tracking-wide uppercase">
              {categoryLabel(c)}
            </span>
            <VerificationBadge status="NEEDS_REVIEW" />
            <MethodBadge method={c.method} />
            <ConfidenceMeter value={c.confidence} />
          </div>
          <Details c={c} />
          {c.excerpt && (
            <blockquote className="border-border-strong text-fg-muted mt-2 border-l-2 pl-2 font-mono text-[11px] leading-relaxed break-words whitespace-pre-line">
              {c.excerpt.length > 400 ? `${c.excerpt.slice(0, 400)}…` : c.excerpt}
            </blockquote>
          )}
          <p className="text-fg-subtle mt-1.5 text-[11px]">Source: {c.documentName}</p>
          {c.duplicateOf && (
            <p className="text-warning mt-2 flex items-center gap-1.5 text-xs">
              <AlertTriangle className="size-3.5" aria-hidden />
              {c.duplicateOf.kind === "profile"
                ? c.duplicateOf.label
                : `Possible duplicate of “${c.duplicateOf.label}”`}
              {c.duplicateOf.score ? (
                <span className="text-fg-subtle font-mono">
                  ({Math.round(c.duplicateOf.score * 100)}%)
                </span>
              ) : null}
            </p>
          )}
          {error && (
            <p role="alert" className="text-danger mt-2 text-xs">
              {error}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row sm:items-start">
          <form action={approve}>
            <input type="hidden" name="_candidateId" value={c.id} />
            <Button
              type="submit"
              size="sm"
              variant="primary"
              disabled={approving || rejecting}
              title="Approve and mark as verified"
            >
              <Check className="size-3.5" aria-hidden /> Approve
            </Button>
          </form>
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" aria-hidden /> Edit
          </Button>
          <form action={reject}>
            <input type="hidden" name="_candidateId" value={c.id} />
            <input type="hidden" name="_reason" value={c.duplicateOf ? "duplicate" : "incorrect"} />
            <Button type="submit" size="sm" variant="ghost" disabled={approving || rejecting}>
              {c.duplicateOf ? (
                <Copy className="size-3.5" aria-hidden />
              ) : (
                <X className="size-3.5" aria-hidden />
              )}
              {!c.duplicateOf
                ? "Reject"
                : c.duplicateOf.kind === "profile"
                  ? "Keep current value"
                  : "Discard duplicate"}
            </Button>
          </form>
        </div>
      </div>
      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title={`Edit before approving: ${categoryLabel(c)}`}
        description="Your edited version is saved and marked as verified."
        wide
      >
        {c.excerpt && (
          <blockquote className="border-border-strong text-fg-muted mb-3 border-l-2 pl-2 font-mono text-[11px] whitespace-pre-line">
            {c.excerpt}
          </blockquote>
        )}
        <ActionForm
          action={approveEditedCandidateAction}
          fields={editFields(c)}
          values={editValues}
          hidden={{ _candidateId: c.id }}
          context={context}
          submitLabel="Save & approve"
          onCancel={() => setEditing(false)}
          onSuccess={() => setEditing(false)}
        />
      </Modal>
    </li>
  );
}

export function ReviewList({
  candidates,
  context,
}: {
  candidates: ReviewCandidate[];
  context: FieldContext;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<"approve" | "reject" | null>(null);
  const [bulkState, bulkAction, bulkPending] = useActionState(
    async (prev: typeof INITIAL_ACTION_STATE, fd: FormData) => {
      const result = await bulkReviewAction(prev, fd);
      if (result.ok) {
        setSelected(new Set());
        setConfirm(null);
      }
      return result;
    },
    INITIAL_ACTION_STATE,
  );

  const safeIds = useMemo(
    () => candidates.filter((c) => !c.bulkIssue).map((c) => c.id),
    [candidates],
  );
  const selectedList = candidates.filter((c) => selected.has(c.id));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="border-border bg-surface-2/95 sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 backdrop-blur">
        <div className="text-fg-muted flex items-center gap-3 text-xs">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-[var(--accent)]"
              checked={safeIds.length > 0 && safeIds.every((id) => selected.has(id))}
              onChange={(e) => setSelected(e.target.checked ? new Set(safeIds) : new Set())}
              disabled={safeIds.length === 0}
            />
            Select all eligible ({safeIds.length})
          </label>
          <span className="font-mono">{selected.size} selected</span>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={selected.size === 0}
            onClick={() => setConfirm("approve")}
          >
            Add selected as user-provided
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={selected.size === 0}
            onClick={() => setConfirm("reject")}
          >
            Reject selected
          </Button>
        </div>
      </div>
      {bulkState.message && bulkState.ok && (
        <p role="status" className="text-success text-sm">
          {bulkState.message}
        </p>
      )}
      <p className="text-fg-subtle text-xs">
        Items needing a decision (profile fields that replace values, possible duplicates, low
        confidence) cannot be bulk-selected and must be reviewed one by one.
      </p>

      <ul className="flex flex-col gap-2">
        {candidates.map((c) => (
          <ReviewCard
            key={c.id}
            c={c}
            context={context}
            selected={selected.has(c.id)}
            onToggle={() => toggle(c.id)}
          />
        ))}
      </ul>

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={
          confirm === "approve"
            ? `Add ${selected.size} facts to your profile?`
            : `Reject ${selected.size} facts?`
        }
        description={
          confirm === "approve"
            ? "They will be saved as “User provided” — NOT verified. You can verify each one later from your profile."
            : "Rejected facts are not added to your profile."
        }
        wide
      >
        <form action={bulkAction} className="flex flex-col gap-3">
          <input type="hidden" name="_op" value={confirm ?? ""} />
          {selectedList.map((c) => (
            <input key={c.id} type="hidden" name="candidateId" value={c.id} />
          ))}
          <ul className="border-border bg-bg max-h-72 space-y-1 overflow-y-auto rounded-md border p-2 text-xs">
            {selectedList.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <Badge>
                  {isSectionKind(c.category) ? SECTION_META[c.category].singular : c.category}
                </Badge>
                <span className="text-fg truncate">
                  {isSectionKind(c.category)
                    ? factLabel(c.category, c.payload)
                    : String(c.payload.value)}
                </span>
              </li>
            ))}
          </ul>
          {bulkState.error && (
            <p role="alert" className="text-danger text-sm">
              {bulkState.error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={confirm === "reject" ? "danger" : "primary"}
              disabled={bulkPending}
            >
              {bulkPending
                ? "Working…"
                : confirm === "approve"
                  ? `Add ${selected.size} as user-provided`
                  : `Reject ${selected.size}`}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
