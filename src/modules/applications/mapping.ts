/**
 * Deterministic field mapping (pure). Every decision carries its source, confidence, fill policy and
 * a human explanation. Rules:
 *  - identity/contact/links → candidate profile (EXACT/HIGH, auto-fill)
 *  - files → the exact approved resume / cover-letter export of the package
 *  - legal (work authorization, sponsorship), salary, availability, relocation → only explicit
 *    candidate data, always reviewed; otherwise "needs your answer" (never guessed)
 *  - demographic / EEO → only the candidate (voluntary; kept out of every generated answer)
 *  - consent / certification checkboxes → only the candidate
 *  - skill yes/no → "Yes" only when the skill is in the candidate's facts; never an automatic "No"
 *  - long custom questions → the question engine (generated, fact-validated answer)
 *  - anything else → unknown, surfaced for review (not guessed)
 */
import { findSkills, skillByKey } from "@/modules/matching/skills";
import type {
  FieldClassification,
  FieldPolicy,
  FieldType,
  MappingConfidence,
  MappingType,
} from "./types";

export interface CandidateData {
  profile: {
    id: string;
    fullName: string | null;
    email: string | null;
    phone: string | null;
    city: string | null;
    countryName: string | null;
    linkedinUrl: string | null;
    githubUrl: string | null;
    portfolioUrl: string | null;
    websiteUrl: string | null;
    availableFrom: string | null;
    noticePeriodWeeks: number | null;
    yearsOfExperience: number | null;
  };
  preferences: {
    salaryMin: number | null;
    salaryMax: number | null;
    salaryCurrency: string | null;
    salaryPeriod: string | null;
    relocation: string | null;
    needsSponsorship: string | null;
  } | null;
  authorizations: { ref: string; countryName: string; status: string }[];
  skills: { ref: string; name: string }[];
  experiences: {
    ref: string;
    title: string;
    organization: string;
    startDate: string | null;
    endDate: string | null;
    isCurrent: boolean;
  }[];
  education: {
    ref: string;
    institution: string;
    degree: string | null;
    fieldOfStudy: string | null;
  }[];
  files: { RESUME?: FileRef; COVER_LETTER?: FileRef };
  coverLetterText: string | null;
}

export interface FileRef {
  exportId: string;
  fileName: string;
  versionId: string;
}

export interface FieldInput {
  externalFieldId: string;
  label: string;
  fieldType: FieldType;
  required: boolean;
  options: string[];
  maxLength: number | null;
  classificationHint?: "DEMOGRAPHIC" | "CONSENT" | null;
}

export interface MappingDecision {
  mappingType: MappingType;
  sourceRef: string | null;
  value: unknown;
  confidence: MappingConfidence;
  policy: FieldPolicy;
  status: "MAPPED" | "NEEDS_REVIEW" | "NEEDS_USER_INPUT" | "BLOCKED";
  explanation: string;
  classification: FieldClassification;
  /** True when a generated answer (question engine) should fill it */
  needsQuestion: boolean;
}

export const PROFILE_KEYS = [
  "firstName",
  "lastName",
  "fullName",
  "preferredName",
  "email",
  "phone",
  "city",
  "location",
  "country",
  "linkedin",
  "github",
  "portfolio",
  "website",
  "currentCompany",
  "currentTitle",
  "school",
  "degree",
  "fieldOfStudy",
] as const;
export type ProfileKey = (typeof PROFILE_KEYS)[number];

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[*:?()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const DEMOGRAPHIC =
  /\b(gender|sex\b|race|racial|ethnic|ethnicity|hispanic|latino|latinx|veteran|disabilit|sexual orientation|lgbt|pronoun|transgender|age range|date of birth|religion|caste)\b/;
const CONSENT =
  /\b(i (agree|consent|acknowledge|certify|confirm|understand)|privacy (policy|notice)|terms|data processing|information (provided )?is (true|accurate)|by (checking|submitting))\b/;
const WORK_AUTH =
  /\b(authori[sz]ed to work|work authori[sz]ation|right to work|legally (allowed|authori[sz]ed|eligible|permitted) to work|eligible to work|work permit|visa status)\b/;
const SPONSOR = /\b(sponsor|sponsorship|visa sponsorship|require (a )?visa)\b/;
const SALARY =
  /\b(salary|compensation|pay expectation|expected (pay|ctc|package)|ctc|remuneration)\b/;
const RELOCATE = /\b(relocat|willing to move)\b/;
const START =
  /\b(start date|earliest (start|date)|when can you start|available (to start|from)|availability|notice period)\b/;
const YEARS = /\b(years? of (relevant |professional |work )?experience|how many years)\b/;
const SOURCE_Q = /\b(how did you (hear|find|learn)|where did you (hear|find))\b/;
const SKILL_Q =
  /\b(have you (worked|used|built)|do you have (experience|knowledge)|experience (with|in|using)|familiar with|proficien|rate your|skill level|level of expertise)\b/;
const RATING = /\b(rate|proficiency|skill level|level of expertise|how (strong|proficient))\b/;
const QUESTION_LIKE =
  /\?\s*$|\b(why|describe|tell us|explain|what (interests|excites|motivates|makes)|share|walk us through|how would you|please (provide|elaborate))\b/;

function splitName(full: string | null): { first: string | null; last: string | null } {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: null, last: null };
  if (parts.length === 1) return { first: parts[0]!, last: null };
  return { first: parts[0]!, last: parts.slice(1).join(" ") };
}

