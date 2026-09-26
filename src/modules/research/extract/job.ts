import { descriptionLines, headingSection } from "@/modules/matching/requirements/extract";
import { findSkills, skillByKey } from "@/modules/matching/skills";
import { foldText } from "@/modules/search-profiles/criteria";
import type { DraftClaim } from "../types";

/**
 * Job research extraction (pure, deterministic). Everything is quoted from the job listing
 * itself — the original description is never replaced. Priorities are INTERPRETATIONS
 * (derived from how often the posting mentions a theme) and are labelled as such.
 */

export interface JobInput {
  title: string;
  description: string;
  sourceKey: string;
}

export interface RequirementRow {
  category: string;
  requirementType: string;
  text: string;
  sourceText: string;
  sourceReference: string;
}

const clip = (s: string, n = 600) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const ABOUT_ROLE =
  /\b(about the (role|position|job|opportunity)|the opportunity|role overview|position (summary|overview)|job (summary|description|overview)|overview)\b/i;
const APPLY_HEADING = /\b(how to apply|application process|to apply|applying|next steps)\b/i;

const PURPOSE_RE =
  /\b(help(s|ing)? (us )?(build|scale|grow|launch|establish|expand|shape|lead)|new (team|function|product|market|office|capability|department|practice)|first (hire|marketer|engineer|designer|member)|backfill|replac(e|ing) (a|our)|expand(ing)? (our|into)|as we (grow|scale|expand)|to support (our )?(growth|expansion)|newly created|build out)\b/i;
const APPLY_RE =
  /\b(please (include|submit|send|attach|apply|share|upload)|to apply|cover letter|portfolio (link|url)|application deadline|apply (via|through|by|before|online)|applications? (close|will be reviewed)|send (your|a) (cv|resume))\b/i;

/** Role themes used for "what the employer emphasizes" (keyword → theme). */
export const THEMES: Record<string, { label: string; words: RegExp }> = {
  CLIENT: {
    label: "client communication",
    words: /\b(client|customer|stakeholder|account management|relationship)s?\b/gi,
  },
  SOCIAL: {
    label: "social media",
    words: /\b(social media|instagram|tiktok|linkedin|facebook|community|influencer)s?\b/gi,
  },
  CONTENT: {
    label: "content",
    words: /\b(content|copywriting|copy|blog|storytelling|editorial|video)s?\b/gi,
  },
  WEB: {
    label: "web development",
    words:
      /\b(website|web|frontend|front-end|react|next\.?js|html|css|javascript|typescript|wordpress|webflow)\b/gi,
  },
  AUTOMATION: {
    label: "automation & AI",
    words:
      /\b(automation|automate|ai|machine learning|llm|workflow|zapier|n8n|make\.com|agents?)\b/gi,
  },
  ANALYTICS: {
    label: "analytics",
    words: /\b(analytics|data|reporting|dashboard|metrics|kpis?|ga4|insights?|a\/b test(ing)?)\b/gi,
  },
  PAID: {
    label: "paid acquisition",
    words:
      /\b(paid (social|search|media)|google ads|meta ads|ppc|sem|performance marketing|ad spend|campaigns?)\b/gi,
  },
  SEO: {
    label: "SEO",
    words: /\b(seo|search engine optimi[sz]ation|organic search|keywords?)\b/gi,
  },
  SALES: {
    label: "sales & business development",
    words:
      /\b(sales|business development|lead generation|leads|pipeline|prospect(ing)?|outreach|crm|deals?)\b/gi,
  },
  OPERATIONS: {
    label: "operations",
    words: /\b(operations|process(es)?|project management|coordination|logistics|scheduling)\b/gi,
  },
  DESIGN: { label: "design", words: /\b(design|figma|ux|ui|visual|brand(ing)?|creative)\b/gi },
  LEADERSHIP: {
    label: "leadership",
    words:
      /\b(lead(ing)? a team|manage (a|the) team|mentor(ing)?|leadership|strategy|strategic)\b/gi,
  },
};

