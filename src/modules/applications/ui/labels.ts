import type { Tone } from "@/components/ui/primitives";
import type { ApplicationStatus, AutomationMode } from "../types";

export const APPLICATION_STATUS_TONES: Partial<Record<ApplicationStatus, Tone>> = {
  READY: "info",
  READY_TO_SUBMIT: "info",
  NEEDS_HUMAN_INPUT: "warning",
  SUBMISSION_UNCERTAIN: "warning",
  SUBMITTING: "accent",
  SUBMITTED: "success",
  SUBMISSION_CONFIRMED: "success",
  FAILED: "danger",
  BLOCKED: "danger",
};

export const MODE_LABELS: Record<AutomationMode, { label: string; help: string }> = {
  MANUAL_ONLY: {
    label: "Manual only",
    help: "JOBHUNT OS prepares everything; you apply yourself and confirm.",
  },
  HUMAN_APPROVAL: {
    label: "Human approval (default)",
    help: "After your approval the worker fills the form and waits — you decide to submit.",
  },
  AUTO_FILL_REVIEW_SUBMIT: {
    label: "Auto-fill and submit after approval",
    help: "After your approval the worker fills and submits. Barriers and uncertain results still stop for you.",
  },
};

export const ITEM_TONE = {
  PASS: "text-success",
  FAIL: "text-danger",
  WARN: "text-warning",
  NA: "text-fg-subtle",
} as const;
export const ITEM_MARK = { PASS: "✓", FAIL: "✕", WARN: "!", NA: "–" } as const;

export const MAPPING_TONES: Record<string, Tone> = {
  MAPPED: "success",
  CONFIRMED: "success",
  OVERRIDDEN: "info",
  NEEDS_REVIEW: "warning",
  NEEDS_USER_INPUT: "danger",
  BLOCKED: "danger",
};

export const VALIDATION_TONES: Record<string, Tone> = {
  SUPPORTED: "success",
  PARTIALLY_SUPPORTED: "warning",
  UNSUPPORTED: "danger",
  NEEDS_USER_INPUT: "danger",
  NOT_VALIDATED: "neutral",
};

export function human(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/_/g, " ");
}

export function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes (checked)" : "No";
  if (typeof value === "object") return (value as { fileName?: string }).fileName ?? "";
  return String(value);
}
