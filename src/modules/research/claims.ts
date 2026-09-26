import { z } from "zod";
import { foldText } from "@/modules/search-profiles/criteria";
import type {
  CompletenessDimension,
  DraftClaim,
  EvidenceRef,
  Reliability,
  ResearchStats,
  StoredStatus,
} from "./types";

/**
 * Pure claim logic: AI output validation, stats, completeness and status.
 * Nothing here decides anything with AI; every rule is deterministic and documented in
 * docs/research.md.
 */

// --- AI synthesis contract ------------------------------------------------------------------

export const aiSynthesisSchema = z.object({
  claims: z
    .array(
      z.object({
        text: z.string().min(1).max(500),
        type: z.enum(["FACT", "INTERPRETATION", "INFERENCE"]),
        evidenceIds: z.array(z.string().max(20)).max(6),
      }),
    )
    .max(20),
});
export type AiSynthesis = z.infer<typeof aiSynthesisSchema>;

export interface EvidenceForAi {
  id: string; // "E1", "E2", …
  sourceKey: string;
  excerpt: string;
}

const COMMON = new Set(
  "the a an and or of to in on for with by from at as is are was were be been this that these those it its their our we you they company role team job posting official site page".split(
    " ",
  ),
);

/**
 * Tokens that must be supported by the cited evidence: numbers (years, amounts, percentages)
 * and proper nouns (capitalised words that are not the first word of the sentence).
 */
export function salientTokens(text: string, ignore: string[] = []): string[] {
  const ignored = new Set(ignore.flatMap((i) => foldText(i).split(" ")).filter(Boolean));
  const out = new Set<string>();
  for (const n of text.match(/\b\d[\d.,%]*\b/g) ?? []) out.add(n.replace(/[.,]+$/, ""));
  const words = text.split(/\s+/);
  words.forEach((raw, i) => {
    const w = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
    if (!w || i === 0 || /[.!?:]$/.test(words[i - 1] ?? "")) return;
    if (
      /^[A-Z][A-Za-z0-9&-]+$/.test(w) &&
      !COMMON.has(w.toLowerCase()) &&
      !ignored.has(w.toLowerCase())
    )
      out.add(w);
  });
  return [...out];
}

export type AiValidation = { accepted: DraftClaim[]; rejected: DraftClaim[] };

/**
 * Keep only AI claims that cite known evidence IDs AND whose numbers / proper nouns all appear in
 * the cited excerpts. Accepted AI claims are PENDING_REVIEW (AI never verifies anything);
 * the rest are stored as REJECTED with the reason, so they can never appear as facts.
 */
export function validateAiClaims(
  output: AiSynthesis,
  evidence: EvidenceForAi[],
  section: string,
  ignoreNames: string[] = [],
): AiValidation {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const accepted: DraftClaim[] = [];
  const rejected: DraftClaim[] = [];
  for (const c of output.claims) {
    const cited = c.evidenceIds
      .map((id) => byId.get(id))
      .filter((e): e is EvidenceForAi => Boolean(e));
    const refs: EvidenceRef[] = cited.map((e) => ({
      sourceKey: e.sourceKey,
      excerpt: e.excerpt.slice(0, 1000),
      reference: `AI cited ${e.id}`,
    }));
    const base = {
      section,
      claim: c.text,
      claimType: c.type,
      method: "AI" as const,
      temporal: "UNDATED" as const,
    };
    let reason: string | null = null;
    if (!c.evidenceIds.length) reason = "No supporting source cited.";
    else if (cited.length !== c.evidenceIds.length) reason = "Cites evidence that does not exist.";
    else {
      const haystack = ` ${foldText(cited.map((e) => e.excerpt).join(" "))} `;
      const missing = salientTokens(c.text, ignoreNames).filter(
        (t) => !haystack.includes(` ${foldText(t)}`),
      );
      if (missing.length)
        reason = `No supporting source: “${missing.slice(0, 3).join("”, “")}” does not appear in the cited evidence.`;
    }
    if (reason)
      rejected.push({ ...base, verification: "REJECTED", rejectionReason: reason, evidence: refs });
    else accepted.push({ ...base, verification: "PENDING_REVIEW", evidence: refs });
  }
  return { accepted, rejected };
}

// --- Stats, completeness, status ----------------------------------------------------------------

export interface SourceOutcome {
  key: string;
  ok: boolean;
  reliability: Reliability;
  sourceType: string;
  /** Attempted and failed (network, blocked, robots, unsafe…) */
  failed: boolean;
}

