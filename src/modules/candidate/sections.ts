import "server-only";
import type { Tx } from "@/server/db";
import type { AuditAction } from "@/server/audit";
import { normalizeKey } from "./duplicates";
import type { SectionInput, SectionKind } from "./schemas";

/**
 * Registry of fact sections: how each kind maps to its table. Keeps the
 * generic fact service free of per-table branching.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Prisma delegates differ per model; access is centralised and typed at the service boundary. */
export interface SectionDelegate {
  findMany(args: any): Promise<any[]>;
  findFirst(args: any): Promise<any | null>;
  create(args: any): Promise<any>;
  update(args: any): Promise<any>;
  count(args: any): Promise<number>;
  deleteMany(args: any): Promise<{ count: number }>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface SectionConfig<K extends SectionKind = SectionKind> {
  kind: K;
  /** Audit resource type + action prefix */
  resource: string;
  created: AuditAction;
  updated: AuditAction;
  delegate: (tx: Tx) => SectionDelegate;
  /** Map validated input to column values (derived columns included). */
  toData: (input: SectionInput<K>) => Record<string, unknown>;
  orderBy: Record<string, "asc" | "desc">[];
}

const byDate: Record<string, "asc" | "desc">[] = [
  { sortOrder: "asc" },
  { startDate: "desc" },
  { createdAt: "asc" },
];
const byCreated: Record<string, "asc" | "desc">[] = [{ sortOrder: "asc" }, { createdAt: "asc" }];

export const SECTIONS: { [K in SectionKind]: SectionConfig<K> } = {
  education: {
    kind: "education",
    resource: "education",
    created: "education_created",
    updated: "education_updated",
    delegate: (tx) => tx.candidateEducation,
    toData: (input) => ({ ...input }),
    orderBy: byDate,
  },
  experience: {
    kind: "experience",
    resource: "experience",
    created: "experience_created",
    updated: "experience_updated",
    delegate: (tx) => tx.candidateExperience,
    toData: (input) => ({ ...input }),
    orderBy: byDate,
  },
  achievement: {
    kind: "achievement",
    resource: "achievement",
    created: "achievement_created",
    updated: "achievement_updated",
    delegate: (tx) => tx.candidateAchievement,
    toData: (input) => ({ ...input }),
    orderBy: byCreated,
  },
  project: {
    kind: "project",
    resource: "project",
    created: "project_created",
    updated: "project_updated",
    delegate: (tx) => tx.candidateProject,
    toData: (input) => ({ ...input }),
    orderBy: byDate,
  },
  skill: {
    kind: "skill",
    resource: "skill",
    created: "skill_created",
    updated: "skill_updated",
    delegate: (tx) => tx.candidateSkill,
    toData: (input) => ({ ...input, nameNormalized: normalizeKey(input.name) }),
    orderBy: [{ category: "asc" }, { name: "asc" }],
  },
  certification: {
    kind: "certification",
    resource: "certification",
    created: "certification_created",
    updated: "certification_updated",
    delegate: (tx) => tx.candidateCertification,
    toData: (input) => ({ ...input }),
    orderBy: [{ sortOrder: "asc" }, { issueDate: "desc" }],
  },
  portfolio: {
    kind: "portfolio",
    resource: "portfolio",
    created: "portfolio_created",
    updated: "portfolio_updated",
    delegate: (tx) => tx.candidatePortfolioItem,
    toData: (input) => ({ ...input }),
    orderBy: byCreated,
  },
  language: {
    kind: "language",
    resource: "language",
    created: "language_created",
    updated: "language_updated",
    delegate: (tx) => tx.candidateLanguage,
    toData: (input) => ({ ...input, languageNormalized: normalizeKey(input.language) }),
    orderBy: byCreated,
  },
  authorization: {
    kind: "authorization",
    resource: "work_authorization",
    created: "authorization_created",
    updated: "authorization_updated",
    delegate: (tx) => tx.candidateWorkAuthorization,
    toData: (input) => ({
      ...input,
      validUntil: input.validUntil ? new Date(`${input.validUntil}T00:00:00.000Z`) : null,
    }),
    orderBy: byCreated,
  },
};

/** Columns compared to decide whether an edit changed the content (resets verification). */
export const PROVENANCE_COLUMNS = new Set([
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
]);
