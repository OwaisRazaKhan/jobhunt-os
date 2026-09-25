import "server-only";
import type { FactSourceType, VerificationStatus } from "@/generated/prisma/enums";
import { inSequence, mapInSequence, withUserContext, type Tx } from "@/server/db";
import type { ActorRef } from "./facts.service";
import { factLabel } from "./labels";
import { getPreferences, getProfile } from "./profile.service";
import { isUsableStatus } from "./provenance";
import { countPendingCandidates } from "./review.service";
import type { SectionKind } from "./schemas";
import {
  computeCompleteness,
  computeReadiness,
  computeWarnings,
  type CandidateSnapshot,
} from "./scoring";
import { SECTIONS } from "./sections";

/**
 * Candidate Knowledge Service — the retrieval foundation future phases build on.
 *
 * Every fact is addressable by a stable reference "<kind>:<uuid>" so later AI
 * generation can be required to cite the facts it uses (docs/ai-architecture.md
 * §2.4). Job-specific retrieval (getFactsForJobContext) is intentionally not
 * built until the matching phase.
 */

export type FactRef = `${SectionKind}:${string}`;

export interface CandidateFact {
  ref: FactRef;
  id: string;
  kind: SectionKind;
  label: string;
  value: Record<string, unknown>;
  verificationStatus: VerificationStatus;
  source: {
    type: FactSourceType;
    documentId: string | null;
    excerpt: string | null;
    confidence: number | null;
  };
  /** Sensitive facts (work authorization) must be excluded from AI context unless required. */
  sensitive: boolean;
  verifiedAt: Date | null;
  updatedAt: Date;
}

const VALUE_EXCLUDED = new Set([
  "id",
  "userId",
  "verificationStatus",
  "sourceType",
  "sourceDocumentId",
  "sourceFactCandidateId",
  "sourceExcerpt",
  "confidence",
  "verifiedAt",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "sortOrder",
  "nameNormalized",
  "languageNormalized",
]);

function toFact(kind: SectionKind, record: Record<string, unknown>): CandidateFact {
  const value = Object.fromEntries(
    Object.entries(record).filter(([key]) => !VALUE_EXCLUDED.has(key)),
  );
  return {
    ref: `${kind}:${String(record.id)}`,
    id: String(record.id),
    kind,
    label: factLabel(kind, record),
    value,
    verificationStatus: record.verificationStatus as VerificationStatus,
    source: {
      type: record.sourceType as FactSourceType,
      documentId: (record.sourceDocumentId as string | null) ?? null,
      excerpt: (record.sourceExcerpt as string | null) ?? null,
      confidence: (record.confidence as number | null) ?? null,
    },
    sensitive: kind === "authorization",
    verifiedAt: (record.verifiedAt as Date | null) ?? null,
    updatedAt: record.updatedAt as Date,
  };
}

export interface FactQuery {
  kinds?: SectionKind[];
  statuses?: VerificationStatus[];
  includeSensitive?: boolean;
}

export async function getCandidateFacts(
  actor: ActorRef,
  query: FactQuery = {},
  tx?: Tx,
): Promise<CandidateFact[]> {
  const kinds = query.kinds ?? (Object.keys(SECTIONS) as SectionKind[]);
  const run = async (t: Tx) => {
    const lists = await mapInSequence(kinds, async (kind) => {
      const rows = await SECTIONS[kind].delegate(t).findMany({
        where: {
          userId: actor.userId,
          deletedAt: null,
          ...(query.statuses ? { verificationStatus: { in: query.statuses } } : {}),
        },
        orderBy: SECTIONS[kind].orderBy,
      });
      return rows.map((row) => toFact(kind, row));
    });
    return lists.flat().filter((fact) => query.includeSensitive !== false || !fact.sensitive);
  };
  return tx ? run(tx) : withUserContext(actor.userId, run);
}

/** Only facts the user explicitly verified. */
export function getVerifiedCandidateFacts(
  actor: ActorRef,
  query: Omit<FactQuery, "statuses"> = {},
) {
  return getCandidateFacts(actor, { ...query, statuses: ["VERIFIED"] });
}