/** Value of a profile key from explicit candidate data (null when not available). */
export function profileValue(
  key: ProfileKey,
  data: CandidateData,
): { value: string | null; sourceRef: string | null } {
  const p = data.profile;
  const name = splitName(p.fullName);
  const current = data.experiences.find((e) => e.isCurrent) ?? null;
  const edu = data.education.length === 1 ? data.education[0]! : null;
  const ref = `profile:${p.id}`;
  switch (key) {
    case "firstName":
      return { value: name.first, sourceRef: ref };
    case "lastName":
      return { value: name.last, sourceRef: ref };
    case "fullName":
    case "preferredName":
      return { value: p.fullName, sourceRef: ref };
    case "email":
      return { value: p.email, sourceRef: ref };
    case "phone":
      return { value: p.phone, sourceRef: ref };
    case "city":
      return { value: p.city, sourceRef: ref };
    case "location":
      return { value: [p.city, p.countryName].filter(Boolean).join(", ") || null, sourceRef: ref };
    case "country":
      return { value: p.countryName, sourceRef: ref };
    case "linkedin":
      return { value: p.linkedinUrl, sourceRef: ref };
    case "github":
      return { value: p.githubUrl, sourceRef: ref };
    case "portfolio":
      return { value: p.portfolioUrl ?? p.websiteUrl, sourceRef: ref };
    case "website":
      return { value: p.websiteUrl ?? p.portfolioUrl, sourceRef: ref };
    case "currentCompany":
      return { value: current?.organization ?? null, sourceRef: current?.ref ?? null };
    case "currentTitle":
      return { value: current?.title ?? null, sourceRef: current?.ref ?? null };
    case "school":
      return { value: edu?.institution ?? null, sourceRef: edu?.ref ?? null };
    case "degree":
      return { value: edu?.degree ?? null, sourceRef: edu?.ref ?? null };
    case "fieldOfStudy":
      return { value: edu?.fieldOfStudy ?? null, sourceRef: edu?.ref ?? null };
  }
}