/** Employer terminology worth recognising (never added to the candidate's skills). */
const TERM_PHRASES = [
  "marketing operations",
  "lifecycle",
  "lead generation",
  "demand generation",
  "customer acquisition",
  "go-to-market",
  "growth marketing",
  "performance marketing",
  "content strategy",
  "brand awareness",
  "conversion rate",
  "user acquisition",
  "retention",
  "ai workflow",
  "automation",
  "b2b",
  "b2c",
  "saas",
  "e-commerce",
  "cross-functional",
  "stakeholder management",
  "product-led",
  "account-based marketing",
  "community management",
  "thought leadership",
  "a/b testing",
  "funnel",
];

interface SectionedLine {
  text: string;
  n: number;
  bullet: boolean;
  section: "RESPONSIBILITIES" | "ABOUT_ROLE" | "APPLY" | "REQUIRED" | "PREFERRED" | "OTHER";
}

export function sectionLines(description: string): SectionedLine[] {
  let section: SectionedLine["section"] = "OTHER";
  const out: SectionedLine[] = [];
  for (const line of descriptionLines(description)) {
    const t = line.text.replace(/[:\s]+$/, "");
    const shortHeading =
      !line.bullet &&
      t.length <= 70 &&
      !/[.!?]$/.test(line.text.trim()) &&
      t.split(/\s+/).length <= 9;
    if (shortHeading && APPLY_HEADING.test(t)) {
      section = "APPLY";
      continue;
    }
    if (shortHeading && ABOUT_ROLE.test(t)) {
      section = "ABOUT_ROLE";
      continue;
    }
    const heading = line.bullet ? null : headingSection(line.text);
    if (heading) {
      section =
        heading === "RESPONSIBILITIES"
          ? "RESPONSIBILITIES"
          : heading === "REQUIRED"
            ? "REQUIRED"
            : heading === "PREFERRED"
              ? "PREFERRED"
              : "OTHER";
      continue;
    }
    out.push({ text: line.text, n: line.n, bullet: line.bullet, section });
  }
  return out;
}

const REQ_SECTION: Record<string, string> = {
  SKILL: "SKILL",
  EXPERIENCE: "EXPERIENCE",
  EDUCATION: "EDUCATION",
  LANGUAGE: "LANGUAGE",
  WORK_MODE: "WORK_MODEL",
  LOCATION: "LOCATION",
  SALARY: "SALARY",
  AUTHORIZATION: "AUTHORIZATION",
  EMPLOYMENT: "WORK_MODEL",
  CERTIFICATION: "EDUCATION",
  PORTFOLIO: "APPLICATION",
  DOMAIN: "EXPERIENCE",
  OTHER: "OTHER",
};

export interface JobExtraction {
  claims: DraftClaim[];
  themes: { key: string; label: string; count: number }[];
  terms: { term: string; count: number }[];
  openQuestions: string[];
}

