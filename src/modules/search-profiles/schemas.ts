import { z } from "zod";
import {
  EXPERIENCE_LEVELS,
  JOB_TYPES,
  LOCATION_KINDS,
  PROFILE_SALARY_PERIODS,
  PROFILE_SOURCE_KEYS,
  VISA_PREFERENCES,
  WORK_MODES,
} from "./types";

const emptyToNull = (v: unknown) => (v === "" || v === undefined ? null : v);
const list = <T extends readonly [string, ...string[]]>(values: T, max = values.length) =>
  z
    .array(z.enum(values))
    .max(max)
    .default([])
    .transform((a) => [...new Set(a)]);
const optMoney = z.preprocess(
  emptyToNull,
  z.coerce.number().int("Whole numbers only").min(0).max(1_000_000_000).nullable(),
);

export const SCHEDULE_OPTIONS = [
  { value: "", label: "Manual only" },
  { value: "24", label: "Every day" },
  { value: "72", label: "Every 3 days" },
  { value: "168", label: "Every week" },
] as const;

export const searchProfileInput = z
  .object({
    name: z.string().trim().min(1, "Enter a name").max(100),
    countryCodes: z
      .array(z.string().regex(/^[A-Z]{2}$/))
      .max(60)
      .default([])
      .transform((a) => [...new Set(a)]),
    locationIds: z
      .array(z.uuid())
      .max(100)
      .default([])
      .transform((a) => [...new Set(a)]),
    categoryIds: z
      .array(z.uuid())
      .max(30)
      .default([])
      .transform((a) => [...new Set(a)]),
    searchTerms: z.preprocess(
      (v) => (typeof v === "string" ? v.split(/\r?\n|,/) : (v ?? [])),
      z
        .array(z.string())
        .transform((a) => [...new Set(a.map((t) => t.trim()).filter(Boolean))])
        .pipe(
          z
            .array(z.string().max(80, "Each term must be 80 characters or fewer"))
            .max(50, "At most 50 terms"),
        ),
    ),
    workModes: list(WORK_MODES),
    employmentTypes: list(JOB_TYPES),
    experienceLevels: list(EXPERIENCE_LEVELS),
    salaryMin: optMoney,
    salaryMax: optMoney,
    salaryCurrency: z.preprocess(
      (v) => (typeof v === "string" ? v.trim().toUpperCase() || null : (v ?? null)),
      z
        .string()
        .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code, e.g. INR, EUR, AED")
        .nullable(),
    ),
    salaryPeriod: z.preprocess(emptyToNull, z.enum(PROFILE_SALARY_PERIODS).nullable()),
    visaPreference: z.preprocess((v) => emptyToNull(v) ?? "UNKNOWN", z.enum(VISA_PREFERENCES)),
    sourceKeys: list(PROFILE_SOURCE_KEYS),
    scheduleIntervalHours: z.preprocess(
      emptyToNull,
      z.coerce
        .number()
        .int()
        .refine((n) => [24, 72, 168].includes(n), "Choose a schedule")
        .nullable(),
    ),
  })
  .superRefine((v, ctx) => {
    if (v.salaryMin != null && v.salaryMax != null && v.salaryMin > v.salaryMax) {
      ctx.addIssue({
        code: "custom",
        path: ["salaryMax"],
        message: "Maximum must be at least the minimum",
      });
    }
    if ((v.salaryMin != null || v.salaryMax != null) && !v.salaryCurrency) {
      ctx.addIssue({
        code: "custom",
        path: ["salaryCurrency"],
        message: "A salary needs a currency — amounts in different currencies are never compared",
      });
    }
  });
export type SearchProfileInput = z.infer<typeof searchProfileInput>;

export const locationInput = z.object({
  countryCode: z.string().regex(/^[A-Z]{2}$/, "Select a country"),
  name: z.string().trim().min(1, "Enter a name").max(100),
  kind: z.preprocess((v) => emptyToNull(v) ?? "CITY", z.enum(LOCATION_KINDS)),
  aliases: z.preprocess(
    (v) => (typeof v === "string" ? v.split(/\r?\n|,/) : (v ?? [])),
    z
      .array(z.string())
      .transform((a) => [...new Set(a.map((t) => t.trim().toLowerCase()).filter(Boolean))])
      .pipe(z.array(z.string().max(100)).max(20)),
  ),
});

export const categoryInput = z.object({
  name: z.string().trim().min(1, "Enter a name").max(80),
  description: z.preprocess(emptyToNull, z.string().trim().max(500).nullable()),
});

export const termInput = z.object({
  categoryId: z.uuid(),
  term: z.string().trim().min(1, "Enter a term").max(80),
});
