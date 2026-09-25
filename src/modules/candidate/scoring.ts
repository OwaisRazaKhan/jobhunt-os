import { findDuplicatePairs, type Comparable, type DuplicatePair } from "./duplicates";
import { countryName, factLabel, toComparable } from "./labels";
import type { SectionKind } from "./schemas";

/**
 * Deterministic profile scoring. Pure functions over a snapshot of the
 * candidate's data — no AI, no randomness. Weights are documented in
 * docs/candidate-intelligence.md and must sum to 100.
 */

type Status = "VERIFIED" | "USER_PROVIDED" | "NEEDS_REVIEW" | "AI_INFERRED";
interface Fact {
  id: string;
  verificationStatus: Status;
}

export interface CandidateSnapshot {
  profile: {
    fullName: string | null;
    headline: string | null;
    currentCity: string | null;
    currentCountryCode: string | null;
    phone: string | null;
    professionalEmail: string | null;
    summary: string | null;
    careerGoal: string | null;
    websiteUrl: string | null;
    githubUrl: string | null;
    portfolioUrl: string | null;
    verificationStatus: Status;
  } | null;
  education: (Fact & { institution: string; degree: string | null })[];
  experiences: (Fact & {
    title: string;
    organization: string;
    startDate: string | null;
    endDate: string | null;
    isCurrent: boolean;
    skillsUsed: string[];
  })[];
  skills: (Fact & {
    name: string;
    nameNormalized: string;
    proficiency: number | null;
    sourceType: string;
  })[];
  projects: (Fact & {
    name: string;
    description: string | null;
    technologies: string[];
    skills: string[];
  })[];
  certifications: (Fact & { name: string; issuer: string | null })[];
  portfolio: (Fact & { title: string; url: string | null })[];
  languages: (Fact & { language: string; proficiency: string | null })[];
  authorizations: (Fact & { countryCode: string; status: string })[];
  achievements: Fact[];
  preferences: {
    targetRoles: string[];
    workModes: string[];
    employmentTypes: string[];
  } | null;
  targetLocations: { countryCode: string; city: string | null }[];
  pendingReview: number;
}

// --- Completeness -------------------------------------------------------------------

export interface CompletenessItem {
  key: string;
  label: string;
  weight: number;
  earned: number;
  status: "complete" | "partial" | "missing";
  hint: string;
  href: string;
}

export interface Completeness {
  percent: number;
  items: CompletenessItem[];
}

const has = (v: string | null | undefined) => Boolean(v && v.trim());

/** Weights (sum = 100). Certifications are optional and do not count. */
export const COMPLETENESS_WEIGHTS = {
  basic: 15,
  about: 5,
  education: 10,
  experience: 15,
  skills: 10,
  projects: 10,
  portfolio: 5,
  languages: 5,
  goals: 5,
  roles: 5,
  locations: 5,
  workPreferences: 5,
  authorization: 5,
} as const;

