import { z } from "zod";
import {
  AVAILABILITY_OPTIONS,
  COMPANY_SIZES,
  COMPANY_TYPES,
  DOCUMENT_TYPES,
  EMPLOYMENT_TYPES,
  LANGUAGE_LEVELS,
  PORTFOLIO_TYPES,
  PROJECT_TYPES,
  RELOCATION_OPTIONS,
  SALARY_PERIODS,
  SENIORITY_LEVELS,
  SKILL_CATEGORIES,
  SPONSORSHIP_NEEDS,
  WORK_AUTHORIZATION_STATUSES,
  WORK_MODES,
} from "./options";

/*
 * Input contracts for candidate data. Client-safe. Every value that reaches a
 * service has passed one of these schemas (UI forms, fact approval, AI output
 * mapping all converge here).
 */

const emptyToNull = (value: unknown) => {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  return value;
};

const reqText = (max: number) =>
  z.string({ error: "Required" }).trim().min(1, "Required").max(max, `Max ${max} characters`);

const optText = (max: number) =>
  z.preprocess(emptyToNull, z.string().max(max, `Max ${max} characters`).nullable());

const optUrl = z.preprocess(
  (value) => {
    const v = emptyToNull(value);
    // Accept "example.com" by assuming https — the user typed it, we only normalise.
    return typeof v === "string" && !/^[a-z]+:\/\//i.test(v) ? `https://${v}` : v;
  },
  z
    .url({ protocol: /^https?$/, error: "Enter a valid http(s) URL" })
    .max(500)
    .nullable(),
);

const PARTIAL_DATE = /^\d{4}(-(0[1-9]|1[0-2]))?$/;
export const partialDate = z.preprocess(
  emptyToNull,
  z.string().regex(PARTIAL_DATE, "Use YYYY or YYYY-MM").nullable(),
);

const isoDate = z.preprocess(
  emptyToNull,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .nullable(),
);

const optEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(emptyToNull, z.enum(values).nullable());

const list = (maxItems: number, maxLength: number) =>
  z.preprocess(
    (value) => {
      const raw = Array.isArray(value)
        ? value
        : typeof value === "string"
          ? value.split(/\r?\n/)
          : value === undefined || value === null
            ? []
            : value;
      if (!Array.isArray(raw)) return raw;
      const seen = new Set<string>();
      const out: string[] = [];
      for (const item of raw) {
        if (typeof item !== "string") return raw;
        const trimmed = item.replace(/^[\s•·\-–*]+/, "").trim();
        const key = trimmed.toLowerCase();
        if (trimmed && !seen.has(key)) {
          seen.add(key);
          out.push(trimmed);
        }
      }
      return out;
    },
    z.array(z.string().max(maxLength, `Each item max ${maxLength} characters`)).max(maxItems),
  );

const enumList = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(
    (value) =>
      value === undefined || value === null || value === ""
        ? []
        : Array.isArray(value)
          ? value
          : [value],
    z.array(z.enum(values)).transform((items) => Array.from(new Set(items))),
  );

const checkbox = z.preprocess(
  (value) => value === true || value === "on" || value === "true",
  z.boolean(),
);

const optNumber = (min: number, max: number, integer = false) =>
  z.preprocess(
    (value) => {
      const v = emptyToNull(value);
      return typeof v === "string" ? Number(v) : v;
    },
    (integer ? z.number().int("Whole number") : z.number())
      .min(min, `Min ${min}`)
      .max(max, `Max ${max}`)
      .nullable(),
  );

const optUuid = z.preprocess(emptyToNull, z.uuid().nullable());

const CURRENCIES = new Set(
  typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("currency") : [],
);
const currency = z.preprocess(
  (value) => {
    const v = emptyToNull(value);
    return typeof v === "string" ? v.toUpperCase() : v;
  },
  z
    .string()
    .length(3)
    .refine((code) => CURRENCIES.size === 0 || CURRENCIES.has(code), "Unknown currency code")
    .nullable(),
);

const countryCode = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toUpperCase() : value),
  z.string().regex(/^[A-Z]{2}$/, "Select a country"),
);

