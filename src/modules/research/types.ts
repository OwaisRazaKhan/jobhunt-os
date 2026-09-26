import { z } from "zod";

/**
 * Phase 5 research contracts (client-safe). See docs/research.md.
 * Research is evidence-first: every claim links to the source(s) that support it, and
 * FACT / INTERPRETATION / INFERENCE / UNKNOWN / CONFLICTING are never mixed up.
 */

/** Bump when extraction/validation rules change: existing research becomes STALE. */
export const RESEARCH_ENGINE_VERSION = "research-1.0";

export const DEPTHS = ["QUICK", "STANDARD", "DEEP"] as const;
export type Depth = (typeof DEPTHS)[number];

export interface DepthConfig {
  label: string;
  description: string;
  maxPages: number;
  maxDurationMs: number;
  /** Official company pages to fetch beyond the homepage, by kind */
  pages: {
    about: number;
    careers: number;
    product: number;
    news: number;
    blog: number;
    docs: number;
  };
  searchQueries: number;
  searchFetches: number;
}

/** Tiers are bounded: every tier has a page cap and a time cap. */
export const DEPTH_CONFIG: Record<Depth, DepthConfig> = {
  QUICK: {
    label: "Quick",
    description: "Job listing + company homepage and about page. No search, no news.",
    maxPages: 3,
    maxDurationMs: 45_000,
    pages: { about: 1, careers: 0, product: 0, news: 0, blog: 0, docs: 0 },
    searchQueries: 0,
    searchFetches: 0,
  },
  STANDARD: {
    label: "Standard",
    description:
      "Quick + careers page, one product page, newsroom or blog, and (if a search provider is configured) one discovery query.",
    maxPages: 8,
    maxDurationMs: 90_000,
    pages: { about: 1, careers: 1, product: 1, news: 1, blog: 1, docs: 0 },
    searchQueries: 1,
    searchFetches: 2,
  },
  DEEP: {
    label: "Deep",
    description:
      "Standard + more product pages, newsroom and blog, documentation, two discovery queries and cross-source conflict checks. Still capped.",
    maxPages: 16,
    maxDurationMs: 180_000,
    pages: { about: 1, careers: 1, product: 3, news: 1, blog: 1, docs: 1 },
    searchQueries: 2,
    searchFetches: 4,
  },
};

export const SOURCE_TYPES = [
  "OFFICIAL_JOB",
  "OFFICIAL_COMPANY",
  "OFFICIAL_CAREERS",
  "OFFICIAL_PRODUCT",
  "OFFICIAL_NEWS",
  "OFFICIAL_BLOG",
  "OFFICIAL_DOCUMENTATION",
  "PUBLIC_NEWS",
  "PUBLIC_DATABASE",
  "SEARCH_RESULT",
  "MANUAL",
  "OTHER",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const RELIABILITY = ["AUTHORITATIVE", "STRONG", "SECONDARY", "DISCOVERY_ONLY"] as const;
export type Reliability = (typeof RELIABILITY)[number];

/** Source type → default reliability. Search snippets are never evidence on their own. */
export const SOURCE_RELIABILITY: Record<SourceType, Reliability> = {
  OFFICIAL_JOB: "AUTHORITATIVE",
  OFFICIAL_COMPANY: "AUTHORITATIVE",
  OFFICIAL_CAREERS: "AUTHORITATIVE",
  OFFICIAL_PRODUCT: "AUTHORITATIVE",
  OFFICIAL_NEWS: "AUTHORITATIVE",
  OFFICIAL_BLOG: "STRONG",
  OFFICIAL_DOCUMENTATION: "STRONG",
  PUBLIC_NEWS: "SECONDARY",
  PUBLIC_DATABASE: "SECONDARY",
  MANUAL: "SECONDARY",
  OTHER: "SECONDARY",
  SEARCH_RESULT: "DISCOVERY_ONLY",
};

/** Higher = preferred when sources conflict (conflicts are still kept, never deleted). */
export const RELIABILITY_RANK: Record<Reliability, number> = {
  AUTHORITATIVE: 4,
  STRONG: 3,
  SECONDARY: 2,
  DISCOVERY_ONLY: 1,
};

export const CLAIM_TYPES = [
  "FACT",
  "INTERPRETATION",
  "INFERENCE",
  "UNKNOWN",
  "CONFLICTING",
] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];
export const VERIFICATIONS = [
  "VERIFIED_FROM_SOURCE",
  "PENDING_REVIEW",
  "REJECTED",
  "CONFLICTING",
] as const;
export type Verification = (typeof VERIFICATIONS)[number];
export type Temporal = "CURRENT" | "HISTORICAL" | "UNDATED";

export const RESEARCH_STATUSES = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "COMPLETED",
  "PARTIAL",
  "FAILED",
  "STALE",
  "NEEDS_REVIEW",
] as const;
export type ResearchStatus = (typeof RESEARCH_STATUSES)[number];
export type StoredStatus = "COMPLETED" | "PARTIAL" | "NEEDS_REVIEW" | "FAILED";

export type Freshness = "FRESH" | "AGING" | "STALE" | "UNKNOWN";

export interface FreshnessPolicy {
  freshDays: number;
  staleDays: number;
}
export const DEFAULT_FRESHNESS: FreshnessPolicy = { freshDays: 14, staleDays: 45 };

/**
 * FRESH: researched within freshDays. AGING: until staleDays. STALE: older, invalidated
 * (source / job / website changed, manual source added) or produced by an older engine version.
 */