export function computeCompleteness(s: CandidateSnapshot): Completeness {
  const p = s.profile;
  const w = COMPLETENESS_WEIGHTS;
  const ratio = (part: number) => Math.max(0, Math.min(1, part));
  const basicParts = [
    has(p?.fullName),
    has(p?.headline),
    has(p?.currentCity) || has(p?.currentCountryCode),
    has(p?.professionalEmail) || has(p?.phone),
  ];
  const workPrefParts = [
    (s.preferences?.workModes.length ?? 0) > 0,
    (s.preferences?.employmentTypes.length ?? 0) > 0,
  ];
  const hasPortfolio =
    s.portfolio.length > 0 || has(p?.portfolioUrl) || has(p?.websiteUrl) || has(p?.githubUrl);

  const rows: Array<Omit<CompletenessItem, "earned" | "status"> & { r: number }> = [
    {
      key: "basic",
      label: "Basic information",
      weight: w.basic,
      r: basicParts.filter(Boolean).length / 4,
      hint: "Name, headline, location and a contact method",
      href: "/candidate/onboarding?step=basic",
    },
    {
      key: "about",
      label: "About",
      weight: w.about,
      r: has(p?.summary) ? 1 : 0,
      hint: "A short professional summary",
      href: "/candidate/onboarding?step=basic",
    },
    {
      key: "education",
      label: "Education",
      weight: w.education,
      r: s.education.length > 0 ? 1 : 0,
      hint: "At least one education record",
      href: "/candidate/onboarding?step=education",
    },
    {
      key: "experience",
      label: "Experience",
      weight: w.experience,
      r: s.experiences.length > 0 ? 1 : 0,
      hint: "At least one experience",
      href: "/candidate/onboarding?step=experience",
    },
    {
      key: "skills",
      label: "Skills",
      weight: w.skills,
      r: ratio(s.skills.length / 5),
      hint: "At least 5 skills",
      href: "/candidate/onboarding?step=skills",
    },
    {
      key: "projects",
      label: "Projects",
      weight: w.projects,
      r: s.projects.length > 0 ? 1 : 0,
      hint: "At least one project",
      href: "/candidate/onboarding?step=projects",
    },
    {
      key: "portfolio",
      label: "Portfolio",
      weight: w.portfolio,
      r: hasPortfolio ? 1 : 0,
      hint: "A portfolio item or link",
      href: "/candidate/onboarding?step=portfolio",
    },
    {
      key: "languages",
      label: "Languages",
      weight: w.languages,
      r: s.languages.length > 0 ? 1 : 0,
      hint: "At least one language",
      href: "/candidate/onboarding?step=languages",
    },
    {
      key: "goals",
      label: "Career goals",
      weight: w.goals,
      r: has(p?.careerGoal) ? 1 : 0,
      hint: "Describe your career goal",
      href: "/candidate/onboarding?step=goals",
    },
    {
      key: "roles",
      label: "Target roles",
      weight: w.roles,
      r: (s.preferences?.targetRoles.length ?? 0) > 0 ? 1 : 0,
      hint: "At least one target role",
      href: "/candidate/onboarding?step=roles",
    },
    {
      key: "locations",
      label: "Target countries",
      weight: w.locations,
      r: s.targetLocations.length > 0 ? 1 : 0,
      hint: "At least one target country",
      href: "/candidate/onboarding?step=countries",
    },
    {
      key: "workPreferences",
      label: "Work preferences",
      weight: w.workPreferences,
      r: workPrefParts.filter(Boolean).length / 2,
      hint: "Work mode and employment type",
      href: "/candidate/onboarding?step=preferences",
    },
    {
      key: "authorization",
      label: "Work authorization",
      weight: w.authorization,
      r: s.authorizations.length > 0 ? 1 : 0,
      hint: "Your stated authorization for at least one country",
      href: "/candidate/onboarding?step=authorization",
    },
  ];

  const items: CompletenessItem[] = rows.map(({ r, ...row }) => {
    const earned = Math.round(row.weight * r * 10) / 10;
    return { ...row, earned, status: r >= 1 ? "complete" : r > 0 ? "partial" : "missing" };
  });
  const percent = Math.round(items.reduce((sum, item) => sum + item.earned, 0));
  return { percent, items };
}

// --- Warnings ---------------------------------------------------------------------------

export interface ProfileWarning {
  code: string;
  severity: "warning" | "info";
  message: string;
  href?: string;
}

function rangeOf(
  start: string | null,
  end: string | null,
  isCurrent: boolean,
): [string, string] | null {
  if (!start) return null;
  const endValue = isCurrent || !end ? "9999-12" : end.length === 4 ? `${end}-12` : end;
  const startValue = start.length === 4 ? `${start}-01` : start;
  return [startValue, endValue];
}

export function findOverlappingExperiences(experiences: CandidateSnapshot["experiences"]) {
  const pairs: [string, string][] = [];
  for (let i = 0; i < experiences.length; i++) {
    for (let j = i + 1; j < experiences.length; j++) {
      const a = experiences[i]!;
      const b = experiences[j]!;
      const ra = rangeOf(a.startDate, a.endDate, a.isCurrent);
      const rb = rangeOf(b.startDate, b.endDate, b.isCurrent);
      // Year-only dates are ambiguous at the boundary; require a strict overlap.
      if (ra && rb && ra[0] < rb[1] && rb[0] < ra[1]) {
        pairs.push([factLabel("experience", a), factLabel("experience", b)]);
      }
    }
  }
  return pairs;
}