/** Shared date-order rule for records with start/end/current. */
function dateOrder<
  T extends { startDate?: string | null; endDate?: string | null; isCurrent?: boolean },
>(value: T, ctx: z.RefinementCtx) {
  if (value.isCurrent && value.endDate) {
    ctx.addIssue({
      code: "custom",
      path: ["endDate"],
      message: "Leave empty when this is current",
    });
  }
  if (value.startDate && value.endDate && value.endDate < value.startDate) {
    ctx.addIssue({ code: "custom", path: ["endDate"], message: "End date is before start date" });
  }
}

// --- Fact sections -----------------------------------------------------------

export const educationInput = z
  .object({
    institution: reqText(200),
    degree: optText(200),
    fieldOfStudy: optText(200),
    location: optText(200),
    startDate: partialDate,
    endDate: partialDate,
    isCurrent: checkbox,
    description: optText(4000),
  })
  .superRefine(dateOrder);

export const experienceInput = z
  .object({
    organization: reqText(200),
    title: reqText(200),
    employmentType: optEnum(EMPLOYMENT_TYPES),
    location: optText(200),
    startDate: partialDate,
    endDate: partialDate,
    isCurrent: checkbox,
    description: optText(5000),
    responsibilities: list(30, 500),
    skillsUsed: list(50, 80),
  })
  .superRefine(dateOrder);

export const achievementInput = z
  .object({
    statement: reqText(1000),
    /** Only a figure the user actually has. The system never generates metrics. */
    metric: optText(100),
    experienceId: optUuid,
    projectId: optUuid,
  })
  .refine((v) => !(v.experienceId && v.projectId), {
    message: "Link to an experience or a project, not both",
    path: ["projectId"],
  });

export const projectInput = z
  .object({
    name: reqText(200),
    description: optText(5000),
    role: optText(200),
    projectType: optEnum(PROJECT_TYPES),
    technologies: list(50, 80),
    skills: list(50, 80),
    responsibilities: list(30, 500),
    outcomes: list(30, 500),
    portfolioUrl: optUrl,
    repositoryUrl: optUrl,
    liveUrl: optUrl,
    imageUrls: list(10, 500).pipe(
      z.array(z.url({ protocol: /^https?$/, error: "Image links must be http(s) URLs" })),
    ),
    startDate: partialDate,
    endDate: partialDate,
    isCurrent: checkbox,
    teamSize: optNumber(1, 10000, true),
  })
  .superRefine(dateOrder);

export const skillInput = z.object({
  name: reqText(80),
  category: z.preprocess((v) => emptyToNull(v) ?? "OTHER", z.enum(SKILL_CATEGORIES)),
  proficiency: optNumber(1, 5, true),
  yearsUsed: optNumber(0, 60),
});

export const certificationInput = z
  .object({
    name: reqText(200),
    issuer: optText(200),
    issueDate: partialDate,
    expiryDate: partialDate,
    credentialId: optText(200),
    credentialUrl: optUrl,
  })
  .refine((v) => !(v.issueDate && v.expiryDate && v.expiryDate < v.issueDate), {
    message: "Expiry is before issue date",
    path: ["expiryDate"],
  });

export const portfolioInput = z.object({
  title: reqText(200),
  type: z.preprocess((v) => emptyToNull(v) ?? "OTHER", z.enum(PORTFOLIO_TYPES)),
  url: optUrl,
  description: optText(2000),
  skills: list(30, 80),
  projectId: optUuid,
});

export const languageInput = z.object({
  language: reqText(60),
  proficiency: optEnum(LANGUAGE_LEVELS),
  reading: optEnum(LANGUAGE_LEVELS),
  writing: optEnum(LANGUAGE_LEVELS),
  speaking: optEnum(LANGUAGE_LEVELS),
});

export const authorizationInput = z.object({
  countryCode,
  status: z.enum(WORK_AUTHORIZATION_STATUSES, { error: "Select a status" }),
  permitType: optText(120),
  validUntil: isoDate,
  notes: optText(1000),
});

