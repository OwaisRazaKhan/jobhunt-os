/**
 * Communication Package — deterministic readiness, stale detection and integrity (pure functions).
 *
 * A package is the exact set of approved assets prepared for ONE job: resume version, optional
 * email / cover-letter versions, recipient context and the context versions (match, requirement
 * set, research, job content) they were prepared against. It is the Phase 7 → Phase 8 boundary.
 *
 *   INCOMPLETE             something required is missing or not yet valid
 *   READY_FOR_REVIEW       every check passes; the candidate has not confirmed yet
 *   READY_FOR_APPLICATION  confirmed; frozen (DB trigger). Prepared and approved — NOT submitted
 *   STALE                  a frozen package whose references are no longer current / approved
 *   INVALID                integrity problem (hash mismatch, job gone, inconsistent references)
 *   ARCHIVED               retained history
 * No scores or percentages: every item is PASS / FAIL / WARN / N/A with a reason.
 */
import { createHash } from "node:crypto";

export const PACKAGE_STATUSES = [
  "INCOMPLETE",
  "READY_FOR_REVIEW",
  "READY_FOR_APPLICATION",
  "STALE",
  "INVALID",
  "ARCHIVED",
] as const;
export type PackageStatus = (typeof PACKAGE_STATUSES)[number];
export const FROZEN_STATUSES: readonly PackageStatus[] = [
  "READY_FOR_APPLICATION",
  "STALE",
  "INVALID",
  "ARCHIVED",
];
export const PACKAGE_CHANNELS = ["EMAIL", "PORTAL"] as const;
export type PackageChannel = (typeof PACKAGE_CHANNELS)[number];
export const ASSET_TYPES = ["RESUME", "EMAIL", "COVER_LETTER"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const PACKAGE_STATUS_LABELS: Record<PackageStatus, string> = {
  INCOMPLETE: "Incomplete",
  READY_FOR_REVIEW: "Ready for review",
  READY_FOR_APPLICATION: "Ready for application",
  STALE: "Stale",
  INVALID: "Invalid",
  ARCHIVED: "Archived",
};
export const ASSET_LABELS: Record<AssetType, string> = {
  RESUME: "Resume",
  EMAIL: "Application email",
  COVER_LETTER: "Cover letter",
};

export interface AssetState {
  type: AssetType;
  versionId: string;
  versionNumber: number;
  /** Hash stored on the package asset row when it was selected */
  selectedHash: string;
  /** Hash currently stored on the version row */
  storedHash: string;
  /** Hash recomputed from the version content (null when the content failed to parse) */
  recomputedHash: string | null;
  status: string;
  activeApproval: { id: string; contentHash: string } | null;
  /** Approval id recorded when the package became ready (frozen packages) */
  recordedApprovalId: string | null;
  /** The asset belongs to the package's job (resume: tailored for it or general; communication: job_id) */
  jobConsistent: boolean;
  jobDetail?: string;
  /** Latest quality check for this exact content (communications only) */
  check: { critical: number; unsupported: number } | null;
  /** A newer APPROVED version of the same resume / communication exists */
  newerApprovedVersion: number | null;
  /** The approved version was edited afterwards (a MANUAL_EDIT child exists) */
  editedAfterApproval: boolean;
  /** Communication details that must agree with the package */
  recipientEmail?: string | null;
  resumeVersionId?: string | null;
}

export interface PackageEvaluationInput {
  channel: PackageChannel;
  includeEmail: boolean;
  includeCoverLetter: boolean;
  frozen: boolean;
  candidate: { exists: boolean; usableFacts: number };
  job: {
    exists: boolean;
    deleted: boolean;
    contentHash: string | null;
    packagedContentHash: string | null;
  };
  match: { id: string; isCurrent: boolean; jobMatches: boolean } | null;
  requirementSet: { id: string; isCurrent: boolean } | null;
  research: { id: string; version: number; isCurrent: boolean } | null;
  assets: Partial<Record<AssetType, AssetState>>;
  resumeVersionId: string | null;
  recipient: {
    email: string | null;
    name: string | null;
    verificationStatus: string;
    /** Frozen packages: the current recipient context differs from the snapshot */
    changedSinceSnapshot: boolean;
  } | null;
}

export type ItemStatus = "PASS" | "FAIL" | "WARN" | "NA";
export interface ReadinessItem {
  key: string;
  label: string;
  status: ItemStatus;
  detail: string;
  /** FAIL kind: MISSING → incomplete, INVALID → integrity, STALE → outdated reference */
  kind?: "MISSING" | "BLOCKING" | "INVALID" | "STALE";
}

export interface Evaluation {
  items: ReadinessItem[];
  ready: boolean;
  staleReasons: string[];
  invalidReasons: string[];
}

export function requiredAssets(
  channel: PackageChannel,
  includeEmail: boolean,
  includeCoverLetter: boolean,
): AssetType[] {
  const out: AssetType[] = ["RESUME"];
  if (channel === "EMAIL" || includeEmail) out.push("EMAIL");
  if (includeCoverLetter) out.push("COVER_LETTER");
  return out;
}

export function evaluatePackage(input: PackageEvaluationInput): Evaluation {
  const items: ReadinessItem[] = [];
  const add = (
    key: string,
    label: string,
    status: ItemStatus,
    detail: string,
    kind?: ReadinessItem["kind"],
  ) =>
    items.push({
      key,
      label,
      status,
      detail,
      kind: status === "FAIL" ? (kind ?? "BLOCKING") : undefined,
    });

  add(
    "candidate",
    "Candidate profile",
    input.candidate.exists && input.candidate.usableFacts > 0 ? "PASS" : "FAIL",
    input.candidate.exists ? `${input.candidate.usableFacts} usable facts` : "No candidate profile",
    "MISSING",
  );

  if (!input.job.exists || input.job.deleted)
    add("job", "Job exists", "FAIL", "The job is no longer available.", "INVALID");
  else if (
    input.frozen &&
    input.job.packagedContentHash &&
    input.job.contentHash !== input.job.packagedContentHash
  )
    add(
      "job",
      "Job exists",
      "FAIL",
      "The job posting changed after the package was prepared.",
      "STALE",
    );
  else add("job", "Job exists", "PASS", "Job posting available.");

  if (!input.match)
    add("match", "Match exists", "FAIL", "Compute the match for this job first.", "MISSING");
  else if (!input.match.jobMatches)
    add("match", "Match exists", "FAIL", "The match belongs to a different job.", "INVALID");
  else if (!input.match.isCurrent)
    add(
      "match",
      "Match exists",
      "FAIL",
      "The match was recomputed after this package was prepared.",
      "STALE",
    );
  else add("match", "Match exists", "PASS", "Current match.");

  if (input.requirementSet && !input.requirementSet.isCurrent)
    add(
      "requirements",
      "Job requirements current",
      "FAIL",
      "The job's requirements were re-extracted.",
      "STALE",
    );
  if (input.research) {
    add(
      "research",
      "Research",
      input.research.isCurrent ? "PASS" : "FAIL",
      input.research.isCurrent
        ? `Research v${input.research.version}`
        : `Research v${input.research.version} was superseded.`,
      "STALE",
    );
  } else
    add(
      "research",
      "Research",
      "NA",
      "No research used (company claims are not allowed without it).",
    );

  for (const type of requiredAssets(input.channel, input.includeEmail, input.includeCoverLetter)) {
    const a = input.assets[type];
    const label = ASSET_LABELS[type];
    const key = type.toLowerCase();
    if (!a) {
      add(
        `${key}_selected`,
        `${label} selected`,
        "FAIL",
        `Select an approved ${label.toLowerCase()} version.`,
        "MISSING",
      );
      continue;
    }
    const v = `v${a.versionNumber}`;
    // Integrity: the version's content still hashes to what was selected and approved.
    if (
      a.recomputedHash === null ||
      a.recomputedHash !== a.storedHash ||
      a.storedHash !== a.selectedHash
    ) {
      add(
        `${key}_integrity`,
        `${label} integrity`,
        "FAIL",
        `${label} ${v} content does not match its recorded hash.`,
        "INVALID",
      );
      continue;
    }
    add(`${key}_integrity`, `${label} integrity`, "PASS", `${v} content hash verified.`);
    const approvedHere = a.status === "APPROVED" && a.activeApproval?.contentHash === a.storedHash;
    if (!approvedHere) {
      add(
        `${key}_approved`,
        `${label} approved`,
        "FAIL",
        a.activeApproval
          ? `${label} ${v} approval does not match its content.`
          : `${label} ${v} is not approved.`,
        input.frozen ? "STALE" : "BLOCKING",
      );
    } else if (
      input.frozen &&
      a.recordedApprovalId &&
      a.recordedApprovalId !== a.activeApproval!.id
    ) {
      add(
        `${key}_approved`,
        `${label} approved`,
        "FAIL",
        `The approval of ${label.toLowerCase()} ${v} changed after the package was prepared.`,
        "STALE",
      );
    } else add(`${key}_approved`, `${label} approved`, "PASS", `${v} approved.`);
    if (a.editedAfterApproval)
      add(
        `${key}_current`,
        `${label} current`,
        "FAIL",
        `${label} ${v} was edited after approval — the approved text is no longer the intended version.`,
        "STALE",
      );
    else if (a.newerApprovedVersion)
      add(
        `${key}_current`,
        `${label} current`,
        "FAIL",
        `A newer approved version (v${a.newerApprovedVersion}) exists.`,
        "STALE",
      );
    else add(`${key}_current`, `${label} current`, "PASS", `${v} is the latest approved version.`);
    if (!a.jobConsistent)
      add(
        `${key}_job`,
        `${label} is for this job`,
        "FAIL",
        a.jobDetail ?? `${label} was prepared for a different job.`,
        "INVALID",
      );
    if (type !== "RESUME") {
      if (!a.check)
        add(
          `${key}_claims`,
          `${label} claims validated`,
          "FAIL",
          "No quality check for this exact content.",
          "BLOCKING",
        );
      else {
        add(
          `${key}_claims`,
          `${label} claims validated`,
          a.check.unsupported ? "FAIL" : "PASS",
          a.check.unsupported
            ? `${a.check.unsupported} unsupported statement(s).`
            : "Every statement is supported or flagged for review.",
        );
        add(
          `${key}_critical`,
          `${label} has no critical issues`,
          a.check.critical ? "FAIL" : "PASS",
          a.check.critical ? `${a.check.critical} critical finding(s).` : "0 critical findings.",
        );
      }
      if (a.resumeVersionId && input.resumeVersionId && a.resumeVersionId !== input.resumeVersionId)
        add(
          `${key}_resume`,
          `${label} matches the resume`,
          "FAIL",
          `${label} was written for a different resume version.`,
          "INVALID",
        );
    }
  }

  // Recipient
  const r = input.recipient;
  const needsEmail = input.channel === "EMAIL";
  if (!r) {
    add(
      "recipient",
      "Recipient context",
      needsEmail ? "FAIL" : "NA",
      needsEmail
        ? "An email application needs a recipient email address you know — none is set (nothing is guessed)."
        : "Not required for a portal application.",
      "MISSING",
    );
  } else if (r.verificationStatus === "INVALID" || r.verificationStatus === "STALE") {
    add(
      "recipient",
      "Recipient context",
      "FAIL",
      `Recipient details are marked ${r.verificationStatus.toLowerCase()}.`,
      input.frozen ? "STALE" : "BLOCKING",
    );
  } else if (input.frozen && r.changedSinceSnapshot) {
    add(
      "recipient",
      "Recipient context",
      "FAIL",
      "Recipient details changed after the package was prepared.",
      "STALE",
    );
  } else if (needsEmail && !r.email) {
    add("recipient", "Recipient context", "FAIL", "Recipient email is missing.", "MISSING");
  } else if (r.verificationStatus !== "SOURCE_VERIFIED") {
    add(
      "recipient",
      "Recipient context",
      "WARN",
      `${r.name ?? r.email ?? "Recipient"} — not source-verified (your own details).`,
    );
  } else add("recipient", "Recipient context", "PASS", `${r.name ?? r.email} — source verified.`);

  const emailAsset = input.assets.EMAIL;
  if (
    r?.email &&
    emailAsset?.recipientEmail &&
    emailAsset.recipientEmail.toLowerCase() !== r.email.toLowerCase()
  )
    add(
      "recipient_consistent",
      "Recipient matches the email",
      "FAIL",
      "The email was prepared for a different recipient address.",
      "INVALID",
    );

  const fails = items.filter((i) => i.status === "FAIL");
  return {
    items,
    ready: fails.length === 0,
    staleReasons: fails.filter((i) => i.kind === "STALE").map((i) => i.detail),
    invalidReasons: fails.filter((i) => i.kind === "INVALID").map((i) => i.detail),
  };
}

/**
 * Next status for a package after an evaluation. Frozen packages only move forward
 * (READY_FOR_APPLICATION → STALE / INVALID); editable ones follow the checklist.
 */
export function nextStatus(current: PackageStatus, evaluation: Evaluation): PackageStatus {
  if (current === "ARCHIVED" || current === "STALE" || current === "INVALID") return current;
  if (current === "READY_FOR_APPLICATION") {
    if (evaluation.invalidReasons.length) return "INVALID";
    if (!evaluation.ready) return "STALE";
    return current;
  }
  if (evaluation.invalidReasons.length) return "INCOMPLETE";
  return evaluation.ready ? "READY_FOR_REVIEW" : "INCOMPLETE";
}

export interface IntegrityInput {
  jobId: string;
  jobContentHash: string | null;
  channel: PackageChannel;
  includeEmail: boolean;
  includeCoverLetter: boolean;
  matchId: string | null;
  requirementSetId: string | null;
  jobResearchId: string | null;
  candidateSnapshotHash: string | null;
  assets: { type: AssetType; versionId: string; contentHash: string }[];
  recipient: Record<string, unknown>;
  strategy: Record<string, unknown>;
}

const stable = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(stable)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v as object)
            .sort()
            .map((k) => [k, stable((v as Record<string, unknown>)[k])]),
        )
      : (v ?? null);

/** Reproducible package integrity hash (does not replace the per-asset content hashes). */
export function packageIntegrityHash(input: IntegrityInput): string {
  const assets = [...input.assets]
    .sort((a, b) => a.type.localeCompare(b.type))
    .map((a) => [a.type, a.versionId, a.contentHash]);
  return createHash("sha256")
    .update(JSON.stringify(stable({ ...input, assets, v: 1 })))
    .digest("hex");
}
