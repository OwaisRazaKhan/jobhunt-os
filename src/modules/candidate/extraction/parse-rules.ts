import type { SectionKind } from "../schemas";

/**
 * Deterministic CV parser. Pure and dependency-free so it is fully unit-testable.
 *
 * It only proposes facts that are literally present in the text: every draft
 * carries the excerpt it came from. It never guesses proficiency, invents dates
 * (year-only stays year-only) or fabricates metrics.
 */

export type DraftCategory = SectionKind | "profile";

export interface FactDraft {
  category: DraftCategory;
  payload: Record<string, unknown>;
  excerpt: string;
  confidence: number;
  method: "RULE" | "AI";
}

type SectionKey =
  | "summary"
  | "experience"
  | "education"
  | "skills"
  | "projects"
  | "certifications"
  | "languages"
  | "portfolio"
  | "achievements"
  | "ignore";

const HEADINGS: Record<SectionKey, string[]> = {
  summary: [
    "summary",
    "profile",
    "professional summary",
    "about",
    "about me",
    "objective",
    "career objective",
    "professional profile",
    "personal statement",
  ],
  experience: [
    "experience",
    "work experience",
    "professional experience",
    "employment history",
    "work history",
    "career history",
    "employment",
    "relevant experience",
    "volunteer experience",
    "experience and projects",
  ],
  education: [
    "education",
    "academic background",
    "education and training",
    "qualifications",
    "academic qualifications",
    "academics",
  ],
  skills: [
    "skills",
    "technical skills",
    "core skills",
    "key skills",
    "competencies",
    "core competencies",
    "skills and tools",
    "tools and technologies",
    "technologies",
    "expertise",
    "skills and expertise",
    "areas of expertise",
    "tools",
  ],
  projects: [
    "projects",
    "personal projects",
    "selected projects",
    "key projects",
    "portfolio projects",
    "academic projects",
    "side projects",
  ],
  certifications: [
    "certifications",
    "certificates",
    "licenses and certifications",
    "courses",
    "certifications and courses",
    "training",
    "courses and certifications",
    "licenses",
  ],
  languages: ["languages", "language skills", "language"],
  portfolio: ["portfolio", "links", "online presence", "online profiles", "websites"],
  achievements: [
    "achievements",
    "awards",
    "honors",
    "honours",
    "accomplishments",
    "awards and achievements",
    "key achievements",
  ],
  ignore: [
    "interests",
    "hobbies",
    "references",
    "hobbies and interests",
    "personal interests",
    "declaration",
    "personal details",
    "personal information",
  ],
};

const HEADING_LOOKUP = new Map<string, SectionKey>();
for (const [key, names] of Object.entries(HEADINGS) as [SectionKey, string[]][]) {
  for (const name of names) HEADING_LOOKUP.set(name, key);
}