export const SECTION_SCHEMAS = {
  education: educationInput,
  experience: experienceInput,
  achievement: achievementInput,
  project: projectInput,
  skill: skillInput,
  certification: certificationInput,
  portfolio: portfolioInput,
  language: languageInput,
  authorization: authorizationInput,
} as const;

export type SectionKind = keyof typeof SECTION_SCHEMAS;
export const SECTION_KINDS = Object.keys(SECTION_SCHEMAS) as SectionKind[];
export type SectionInput<K extends SectionKind> = z.output<(typeof SECTION_SCHEMAS)[K]>;

export function isSectionKind(value: unknown): value is SectionKind {
  return typeof value === "string" && value in SECTION_SCHEMAS;
}

// --- Profile ----------------------------------------------------------------

export const profileInput = z.object({
  fullName: optText(120),
  headline: optText(200),
  currentCity: optText(120),
  currentCountryCode: z.preprocess(
    (v) => (typeof emptyToNull(v) === "string" ? String(v).trim().toUpperCase() : null),
    z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable(),
  ),
  phone: z.preprocess(
    emptyToNull,
    z
      .string()
      .max(40)
      .regex(/^\+?[0-9 ()./-]{6,}$/, "Enter a valid phone number")
      .nullable(),
  ),
  professionalEmail: z.preprocess(emptyToNull, z.email("Enter a valid email").max(254).nullable()),
  websiteUrl: optUrl,
  linkedinUrl: optUrl,
  githubUrl: optUrl,
  portfolioUrl: optUrl,
  summary: optText(3000),
  careerGoal: optText(2000),
  availability: optEnum(AVAILABILITY_OPTIONS),
  availableFrom: isoDate,
  noticePeriodWeeks: optNumber(0, 52, true),
  yearsOfExperience: optNumber(0, 60),
});

/** Partial update: only keys present in the submitted form are changed. */
export const profileUpdateInput = profileInput.partial();
export type ProfileUpdate = z.output<typeof profileUpdateInput>;
export type ProfileField = keyof z.output<typeof profileInput>;

// --- Preferences ------------------------------------------------------------

export const preferencesInput = z
  .object({
    targetRoles: list(20, 120),
    targetIndustries: list(20, 120),
    employmentTypes: enumList(EMPLOYMENT_TYPES),
    seniorityLevels: enumList(SENIORITY_LEVELS),
    workModes: enumList(WORK_MODES),
    companySizes: enumList(COMPANY_SIZES),
    companyTypes: enumList(COMPANY_TYPES),
    relocation: optEnum(RELOCATION_OPTIONS),
    needsSponsorship: optEnum(SPONSORSHIP_NEEDS),
    salaryMin: optNumber(0, 100_000_000, true),
    salaryMax: optNumber(0, 100_000_000, true),
    salaryCurrency: currency,
    salaryPeriod: optEnum(SALARY_PERIODS),
  })
  .partial()
  .superRefine((v, ctx) => {
    if (v.salaryMin != null && v.salaryMax != null && v.salaryMax < v.salaryMin) {
      ctx.addIssue({ code: "custom", path: ["salaryMax"], message: "Max is below min" });
    }
    if ((v.salaryMin != null || v.salaryMax != null) && v.salaryCurrency === null) {
      ctx.addIssue({ code: "custom", path: ["salaryCurrency"], message: "Choose a currency" });
    }
  });
export type PreferencesUpdate = z.output<typeof preferencesInput>;

export const targetLocationsInput = z.object({
  locations: z.array(z.object({ countryCode, city: optText(120) })).max(30, "Up to 30 locations"),
});

// --- Documents & onboarding -----------------------------------------------------

export const documentTypeInput = z.enum(DOCUMENT_TYPES);

export const ONBOARDING_STEPS = [
  "basic",
  "education",
  "experience",
  "skills",
  "projects",
  "certifications",
  "portfolio",
  "languages",
  "goals",
  "countries",
  "roles",
  "preferences",
  "authorization",
  "review",
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const onboardingStepInput = z.object({
  step: z.enum(ONBOARDING_STEPS),
  action: z.enum(["complete", "skip", "visit"]),
});
