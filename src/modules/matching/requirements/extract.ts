import { findSkills, skillByKey } from "../skills";

/**
 * Deterministic job-requirement extraction (pure, no AI, unit-tested).
 *
 * Rules:
 *  - Only what the job states is extracted; nothing is inferred or invented.
 *  - Structured job fields (work mode, location, employment type, salary, title wording,
 *    visa text) become requirements with a `job.<field>` source reference.
 *  - Description lines produce requirements only inside requirement / nice-to-have
 *    sections, or when the line itself carries an explicit cue ("must", "a plus",
 *    "experience with"). Responsibilities, benefits and "about us" text never do.
 *  - Every requirement keeps the verbatim source line and its line number.
 *  - Job text is untrusted: it is only pattern-matched and stored as text.
 */

export const EXTRACTOR_VERSION = "rules-3";

export const REQUIREMENT_TYPES = ["REQUIRED", "PREFERRED", "INFORMATIONAL", "UNKNOWN"] as const;
export type RequirementType = (typeof REQUIREMENT_TYPES)[number];

export const REQUIREMENT_KINDS = [
  "SKILL",
  "EXPERIENCE",
  "EDUCATION",
  "LOCATION",
  "WORK_MODE",
  "EMPLOYMENT",
  "SALARY",
  "AUTHORIZATION",
  "LANGUAGE",
  "CERTIFICATION",
  "DOMAIN",
  "PORTFOLIO",
  "OTHER",
] as const;
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];

export interface ExtractableJob {
  title: string;
  description: string;
  locationRaw: string;
  city: string | null;
  region: string | null;
  countryCode: string | null;
  remoteStatus: string;
  remoteStatusRaw: string | null;
  employmentType: string;
  employmentTypeRaw: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
  salaryRaw: string | null;
  experienceLevel: string;
  experienceLevelRaw: string | null;
  visaTextRaw: string | null;
}

export interface ExtractedRequirement {
  category: RequirementKind;
  requirementType: RequirementType;
  /** Short statement of the requirement (≤ 500 chars) */
  text: string;
  normalizedValue: Record<string, unknown>;
  /** Verbatim job wording (≤ 2000 chars) */
  sourceText: string;
  /** "job.<field>" or "description:L<line>" */
  sourceReference: string;
  confidence: number;
}

// --- Sections ----------------------------------------------------------------------

type Section = "REQUIRED" | "PREFERRED" | "RESPONSIBILITIES" | "BENEFITS" | "ABOUT" | "NONE";