/** Deterministic label/name → profile key (null when not recognised). */
export function recognizeProfileKey(
  field: FieldInput,
): { key: ProfileKey; confidence: MappingConfidence } | null {
  const l = norm(field.label);
  const id = field.externalFieldId.toLowerCase();
  const exact = (re: RegExp) => re.test(l) || re.test(id.replace(/[_-]/g, " "));
  if (exact(/^(first name|given name|firstname|first_name|fname)$/))
    return { key: "firstName", confidence: "EXACT" };
  if (exact(/^(last name|surname|family name|lastname|last_name|lname)$/))
    return { key: "lastName", confidence: "EXACT" };
  if (exact(/^(full name|name|your name|legal name)$/))
    return { key: "fullName", confidence: "EXACT" };
  if (/^preferred (first )?name$/.test(l)) return { key: "preferredName", confidence: "HIGH" };
  if (field.fieldType === "EMAIL" || exact(/^(e-?mail|email address|your email)$/))
    return { key: "email", confidence: "EXACT" };
  if (
    field.fieldType === "PHONE" ||
    exact(/^(phone|phone number|mobile|mobile number|telephone|contact number)$/)
  )
    return { key: "phone", confidence: "EXACT" };
  if (/linkedin/.test(l) || /linkedin/.test(id)) return { key: "linkedin", confidence: "EXACT" };
  if (/github/.test(l) || /github/.test(id)) return { key: "github", confidence: "EXACT" };
  if (/^portfolio( (url|link|website))?$/.test(l)) return { key: "portfolio", confidence: "HIGH" };
  if (/^(personal )?(website|site|web site|blog)( url)?$|^other website$/.test(l))
    return { key: "website", confidence: "MEDIUM" };
  if (/^(current )?(city|town)$/.test(l)) return { key: "city", confidence: "HIGH" };
  if (/^(current )?(location|where are you (currently )?(based|located))/.test(l))
    return { key: "location", confidence: "HIGH" };
  if (/^(country|country of residence)$/.test(l)) return { key: "country", confidence: "HIGH" };
  if (/^current (company|employer|organization|organisation)$/.test(l))
    return { key: "currentCompany", confidence: "HIGH" };
  if (/^current (job )?(title|role|position)$/.test(l))
    return { key: "currentTitle", confidence: "HIGH" };
  if (/^(school|university|college|institution)( name)?$/.test(l))
    return { key: "school", confidence: "MEDIUM" };
  if (/^(degree|highest degree|qualification)$/.test(l))
    return { key: "degree", confidence: "MEDIUM" };
  if (/^(discipline|field of study|major|specialization|specialisation)$/.test(l))
    return { key: "fieldOfStudy", confidence: "MEDIUM" };
  return null;
}

const decision = (
  d: Omit<MappingDecision, "needsQuestion"> & { needsQuestion?: boolean },
): MappingDecision => ({ needsQuestion: false, ...d });
const userInput = (
  classification: FieldClassification,
  explanation: string,
  blocked = false,
): MappingDecision =>
  decision({
    mappingType: "USER_INPUT",
    sourceRef: null,
    value: null,
    confidence: "UNKNOWN",
    policy: blocked ? "BLOCK" : "REQUIRE_USER_INPUT",
    status: blocked ? "BLOCKED" : "NEEDS_USER_INPUT",
    explanation,
    classification,
  });

/** Picks the option matching a value exactly (case-insensitive); never a "closest" guess. */
export function matchOption(options: string[], value: string): string | null {
  if (!options.length) return value;
  return options.find((o) => o.toLowerCase() === value.toLowerCase()) ?? null;
}

function yearsFromExperience(data: CandidateData): number | null {
  const months = new Set<string>();
  const now = new Date();
  for (const e of data.experiences) {
    if (!e.startDate) return null;
    const [sy, sm] = e.startDate.split("-").map(Number);
    const end = e.isCurrent ? `${now.getFullYear()}-${now.getMonth() + 1}` : e.endDate;
    if (!end || !sy) return null;
    const [ey, em] = end.split("-").map(Number);
    for (let y = sy, m = sm || 1; y < ey! || (y === ey && m <= (em || 12)); m++) {
      if (m > 12) {
        m = 1;
        y++;
        if (y > ey!) break;
      }
      months.add(`${y}-${m}`);
    }
  }
  return months.size ? Math.floor((months.size / 12) * 10) / 10 : null;
}

