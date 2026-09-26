/**
 * Communication Studio (Phase 7) — client-safe constants. Communications are PREPARED here and
 * never sent: Phase 7 has no delivery channel of any kind.
 */

export const COMMUNICATION_KINDS = ["EMAIL", "COVER_LETTER"] as const;
export type CommunicationKind = (typeof COMMUNICATION_KINDS)[number];

export const EMAIL_TYPES = [
  "APPLICATION_EMAIL",
  "RECRUITER_OUTREACH",
  "HIRING_MANAGER_OUTREACH",
  "GENERAL_HR_OUTREACH",
  "NETWORKING_INTRODUCTION",
  "PORTFOLIO_INTRODUCTION",
  "CUSTOM_EMAIL",
] as const;
export const COMMUNICATION_TYPES = [...EMAIL_TYPES, "COVER_LETTER"] as const;
export type CommunicationType = (typeof COMMUNICATION_TYPES)[number];

export const RECIPIENT_TYPES = [
  "RECRUITER",
  "HIRING_MANAGER",
  "HR",
  "TEAM_MEMBER",
  "GENERAL_COMPANY",
  "UNKNOWN",
  "CUSTOM",
] as const;
export type RecipientType = (typeof RECIPIENT_TYPES)[number];

export const TONES = [
  "NATURAL",
  "PROFESSIONAL",
  "WARM",
  "DIRECT",
  "CONFIDENT",
  "CONCISE",
  "FORMAL",
] as const;
export type Tone = (typeof TONES)[number];

export const LENGTHS = ["SHORT", "STANDARD", "DETAILED"] as const;
export type Length = (typeof LENGTHS)[number];

export const COVER_LETTER_TEMPLATES = ["CLASSIC", "MODERN", "MINIMAL", "EDITORIAL"] as const;
export type CoverLetterTemplate = (typeof COVER_LETTER_TEMPLATES)[number];

export const VERSION_STATUSES = [
  "DRAFT",
  "READY_FOR_REVIEW",
  "APPROVED",
  "REJECTED",
  "ARCHIVED",
] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

export const VERSION_TYPES = [
  "GENERATED",
  "AI_ASSISTED",
  "MANUAL_EDIT",
  "RESTORED",
  "DUPLICATED",
  "IMPORTED",
] as const;
export type VersionType = (typeof VERSION_TYPES)[number];

export const CONTENT_SOURCES = [
  "AI_GENERATED",
  "AI_ASSISTED",
  "USER_AUTHORED",
  "IMPORTED",
  "RESTORED",
] as const;
export type ContentSource = (typeof CONTENT_SOURCES)[number];

export const CLAIM_STATUSES = [
  "SUPPORTED",
  "PARTIALLY_SUPPORTED",
  "UNSUPPORTED",
  "UNKNOWN",
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const CLAIM_KINDS = ["CANDIDATE", "COMPANY", "USER_CONTEXT"] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

export const TYPE_LABELS: Record<CommunicationType, string> = {
  APPLICATION_EMAIL: "Application email",
  RECRUITER_OUTREACH: "Recruiter outreach",
  HIRING_MANAGER_OUTREACH: "Hiring manager outreach",
  GENERAL_HR_OUTREACH: "General HR outreach",
  NETWORKING_INTRODUCTION: "Networking introduction",
  PORTFOLIO_INTRODUCTION: "Portfolio introduction",
  CUSTOM_EMAIL: "Custom email",
  COVER_LETTER: "Cover letter",
};

export const RECIPIENT_LABELS: Record<RecipientType, string> = {
  RECRUITER: "Recruiter",
  HIRING_MANAGER: "Hiring manager",
  HR: "HR",
  TEAM_MEMBER: "Team member",
  GENERAL_COMPANY: "Company (general)",
  UNKNOWN: "Unknown",
  CUSTOM: "Custom",
};

export const STATUS_LABELS: Record<VersionStatus, string> = {
  DRAFT: "Draft",
  READY_FOR_REVIEW: "Ready for review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  ARCHIVED: "Archived",
};

export const SOURCE_LABELS: Record<ContentSource, string> = {
  AI_GENERATED: "AI-generated",
  AI_ASSISTED: "AI-assisted",
  USER_AUTHORED: "Written by you",
  IMPORTED: "Imported",
  RESTORED: "Restored",
};

export function kindOf(type: CommunicationType): CommunicationKind {
  return type === "COVER_LETTER" ? "COVER_LETTER" : "EMAIL";
}

/** A neutral greeting that never invents a recipient name. */
export function defaultGreeting(
  recipientName: string | null | undefined,
  recipientType: RecipientType,
): string {
  const name = recipientName?.trim();
  if (name) return `Dear ${name},`;
  switch (recipientType) {
    case "RECRUITER":
      return "Dear Recruiter,";
    case "HIRING_MANAGER":
      return "Dear Hiring Manager,";
    case "HR":
      return "Dear HR Team,";
    default:
      return "Dear Hiring Team,";
  }
}
