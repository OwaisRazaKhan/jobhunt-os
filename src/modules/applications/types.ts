/**
 * Application Engine (Phase 8) — client-safe constants.
 * An application is one candidate's attempt at one job. READY ≠ SUBMITTED: success states are
 * only reached with recorded evidence (enforced by DB CHECKs as well as the services).
 */

export const APPLICATION_STATUSES = [
  "DRAFT",
  "READY",
  "IN_PROGRESS",
  "NEEDS_HUMAN_INPUT",
  "READY_TO_SUBMIT",
  "SUBMITTING",
  "SUBMITTED",
  "SUBMISSION_CONFIRMED",
  "SUBMISSION_UNCERTAIN",
  "FAILED",
  "BLOCKED",
  "CANCELLED",
  "WITHDRAWN",
  "ARCHIVED",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const AUTOMATION_MODES = [
  "MANUAL_ONLY",
  "HUMAN_APPROVAL",
  "AUTO_FILL_REVIEW_SUBMIT",
] as const;
export type AutomationMode = (typeof AUTOMATION_MODES)[number];
export const DEFAULT_AUTOMATION_MODE: AutomationMode = "HUMAN_APPROVAL";

export const READINESS = ["NOT_READY", "READY", "NEEDS_USER_INPUT", "BLOCKED", "STALE"] as const;
export type Readiness = (typeof READINESS)[number];

export const CHANNEL_TYPES = [
  "ATS",
  "CAREERS_PAGE",
  "APPLICATION_FORM",
  "EMAIL_APPLICATION",
  "EXTERNAL_PORTAL",
  "MANUAL_APPLICATION",
  "UNKNOWN",
] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];
export const ATS_PROVIDERS = ["GREENHOUSE", "LEVER", "ASHBY", "OTHER", "NONE"] as const;
export type AtsProvider = (typeof ATS_PROVIDERS)[number];
export const CHANNEL_SOURCES = [
  "JOB_RECORD",
  "JOB_POST",
  "ATS_API",
  "OFFICIAL_CAREERS_PAGE",
  "OFFICIAL_COMPANY_PAGE",
  "USER_PROVIDED",
  "UNKNOWN",
] as const;
export const CHANNEL_VERIFICATION = [
  "SOURCE_VERIFIED",
  "UNVERIFIED",
  "STALE",
  "INVALID",
  "INFERRED",
] as const;

export const ATTEMPT_STATUSES = [
  "QUEUED",
  "RUNNING",
  "PAUSED",
  "NEEDS_HUMAN_INPUT",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "UNCERTAIN",
] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];
export const ACTIVE_ATTEMPT_STATUSES: readonly AttemptStatus[] = [
  "QUEUED",
  "RUNNING",
  "PAUSED",
  "NEEDS_HUMAN_INPUT",
];