export function mapField(field: FieldInput, data: CandidateData): MappingDecision {
  const l = norm(field.label);

  // 1. Files — exact approved exports only.
  if (field.fieldType === "FILE") {
    if (/resume|cv|curriculum/.test(l) || /resume|cv/.test(field.externalFieldId.toLowerCase())) {
      const f = data.files.RESUME;
      return f
        ? decision({
            mappingType: "RESUME",
            sourceRef: `resume_export:${f.exportId}`,
            value: { exportId: f.exportId, fileName: f.fileName },
            confidence: "EXACT",
            policy: "AUTO_FILL",
            status: "MAPPED",
            explanation: `Approved resume from the package (${f.fileName}).`,
            classification: "FILE",
          })
        : userInput("FILE", "No approved resume file is available for this package.", true);
    }
    if (/cover/.test(l)) {
      const f = data.files.COVER_LETTER;
      if (f)
        return decision({
          mappingType: "COVER_LETTER",
          sourceRef: `communication_export:${f.exportId}`,
          value: { exportId: f.exportId, fileName: f.fileName },
          confidence: "EXACT",
          policy: "AUTO_FILL",
          status: "MAPPED",
          explanation: `Approved cover letter from the package (${f.fileName}).`,
          classification: "FILE",
        });
      return field.required
        ? userInput(
            "FILE",
            "A cover letter is required but the package has none — add an approved cover letter to the package.",
            true,
          )
        : decision({
            mappingType: "COVER_LETTER",
            sourceRef: null,
            value: null,
            confidence: "EXACT",
            policy: "AUTO_FILL",
            status: "MAPPED",
            explanation: "Optional — the package has no cover letter, so none is uploaded.",
            classification: "FILE",
          });
    }
    return field.required
      ? userInput(
          "FILE",
          "An unknown file upload is required — only you can decide what to attach.",
        )
      : decision({
          mappingType: "UNKNOWN",
          sourceRef: null,
          value: null,
          confidence: "UNKNOWN",
          policy: "REQUIRE_REVIEW",
          status: "NEEDS_REVIEW",
          explanation: "Optional upload left empty.",
          classification: "FILE",
        });
  }

  // 2. Voluntary self-identification and consent — never answered for the candidate.
  if (field.classificationHint === "DEMOGRAPHIC" || DEMOGRAPHIC.test(l))
    return userInput(
      "DEMOGRAPHIC",
      "Voluntary self-identification — only you can answer (choose “decline to answer” where offered). Never used in any generated answer.",
    );
  if (field.classificationHint === "CONSENT" || (field.fieldType === "CHECKBOX" && CONSENT.test(l)))
    return userInput(
      "CONSENT",
      "A legal acknowledgement or consent — this needs your explicit confirmation.",
    );

  // 3. Legal questions — explicit data only.
  if (WORK_AUTH.test(l)) {
    const matches = data.authorizations.filter((a) => l.includes(a.countryName.toLowerCase()));
    const a = matches.length === 1 ? matches[0]! : null;
    if (a && (a.status === "AUTHORIZED" || a.status === "NOT_AUTHORIZED")) {
      const answer = a.status === "AUTHORIZED" ? "Yes" : "No";
      const opt = matchOption(field.options, answer);
      if (opt)
        return decision({
          mappingType: "CANDIDATE_FACT",
          sourceRef: a.ref,
          value: opt,
          confidence: "HIGH",
          policy: "REQUIRE_REVIEW",
          status: "MAPPED",
          explanation: `From your work authorization for ${a.countryName} (${a.status.toLowerCase().replace(/_/g, " ")}). Please confirm.`,
          classification: "LEGAL",
        });
    }
    return userInput(
      "LEGAL",
      "Work authorization isn't recorded in your profile for this country — needs your answer. It is never guessed.",
    );
  }
  if (SPONSOR.test(l)) {
    const s = data.preferences?.needsSponsorship?.toUpperCase();
    const answer =
      s === "YES" || s === "REQUIRED" || s === "TRUE"
        ? "Yes"
        : s === "NO" || s === "NOT_REQUIRED" || s === "FALSE"
          ? "No"
          : null;
    const opt = answer ? matchOption(field.options, answer) : null;
    return opt
      ? decision({
          mappingType: "CANDIDATE_PROFILE",
          sourceRef: `preferences:${data.profile.id}`,
          value: opt,
          confidence: "HIGH",
          policy: "REQUIRE_REVIEW",
          status: "MAPPED",
          explanation: "From your sponsorship preference. Please confirm.",
          classification: "LEGAL",
        })
      : userInput(
          "LEGAL",
          "Sponsorship needs isn't recorded in your preferences — needs your answer.",
        );
  }

  // 4. Preferences — explicit only.
  if (SALARY.test(l)) {
    const p = data.preferences;
    if (p?.salaryMin && p.salaryCurrency) {
      const text =
        field.fieldType === "NUMBER"
          ? String(p.salaryMin)
          : `${p.salaryCurrency} ${p.salaryMin.toLocaleString("en-US")}${p.salaryMax ? `–${p.salaryMax.toLocaleString("en-US")}` : ""}${p.salaryPeriod ? ` per ${p.salaryPeriod.toLowerCase()}` : ""}`;
      return decision({
        mappingType: "CANDIDATE_PROFILE",
        sourceRef: `preferences:${data.profile.id}`,
        value: text,
        confidence: "HIGH",
        policy: "REQUIRE_REVIEW",
        status: "MAPPED",
        explanation: "From your salary preference (no currency conversion). Please confirm.",
        classification: "PREFERENCE",
      });
    }
    return userInput(
      "PREFERENCE",
      "No salary expectation is configured — needs your answer. A number is never invented.",
    );
  }
  if (RELOCATE.test(l)) {
    const r = data.preferences?.relocation?.toUpperCase();
    const answer =
      r === "YES" || r === "OPEN" || r === "WILLING"
        ? "Yes"
        : r === "NO" || r === "NOT_WILLING"
          ? "No"
          : null;
    const opt = answer ? matchOption(field.options, answer) : null;
    return opt
      ? decision({
          mappingType: "CANDIDATE_PROFILE",
          sourceRef: `preferences:${data.profile.id}`,
          value: opt,
          confidence: "HIGH",
          policy: "REQUIRE_REVIEW",
          status: "MAPPED",
          explanation: "From your relocation preference. Please confirm.",
          classification: "PREFERENCE",
        })
      : userInput(
          "PREFERENCE",
          "Relocation isn't recorded in your preferences — needs your answer.",
        );
  }
  if (START.test(l)) {
    const p = data.profile;
    const value =
      field.fieldType === "DATE"
        ? p.availableFrom
        : p.availableFrom
          ? `Available from ${p.availableFrom}`
          : p.noticePeriodWeeks != null
            ? `${p.noticePeriodWeeks} weeks' notice`
            : null;
    return value
      ? decision({
          mappingType: "CANDIDATE_PROFILE",
          sourceRef: `profile:${p.id}`,
          value,
          confidence: "HIGH",
          policy: "REQUIRE_REVIEW",
          status: "MAPPED",
          explanation: "From your availability in your profile. Please confirm.",
          classification: "PREFERENCE",
        })
      : userInput(
          "PREFERENCE",
          "Availability / notice period isn't in your profile — needs your answer.",
        );
  }
  if (YEARS.test(l) && !QUESTION_LIKE.test(l.replace(/\?\s*$/, ""))) {
    if (data.profile.yearsOfExperience != null)
      return decision({
        mappingType: "CANDIDATE_PROFILE",
        sourceRef: `profile:${data.profile.id}`,
        value: String(data.profile.yearsOfExperience),
        confidence: "HIGH",
        policy: "REQUIRE_REVIEW",
        status: "MAPPED",
        explanation: "Years of experience from your profile. Please confirm.",
        classification: "FACTUAL",
      });
    const computed = yearsFromExperience(data);
    return computed != null
      ? decision({
          mappingType: "CANDIDATE_FACT",
          sourceRef: data.experiences[0]?.ref ?? null,
          value: String(computed),
          confidence: "MEDIUM",
          policy: "REQUIRE_REVIEW",
          status: "NEEDS_REVIEW",
          explanation: `Computed from the dates of your experience entries (${computed} years). Please confirm — the form may mean relevant experience only.`,
          classification: "FACTUAL",
        })
      : userInput(
          "FACTUAL",
          "Years of experience can't be computed reliably from your facts — needs your answer.",
        );
  }
  if (SOURCE_Q.test(l))
    return userInput("OTHER", "“How did you hear about us” — only you know; not guessed.");

  // 5. Skill questions (yes/no, ratings) — evidence only.
  if (
    SKILL_Q.test(l) &&
    (field.fieldType === "YES_NO" || field.fieldType === "SELECT" || field.fieldType === "RADIO")
  ) {
    const asked = findSkills(field.label);
    const have = new Set(data.skills.map((s) => s.name.toLowerCase()));
    const known = asked.filter(
      (s) =>
        have.has((skillByKey(s.key)?.name ?? s.matched).toLowerCase()) ||
        data.skills.some((c) => findSkills(c.name).some((x) => x.key === s.key)),
    );
    if (RATING.test(l))
      return userInput(
        "TECHNICAL",
        known.length
          ? `${skillByKey(known[0]!.key)?.name ?? known[0]!.matched} is in your facts, but your proficiency level isn't — choose it yourself.`
          : "This skill isn't in your facts — a proficiency level is never invented.",
      );
    if (asked.length && known.length === asked.length) {
      const opt = matchOption(field.options, "Yes");
      const ref =
        data.skills.find((c) => findSkills(c.name).some((x) => x.key === known[0]!.key))?.ref ??
        null;
      if (opt)
        return decision({
          mappingType: "CANDIDATE_FACT",
          sourceRef: ref,
          value: opt,
          confidence: "HIGH",
          policy: "REQUIRE_REVIEW",
          status: "MAPPED",
          explanation: `“Yes” — ${known.map((k) => skillByKey(k.key)?.name ?? k.matched).join(", ")} is in your facts. Please confirm.`,
          classification: "TECHNICAL",
        });
    }
    return userInput(
      "TECHNICAL",
      asked.length
        ? "Not in your facts — needs your answer (an automatic “No” or “Yes” is never given)."
        : "Needs your answer.",
    );
  }

  // 6. Profile fields.
  const recognized = recognizeProfileKey(field);
  if (recognized) {
    const { value, sourceRef } = profileValue(recognized.key, data);
    if (!value)
      return field.required
        ? userInput(
            "FACTUAL",
            `Your profile has no ${recognized.key.replace(/([A-Z])/g, " $1").toLowerCase()} — needs your answer.`,
          )
        : decision({
            mappingType: "CANDIDATE_PROFILE",
            sourceRef,
            value: null,
            confidence: recognized.confidence,
            policy: "REQUIRE_REVIEW",
            status: "NEEDS_REVIEW",
            explanation: "Optional — not in your profile, left empty.",
            classification: "FACTUAL",
          });
    const opt = field.options.length ? matchOption(field.options, value) : value;
    if (!opt)
      return userInput(
        "FACTUAL",
        `Your ${recognized.key} (“${value}”) doesn't match any offered option — choose one yourself.`,
      );
    const auto = recognized.confidence === "EXACT" || recognized.confidence === "HIGH";
    return decision({
      mappingType: sourceRef?.startsWith("profile:") ? "CANDIDATE_PROFILE" : "CANDIDATE_FACT",
      sourceRef,
      value: opt,
      confidence: recognized.confidence,
      policy: auto ? "AUTO_FILL" : "REQUIRE_REVIEW",
      status: auto ? "MAPPED" : "NEEDS_REVIEW",
      explanation: auto
        ? `From your ${sourceRef?.startsWith("profile:") ? "candidate profile" : "facts"}.`
        : `Probably your ${recognized.key.replace(/([A-Z])/g, " $1").toLowerCase()} — please confirm.`,
      classification: "FACTUAL",
    });
  }

  // 7. Cover letter as text.
  if ((field.fieldType === "TEXTAREA" || field.fieldType === "TEXT") && /^cover letter/.test(l)) {
    return data.coverLetterText
      ? decision({
          mappingType: "COVER_LETTER",
          sourceRef: null,
          value: data.coverLetterText,
          confidence: "EXACT",
          policy: "REQUIRE_REVIEW",
          status: "MAPPED",
          explanation: "Text of the approved cover letter from the package.",
          classification: "OTHER",
        })
      : field.required
        ? userInput("OTHER", "Cover letter text is required but the package has no cover letter.")
        : decision({
            mappingType: "COVER_LETTER",
            sourceRef: null,
            value: null,
            confidence: "EXACT",
            policy: "AUTO_FILL",
            status: "MAPPED",
            explanation: "Optional — no cover letter in the package.",
            classification: "OTHER",
          });
  }

  // 8. Custom questions → question engine.
  if (
    (field.fieldType === "TEXTAREA" || (field.fieldType === "TEXT" && QUESTION_LIKE.test(l))) &&
    field.label.length > 8
  )
    return decision({
      mappingType: "GENERATED_ANSWER",
      sourceRef: null,
      value: null,
      confidence: "MEDIUM",
      policy: "REQUIRE_REVIEW",
      status: "NEEDS_REVIEW",
      explanation:
        "Custom question — answered by the question engine from your facts and checked before use.",
      classification: "OTHER",
      needsQuestion: true,
    });

  // 9. Unknown — surfaced, never guessed.
  return decision({
    mappingType: "UNKNOWN",
    sourceRef: null,
    value: null,
    confidence: "UNKNOWN",
    policy: field.required ? "REQUIRE_USER_INPUT" : "REQUIRE_REVIEW",
    status: field.required ? "NEEDS_USER_INPUT" : "NEEDS_REVIEW",
    explanation: field.required
      ? "Not recognised — needs your answer."
      : "Not recognised — optional; left empty unless you fill it.",
    classification: "OTHER",
  });
}