export function extractJobClaims(
  job: JobInput,
  requirements: RequirementRow[],
  sourceKey: string,
): JobExtraction {
  const claims: DraftClaim[] = [];
  const lines = sectionLines(job.description);
  const fact = (
    section: string,
    claim: string,
    excerpt: string,
    reference: string,
    extra: Partial<DraftClaim> = {},
  ) =>
    claims.push({
      section,
      claim: clip(claim, 1000),
      claimType: "FACT",
      verification: "VERIFIED_FROM_SOURCE",
      method: "RULE",
      temporal: "CURRENT",
      evidence: [{ sourceKey, excerpt: clip(excerpt, 1000), reference }],
      ...extra,
    });

  // Role summary: the posting's own overview sentences.
  const about = lines.filter((l) => l.section === "ABOUT_ROLE").slice(0, 2);
  const summaryLines = about.length
    ? about
    : lines
        .filter((l) => /\b(role|position|looking for|join|you will|you'll)\b/i.test(l.text))
        .slice(0, 1);
  for (const l of summaryLines)
    fact("ROLE_SUMMARY", `The posting says: “${clip(l.text, 400)}”`, l.text, `description:L${l.n}`);

  // Why the role exists — only what the posting states.
  const purpose = lines.filter((l) => PURPOSE_RE.test(l.text)).slice(0, 3);
  for (const l of purpose)
    fact("ROLE_PURPOSE", `The posting says: “${clip(l.text, 400)}”`, l.text, `description:L${l.n}`);

  // Responsibilities.
  const resp = lines.filter((l) => l.section === "RESPONSIBILITIES").slice(0, 15);
  for (const l of resp) fact("RESPONSIBILITY", l.text, l.text, `description:L${l.n}`);

  // Application instructions.
  const apply = lines.filter((l) => l.section === "APPLY" || APPLY_RE.test(l.text)).slice(0, 6);
  for (const l of apply) fact("APPLICATION", l.text, l.text, `description:L${l.n}`);

  // Requirements (Phase 4 requirement set — deterministic, with the posting's wording).
  for (const r of requirements) {
    const kind =
      r.requirementType === "REQUIRED"
        ? "Required"
        : r.requirementType === "PREFERRED"
          ? "Preferred"
          : r.requirementType === "INFORMATIONAL"
            ? "Job fact"
            : "Importance unclear";
    fact(
      `REQ_${REQ_SECTION[r.category] ?? "OTHER"}`,
      `${kind}: ${r.text}`,
      r.sourceText,
      r.sourceReference,
      {
        value: r.requirementType,
      },
    );
  }

  // Themes the posting emphasizes (INTERPRETATION, with the lines that support it).
  const focusText = lines.filter((l) => l.section !== "APPLY");
  const themes = Object.entries(THEMES)
    .map(([key, t]) => {
      const hits = focusText.filter((l) => new RegExp(t.words.source, "i").test(l.text));
      const count = focusText.reduce((n, l) => n + (l.text.match(t.words)?.length ?? 0), 0);
      return { key, label: t.label, count, hits };
    })
    .filter((t) => t.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  for (const t of themes)
    claims.push({
      section: "PRIORITY",
      claim: `The posting emphasizes ${t.label} (${t.count} mentions across ${t.hits.length} lines).`,
      claimType: "INTERPRETATION",
      verification: "VERIFIED_FROM_SOURCE",
      method: "RULE",
      value: t.key,
      temporal: "CURRENT",
      evidence: t.hits
        .slice(0, 3)
        .map((l) => ({ sourceKey, excerpt: clip(l.text, 1000), reference: `description:L${l.n}` })),
    });

  // Important terminology (counts are facts about the posting; nothing is added to the candidate).
  const folded = ` ${foldText(job.description)} `;
  const terms = new Map<string, number>();
  for (const s of findSkills(job.description)) {
    const name = skillByKey(s.key)?.name ?? s.matched;
    const count = Math.max(1, folded.split(` ${s.matched} `).length - 1);
    terms.set(name, count);
  }
  for (const phrase of TERM_PHRASES) {
    const f = foldText(phrase);
    const count = folded.split(` ${f}`).length - 1;
    if (count > 0 && ![...terms.keys()].some((k) => foldText(k) === f)) terms.set(phrase, count);
  }
  const termList = [...terms]
    .map(([term, count]) => ({ term, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
  for (const t of termList) {
    const line = lines.find((l) => foldText(l.text).includes(foldText(t.term)));
    if (!line) continue;
    fact(
      "TERM",
      `“${t.term}” appears ${t.count} time${t.count === 1 ? "" : "s"} in the posting.`,
      line.text,
      `description:L${line.n}`,
      {
        value: t.term,
      },
    );
  }

  // Unknowns — never filled with guesses.
  const openQuestions: string[] = [];
  const has = (cat: string) => requirements.some((r) => r.category === cat);
  if (!purpose.length) {
    openQuestions.push("The posting does not say why this role exists.");
    claims.push(unknownClaim("ROLE_PURPOSE", "The posting does not say why this role exists."));
  }
  if (!has("SALARY")) openQuestions.push("Salary is not stated in the posting.");
  if (!has("AUTHORIZATION"))
    openQuestions.push("Work authorization / visa sponsorship is not stated in the posting.");
  if (!has("WORK_MODE"))
    openQuestions.push("The work model (remote / hybrid / on-site) is not stated.");
  if (!resp.length) openQuestions.push("No responsibilities section was found in the posting.");
  if (!apply.length) openQuestions.push("No specific application instructions were found.");
  return {
    claims,
    themes: themes.map(({ key, label, count }) => ({ key, label, count })),
    terms: termList,
    openQuestions,
  };
}

export function unknownClaim(section: string, text: string): DraftClaim {
  return {
    section,
    claim: text,
    claimType: "UNKNOWN",
    verification: "PENDING_REVIEW",
    method: "RULE",
    temporal: "UNDATED",
    evidence: [],
  };
}