export const ERROR_CODES = [
  "FORM_FIELD_NOT_FOUND",
  "FILE_UPLOAD_FAILED",
  "SESSION_EXPIRED",
  "NETWORK_ERROR",
  "AUTHENTICATION_REQUIRED",
  "CAPTCHA_REQUIRED",
  "TWO_FACTOR_REQUIRED",
  "ANTI_BOT_BLOCKED",
  "RATE_LIMITED",
  "FORM_CHANGED",
  "SUBMISSION_REJECTED",
  "UNKNOWN_RESULT",
  "UNSAFE_URL",
  "JOB_CLOSED",
  "TIMEOUT",
  "CANCELLED",
  "VALIDATION_FAILED",
  "INTERNAL_ERROR",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
/** Barriers that must stop automation and hand control to the human — never bypassed. */
export const HUMAN_BARRIERS: readonly ErrorCode[] = [
  "CAPTCHA_REQUIRED",
  "TWO_FACTOR_REQUIRED",
  "AUTHENTICATION_REQUIRED",
  "ANTI_BOT_BLOCKED",
];

export const FIELD_TYPES = [
  "TEXT",
  "TEXTAREA",
  "EMAIL",
  "PHONE",
  "URL",
  "NUMBER",
  "DATE",
  "SELECT",
  "MULTISELECT",
  "RADIO",
  "CHECKBOX",
  "FILE",
  "ADDRESS",
  "LOCATION",
  "YES_NO",
  "CUSTOM",
  "UNKNOWN",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export const FIELD_CLASSIFICATIONS = [
  "FACTUAL",
  "EXPERIENCE",
  "PREFERENCE",
  "MOTIVATION",
  "BEHAVIORAL",
  "TECHNICAL",
  "LEGAL",
  "DEMOGRAPHIC",
  "CONSENT",
  "FILE",
  "OTHER",
] as const;
export type FieldClassification = (typeof FIELD_CLASSIFICATIONS)[number];

export const MAPPING_TYPES = [
  "CANDIDATE_FACT",
  "CANDIDATE_PROFILE",
  "RESUME",
  "COVER_LETTER",
  "COMMUNICATION_PACKAGE",
  "GENERATED_ANSWER",
  "USER_INPUT",
  "UNKNOWN",
] as const;
export type MappingType = (typeof MAPPING_TYPES)[number];
export const MAPPING_CONFIDENCE = ["EXACT", "HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const;
export type MappingConfidence = (typeof MAPPING_CONFIDENCE)[number];
export const FIELD_POLICIES = [
  "AUTO_FILL",
  "REQUIRE_REVIEW",
  "REQUIRE_USER_INPUT",
  "BLOCK",
] as const;
export type FieldPolicy = (typeof FIELD_POLICIES)[number];

export const ANSWER_TYPES = [
  "CANDIDATE_FACT",
  "EXPERIENCE",
  "PROJECT",
  "MOTIVATION",
  "COMPANY_INTEREST",
  "ROLE_INTEREST",
  "BEHAVIORAL",
  "TECHNICAL",
  "PREFERENCES",
  "AVAILABILITY",
  "OTHER",
] as const;
export const ANSWER_VALIDATION = [
  "SUPPORTED",
  "PARTIALLY_SUPPORTED",
  "UNSUPPORTED",
  "NEEDS_USER_INPUT",
  "NOT_VALIDATED",
] as const;

export const SUBMISSION_STATUSES = [
  "SUBMITTING",
  "SUBMITTED",
  "SUBMISSION_CONFIRMED",
  "SUBMISSION_UNCERTAIN",
  "FAILED",
  "READY_TO_SEND",
  "SENDING",
  "SENT",
  "DELIVERY_UNKNOWN",
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];
export const CONFIRMATION_SOURCES = [
  "CONFIRMATION_PAGE",
  "CONFIRMATION_ID",
  "SUCCESS_MESSAGE",
  "EXTERNAL_APPLICATION_ID",
  "HTTP_API_SUCCESS",
  "USER_CONFIRMED",
] as const;
export type ConfirmationSource = (typeof CONFIRMATION_SOURCES)[number];

export const EVIDENCE_TYPES = [
  "SCREENSHOT",
  "CONFIRMATION_PAGE",
  "CONFIRMATION_ID",
  "SUCCESS_MESSAGE",
  "EXTERNAL_APPLICATION_ID",
  "HTTP_API_SUCCESS",
  "USER_CONFIRMED",
  "FAILURE_STATE",
  "REVIEW_STATE",
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const EVENT_TYPES = [
  "APPLICATION_CREATED",
  "PACKAGE_VALIDATED",
  "CHANNEL_DETECTED",
  "CHANNEL_RESOLVED",
  "FORM_OPENED",
  "FORM_DISCOVERED",
  "FORM_ANALYZED",
  "FORM_CHANGED",
  "FIELDS_MAPPED",
  "FIELD_OVERRIDDEN",
  "ANSWER_GENERATED",
  "ANSWER_VALIDATED",
  "ANSWER_EDITED",
  "ANSWER_APPROVED",
  "FILES_ATTACHED",
  "READY_FOR_REVIEW",
  "WAITING_FOR_USER",
  "APPROVED",
  "APPROVAL_INVALIDATED",
  "AUTOFILL_STARTED",
  "AUTOFILL_COMPLETED",
  "PAUSED",
  "RESUMED",
  "STOPPED",
  "SUBMISSION_STARTED",
  "SUBMITTED",
  "CONFIRMED",
  "SUBMISSION_UNCERTAIN",
  "USER_CONFIRMED",
  "FAILED",
  "BLOCKED",
  "STATUS_CHANGED",
  "CANCELLED",
  "WITHDRAWN",
  "ARCHIVED",
  "STALE_DETECTED",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  DRAFT: "Draft",
  READY: "Ready for review",
  IN_PROGRESS: "In progress",
  NEEDS_HUMAN_INPUT: "Needs your input",
  READY_TO_SUBMIT: "Approved — ready to submit",
  SUBMITTING: "Submitting",
  SUBMITTED: "Submitted",
  SUBMISSION_CONFIRMED: "Submission confirmed",
  SUBMISSION_UNCERTAIN: "Submission uncertain",
  FAILED: "Failed",
  BLOCKED: "Blocked",
  CANCELLED: "Cancelled",
  WITHDRAWN: "Withdrawn",
  ARCHIVED: "Archived",
};

/** Dashboard filters (real records only). */
export const APPLICATION_FILTERS = {
  all: { label: "All", statuses: null },
  draft: { label: "Draft", statuses: ["DRAFT"] },
  ready: { label: "Ready", statuses: ["READY", "READY_TO_SUBMIT"] },
  attention: { label: "Needs attention", statuses: ["NEEDS_HUMAN_INPUT", "SUBMISSION_UNCERTAIN"] },
  progress: { label: "In progress", statuses: ["IN_PROGRESS", "SUBMITTING"] },
  submitted: { label: "Submitted", statuses: ["SUBMITTED", "SUBMISSION_CONFIRMED"] },
  failed: { label: "Failed", statuses: ["FAILED"] },
  blocked: { label: "Blocked", statuses: ["BLOCKED"] },
  archived: { label: "Archived", statuses: ["ARCHIVED", "CANCELLED", "WITHDRAWN"] },
} as const satisfies Record<
  string,
  { label: string; statuses: readonly ApplicationStatus[] | null }
>;
export type ApplicationFilter = keyof typeof APPLICATION_FILTERS;

export const ATTEMPT_PHASES = ["INSPECT", "FILL", "FILL_AND_SUBMIT", "SUBMIT"] as const;
export type AttemptPhase = (typeof ATTEMPT_PHASES)[number];
export const CONTROL_COMMANDS = ["NONE", "PAUSE", "RESUME", "STOP"] as const;
export type ControlCommand = (typeof CONTROL_COMMANDS)[number];
