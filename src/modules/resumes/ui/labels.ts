import type { Tone } from "@/components/ui/primitives";
import type { VersionStatus } from "../resume.service";

export const STATUS_TONES: Record<VersionStatus, Tone> = {
  DRAFT: "neutral",
  READY_FOR_REVIEW: "info",
  APPROVED: "success",
  REJECTED: "danger",
  ARCHIVED: "neutral",
};

export const VERSION_TYPE_LABELS: Record<string, string> = {
  MASTER: "Master",
  TAILORED: "Tailored",
  MANUAL_EDIT: "Edit",
  RESTORED: "Restored",
  DUPLICATE: "Duplicate",
};

export const SEVERITY_TONES: Record<string, Tone> = {
  PASS: "success",
  INFO: "neutral",
  OPPORTUNITY: "accent",
  WARNING: "warning",
  ISSUE: "danger",
};

export const SEVERITY_LABELS: Record<string, string> = {
  PASS: "Passed",
  INFO: "Note",
  OPPORTUNITY: "Opportunity",
  WARNING: "Review",
  ISSUE: "Issue",
};

export const ALIGNMENT_TONES: Record<string, Tone> = {
  MATCHED: "success",
  PARTIALLY_MATCHED: "accent",
  MISSING: "neutral",
  UNSUPPORTED: "danger",
  NOT_RELEVANT: "neutral",
};

export const ALIGNMENT_LABELS: Record<string, string> = {
  MATCHED: "Matched",
  PARTIALLY_MATCHED: "Partly matched",
  MISSING: "Not in profile",
  UNSUPPORTED: "Unsupported",
  NOT_RELEVANT: "Not resume content",
};

export const ago = (d: Date) => {
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