const HEADINGS: [Section, RegExp][] = [
  [
    "PREFERRED",
    /\b(nice[\s-]to[\s-]haves?|preferred( qualifications| skills)?|bonus( points)?|pluses|desired( skills| qualifications)?|good[\s-]to[\s-]have|extra credit|it would be great|even better if|what would make you stand out)\b/i,
  ],
  [
    "REQUIRED",
    /\b(requirements?|qualifications|what you('ll| will)? (need|bring)|who you are|must[\s-]haves?|what we('re| are)? looking for|skills (and|&) experience|about you|you (have|bring)|minimum qualifications|basic qualifications|essential|your profile|your skills|key skills|eligibility)\b/i,
  ],
  [
    "RESPONSIBILITIES",
    /\b(responsibilit(y|ies)|what you('ll| will) (do|be doing|work on)|the role|your role|day[\s-]to[\s-]day|in this role|key duties|duties|your mission|your impact|what you('ll| will) achieve)\b/i,
  ],
  [
    "BENEFITS",
    /\b(benefits|perks|what we offer|why join|why you('ll| will) love|we offer|compensation|package)\b/i,
  ],
  [
    "ABOUT",
    /\b(about (us|the company|the team)|who we are|our (mission|story|values)|company overview)\b/i,
  ],
];

function headingSection(line: string): Section | null {
  const t = line.replace(/^[#*•\-\s]+|[:\s]+$/g, "");
  if (t.length === 0 || t.length > 70 || /[.!?]$/.test(line.trim())) return null;
  if (t.split(/\s+/).length > 9) return null;
  for (const [section, re] of HEADINGS) if (re.test(t)) return section;
  return null;
}

const PREFERRED_CUE =
  /\b(nice to have|preferred|preferably|is a plus|a plus|an advantage|advantageous|bonus|desirable|ideally|good to have|would be great|beneficial)\b/i;
const REQUIRED_CUE =
  /\b(must|required|requirement|mandatory|essential|need(s)? to (have|be)|you (have|bring|are)|minimum|at least|proven)\b/i;
/** Wording that marks a skill/qualification statement even without a section heading */
const QUALIFICATION_CUE =
  /\b(experience (with|in|using|of)|proficien(t|cy)|knowledge of|familiar(ity)? with|skills? in|hands[\s-]on|expertise in|working knowledge|understanding of|comfortable (with|using)|ability to use)\b/i;

function lineType(section: Section, line: string): RequirementType | null {
  if (PREFERRED_CUE.test(line)) return "PREFERRED";
  if (section === "PREFERRED") return "PREFERRED";
  if (section === "REQUIRED") return "REQUIRED";
  if (section === "RESPONSIBILITIES" || section === "BENEFITS" || section === "ABOUT") {
    return REQUIRED_CUE.test(line) && QUALIFICATION_CUE.test(line) ? "REQUIRED" : null;
  }
  if (REQUIRED_CUE.test(line)) return "REQUIRED";
  if (QUALIFICATION_CUE.test(line)) return "UNKNOWN";
  return null;
}

// --- Line splitting ----------------------------------------------------------------

interface Line {
  n: number;
  text: string;
  /** Bullet / numbered item: content, never a section heading */
  bullet: boolean;
}

function descriptionLines(description: string): Line[] {
  const out: Line[] = [];
  description.split(/\r?\n/).forEach((raw, i) => {
    const bullet = /^\s*(?:[•·▪◦*\-–]|\d{1,2}[.)])\s+/.test(raw);
    const text = raw
      .replace(/^\s*(?:[•·▪◦*\-–]|\d{1,2}[.)])\s*/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return;
    // Long paragraphs are split into sentences so each requirement keeps a precise source.
    const parts = text.split(/(?<=[.!?;])\s+(?=[A-Z])/);
    for (const p of parts) if (p.trim()) out.push({ n: i + 1, text: p.trim(), bullet });
  });
  return out;
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

// --- Per-line detectors ----------------------------------------------------------------

const YEARS_RE =
  /(?:(?:minimum|at least|min\.?)\s+(?:of\s+)?)?(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*(\d{1,2})\s*)?\+?\s*(?:years?|yrs?)(?:'|’)?\s*(?:of\s+)?((?:[a-z/&+,.\s-]{0,60}?\s)?)experience(?:\s+(?:in|with|as|of|within|across|managing|running|doing)\s+([^.;:()]{2,80}))?/i;
const YEARS_AFTER_RE =
  /experience\s+(?:in|with|as|of)?\s*([^.;:()]{2,60}?)[,\s]+(?:of\s+)?(?:minimum|at least)?\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?)/i;

function experience(line: string) {
  const m = YEARS_RE.exec(line);
  if (m) {
    const min = Number(m[1]);
    const max = m[2] ? Number(m[2]) : null;
    if (min > 40 || (max !== null && max < min)) return null;
    const before = (m[3] ?? "").trim();
    const after = (m[4] ?? "").trim().replace(/\s+(is|are|preferred|required).*$/i, "");
    const domain = [before, after].filter(Boolean).join(" ").trim() || null;
    return {
      minYears: min,
      maxYears: max,
      domain,
      professional: /\b(professional|work|industry|full[\s-]time|commercial)\b/i.test(before),
    };
  }
  const a = YEARS_AFTER_RE.exec(line);
  if (a) {
    const min = Number(a[2]);
    if (min > 40) return null;
    return { minYears: min, maxYears: null, domain: a[1]!.trim() || null, professional: false };
  }
  return null;
}

const DEGREE_LEVELS: [string, RegExp][] = [
  ["DOCTORATE", /\b(ph\.?\s?d|doctorate|doctoral)\b/i],
  [
    "MASTER",
    /\b(master'?s?|m\.?\s?sc|mba|m\.?\s?tech|m\.?\s?a\.|m\.?\s?eng|postgraduate degree)\b/i,
  ],
  [
    "BACHELOR",
    /\b(bachelor'?s?|b\.?\s?sc|b\.?\s?tech|b\.?\s?e\.|bba|b\.?\s?com|b\.?\s?a\.|undergraduate degree|graduate degree)\b/i,
  ],
  ["ASSOCIATE", /\bassociate'?s? degree\b/i],
  ["DIPLOMA", /\bdiploma\b/i],
  ["ANY_DEGREE", /\b(university degree|college degree|degree)\b/i],
];

/** Degree level stated in a piece of text (DOCTORATE … DIPLOMA, ANY_DEGREE), or null. */
export function degreeLevel(text: string): string | null {
  if (
    !/\b(degree|bachelor|master|mba|bba|ph\.?\s?d|doctorate|diploma|b\.?\s?tech|b\.?\s?sc|m\.?\s?sc|b\.?\s?com|b\.?\s?a\.|m\.?\s?a\.|b\.?\s?e\.)/i.test(
      text,
    )
  )
    return null;
  return DEGREE_LEVELS.find(([, re]) => re.test(text))?.[0] ?? "ANY_DEGREE";
}

function education(line: string) {
  if (
    !/\b(degree|bachelor|master|mba|bba|ph\.?\s?d|doctorate|diploma|b\.?\s?tech|b\.?\s?sc|m\.?\s?sc)\b/i.test(
      line,
    )
  )
    return null;
  const level = DEGREE_LEVELS.find(([, re]) => re.test(line))?.[0] ?? "ANY_DEGREE";
  const field =
    /\b(?:degree|bachelor'?s?|master'?s?|diploma)\s+(?:degree\s+)?(?:in|of)\s+([A-Za-z&/,\s-]{3,80}?)(?=\s+(?:or\s+(?:a\s+)?(?:related|similar|equivalent|relevant)|and\b|with\b|from\b)|[.;:()]|,\s*(?:or|and)|$)/i.exec(
      line,
    );
  return {
    level,
    field: field?.[1]?.trim().replace(/,$/, "") || null,
    relatedFieldsAccepted:
      /\b(or )?(a )?(related|similar|relevant|equivalent) (field|discipline|subject|area)/i.test(
        line,
      ),
    equivalentExperienceAccepted:
      /\b(or )?equivalent (practical |work |professional )?experience\b/i.test(line),
  };
}

const LANGUAGES = [
  "English",
  "German",
  "French",
  "Spanish",
  "Italian",
  "Portuguese",
  "Dutch",
  "Polish",
  "Swedish",
  "Danish",
  "Finnish",
  "Norwegian",
  "Czech",
  "Estonian",
  "Arabic",
  "Hindi",
  "Bengali",
  "Tamil",
  "Telugu",
  "Marathi",
  "Kannada",
  "Malayalam",
  "Gujarati",
  "Punjabi",
  "Urdu",
  "Mandarin",
  "Chinese",
  "Japanese",
  "Korean",
  "Russian",
  "Turkish",
  "Greek",
  "Hebrew",
];
const LANG_CUE =
  /\b(fluen(t|cy)|native|proficien(t|cy)|speak(ing)?|spoken|written|verbal|language|bilingual|level|communication|mother tongue|[abc][12])\b/i;
const LANG_LEVEL: [string, RegExp][] = [
  ["NATIVE", /\b(native|mother tongue)\b/i],
  ["C2", /\bC2\b/],
  ["C1", /\bC1\b/],
  ["B2", /\bB2\b/],
  ["B1", /\bB1\b/],
  ["FLUENT", /\bfluen(t|cy)\b/i],
  [
    "PROFESSIONAL",
    /\b(business|professional|working) (level|proficiency|fluency|english|german|french)?/i,
  ],
  ["PROFICIENT", /\bproficien(t|cy)\b/i],
];

/** `lenient`: a short sentence inside a requirements section may name a language without a cue word. */
function languages(line: string, lenient = false) {
  if (!LANG_CUE.test(line) && !(lenient && line.length <= 60)) return [];
  const found = LANGUAGES.filter((l) => new RegExp(`\\b${l}\\b`, "i").test(line));
  const level = LANG_LEVEL.find(([, re]) => re.test(line))?.[0] ?? null;
  return found.map((language) => ({ language, level }));
}

const REGIONS: [string, RegExp][] = [
  ["EU", /\b(EU|European Union|EEA|Europe)\b/],
  ["US", /\b(US|U\.S\.|USA|United States)\b/],
  ["UK", /\b(UK|United Kingdom)\b/],
  ["IN", /\bIndia\b/i],
  ["DE", /\bGermany\b/i],
  ["AE", /\b(UAE|United Arab Emirates)\b/],
  ["CA", /\bCanada\b/i],
  ["NL", /\bNetherlands\b/i],
  ["IE", /\bIreland\b/i],
  ["QA", /\bQatar\b/i],
  ["SA", /\bSaudi Arabia\b/i],
];

function authorization(line: string) {
  if (
    !/\b(work(ing)? (authori[sz]ation|permit|visa)|authori[sz]ed to work|right to work|eligib(le|ility) to work|legally (able|allowed|entitled) to work|visa sponsorship|sponsor(ship)?|citizen(ship)?|permanent resident|residency)\b/i.test(
      line,
    )
  )
    return null;
  const region = REGIONS.find(([, re]) => re.test(line))?.[0] ?? null;
  if (
    /\b(no|not|unable|cannot|can'?t|won'?t|will not|do not|does not|without)\b[^.]{0,40}\bsponsor/i.test(
      line,
    ) ||
    /\bsponsorship (is )?not (available|provided|offered|possible)\b/i.test(line)
  )
    return { kind: "SPONSORSHIP_UNAVAILABLE", region };
  if (
    /\b(visa sponsorship (is )?(available|provided|offered|possible)|we (can |will |do )?sponsor|sponsorship (is )?available|relocation and visa support)\b/i.test(
      line,
    )
  )
    return { kind: "SPONSORSHIP_AVAILABLE", region };
  if (/\bcitizen(ship)?\b/i.test(line)) return { kind: "CITIZENSHIP_REQUIRED", region };
  return { kind: "AUTHORIZATION_REQUIRED", region };
}

function portfolio(line: string) {
  if (!/\b(portfolio|work samples|showreel|case studies)\b/i.test(line)) return false;
  return !/\b(product|investment|brand|client|project|property|company|companies) portfolio|portfolio (companies|of (products|brands|clients|services|companies))|our portfolio\b/i.test(
    line,
  );
}

function certification(line: string) {
  if (!/\b(certifi(ed|cation|cations|cate)|chartered)\b/i.test(line)) return null;
  const skills = findSkills(line).map((s) => s.key);
  const phrase =
    /((?:[A-Z][\w.+#&-]*\s+){0,5}(?:certified|certification|certificate)(?:\s+(?:in|for|as)\s+[^.;,()]{2,60})?)/.exec(
      line,
    )?.[1];
  return { name: phrase?.trim() ?? null, skills };
}

function other(line: string) {
  const out: { kind: string; value?: number | null; text: string }[] = [];
  const travel =
    /(\d{1,3})\s?%\s*(?:of\s+(?:the\s+)?time\s+)?travel|travel(?:ling)?\s+(?:up to\s+|about\s+|around\s+)?(\d{1,3})\s?%/i.exec(
      line,
    );
  if (travel) out.push({ kind: "TRAVEL", value: Number(travel[1] ?? travel[2]), text: "Travel" });
  else if (/\bwilling(ness)? to travel\b|\btravel (is )?required\b/i.test(line))
    out.push({ kind: "TRAVEL", value: null, text: "Willingness to travel" });
  if (/\b(driv(ing|er'?s) licen[cs]e|valid licen[cs]e to drive|own (car|vehicle))\b/i.test(line))
    out.push({ kind: "DRIVING_LICENSE", text: "Driving licence" });
  if (/\bsecurity clearance\b/i.test(line))
    out.push({ kind: "SECURITY_CLEARANCE", text: "Security clearance" });
  if (
    /\b(night shifts?|rotational shifts?|shift work|weekend work|work(ing)? (on )?weekends)\b/i.test(
      line,
    )
  )
    out.push({ kind: "SCHEDULE", text: "Shift / weekend work" });
  if (/\b(immediate (joiner|start|joining)|join immediately|notice period)\b/i.test(line))
    out.push({ kind: "AVAILABILITY", text: "Availability / notice period" });
  return out;
}

function relocation(line: string) {
  return /\b(willing(ness)? to relocate|relocation (is )?required|must relocate|able to relocate)\b/i.test(
    line,
  );
}

const EDU_LABEL: Record<string, string> = {
  DOCTORATE: "Doctorate",
  MASTER: "Master's degree",
  BACHELOR: "Bachelor's degree",
  ASSOCIATE: "Associate degree",
  DIPLOMA: "Diploma",
  ANY_DEGREE: "Degree",
};

const DOMAIN_RE =
  /\b(B2B|B2C|D2C|DTC|SaaS|fintech|edtech|healthtech|e-?commerce|agency|startup|enterprise software|consumer tech)\b/i;

// --- Main --------------------------------------------------------------------------------

const TYPE_RANK: Record<RequirementType, number> = {
  REQUIRED: 3,
  PREFERRED: 2,
  UNKNOWN: 1,
  INFORMATIONAL: 0,
};
const MODE_LABEL: Record<string, string> = {
  REMOTE: "Remote",
  HYBRID: "Hybrid",
  ONSITE: "On-site",
};
const EMPLOYMENT_LABEL: Record<string, string> = {
  FULL_TIME: "Full time",
  PART_TIME: "Part time",
  CONTRACT: "Contract",
  TEMPORARY: "Temporary",
  INTERNSHIP: "Internship",
  APPRENTICESHIP: "Apprenticeship",
  FREELANCE: "Freelance",
};

/** Stable identity used to de-duplicate (same requirement stated twice keeps the strongest type). */
function identity(r: ExtractedRequirement): string {
  const v = r.normalizedValue;
  switch (r.category) {
    case "SKILL":
      return `SKILL:${v.skill}`;
    case "LANGUAGE":
      return `LANGUAGE:${v.language}`;
    case "EXPERIENCE":
      return `EXPERIENCE:${v.minYears ?? v.level}:${String(v.domain ?? "").toLowerCase()}`;
    case "EDUCATION":
      return `EDUCATION:${v.level}:${String(v.field ?? "").toLowerCase()}`;
    case "OTHER":
      return `OTHER:${v.kind}`;
    default:
      return `${r.category}:${JSON.stringify(v)}`;
  }
}

export function extractRequirements(job: ExtractableJob): ExtractedRequirement[] {
  const out: ExtractedRequirement[] = [];
  const push = (r: ExtractedRequirement) =>
    out.push({ ...r, text: clip(r.text, 500), sourceText: clip(r.sourceText, 2000) });

  // 1) Structured job fields -----------------------------------------------------------
  if (job.remoteStatus !== "UNKNOWN" && MODE_LABEL[job.remoteStatus]) {
    push({
      category: "WORK_MODE",
      requirementType: "REQUIRED",
      text: MODE_LABEL[job.remoteStatus]!,
      normalizedValue: { mode: job.remoteStatus },
      sourceText: job.remoteStatusRaw || job.locationRaw || MODE_LABEL[job.remoteStatus]!,
      sourceReference: "job.remote_status",
      confidence: 0.9,
    });
  }
  if (job.countryCode || job.city) {
    const onsite = job.remoteStatus === "ONSITE" || job.remoteStatus === "HYBRID";
    push({
      category: "LOCATION",
      requirementType: onsite ? "REQUIRED" : "INFORMATIONAL",
      text:
        job.remoteStatus === "REMOTE"
          ? `Remote${job.countryCode ? ` (listed for ${job.countryCode})` : ""}`
          : [job.city, job.region, job.countryCode].filter(Boolean).join(", "),
      normalizedValue: {
        countryCode: job.countryCode,
        city: job.city,
        region: job.region,
        remote: job.remoteStatus === "REMOTE",
      },
      sourceText: job.locationRaw || [job.city, job.countryCode].filter(Boolean).join(", "),
      sourceReference: "job.location",
      confidence: onsite ? 0.85 : 0.6,
    });
  }
  if (job.employmentType !== "UNKNOWN" && EMPLOYMENT_LABEL[job.employmentType]) {
    push({
      category: "EMPLOYMENT",
      requirementType: "REQUIRED",
      text: EMPLOYMENT_LABEL[job.employmentType]!,
      normalizedValue: { type: job.employmentType },
      sourceText: job.employmentTypeRaw || EMPLOYMENT_LABEL[job.employmentType]!,
      sourceReference: "job.employment_type",
      confidence: 0.9,
    });
  }
  if (job.salaryMin != null || job.salaryMax != null) {
    push({
      category: "SALARY",
      requirementType: "INFORMATIONAL",
      text: `${job.salaryCurrency ?? "Unknown currency"} ${job.salaryMin ?? "?"}–${job.salaryMax ?? "?"}${job.salaryPeriod ? ` per ${job.salaryPeriod.toLowerCase()}` : ""}`,
      normalizedValue: {
        min: job.salaryMin,
        max: job.salaryMax,
        currency: job.salaryCurrency,
        period: job.salaryPeriod,
      },
      sourceText:
        job.salaryRaw ||
        `${job.salaryMin ?? ""}–${job.salaryMax ?? ""} ${job.salaryCurrency ?? ""}`.trim(),
      sourceReference: "job.salary",
      confidence: 0.9,
    });
  }
  if (job.experienceLevel !== "UNKNOWN" && job.experienceLevelRaw) {
    push({
      category: "EXPERIENCE",
      requirementType: "INFORMATIONAL",
      text: `Seniority stated in title: ${job.experienceLevelRaw}`,
      normalizedValue: { level: job.experienceLevel },
      sourceText: job.title,
      sourceReference: "job.title",
      confidence: 0.8,
    });
  }
  if (job.visaTextRaw) {
    const auth = authorization(job.visaTextRaw);
    if (auth) {
      push({
        category: "AUTHORIZATION",
        requirementType: auth.kind === "SPONSORSHIP_AVAILABLE" ? "INFORMATIONAL" : "REQUIRED",
        text: authText(auth.kind, auth.region),
        normalizedValue: auth,
        sourceText: job.visaTextRaw,
        sourceReference: "job.visa_text",
        confidence: 0.85,
      });
    }
  }

  // 2) Description -------------------------------------------------------------------------
  let section: Section = "NONE";
  for (const line of descriptionLines(job.description)) {
    const heading = line.bullet ? null : headingSection(line.text);
    if (heading) {
      section = heading;
      continue;
    }
    const type = lineType(section, line.text);
    if (!type) continue;
    const ref = `description:L${line.n}`;
    const conf = section === "REQUIRED" || section === "PREFERRED" ? 0.8 : 0.6;
    const base = {
      requirementType: type,
      sourceText: line.text,
      sourceReference: ref,
      confidence: conf,
    };

    const exp = experience(line.text);
    if (exp) {
      push({
        ...base,
        category: "EXPERIENCE",
        text: `${exp.minYears}${exp.maxYears ? `–${exp.maxYears}` : "+"} years${exp.professional ? " professional" : ""} experience${exp.domain ? ` (${exp.domain})` : ""}`,
        // Skills named in the experience statement belong to it ("3+ years with Python").
        normalizedValue: { ...exp, domainSkills: findSkills(exp.domain ?? "").map((s) => s.key) },
      });
    }
    const edu = education(line.text);
    if (edu) {
      push({
        ...base,
        category: "EDUCATION",
        text: `${EDU_LABEL[edu.level] ?? "Degree"}${edu.field ? ` in ${edu.field}` : ""}${edu.relatedFieldsAccepted ? " (or related field)" : ""}${edu.equivalentExperienceAccepted ? " (or equivalent experience)" : ""}`,
        normalizedValue: edu,
      });
    }
    const inSection = section === "REQUIRED" || section === "PREFERRED";
    for (const lang of languages(line.text, inSection)) {
      push({
        ...base,
        category: "LANGUAGE",
        text: `${lang.language}${lang.level ? ` (${lang.level.toLowerCase()})` : ""}`,
        normalizedValue: lang,
      });
    }
    const auth = authorization(line.text);
    if (auth) {
      push({
        ...base,
        requirementType: auth.kind === "SPONSORSHIP_AVAILABLE" ? "INFORMATIONAL" : type,
        category: "AUTHORIZATION",
        text: authText(auth.kind, auth.region),
        normalizedValue: auth,
      });
    }
    const cert = certification(line.text);
    if (cert) {
      push({
        ...base,
        category: "CERTIFICATION",
        text: cert.name ?? clip(line.text, 160),
        normalizedValue: cert,
      });
    }
    if (portfolio(line.text)) {
      push({
        ...base,
        category: "PORTFOLIO",
        text: "Portfolio / work samples",
        normalizedValue: { kind: "PORTFOLIO" },
      });
    }
    if (relocation(line.text)) {
      push({
        ...base,
        category: "LOCATION",
        text: "Willingness to relocate",
        normalizedValue: { relocationRequired: true },
      });
    }
    for (const o of other(line.text)) {
      push({
        ...base,
        category: "OTHER",
        text: o.value ? `${o.text} (${o.value}%)` : o.text,
        normalizedValue: { kind: o.kind, value: o.value ?? null },
      });
    }
    const domain = DOMAIN_RE.exec(line.text);
    if (domain && /\bexperience\b/i.test(line.text) && !exp) {
      push({
        ...base,
        category: "DOMAIN",
        text: `${domain[1]} experience`,
        normalizedValue: { domain: domain[1]!.toUpperCase() },
      });
    }
    const lineSkills = exp
      ? [] // covered by the experience requirement (domainSkills)
      : findSkills(line.text).filter((s) => !cert?.skills.includes(s.key)); // "Google Ads certification" ≠ the skill
    // "Zapier or n8n": alternatives — satisfying any one of them satisfies the line.
    const anyOf =
      lineSkills.length > 1 && /\bor\b/i.test(line.text) ? lineSkills.map((s) => s.key) : null;
    for (const skill of lineSkills) {
      push({
        ...base,
        category: "SKILL",
        text: skillByKey(skill.key)?.name ?? skill.matched,
        normalizedValue: { skill: skill.key, matched: skill.matched, ...(anyOf ? { anyOf } : {}) },
      });
    }
  }

  // 3) De-duplicate: keep the strongest statement of the same requirement ----------------
  const best = new Map<string, ExtractedRequirement>();
  for (const r of out) {
    const key = identity(r);
    const prev = best.get(key);
    if (!prev || TYPE_RANK[r.requirementType] > TYPE_RANK[prev.requirementType]) best.set(key, r);
  }
  return [...best.values()].slice(0, 80);
}

function authText(kind: string, region: string | null) {
  const where = region ? ` (${region})` : "";
  switch (kind) {
    case "SPONSORSHIP_UNAVAILABLE":
      return `Visa sponsorship not available${where}`;
    case "SPONSORSHIP_AVAILABLE":
      return `Visa sponsorship available${where}`;
    case "CITIZENSHIP_REQUIRED":
      return `Citizenship required${where}`;
    default:
      return `Work authorization required${where}`;
  }
}