export function duplicatePairs(s: CandidateSnapshot): DuplicatePair[] {
  const items: Comparable[] = [];
  const add = (kind: SectionKind, rows: { id: string }[]) => {
    for (const row of rows) {
      const c = toComparable(kind, row.id, row);
      if (c) items.push(c);
    }
  };
  add("education", s.education);
  add("experience", s.experiences);
  add("skill", s.skills);
  add("project", s.projects);
  add("portfolio", s.portfolio);
  add("certification", s.certifications);
  add("language", s.languages);
  return findDuplicatePairs(items);
}

export function computeWarnings(s: CandidateSnapshot): ProfileWarning[] {
  const warnings: ProfileWarning[] = [];
  const p = s.profile;
  const add = (w: ProfileWarning) => warnings.push(w);

  if (!has(p?.fullName))
    add({
      code: "NO_NAME",
      severity: "warning",
      message: "Full name is missing.",
      href: "/candidate/onboarding?step=basic",
    });
  if (!has(p?.headline))
    add({
      code: "NO_HEADLINE",
      severity: "info",
      message: "Professional headline is missing.",
      href: "/candidate/onboarding?step=basic",
    });
  if (s.education.length === 0)
    add({
      code: "NO_EDUCATION",
      severity: "warning",
      message: "No education record added.",
      href: "/candidate/onboarding?step=education",
    });
  if (s.experiences.length === 0)
    add({
      code: "NO_EXPERIENCE",
      severity: "warning",
      message: "No experience added.",
      href: "/candidate/onboarding?step=experience",
    });
  if (s.skills.length === 0)
    add({
      code: "NO_SKILLS",
      severity: "warning",
      message: "No skills added.",
      href: "/candidate/onboarding?step=skills",
    });
  if (s.projects.length === 0)
    add({
      code: "NO_PROJECTS",
      severity: "info",
      message: "No projects added.",
      href: "/candidate/onboarding?step=projects",
    });
  if ((s.preferences?.targetRoles.length ?? 0) === 0)
    add({
      code: "NO_TARGET_ROLES",
      severity: "warning",
      message: "No target roles selected.",
      href: "/candidate/onboarding?step=roles",
    });
  if (s.targetLocations.length === 0)
    add({
      code: "NO_TARGET_COUNTRIES",
      severity: "warning",
      message: "No target countries selected.",
      href: "/candidate/onboarding?step=countries",
    });
  if (
    !has(p?.portfolioUrl) &&
    !has(p?.websiteUrl) &&
    !has(p?.githubUrl) &&
    s.portfolio.length === 0
  ) {
    add({
      code: "NO_PORTFOLIO_URL",
      severity: "info",
      message: "Portfolio URL is missing.",
      href: "/candidate/onboarding?step=portfolio",
    });
  }
  if (s.authorizations.length === 0) {
    add({
      code: "NO_WORK_AUTHORIZATION",
      severity: "warning",
      message: "Work authorization status not specified.",
      href: "/candidate/onboarding?step=authorization",
    });
  } else {
    const covered = new Set(s.authorizations.map((a) => a.countryCode));
    for (const code of new Set(s.targetLocations.map((l) => l.countryCode))) {
      if (!covered.has(code)) {
        add({
          code: "TARGET_COUNTRY_NO_AUTHORIZATION",
          severity: "info",
          message: `Work authorization for ${countryName(code)} not specified.`,
          href: "/candidate/onboarding?step=authorization",
        });
      }
    }
  }
  for (const [a, b] of findOverlappingExperiences(s.experiences)) {
    add({
      code: "EXPERIENCE_OVERLAP",
      severity: "info",
      message: `Experience dates overlap: "${a}" and "${b}". Confirm this is intended.`,
      href: "/candidate#experience",
    });
  }
  for (const exp of s.experiences) {
    if (!exp.startDate)
      add({
        code: "EXPERIENCE_NO_START",
        severity: "info",
        message: `"${factLabel("experience", exp)}" has no start date.`,
        href: "/candidate#experience",
      });
  }
  for (const project of s.projects) {
    if (!has(project.description))
      add({
        code: "PROJECT_NO_DESCRIPTION",
        severity: "warning",
        message: `Project "${project.name}" has no description.`,
        href: "/candidate#projects",
      });
  }
  // A manually entered skill that no experience or project mentions has no supporting source.
  const evidence = new Set(
    [
      ...s.experiences.flatMap((e) => e.skillsUsed),
      ...s.projects.flatMap((pr) => [...pr.technologies, ...pr.skills]),
    ].map((x) => x.toLowerCase().replace(/[^a-z0-9#+]/g, "")),
  );
  for (const skill of s.skills) {
    if (skill.sourceType === "MANUAL_ENTRY" && !evidence.has(skill.nameNormalized)) {
      add({
        code: "SKILL_NO_SOURCE",
        severity: "info",
        message: `Skill "${skill.name}" exists without a source (not linked to any experience or project).`,
        href: "/candidate#skills",
      });
    }
  }
  for (const pair of duplicatePairs(s)) {
    add({
      code: "POSSIBLE_DUPLICATE",
      severity: "warning",
      message: `Possible duplicate ${pair.kind}: "${pair.a.label}" and "${pair.b.label}".`,
      href: "/candidate",
    });
  }
  if (s.pendingReview > 0) {
    add({
      code: "PENDING_REVIEW",
      severity: "warning",
      message: `${s.pendingReview} extracted fact${s.pendingReview === 1 ? "" : "s"} waiting for your review.`,
      href: "/candidate/review",
    });
  }
  return warnings;
}

// --- Readiness ------------------------------------------------------------------------

export interface Readiness {
  status: "READY" | "NEEDS_REVIEW" | "INCOMPLETE";
  reasons: string[];
  verifiedFacts: number;
  totalFacts: number;
}

export const READINESS_MIN_COMPLETENESS = 60;

export function allFacts(s: CandidateSnapshot): Fact[] {
  return [
    ...s.education,
    ...s.experiences,
    ...s.skills,
    ...s.projects,
    ...s.certifications,
    ...s.portfolio,
    ...s.languages,
    ...s.authorizations,
    ...s.achievements,
  ];
}

/**
 * Readiness is separate from completeness: a complete profile with unreviewed
 * facts is NOT ready to be used for applications.
 */
export function computeReadiness(s: CandidateSnapshot, completeness: Completeness): Readiness {
  const facts = allFacts(s);
  const verifiedFacts = facts.filter((f) => f.verificationStatus === "VERIFIED").length;
  const incomplete: string[] = [];
  if (!has(s.profile?.fullName)) incomplete.push("Full name is missing.");
  if (s.experiences.length === 0 && s.projects.length === 0)
    incomplete.push("Add at least one experience or project.");
  if (s.skills.length === 0) incomplete.push("Add at least one skill.");
  if ((s.preferences?.targetRoles.length ?? 0) === 0)
    incomplete.push("Select at least one target role.");
  if (s.targetLocations.length === 0) incomplete.push("Select at least one target country.");
  if (completeness.percent < READINESS_MIN_COMPLETENESS) {
    incomplete.push(
      `Profile completeness is ${completeness.percent}% (minimum ${READINESS_MIN_COMPLETENESS}%).`,
    );
  }
  if (incomplete.length > 0)
    return { status: "INCOMPLETE", reasons: incomplete, verifiedFacts, totalFacts: facts.length };

  const review: string[] = [];
  if (s.pendingReview > 0)
    review.push(
      `${s.pendingReview} candidate fact${s.pendingReview === 1 ? "" : "s"} need verification.`,
    );
  const unreviewed = facts.filter(
    (f) => f.verificationStatus === "NEEDS_REVIEW" || f.verificationStatus === "AI_INFERRED",
  ).length;
  if (unreviewed > 0)
    review.push(
      `${unreviewed} saved fact${unreviewed === 1 ? " is" : "s are"} marked as needing review.`,
    );
  if (duplicatePairs(s).length > 0) review.push("Possible duplicate records need resolving.");
  if (review.length > 0)
    return { status: "NEEDS_REVIEW", reasons: review, verifiedFacts, totalFacts: facts.length };

  return { status: "READY", reasons: [], verifiedFacts, totalFacts: facts.length };
}