export function freshnessOf(
  research: { researchedAt: Date; invalidatedAt: Date | null; engineVersion: string } | null,
  policy: FreshnessPolicy,
  now = new Date(),
): Freshness {
  if (!research) return "UNKNOWN";
  if (research.invalidatedAt || research.engineVersion !== RESEARCH_ENGINE_VERSION) return "STALE";
  const days = (now.getTime() - research.researchedAt.getTime()) / 86_400_000;
  if (days <= policy.freshDays) return "FRESH";
  if (days <= policy.staleDays) return "AGING";
  return "STALE";
}

// --- Claims produced by extractors (before persistence) -----------------------------------

export interface EvidenceRef {
  /** Key of a source in the run's source table (url-normalized) */
  sourceKey: string;
  excerpt: string;
  reference?: string;
}

export interface DraftClaim {
  section: string;
  claim: string;
  claimType: ClaimType;
  verification: Verification;
  method: "RULE" | "AI" | "USER";
  valueKey?: string;
  value?: string;
  temporal?: Temporal;
  rejectionReason?: string;
  evidence: EvidenceRef[];
}

/** A brief item: text plus the claim(s) behind it (claim ids after persistence). */
export interface BriefItem {
  text: string;
  claimIds: string[];
  type: ClaimType;
}

export interface CompanyBrief {
  whatTheyDo: BriefItem[];
  productsServices: BriefItem[];
  industry: BriefItem[];
  marketsServed: BriefItem[];
  companyPositioning: BriefItem[];
  relevantActivity: BriefItem[];
  technologySignals: BriefItem[];
  marketingSignals: BriefItem[];
  growthSignals: BriefItem[];
  facts: BriefItem[];
  conflicts: BriefItem[];
  officialLinks: { kind: string; url: string }[];
  unknowns: string[];
}

export interface JobBrief {
  roleSummary: BriefItem[];
  rolePurpose: BriefItem[];
  keyResponsibilities: BriefItem[];
  rolePriorities: BriefItem[];
  requiredSkills: BriefItem[];
  preferredSkills: BriefItem[];
  requiredExperience: BriefItem[];
  preferredExperience: BriefItem[];
  educationExpectations: BriefItem[];
  languageRequirements: BriefItem[];
  workModel: BriefItem[];
  locationContext: BriefItem[];
  salaryContext: BriefItem[];
  authorizationContext: BriefItem[];
  applicationInstructions: BriefItem[];
  importantTerms: { term: string; count: number; claimId: string | null }[];
  relevantPublicContext: BriefItem[];
  aiSynthesis: BriefItem[];
  openQuestions: string[];
  /** Phase 4 context — reference only, never changed here */
  matchContext: { matchId: string; overallStatus: string; computedAt: string } | null;
}

export interface CompletenessDimension {
  key: string;
  label: string;
  state: "COMPLETE" | "PARTIAL" | "MISSING";
  detail: string;
}

export interface ResearchStats {
  sourcesFound: number;
  sourcesFailed: number;
  authoritative: number;
  strong: number;
  secondary: number;
  discoveryOnly: number;
  claimsVerified: number;
  claimsPending: number;
  claimsRejected: number;
  claimsUnknown: number;
  conflicts: number;
}

// --- Inputs ------------------------------------------------------------------------------------

export const depthSchema = z.enum(DEPTHS);

export const researchOptionsSchema = z.object({
  depth: depthSchema.optional(),
  /** Re-research the company even if current company research is fresh */
  refreshCompany: z.boolean().optional(),
});
export type ResearchOptions = z.infer<typeof researchOptionsSchema>;

export const noteInput = z.object({ body: z.string().trim().min(1, "Write a note").max(4000) });

export const researchSettingsInput = z
  .object({
    defaultDepth: depthSchema,
    freshDays: z.coerce.number().int().min(1).max(365),
    staleDays: z.coerce.number().int().min(2).max(730),
    aiSynthesis: z.boolean(),
  })
  .refine((v) => v.staleDays > v.freshDays, {
    path: ["staleDays"],
    message: "Stale threshold must be longer than the fresh threshold",
  });

// --- Labels -----------------------------------------------------------------------------------

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  OFFICIAL_JOB: "Official job listing",
  OFFICIAL_COMPANY: "Official company site",
  OFFICIAL_CAREERS: "Official careers page",
  OFFICIAL_PRODUCT: "Official product page",
  OFFICIAL_NEWS: "Official newsroom",
  OFFICIAL_BLOG: "Official blog",
  OFFICIAL_DOCUMENTATION: "Official documentation",
  PUBLIC_NEWS: "Public news",
  PUBLIC_DATABASE: "Public database",
  SEARCH_RESULT: "Search result (discovery only)",
  MANUAL: "Added by you",
  OTHER: "Other",
};

export const CLAIM_TYPE_LABELS: Record<ClaimType, string> = {
  FACT: "Fact",
  INTERPRETATION: "Interpretation",
  INFERENCE: "Inference",
  UNKNOWN: "Unknown",
  CONFLICTING: "Conflicting",
};

export const VERIFICATION_LABELS: Record<Verification, string> = {
  VERIFIED_FROM_SOURCE: "Verified from source",
  PENDING_REVIEW: "Pending review",
  REJECTED: "Rejected",
  CONFLICTING: "Conflicting sources",
};

export const STATUS_LABELS: Record<ResearchStatus, string> = {
  NOT_STARTED: "Research not run",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  PARTIAL: "Partial",
  FAILED: "Failed",
  STALE: "Stale",
  NEEDS_REVIEW: "Needs review",
};

export const FRESHNESS_LABELS: Record<Freshness, string> = {
  FRESH: "Fresh",
  AGING: "Aging",
  STALE: "Stale",
  UNKNOWN: "Unknown",
};

export const WEBSITE_UNKNOWN_MESSAGE = "Company website could not be confidently identified.";
