/**
 * Application state machine (single source of truth for allowed transitions; the database
 * trigger `applications_guard_status` mirrors this table as defence in depth).
 *
 *   DRAFT → IN_PROGRESS (preparing) → READY (review) → READY_TO_SUBMIT (approved) → SUBMITTING
 *     → SUBMITTED (evidence) → SUBMISSION_CONFIRMED
 *   Failures: FAILED · BLOCKED · NEEDS_HUMAN_INPUT · SUBMISSION_UNCERTAIN (never auto-retried)
 *   Ends: CANCELLED · WITHDRAWN · ARCHIVED
 */
import type { ApplicationStatus } from "./types";

export const TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  DRAFT: ["IN_PROGRESS", "READY", "NEEDS_HUMAN_INPUT", "BLOCKED", "CANCELLED", "ARCHIVED"],
  IN_PROGRESS: ["DRAFT", "READY", "NEEDS_HUMAN_INPUT", "BLOCKED", "FAILED", "CANCELLED"],
  NEEDS_HUMAN_INPUT: ["IN_PROGRESS", "READY", "BLOCKED", "CANCELLED"],
  READY: ["READY_TO_SUBMIT", "IN_PROGRESS", "NEEDS_HUMAN_INPUT", "BLOCKED", "CANCELLED"],
  READY_TO_SUBMIT: [
    "SUBMITTING",
    "READY",
    "IN_PROGRESS",
    "NEEDS_HUMAN_INPUT",
    "BLOCKED",
    "CANCELLED",
  ],
  SUBMITTING: ["SUBMITTED", "SUBMISSION_UNCERTAIN", "FAILED", "NEEDS_HUMAN_INPUT", "BLOCKED"],
  SUBMITTED: ["SUBMISSION_CONFIRMED", "WITHDRAWN", "ARCHIVED"],
  SUBMISSION_CONFIRMED: ["WITHDRAWN", "ARCHIVED"],
  // Uncertain results are resolved by evidence or by the user — never by resubmitting automatically.
  SUBMISSION_UNCERTAIN: ["SUBMITTED", "SUBMISSION_CONFIRMED", "FAILED", "ARCHIVED"],
  // A failed application needs a new, controlled attempt (IN_PROGRESS) or a new review (READY).
  FAILED: ["IN_PROGRESS", "READY", "CANCELLED", "ARCHIVED"],
  BLOCKED: ["IN_PROGRESS", "CANCELLED", "ARCHIVED"],
  CANCELLED: ["ARCHIVED"],
  WITHDRAWN: ["ARCHIVED"],
  ARCHIVED: [],
};

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: ApplicationStatus,
    readonly to: ApplicationStatus,
  ) {
    super(`Invalid application status change ${from} → ${to}`);
  }
}

export function assertTransition(from: ApplicationStatus, to: ApplicationStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/** Statuses in which the application content (fields, answers, files) may still be edited. */
export const EDITABLE_STATUSES: readonly ApplicationStatus[] = [
  "DRAFT",
  "IN_PROGRESS",
  "NEEDS_HUMAN_INPUT",
  "READY",
  "READY_TO_SUBMIT",
  "FAILED",
  "BLOCKED",
];
/** A submission has (or may have) happened — never start another one automatically. */
export const SUBMISSION_SENSITIVE: readonly ApplicationStatus[] = [
  "SUBMITTING",
  "SUBMITTED",
  "SUBMISSION_CONFIRMED",
  "SUBMISSION_UNCERTAIN",
];
/** Finished applications (no further work). */
export const TERMINAL_STATUSES: readonly ApplicationStatus[] = [
  "SUBMISSION_CONFIRMED",
  "CANCELLED",
  "WITHDRAWN",
  "ARCHIVED",
];
