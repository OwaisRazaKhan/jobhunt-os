/**
 * Deterministic matching engine contracts (client-safe, pure data).
 * The engine compares a job's STATED requirements with the candidate's STORED evidence.
 * It is a requirements-alignment engine — never a prediction of hiring, interview or offer.
 */

export type Verification = "VERIFIED" | "USER_PROVIDED" | "NEEDS_REVIEW" | "AI_INFERRED";

/** Only these may support a match (Phase 1 provenance rule). */
export const USABLE: readonly Verification[] = ["VERIFIED", "USER_PROVIDED"];
export const isUsable = (v: Verification) => USABLE.includes(v);

/** Evidence priority (#65): verified > user-provided > imported-unverified > AI-inferred. */
export const EVIDENCE_RANK: Record<Verification, number> = {
  VERIFIED: 4,
  USER_PROVIDED: 3,
  NEEDS_REVIEW: 2,
  AI_INFERRED: 1,
};

interface Fact {
  id: string;
  verification: Verification;
}

export interface CandidateEvidence {
  profile: {
    id: string;
    currentCountryCode: string | null;
    currentCity: string | null;
    portfolioUrl: string | null;
    verification: Verification;
  };
  preferences: {
    employmentTypes: string[];
    workModes: string[];
    relocation: string | null; // YES | NO | OPEN
    needsSponsorship: string | null; // YES | NO | DEPENDS_ON_COUNTRY
    salaryMin: number | null;
    salaryMax: number | null;
    salaryCurrency: string | null;
    salaryPeriod: string | null;
  } | null;
  targetLocations: { id: string; countryCode: string; city: string | null }[];
  skills: (Fact & { name: string; yearsUsed: number | null })[];
  experiences: (Fact & {
    title: string;
    organization: string;
    employmentType: string | null;
    startDate: string | null;
    endDate: string | null;
    isCurrent: boolean;
    description: string | null;
    responsibilities: string[];
    skillsUsed: string[];
  })[];
  education: (Fact & {
    institution: string;
    degree: string | null;
    fieldOfStudy: string | null;
    endDate: string | null;
    isCurrent: boolean;
  })[];
  projects: (Fact & {
    name: string;
    description: string | null;
    technologies: string[];
    skills: string[];
  })[];
  certifications: (Fact & { name: string; issuer: string | null; expiryDate: string | null })[];
  portfolio: (Fact & { title: string; type: string; url: string | null })[];
  languages: (Fact & { language: string; proficiency: string | null })[];
  authorizations: (Fact & { countryCode: string; status: string })[];
}

export interface MatchingSettings {
  workModeHard: boolean;
  employmentTypeHard: boolean;
  locationHard: boolean;
  salaryMinHard: boolean;
}

export const DEFAULT_SETTINGS: MatchingSettings = {
  workModeHard: false,
  employmentTypeHard: false,
  locationHard: false,
  salaryMinHard: false,
};

export interface RequirementLike {
  id: string;
  category: string;
  requirementType: string; // REQUIRED | PREFERRED | INFORMATIONAL | UNKNOWN
  text: string;
  normalizedValue: Record<string, unknown>;
  sourceText: string;
}

export const RESULT_STATUSES = [
  "MATCHED",
  "RELATED",
  "PARTIAL",
  "GAP",
  "UNKNOWN",
  "UNVERIFIED",
  "CONFLICT",
  "BLOCKED",
  "NOT_APPLICABLE",
] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];

/** REQUIRED / PREFERRED: stated job requirement not met. PREFERENCE: job differs from your preferences. */
export type GapKind = "REQUIRED" | "PREFERRED" | "PREFERENCE";

export interface EvidenceItem {
  /** "<kind>:<uuid>" — resolvable to one of the candidate's own facts */
  ref: string;
  kind: string;
  /** Short human label ("Skill: Google Analytics 4", "Experience: Marketing Intern — LeadZing") */
  label: string;
  /** Optional quote from the fact */
  excerpt?: string;
  verification: Verification;
}

export interface RequirementResult {
  requirementId: string;
  status: ResultStatus;
  relationship: "EXACT" | "RELATED" | "NONE" | null;
  gapKind: GapKind | null;
  isHardBlock: boolean;
  evidence: EvidenceItem[];
  explanation: string;
  method: "RULE" | "AI_ASSISTED";
}

export const OVERALL_STATUSES_V2 = [
  "STRONG_MATCH",
  "GOOD_MATCH",
  "PARTIAL_MATCH",
  "LOW_MATCH",
  "BLOCKED",
  "INSUFFICIENT_DATA",
] as const;
export type OverallStatusV2 = (typeof OVERALL_STATUSES_V2)[number];

export interface MatchCounts {
  total: number;
  assessed: number;
  matched: number;
  related: number;
  partial: number;
  requiredGaps: number;
  preferredGaps: number;
  preferenceGaps: number;
  unknown: number;
  unverified: number;
  conflicts: number;
  hardBlocks: number;
  notApplicable: number;
  requiredTotal: number;
  requiredMet: number;
}

export interface DimensionSummary {
  dimension: string;
  status:
    "STRONG_MATCH" | "MATCH" | "PARTIAL_MATCH" | "UNKNOWN" | "GAP" | "BLOCKED" | "NOT_APPLICABLE";
  isHard: boolean;
  summary: string;
  met: number;
  assessed: number;
}

export interface MatchComputation {
  overallStatus: OverallStatusV2;
  hardBlockReason: string | null;
  results: RequirementResult[];
  counts: MatchCounts;
  dimensions: DimensionSummary[];
  summary: string;
}
