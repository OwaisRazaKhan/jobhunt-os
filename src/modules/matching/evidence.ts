import "server-only";
import { sha256Hex } from "@/server/crypto";
import { inSequence, type Tx } from "@/server/db";
import { DEFAULT_SETTINGS, type CandidateEvidence, type MatchingSettings } from "./engine/types";

/**
 * Candidate evidence loader: reads the caller's OWN Phase 1 facts (RLS-scoped transaction)
 * into the engine's input shape. Deleted facts are excluded; provenance is carried as-is so
 * the engine can refuse NEEDS_REVIEW / AI_INFERRED facts as support.
 */
export async function loadCandidateEvidence(
  t: Tx,
  userId: string,
): Promise<CandidateEvidence | null> {
  const where = { userId, deletedAt: null };
  const order = [{ sortOrder: "asc" as const }, { id: "asc" as const }];
  const [
    profile,
    prefs,
    targets,
    skills,
    experiences,
    education,
    projects,
    certs,
    portfolio,
    languages,
    auths,
  ] = await inSequence([
    () => t.candidateProfile.findUnique({ where: { userId } }),
    () => t.candidatePreferences.findUnique({ where: { userId } }),
    () =>
      t.candidateTargetLocation.findMany({
        where: { userId },
        orderBy: [{ priority: "asc" }, { id: "asc" }],
      }),
    () => t.candidateSkill.findMany({ where, orderBy: order }),
    () => t.candidateExperience.findMany({ where, orderBy: order }),
    () => t.candidateEducation.findMany({ where, orderBy: order }),
    () => t.candidateProject.findMany({ where, orderBy: order }),
    () => t.candidateCertification.findMany({ where, orderBy: order }),
    () => t.candidatePortfolioItem.findMany({ where, orderBy: order }),
    () => t.candidateLanguage.findMany({ where, orderBy: order }),
    () => t.candidateWorkAuthorization.findMany({ where, orderBy: order }),
  ] as const);
  if (!profile) return null;
  return {
    profile: {
      id: profile.id,
      currentCountryCode: profile.currentCountryCode,
      currentCity: profile.currentCity,
      portfolioUrl: profile.portfolioUrl,
      verification: profile.verificationStatus,
    },
    preferences: prefs
      ? {
          employmentTypes: prefs.employmentTypes,
          workModes: prefs.workModes,
          relocation: prefs.relocation,
          needsSponsorship: prefs.needsSponsorship,
          salaryMin: prefs.salaryMin,
          salaryMax: prefs.salaryMax,
          salaryCurrency: prefs.salaryCurrency,
          salaryPeriod: prefs.salaryPeriod,
        }
      : null,
    targetLocations: targets.map((x) => ({ id: x.id, countryCode: x.countryCode, city: x.city })),
    skills: skills.map((x) => ({
      id: x.id,
      verification: x.verificationStatus,
      name: x.name,
      yearsUsed: x.yearsUsed,
    })),
    experiences: experiences.map((x) => ({
      id: x.id,
      verification: x.verificationStatus,
      title: x.title,
      organization: x.organization,
      employmentType: x.employmentType,
      startDate: x.startDate,
      endDate: x.endDate,
      isCurrent: x.isCurrent,
      description: x.description,
      responsibilities: x.responsibilities,
      skillsUsed: x.skillsUsed,
    })),
    education: education.map((x) => ({
      id: x.id,
      verification: x.verificationStatus,
      institution: x.institution,
      degree: x.degree,
      fieldOfStudy: x.fieldOfStudy,
      endDate: x.endDate,
      isCurrent: x.isCurrent,
    })),
    projects: projects.map((x) => ({
      id: x.id,
      verification: x.verificationStatus,
      name: x.name,
      description: x.description,
      technologies: x.technologies,
      skills: x.skills,
    })),
    certifications: certs.map((x) => ({
      id: x.id,
      verification: x.verificationStatus,
      name: x.name,
      issuer: x.issuer,
      expiryDate: x.expiryDate,
    })),
    portfolio: portfolio.map((x) => ({
      id: x.id,
      verification: x.verificationStatus,
      title: x.title,
      type: x.type,
      url: x.url,
    })),
    languages: languages.map((x) => ({
      id: x.id,
      verification: x.verificationStatus,
      language: x.language,
      proficiency: x.proficiency,
    })),
    authorizations: auths.map((x) => ({
      id: x.id,
      verification: x.verificationStatus,
      countryCode: x.countryCode,
      status: x.status,
    })),
  };
}

export async function loadMatchingSettings(
  t: Tx,
  userId: string,
): Promise<MatchingSettings & { semanticAssist: boolean }> {
  const row = await t.matchingPreferences.findUnique({ where: { userId } });
  return row
    ? {
        workModeHard: row.workModeHard,
        employmentTypeHard: row.employmentTypeHard,
        locationHard: row.locationHard,
        salaryMinHard: row.salaryMinHard,
        semanticAssist: row.semanticAssist,
      }
    : { ...DEFAULT_SETTINGS, semanticAssist: false };
}

/**
 * Content fingerprint of everything a match depends on for this user (facts, provenance,
 * preferences and matching settings). Any change makes existing matches STALE.
 */
export function candidateHash(
  evidence: CandidateEvidence | null,
  settings: MatchingSettings & { semanticAssist: boolean },
) {
  return sha256Hex(JSON.stringify([evidence, settings]));
}

/** Job side: content plus the exact requirement set version used. */
export function jobHash(
  contentHash: string,
  requirementSet: { id: string; version: number } | null,
) {
  return sha256Hex(
    JSON.stringify([contentHash, requirementSet?.id ?? null, requirementSet?.version ?? null]),
  );
}
