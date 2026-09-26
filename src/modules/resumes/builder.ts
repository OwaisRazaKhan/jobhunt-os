/**
 * Resume builder: candidate facts → ResumeDocument (pure, deterministic).
 * Only USABLE facts (VERIFIED / USER_PROVIDED) are passed in by the service; nothing is
 * invented — empty sections stay empty and are not printed. Every item cites its facts.
 */
import { countryName } from "@/modules/candidate/labels";
import { optionLabel } from "@/modules/candidate/options";
import {
  defaultSections,
  newItemId,
  parseResumeDocument,
  type ResumeBullet,
  type ResumeDocument,
  type ResumeLink,
} from "./document";

export interface BuilderFact {
  ref: string;
  id: string;
  kind: string;
  value: Record<string, unknown>;
}

export interface BuilderProfile {
  fullName: string | null;
  headline: string | null;
  summary: string | null;
  currentCity: string | null;
  currentCountryCode: string | null;
  phone: string | null;
  professionalEmail: string | null;
  websiteUrl: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
}

const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => s(x)).filter((x): x is string => Boolean(x)) : [];
const bool = (v: unknown) => v === true;
const date = (v: unknown) => {
  const t = s(v);
  if (!t) return null;
  const m = t.match(/^(\d{4})(?:-(\d{2}))?/);
  return m ? (m[2] ? `${m[1]}-${m[2]}` : (m[1] ?? null)) : null;
};
const url = (v: unknown) => {
  const t = s(v);
  return t && /^https?:\/\/[^\s<>"']+$/i.test(t) ? t : null;
};

/** Newest first: current items, then by end date, then start date. */
function byRecency<
  T extends { isCurrent: boolean; endDate: string | null; startDate: string | null },
>(a: T, b: T) {
  if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
  const ae = a.endDate ?? a.startDate ?? "";
  const be = b.endDate ?? b.startDate ?? "";
  if (ae !== be) return ae < be ? 1 : -1;
  return (b.startDate ?? "").localeCompare(a.startDate ?? "");
}

function bullet(textValue: string, refs: string[]): ResumeBullet {
  return {
    id: newItemId("b"),
    text: textValue,
    hidden: false,
    factRefs: refs,
    origin: "FACT",
    claimStatus: "SUPPORTED",
    editedAt: null,
  };
}

function achievementText(v: Record<string, unknown>) {
  const statement = s(v.statement) ?? "";
  const metric = s(v.metric);
  return metric && !statement.includes(metric) ? `${statement} (${metric})` : statement;
}

export function buildResumeFromFacts(
  profile: BuilderProfile | null,
  facts: BuilderFact[],
  fallbackName: string,
): ResumeDocument {
  const of = (kind: string) => facts.filter((f) => f.kind === kind);
  const achievements = of("achievement");
  const usedAchievements = new Set<string>();

  const experience = of("experience")
    .map((f) => {
      const v = f.value;
      const linked = achievements.filter((a) => a.value.experienceId === f.id);
      linked.forEach((a) => usedAchievements.add(a.id));
      return {
        id: newItemId("exp"),
        hidden: false,
        factRefs: [f.ref],
        origin: "FACT" as const,
        claimStatus: "SUPPORTED" as const,
        editedAt: null,
        title: s(v.title) ?? "",
        organization: s(v.organization) ?? "",
        location: s(v.location),
        startDate: date(v.startDate),
        endDate: date(v.endDate),
        isCurrent: bool(v.isCurrent),
        description: s(v.description),
        bullets: [
          ...list(v.responsibilities).map((r) => bullet(r, [f.ref])),
          ...linked.map((a) => bullet(achievementText(a.value), [a.ref, f.ref])),
        ],
        technologies: list(v.skillsUsed),
      };
    })
    .filter((e) => e.title && e.organization)
    .sort(byRecency);

  const projects = of("project")
    .map((f) => {
      const v = f.value;
      const linked = achievements.filter((a) => a.value.projectId === f.id);
      linked.forEach((a) => usedAchievements.add(a.id));
      return {
        id: newItemId("prj"),
        hidden: false,
        factRefs: [f.ref],
        origin: "FACT" as const,
        claimStatus: "SUPPORTED" as const,
        editedAt: null,
        name: s(v.name) ?? "",
        role: s(v.role),
        description: s(v.description),
        startDate: date(v.startDate),
        endDate: date(v.endDate),
        isCurrent: bool(v.isCurrent),
        bullets: [
          ...list(v.responsibilities).map((r) => bullet(r, [f.ref])),
          ...list(v.outcomes).map((o) => bullet(o, [f.ref])),
          ...linked.map((a) => bullet(achievementText(a.value), [a.ref, f.ref])),
        ],
        technologies: [...new Set([...list(v.technologies), ...list(v.skills)])],
        url: url(v.liveUrl) ?? url(v.portfolioUrl) ?? url(v.repositoryUrl),
      };
    })
    .filter((p) => p.name)
    .sort(byRecency);

  const education = of("education")
    .map((f) => {
      const v = f.value;
      return {
        id: newItemId("edu"),
        hidden: false,
        factRefs: [f.ref],
        origin: "FACT" as const,
        claimStatus: "SUPPORTED" as const,
        editedAt: null,
        institution: s(v.institution) ?? "",
        degree: s(v.degree),
        fieldOfStudy: s(v.fieldOfStudy),
        location: s(v.location),
        startDate: date(v.startDate),
        endDate: date(v.endDate),
        isCurrent: bool(v.isCurrent),
        grade: null,
        details: s(v.description),
      };
    })
    .filter((e) => e.institution)
    .sort(byRecency);

  const groups = new Map<string, ResumeDocument["skills"][number]>();
  for (const f of of("skill")) {
    const name = s(f.value.name);
    if (!name) continue;
    const category = s(f.value.category) ?? "OTHER";
    const group = groups.get(category) ?? {
      id: newItemId("sg"),
      hidden: false,
      label: optionLabel(category),
      skills: [],
    };
    if (!group.skills.some((x) => x.name.toLowerCase() === name.toLowerCase())) {
      group.skills.push({
        id: newItemId("sk"),
        name,
        hidden: false,
        factRefs: [f.ref],
        origin: "FACT",
        claimStatus: "SUPPORTED",
        editedAt: null,
      });
    }
    groups.set(category, group);
  }

  const certifications = of("certification")
    .map((f) => ({
      id: newItemId("cert"),
      hidden: false,
      factRefs: [f.ref],
      origin: "FACT" as const,
      claimStatus: "SUPPORTED" as const,
      editedAt: null,
      name: s(f.value.name) ?? "",
      issuer: s(f.value.issuer),
      issueDate: date(f.value.issueDate),
      expiryDate: date(f.value.expiryDate),
      credentialId: s(f.value.credentialId),
      url: url(f.value.credentialUrl),
    }))
    .filter((c) => c.name);

  const languages = of("language")
    .map((f) => ({
      id: newItemId("lang"),
      hidden: false,
      factRefs: [f.ref],
      origin: "FACT" as const,
      claimStatus: "SUPPORTED" as const,
      editedAt: null,
      language: s(f.value.language) ?? "",
      proficiency: s(f.value.proficiency) ? optionLabel(s(f.value.proficiency)) : null,
    }))
    .filter((l) => l.language);

  const links: ResumeLink[] = [];
  const addLink = (
    label: string,
    value: string | null,
    refs: string[],
    origin: "PROFILE" | "FACT",
  ) => {
    if (value && !links.some((l) => l.url === value)) {
      links.push({
        id: newItemId("lnk"),
        label,
        url: value,
        hidden: false,
        factRefs: refs,
        origin,
        claimStatus: "SUPPORTED",
        editedAt: null,
      });
    }
  };
  addLink("LinkedIn", url(profile?.linkedinUrl), [], "PROFILE");
  addLink("GitHub", url(profile?.githubUrl), [], "PROFILE");
  addLink("Portfolio", url(profile?.portfolioUrl), [], "PROFILE");
  addLink("Website", url(profile?.websiteUrl), [], "PROFILE");
  for (const f of of("portfolio"))
    addLink(s(f.value.title) ?? "Portfolio", url(f.value.url), [f.ref], "FACT");

  const standalone = achievements.filter((a) => !usedAchievements.has(a.id));
  const additional = standalone.length
    ? [
        {
          id: newItemId("add"),
          hidden: false,
          title: "Achievements",
          bullets: standalone.map((a) => bullet(achievementText(a.value), [a.ref])),
        },
      ]
    : [];

  const location =
    [
      profile?.currentCity,
      profile?.currentCountryCode ? countryName(profile.currentCountryCode) : null,
    ]
      .filter(Boolean)
      .join(", ") || null;
  const summaryText = s(profile?.summary);

  return parseResumeDocument({
    header: {
      name: s(profile?.fullName) ?? fallbackName,
      headline: s(profile?.headline),
      email: s(profile?.professionalEmail),
      phone: s(profile?.phone),
      location,
    },
    summary: summaryText
      ? {
          id: newItemId("sum"),
          text: summaryText,
          hidden: false,
          factRefs: [],
          origin: "PROFILE",
          claimStatus: "SUPPORTED",
          editedAt: null,
        }
      : null,
    summaryVariants: [],
    experience,
    projects,
    education,
    skills: [...groups.values()],
    certifications,
    languages,
    links,
    additional,
    sections: defaultSections(),
  });
}

/** Facts not yet represented in a document (to offer "add new facts" after the profile grows). */
export function unrepresentedFacts(doc: ResumeDocument, facts: BuilderFact[]): BuilderFact[] {
  const used = new Set<string>();
  const visit = (i: { factRefs?: string[]; bullets?: { factRefs: string[] }[] }) => {
    i.factRefs?.forEach((r) => used.add(r));
    i.bullets?.forEach((b) => b.factRefs.forEach((r) => used.add(r)));
  };
  doc.experience.forEach(visit);
  doc.projects.forEach(visit);
  doc.education.forEach(visit);
  doc.skills.forEach((g) => g.skills.forEach(visit));
  doc.certifications.forEach(visit);
  doc.languages.forEach(visit);
  doc.links.forEach(visit);
  doc.additional.forEach((a) => a.bullets.forEach(visit));
  const printable = new Set([
    "experience",
    "project",
    "education",
    "skill",
    "certification",
    "language",
    "portfolio",
    "achievement",
  ]);
  return facts.filter((f) => printable.has(f.kind) && !used.has(f.ref));
}