export function classifyHeading(line: string): SectionKey | null {
  const clean = line
    .replace(/^[#*•\s]+/, "")
    .replace(/[:\-–—|•#*_=]+$/g, "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\s+/g, " ");
  if (!clean || clean.length > 40) return null;
  return HEADING_LOOKUP.get(clean) ?? null;
}

interface Sections {
  header: string[];
  sections: { key: SectionKey; lines: string[] }[];
}

export function splitSections(text: string): Sections {
  const lines = text.split("\n").map((l) => l.trim());
  const result: Sections = { header: [], sections: [] };
  let current: { key: SectionKey; lines: string[] } | null = null;
  for (const line of lines) {
    const key = classifyHeading(line);
    if (key) {
      current = { key, lines: [] };
      result.sections.push(current);
    } else if (current) {
      current.lines.push(line);
    } else {
      result.header.push(line);
    }
  }
  return result;
}

// --- Dates --------------------------------------------------------------------

const MONTH_INDEX: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
const MONTH_RE =
  "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DATE_RE = `(?:${MONTH_RE}\\.?\\s*,?\\s*'?\\d{4}|\\d{1,2}\\s*[/.]\\s*\\d{4}|(?:19|20)\\d{2})`;
const PRESENT_RE = "(?:present|current|currently|now|ongoing|today|to date|date)";
const RANGE_RE = new RegExp(
  `(${DATE_RE})\\s*(?:-|–|—|to|until|till)\\s*(${DATE_RE}|${PRESENT_RE})`,
  "i",
);
const YEAR_RE = /\b(19[5-9]\d|20\d{2})\b/;

export function parsePartialDate(value: string): string | null {
  const v = value.trim().toLowerCase().replace(/[.,']/g, " ").replace(/\s+/g, " ");
  const monthName = v.match(new RegExp(`^(${MONTH_RE})\\s*(\\d{4})$`, "i"));
  if (monthName) {
    const month = MONTH_INDEX[monthName[1]!.slice(0, 3)];
    return month ? `${monthName[2]}-${String(month).padStart(2, "0")}` : monthName[2]!;
  }
  const numeric =
    v.match(/^(\d{1,2})\s*\/?\s*(\d{4})$/) ?? value.trim().match(/^(\d{1,2})\s*[/.]\s*(\d{4})$/);
  if (numeric) {
    const month = Number(numeric[1]);
    if (month >= 1 && month <= 12) return `${numeric[2]}-${String(month).padStart(2, "0")}`;
    return numeric[2]!;
  }
  const year = v.match(/^((?:19|20)\d{2})$/);
  return year ? year[1]! : null;
}

export interface DateRange {
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  matchText: string;
}

export function findDateRange(line: string): DateRange | null {
  const match = line.match(RANGE_RE);
  if (!match) return null;
  const startDate = parsePartialDate(match[1]!);
  const endRaw = match[2]!;
  const isCurrent = new RegExp(`^${PRESENT_RE}$`, "i").test(endRaw.trim());
  const endDate = isCurrent ? null : parsePartialDate(endRaw);
  if (!startDate) return null;
  if (endDate && endDate < startDate) return null;
  return { startDate, endDate, isCurrent, matchText: match[0] };
}

// --- Line helpers ------------------------------------------------------------------

const BULLET_RE = /^([•·▪●◦■□➢►\-–*]|o\s|\d+[.)]\s)/;
export const isBullet = (line: string) => BULLET_RE.test(line);
export const stripBullet = (line: string) => line.replace(BULLET_RE, "").trim();

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const URL_RE =
  /\b((?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/[^\s,;)]*)?)/gi;
const PHONE_RE = /(\+?\d[\d ()./-]{7,}\d)/;

function cleanUrl(raw: string): string {
  const trimmed = raw.replace(/[.,;:)]+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function findUrls(line: string): string[] {
  if (EMAIL_RE.test(line)) line = line.replace(new RegExp(EMAIL_RE.source, "gi"), " ");
  return Array.from(line.matchAll(URL_RE), (m) => cleanUrl(m[1]!)).filter((url) => {
    const host = url.replace(/^https?:\/\//, "").split("/")[0] ?? "";
    // Avoid false positives like "Node.js" or "Next.js" being read as domains.
    return !/\.(js|ts|py)$/i.test(host) || url.includes("/");
  });
}

function splitEntries(lines: string[]): string[][] {
  const entries: string[][] = [];
  let current: string[] = [];
  const push = () => {
    if (current.some((l) => l.length > 0)) entries.push(current);
    current = [];
  };
  for (const line of lines) {
    if (line === "") {
      if (current.length > 0 && current.some((l) => findDateRange(l) || isBullet(l))) push();
      continue;
    }
    if (findDateRange(line) && current.some((l) => findDateRange(l))) {
      // Carry trailing header lines (non-bullet, short) into the new entry.
      const carried: string[] = [];
      while (
        current.length > 1 &&
        carried.length < 2 &&
        !isBullet(current[current.length - 1]!) &&
        !findDateRange(current[current.length - 1]!) &&
        current[current.length - 1]!.length < 100
      ) {
        carried.unshift(current.pop()!);
      }
      push();
      current = carried;
    }
    current.push(line);
  }
  push();
  return entries;
}

const excerptOf = (lines: string[]) => lines.filter(Boolean).join("\n").slice(0, 600);

// --- Experience ------------------------------------------------------------------

const TITLE_RE =
  /\b(founder|co-?founder|owner|ceo|cto|coo|cmo|manager|engineer|developer|intern|assistant|specialist|consultant|designer|analyst|lead|director|officer|executive|coordinator|marketer|freelancer?|head|associate|representative|administrator|strategist|writer|editor|architect|scientist|researcher|trainee|supervisor|agent|advisor|teacher|tutor|volunteer|president|partner|programmer|technician|creator|producer|operator)\b/i;

const SEPARATORS = [" — ", " – ", " | ", " - ", " · ", ", "];

export function splitTitleOrganization(parts: string[]): {
  title: string | null;
  organization: string | null;
  location: string | null;
} {
  const first = parts[0] ?? "";
  const at = first.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
  if (at) {
    const [org, location] = splitOnce(at[2]!);
    return { title: at[1]!.trim(), organization: org, location: location ?? parts[1] ?? null };
  }
  for (const sep of SEPARATORS) {
    if (first.includes(sep)) {
      const [a, ...rest] = first.split(sep).map((p) => p.trim());
      const b = rest[0] ?? "";
      const location = rest.slice(1).join(", ") || null;
      if (TITLE_RE.test(a!) && !TITLE_RE.test(b)) return { title: a!, organization: b, location };
      if (TITLE_RE.test(b) && !TITLE_RE.test(a!)) return { title: b, organization: a!, location };
      return { title: a!, organization: b || null, location };
    }
  }
  if (parts.length >= 2) {
    const second = parts[1]!;
    const [secondOrg, secondLoc] = splitOnce(second);
    if (TITLE_RE.test(second) && !TITLE_RE.test(first))
      return { title: second, organization: first, location: parts[2] ?? null };
    return { title: first, organization: secondOrg, location: secondLoc ?? parts[2] ?? null };
  }
  return TITLE_RE.test(first)
    ? { title: first, organization: null, location: null }
    : { title: null, organization: first || null, location: null };
}

function splitOnce(value: string): [string, string | null] {
  for (const sep of [" | ", " — ", " – ", " - ", ", "]) {
    const i = value.indexOf(sep);
    if (i > 0) return [value.slice(0, i).trim(), value.slice(i + sep.length).trim() || null];
  }
  return [value.trim(), null];
}

function parseExperience(entry: string[]): FactDraft | null {
  let range: DateRange | null = null;
  const header: string[] = [];
  const bullets: string[] = [];
  const description: string[] = [];
  for (const line of entry) {
    if (!line) continue;
    const r: DateRange | null = range ? null : findDateRange(line);
    if (r) {
      range = r;
      const rest = line
        .replace(r.matchText, "")
        .replace(/[|,–—\-()\s]+$/, "")
        .replace(/^[|,–—\-()\s]+/, "")
        .trim();
      if (rest) header.push(rest);
      continue;
    }
    if (isBullet(line)) bullets.push(stripBullet(line));
    else if (
      header.length < 2 &&
      bullets.length === 0 &&
      description.length === 0 &&
      line.length < 120
    )
      header.push(line);
    else description.push(line);
  }
  const { title, organization, location } = splitTitleOrganization(header);
  if (!title || !organization) return null;
  return {
    category: "experience",
    method: "RULE",
    confidence: range ? 0.7 : 0.5,
    excerpt: excerptOf(entry),
    payload: {
      title,
      organization,
      location,
      startDate: range?.startDate ?? null,
      endDate: range?.endDate ?? null,
      isCurrent: range?.isCurrent ?? false,
      description: description.join(" ").slice(0, 5000) || null,
      responsibilities: bullets.slice(0, 30),
      skillsUsed: [],
    },
  };
}

// --- Education -------------------------------------------------------------------

const DEGREE_RE =
  /\b(bachelor|master|b\.?\s?sc|m\.?\s?sc|b\.?\s?a\b|m\.?\s?a\b|bba|mba|ph\.?\s?d|doctorate|diploma|associate degree|a[- ]levels?|o[- ]levels?|high school|hsc|ssc|matric(ulation)?|intermediate|b\.?\s?com|m\.?\s?com|b\.?\s?e\b|b\.?\s?tech|m\.?\s?tech|llb|llm|bs\b|ms\b|fsc|ics|gcse|ib diploma|abitur|baccalaur[eé]at)/i;
const INSTITUTION_RE =
  /\b(university|college|institute|school|academy|polytechnic|universit[äa]t|hochschule|école|ecole|campus)\b/i;

function parseEducation(entry: string[]): FactDraft | null {
  const lines = entry.filter(Boolean);
  let range: DateRange | null = null;
  let singleYear: string | null = null;
  let degreeLine: string | null = null;
  let institution: string | null = null;
  const rest: string[] = [];
  for (const raw of lines) {
    let line = raw;
    const r: DateRange | null = range ? null : findDateRange(line);
    if (r) {
      range = r;
      line = line
        .replace(r.matchText, "")
        .replace(/[|,–—\-()\s]+$/, "")
        .trim();
    } else if (!range && !singleYear) {
      const y = line.match(YEAR_RE);
      if (y && line.replace(y[0], "").replace(/[\s|,()\-–—]/g, "").length < line.length) {
        singleYear = y[1]!;
        line = line
          .replace(y[0], "")
          .replace(/[|,–—\-()\s]+$/, "")
          .trim();
      }
    }
    if (!line) continue;
    const parts = line
      .split(/ [|—–-] |, (?=[A-Z])/)
      .map((p) => p.trim())
      .filter(Boolean);
    for (const part of parts) {
      if (!degreeLine && DEGREE_RE.test(part)) degreeLine = part;
      else if (!institution && INSTITUTION_RE.test(part)) institution = part;
      else rest.push(part);
    }
  }
  if (!institution && degreeLine && rest.length > 0 && !isBullet(rest[0]!))
    institution = rest.shift()!;
  if (!institution) return null;
  let degree = degreeLine;
  let fieldOfStudy: string | null = null;
  if (degreeLine) {
    const m = degreeLine.match(/^(.+?)\s+(?:in|of)\s+(.+)$/i);
    if (m && m[1]!.length <= 30 && !/^(bachelor|master|doctor)$/i.test(m[1]!.trim())) {
      degree = m[1]!.trim();
      fieldOfStudy = m[2]!.trim();
    }
  }
  return {
    category: "education",
    method: "RULE",
    confidence: degreeLine ? 0.7 : 0.5,
    excerpt: excerptOf(entry),
    payload: {
      institution,
      degree,
      fieldOfStudy,
      location: null,
      startDate: range?.startDate ?? null,
      endDate: range?.endDate ?? singleYear ?? null,
      isCurrent: range?.isCurrent ?? false,
      description:
        rest
          .filter((r) => isBullet(r))
          .map(stripBullet)
          .join(" ") || null,
    },
  };
}

// --- Skills --------------------------------------------------------------------

const LABEL_CATEGORIES: [RegExp, string][] = [
  [/^(technical|tech|programming|development|engineering|backend|databases?)/i, "TECHNICAL"],
  [/^(web|frontend|front-end|full[- ]?stack)/i, "WEB"],
  [/^(ai|artificial intelligence|machine learning|ml)/i, "AI"],
  [/^automation/i, "AUTOMATION"],
  [/^(tools|software|platforms)/i, "TOOLS"],
  [/^(design|ui|ux)/i, "DESIGN"],
  [/^creative/i, "CREATIVE"],
  [/^content/i, "CONTENT"],
  [/^(marketing|digital marketing|growth)/i, "MARKETING"],
  [/^sales/i, "SALES"],
  [/^(business|management)/i, "BUSINESS"],
  [/^(soft|interpersonal|personal)/i, "SOFT_SKILLS"],
];

const KEYWORD_CATEGORIES: [RegExp, string][] = [
  [
    /^(react(\.?js)?|next\.?js|vue(\.?js)?|angular|svelte|html5?|css3?|tailwind( css)?|javascript|typescript|node\.?js|wordpress|webflow|shopify|php|django|laravel|express(\.?js)?|framer|wix|squarespace)$/i,
    "WEB",
  ],
  [
    /^(python|java|c\+\+|c#|go|golang|rust|sql|postgres(ql)?|mysql|mongodb|docker|kubernetes|aws|gcp|azure|git|linux|supabase|firebase|prisma|graphql|rest apis?|redis)$/i,
    "TECHNICAL",
  ],
  [
    /(chatgpt|openai|\bllms?\b|machine learning|deep learning|prompt engineering|^ai$|ollama|langchain|\bnlp\b|computer vision|claude|generative ai|midjourney)/i,
    "AI",
  ],
  [/(zapier|make\.com|^make$|\bn8n\b|automation|integromat|airtable|apify)/i, "AUTOMATION"],
  [
    /(figma|photoshop|illustrator|canva|\bui\b|\bux\b|indesign|after effects|premiere|graphic design|web design|branding design)/i,
    "DESIGN",
  ],
  [
    /(\bseo\b|\bsem\b|google ads|meta ads|facebook ads|social media|marketing|analytics|\bppc\b|branding|lead generation|funnels?)/i,
    "MARKETING",
  ],
  [
    /(copywriting|content|writing|blogging|video editing|storytelling|photography|videography)/i,
    "CONTENT",
  ],
  [
    /(sales|\bcrm\b|hubspot|salesforce|negotiation|cold (email|outreach)|business development)/i,
    "SALES",
  ],
  [
    /(excel|project management|strategy|finance|accounting|operations|entrepreneurship|management)/i,
    "BUSINESS",
  ],
  [
    /(communication|leadership|teamwork|problem[- ]solving|time management|adaptability|critical thinking|creativity|collaboration)/i,
    "SOFT_SKILLS",
  ],
  [
    /(notion|jira|trello|slack|asana|clickup|vs ?code|github|google workspace|microsoft office|ms office)/i,
    "TOOLS",
  ],
];

export function categorizeSkill(name: string, label?: string | null): string {
  if (label) {
    for (const [re, category] of LABEL_CATEGORIES) if (re.test(label.trim())) return category;
  }
  for (const [re, category] of KEYWORD_CATEGORIES) if (re.test(name.trim())) return category;
  return "OTHER";
}

function parseSkills(lines: string[]): FactDraft[] {
  const drafts: FactDraft[] = [];
  const seen = new Set<string>();
  for (const raw of lines) {
    if (!raw) continue;
    let line = stripBullet(raw);
    let label: string | null = null;
    const labelled = line.match(/^([A-Za-z &/+-]{2,40}):\s*(.+)$/);
    if (labelled) {
      label = labelled[1]!;
      line = labelled[2]!;
    }
    for (const token of line.split(/\s*[,;|•·]\s*|\s+\/\s+|\t/)) {
      const name = token.replace(/^[\s\-–*]+|[\s.]+$/g, "").trim();
      if (!name || name.length > 40 || name.split(/\s+/).length > 5 || /^\d+$/.test(name)) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      drafts.push({
        category: "skill",
        method: "RULE",
        confidence: 0.75,
        excerpt: raw.slice(0, 300),
        // Proficiency is deliberately NOT inferred.
        payload: {
          name,
          category: categorizeSkill(name, label),
          proficiency: null,
          yearsUsed: null,
        },
      });
    }
  }
  return drafts;
}

// --- Languages ------------------------------------------------------------------

function parseLanguages(lines: string[]): FactDraft[] {
  const drafts: FactDraft[] = [];
  for (const raw of lines) {
    if (!raw) continue;
    for (const token of stripBullet(raw).split(/\s*[,;|•·]\s*(?![^()]*\))/)) {
      const m = token.match(/^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ ]{1,25}?)\s*(?:[:\-–—(]\s*([^)]*)\)?)?$/);
      if (!m) continue;
      const language = m[1]!.trim();
      if (language.split(" ").length > 3) continue;
      const stated = (m[2] ?? "").trim();
      const cefr = stated.match(/\b([ABC][12])\b/i)?.[1]?.toUpperCase() ?? null;
      const native = /native|mother tongue|first language/i.test(stated);
      drafts.push({
        category: "language",
        method: "RULE",
        confidence: 0.7,
        excerpt: raw.slice(0, 200),
        // Only explicit CEFR levels or "native" are mapped; words like "fluent" are left for the user.
        payload: {
          language,
          proficiency: native ? "NATIVE" : cefr,
          reading: null,
          writing: null,
          speaking: null,
        },
      });
    }
  }
  return drafts;
}

// --- Certifications ------------------------------------------------------------------

function parseCertifications(lines: string[]): FactDraft[] {
  const drafts: FactDraft[] = [];
  for (const raw of lines) {
    if (!raw || raw.length > 180) continue;
    let line = stripBullet(raw);
    let issueDate: string | null = null;
    const dated = line.match(new RegExp(`[(\\s,–—-]*(${DATE_RE})\\)?\\s*$`, "i"));
    if (dated) {
      issueDate = parsePartialDate(dated[1]!);
      line = line.slice(0, dated.index).trim();
    }
    let name = line;
    let issuer: string | null = null;
    const byMatch = line.match(/^(.+?)\s+(?:by|from|—|–|-|\||,)\s+(.+)$/i);
    if (byMatch) {
      name = byMatch[1]!.trim();
      issuer = byMatch[2]!.trim();
    }
    name = name.replace(/[\s,–—\-|]+$/, "");
    if (name.length < 3) continue;
    drafts.push({
      category: "certification",
      method: "RULE",
      confidence: 0.65,
      excerpt: raw,
      payload: {
        name,
        issuer,
        issueDate,
        expiryDate: null,
        credentialId: null,
        credentialUrl: null,
      },
    });
  }
  return drafts;
}

// --- Projects ----------------------------------------------------------------------

function parseProjects(lines: string[]): FactDraft[] {
  const drafts: FactDraft[] = [];
  const entries = splitProjectEntries(lines);
  for (const entry of entries) {
    const clean = entry.filter(Boolean);
    if (clean.length === 0) continue;
    let range: DateRange | null = null;
    let name: string | null = null;
    let role: string | null = null;
    const description: string[] = [];
    const bullets: string[] = [];
    let technologies: string[] = [];
    const urls: string[] = [];
    for (const line of clean) {
      urls.push(...findUrls(line));
      const tech = stripBullet(line).match(
        /^(tech(nologies)?( used)?|stack|tech stack|tools|built with)\s*[:\-–]\s*(.+)$/i,
      );
      if (tech) {
        technologies = tech[4]!
          .split(/\s*[,;|•·]\s*|\s+\/\s+/)
          .map((t) => t.trim())
          .filter((t) => t && t.length <= 40);
        continue;
      }
      const r: DateRange | null = range ? null : findDateRange(line);
      let text = line;
      if (r) {
        range = r;
        text = line
          .replace(r.matchText, "")
          .replace(/[|,–—\-()\s]+$/, "")
          .trim();
        if (!text) continue;
      }
      if (!name && !isBullet(text)) {
        const [first, second] = splitOnce(text.replace(URL_RE, "").trim());
        name = first.replace(/[:|,–—\-\s]+$/, "") || null;
        if (second && TITLE_RE.test(second)) role = second;
        else if (second) description.push(second);
      } else if (isBullet(text)) bullets.push(stripBullet(text));
      else description.push(text);
    }
    if (!name || name.length > 120) continue;
    const repositoryUrl = urls.find((u) => /github\.com\/[^/]+\/[^/]+/i.test(u)) ?? null;
    const liveUrl = urls.find((u) => u !== repositoryUrl) ?? null;
    drafts.push({
      category: "project",
      method: "RULE",
      confidence: 0.6,
      excerpt: excerptOf(entry),
      payload: {
        name,
        role,
        description: description.join(" ").slice(0, 5000) || null,
        projectType: null,
        technologies,
        skills: [],
        responsibilities: bullets.slice(0, 30),
        outcomes: [],
        portfolioUrl: null,
        repositoryUrl,
        liveUrl,
        imageUrls: [],
        startDate: range?.startDate ?? null,
        endDate: range?.endDate ?? null,
        isCurrent: range?.isCurrent ?? false,
        teamSize: null,
      },
    });
  }
  return drafts;
}

function splitProjectEntries(lines: string[]): string[][] {
  // Blank lines separate projects; otherwise a non-bullet line after bullets starts a new one.
  const entries: string[][] = [];
  let current: string[] = [];
  let sawBody = false;
  for (const line of lines) {
    if (!line) {
      if (current.length) entries.push(current);
      current = [];
      sawBody = false;
      continue;
    }
    const isTech = /^(tech(nologies)?|stack|tools|built with)\s*[:\-–]/i.test(stripBullet(line));
    if (!isBullet(line) && !isTech && sawBody && current.length) {
      entries.push(current);
      current = [];
      sawBody = false;
    }
    if (isBullet(line) || isTech || current.length > 0)
      sawBody = sawBody || isBullet(line) || isTech || current.length > 0;
    current.push(line);
  }
  if (current.length) entries.push(current);
  return entries;
}

// --- Portfolio & achievements ------------------------------------------------------------

export function portfolioTypeForUrl(url: string): string {
  if (/github\.com\/[^/]+\/[^/]+/i.test(url)) return "GITHUB_REPOSITORY";
  if (/behance\.net|dribbble\.com/i.test(url)) return "DESIGN";
  if (/youtube\.com|youtu\.be|vimeo\.com/i.test(url)) return "VIDEO";
  if (/medium\.com|substack\.com/i.test(url)) return "PUBLICATION";
  return "WEBSITE";
}

function parsePortfolio(lines: string[]): FactDraft[] {
  const drafts: FactDraft[] = [];
  for (const raw of lines) {
    for (const url of findUrls(raw)) {
      if (/linkedin\.com/i.test(url)) continue;
      const label = stripBullet(raw)
        .replace(URL_RE, "")
        .replace(/[:\-–—|\s]+$/, "")
        .trim();
      drafts.push({
        category: "portfolio",
        method: "RULE",
        confidence: 0.7,
        excerpt: raw,
        payload: {
          title: label || url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""),
          type: portfolioTypeForUrl(url),
          url,
          description: null,
          skills: [],
          projectId: null,
        },
      });
    }
  }
  return drafts;
}

function parseAchievements(lines: string[]): FactDraft[] {
  return lines
    .filter(Boolean)
    .map(stripBullet)
    .filter((line) => line.length >= 8 && line.length <= 1000)
    .map((statement) => ({
      category: "achievement" as const,
      method: "RULE" as const,
      confidence: 0.6,
      excerpt: statement,
      // metric intentionally null: never extracted or invented, the user may add one.
      payload: { statement, metric: null, experienceId: null, projectId: null },
    }));
}

// --- Header / contact ----------------------------------------------------------------

const NAME_RE = /^[A-Z][A-Za-zÀ-ÿ'’.-]+(?:\s+[A-Z][A-Za-zÀ-ÿ'’.-]+){1,3}$/;

function profileDraft(
  field: string,
  value: string,
  excerpt: string,
  confidence: number,
): FactDraft {
  return {
    category: "profile",
    method: "RULE",
    confidence,
    excerpt: excerpt.slice(0, 300),
    payload: { field, value },
  };
}

function parseHeader(header: string[], allLines: string[]): FactDraft[] {
  const drafts: FactDraft[] = [];
  const top = header.length > 0 ? header : allLines.slice(0, 12);
  const scan = [...top, ...allLines.slice(0, 20)];
  const seen = new Set<string>();
  const add = (draft: FactDraft) => {
    const key = `${draft.payload.field}`;
    if (!seen.has(key)) {
      seen.add(key);
      drafts.push(draft);
    }
  };

  const nonEmpty = top.filter(Boolean);
  const first = nonEmpty[0];
  if (
    first &&
    first.length <= 60 &&
    (NAME_RE.test(first) || /^[A-Z][A-Z'’. -]{3,59}$/.test(first)) &&
    !classifyHeading(first)
  ) {
    add(profileDraft("fullName", first, first, 0.6));
    const second = nonEmpty[1];
    if (
      second &&
      second.length <= 100 &&
      !EMAIL_RE.test(second) &&
      !PHONE_RE.test(second) &&
      findUrls(second).length === 0 &&
      !classifyHeading(second)
    ) {
      add(profileDraft("headline", second.replace(/\s*[|•·]\s*/g, " · "), second, 0.45));
    }
  }

  for (const line of scan) {
    const email = line.match(EMAIL_RE);
    if (email) add(profileDraft("professionalEmail", email[0], line, 0.9));
    const phone = line.replace(EMAIL_RE, " ").match(PHONE_RE);
    if (phone && phone[1]!.replace(/\D/g, "").length >= 8 && !findDateRange(line)) {
      add(profileDraft("phone", phone[1]!.trim(), line, 0.8));
    }
    for (const url of findUrls(line)) {
      if (/linkedin\.com\/in\//i.test(url)) add(profileDraft("linkedinUrl", url, line, 0.95));
      else if (/github\.com\/[^/\s]+\/?$/i.test(url))
        add(profileDraft("githubUrl", url, line, 0.9));
      else if (!/github\.com|linkedin\.com/i.test(url))
        add(profileDraft("websiteUrl", url, line, 0.6));
    }
  }
  return drafts;
}

// --- Entry point --------------------------------------------------------------------

export function parseCvText(text: string): FactDraft[] {
  const { header, sections } = splitSections(text);
  const allLines = text.split("\n").map((l) => l.trim());
  const drafts: FactDraft[] = [...parseHeader(header, allLines)];

  for (const section of sections) {
    switch (section.key) {
      case "summary": {
        const summary = section.lines.filter(Boolean).join(" ").trim();
        if (summary.length >= 20)
          drafts.push(profileDraft("summary", summary.slice(0, 3000), summary, 0.7));
        break;
      }
      case "experience":
        for (const entry of splitEntries(section.lines)) {
          const draft = parseExperience(entry);
          if (draft) drafts.push(draft);
        }
        break;
      case "education":
        for (const entry of splitEntries(section.lines)) {
          const draft = parseEducation(entry);
          if (draft) drafts.push(draft);
        }
        break;
      case "skills":
        drafts.push(...parseSkills(section.lines));
        break;
      case "languages":
        drafts.push(...parseLanguages(section.lines));
        break;
      case "certifications":
        drafts.push(...parseCertifications(section.lines));
        break;
      case "projects":
        drafts.push(...parseProjects(section.lines));
        break;
      case "portfolio":
        drafts.push(...parsePortfolio(section.lines));
        break;
      case "achievements":
        drafts.push(...parseAchievements(section.lines));
        break;
      case "ignore":
        break;
    }
  }
  return drafts.slice(0, 250);
}