/** Facts usable as ground truth: VERIFIED or USER_PROVIDED. Never AI_INFERRED / NEEDS_REVIEW. */
export async function getUsableCandidateFacts(
  actor: ActorRef,
  query: Omit<FactQuery, "statuses"> = {},
) {
  const facts = await getCandidateFacts(actor, query);
  return facts.filter((fact) => isUsableStatus(fact.verificationStatus));
}

export function getFactsByCategory(
  actor: ActorRef,
  kind: SectionKind,
  query: Omit<FactQuery, "kinds"> = {},
) {
  return getCandidateFacts(actor, { ...query, kinds: [kind] });
}

/** Resolve fact references (e.g. cited by a future AI generation). Unknown/foreign refs are dropped. */
export async function resolveFactRefs(actor: ActorRef, refs: string[]): Promise<CandidateFact[]> {
  const byKind = new Map<SectionKind, string[]>();
  for (const ref of refs) {
    const [kind, id] = ref.split(":");
    if (kind && id && kind in SECTIONS)
      byKind.set(kind as SectionKind, [...(byKind.get(kind as SectionKind) ?? []), id]);
  }
  return withUserContext(actor.userId, async (t) => {
    const lists = await mapInSequence(Array.from(byKind), async ([kind, ids]) => {
      const rows = await SECTIONS[kind]
        .delegate(t)
        .findMany({ where: { userId: actor.userId, deletedAt: null, id: { in: ids } } });
      return rows.map((row) => toFact(kind, row));
    });
    return lists.flat();
  });
}

// --- Overview (dashboard read model) --------------------------------------------------------

export async function getCandidateOverview(actor: ActorRef) {
  return withUserContext(actor.userId, async (t) => {
    const where = { userId: actor.userId, deletedAt: null };
    const [
      profile,
      prefs,
      education,
      experiences,
      achievements,
      skills,
      projects,
      certifications,
      portfolio,
      languages,
      authorizations,
      pendingReview,
      documents,
    ] = await inSequence([
      () => getProfile(actor, t),
      () => getPreferences(actor, t),
      () => t.candidateEducation.findMany({ where, orderBy: SECTIONS.education.orderBy }),
      () => t.candidateExperience.findMany({ where, orderBy: SECTIONS.experience.orderBy }),
      () => t.candidateAchievement.findMany({ where, orderBy: SECTIONS.achievement.orderBy }),
      () => t.candidateSkill.findMany({ where, orderBy: SECTIONS.skill.orderBy }),
      () => t.candidateProject.findMany({ where, orderBy: SECTIONS.project.orderBy }),
      () => t.candidateCertification.findMany({ where, orderBy: SECTIONS.certification.orderBy }),
      () => t.candidatePortfolioItem.findMany({ where, orderBy: SECTIONS.portfolio.orderBy }),
      () => t.candidateLanguage.findMany({ where, orderBy: SECTIONS.language.orderBy }),
      () =>
        t.candidateWorkAuthorization.findMany({ where, orderBy: SECTIONS.authorization.orderBy }),
      () => countPendingCandidates(actor, t),
      () =>
        t.candidateDocument.findMany({
          where: { userId: actor.userId },
          orderBy: { uploadedAt: "desc" },
          take: 5,
          select: { id: true, fileName: true, documentType: true, status: true, uploadedAt: true },
        }),
    ] as const);

    const snapshot: CandidateSnapshot = {
      profile,
      education,
      experiences,
      skills,
      projects,
      certifications,
      portfolio,
      languages,
      authorizations,
      achievements,
      preferences: prefs.preferences,
      targetLocations: prefs.targetLocations,
      pendingReview,
    };
    const completeness = computeCompleteness(snapshot);
    const warnings = computeWarnings(snapshot);
    const readiness = computeReadiness(snapshot, completeness);
    return {
      profile,
      preferences: prefs.preferences,
      targetLocations: prefs.targetLocations,
      education,
      experiences,
      achievements,
      skills,
      projects,
      certifications,
      portfolio,
      languages,
      authorizations,
      documents,
      pendingReview,
      completeness,
      warnings,
      readiness,
    };
  });
}

export type CandidateOverview = Awaited<ReturnType<typeof getCandidateOverview>>;