export function computeStats(sources: SourceOutcome[], claims: DraftClaim[]): ResearchStats {
  const ok = sources.filter((s) => s.ok);
  return {
    sourcesFound: ok.length,
    sourcesFailed: sources.filter((s) => s.failed).length,
    authoritative: ok.filter((s) => s.reliability === "AUTHORITATIVE").length,
    strong: ok.filter((s) => s.reliability === "STRONG").length,
    secondary: ok.filter((s) => s.reliability === "SECONDARY").length,
    discoveryOnly: ok.filter((s) => s.reliability === "DISCOVERY_ONLY").length,
    claimsVerified: claims.filter((c) => c.verification === "VERIFIED_FROM_SOURCE").length,
    claimsPending: claims.filter(
      (c) => c.verification === "PENDING_REVIEW" && c.claimType !== "UNKNOWN",
    ).length,
    claimsRejected: claims.filter((c) => c.verification === "REJECTED").length,
    claimsUnknown: claims.filter((c) => c.claimType === "UNKNOWN").length,
    conflicts: new Set(
      claims.filter((c) => c.verification === "CONFLICTING").map((c) => c.valueKey),
    ).size,
  };
}

/** COMPLETED / PARTIAL / NEEDS_REVIEW / FAILED — deterministic (see docs/research.md). */
export function researchStatus(stats: ResearchStats): StoredStatus {
  if (stats.sourcesFound === 0) return "FAILED";
  if (stats.sourcesFailed > 0) return "PARTIAL";
  if (stats.conflicts > 0 || stats.claimsPending > 0) return "NEEDS_REVIEW";
  return "COMPLETED";
}

export interface CompletenessInput {
  job?: { descriptionLength: number; purposeFound: boolean; responsibilities: number };
  websiteIdentified: boolean;
  websiteFetched: boolean;
  careers: "OK" | "FAILED" | "NOT_FOUND";
  activityChecked: boolean;
  activityFound: number;
  stats: ResearchStats;
}

export function computeCompleteness(input: CompletenessInput): CompletenessDimension[] {
  const d: CompletenessDimension[] = [];
  const { stats } = input;
  if (input.job)
    d.push({
      key: "OFFICIAL_JOB",
      label: "Official job",
      state:
        input.job.descriptionLength >= 200
          ? "COMPLETE"
          : input.job.descriptionLength > 0
            ? "PARTIAL"
            : "MISSING",
      detail: `${input.job.descriptionLength} characters of posting text`,
    });
  d.push({
    key: "COMPANY_WEBSITE",
    label: "Company website",
    state: input.websiteFetched ? "COMPLETE" : input.websiteIdentified ? "PARTIAL" : "MISSING",
    detail: input.websiteFetched
      ? "Identified and fetched"
      : input.websiteIdentified
        ? "Identified, but could not be fetched"
        : "Not identified",
  });
  d.push({
    key: "COMPANY_CAREERS",
    label: "Company careers",
    state: input.careers === "OK" ? "COMPLETE" : input.careers === "FAILED" ? "PARTIAL" : "MISSING",
    detail:
      input.careers === "OK"
        ? "Careers page fetched"
        : input.careers === "FAILED"
          ? "Careers page could not be fetched"
          : "No careers page found",
  });
  if (input.job)
    d.push({
      key: "ROLE_CONTEXT",
      label: "Role context",
      state:
        input.job.purposeFound || input.job.responsibilities >= 3
          ? "COMPLETE"
          : input.job.responsibilities > 0
            ? "PARTIAL"
            : "MISSING",
      detail: `${input.job.responsibilities} responsibilities${input.job.purposeFound ? ", role purpose stated" : ", role purpose not stated"}`,
    });
  d.push({
    key: "PUBLIC_ACTIVITY",
    label: "Relevant public activity",
    state: input.activityFound > 0 ? "COMPLETE" : input.activityChecked ? "PARTIAL" : "MISSING",
    detail:
      input.activityFound > 0
        ? `${input.activityFound} dated items`
        : input.activityChecked
          ? "Checked — none found"
          : "Not checked",
  });
  d.push({
    key: "SOURCES",
    label: "Sources",
    state:
      stats.sourcesFound >= 3 && stats.authoritative >= 2
        ? "COMPLETE"
        : stats.sourcesFound > 0
          ? "PARTIAL"
          : "MISSING",
    detail: `${stats.sourcesFound} sources (${stats.authoritative} authoritative)`,
  });
  d.push({
    key: "CLAIMS_VALIDATED",
    label: "Claims validated",
    state:
      stats.claimsVerified === 0
        ? "MISSING"
        : stats.claimsPending === 0 && stats.conflicts === 0
          ? "COMPLETE"
          : "PARTIAL",
    detail: `${stats.claimsVerified} verified, ${stats.claimsPending} pending, ${stats.conflicts} conflicts`,
  });
  return d;
}
