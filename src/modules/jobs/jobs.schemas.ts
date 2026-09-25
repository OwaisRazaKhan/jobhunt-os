import { z } from "zod";
import { checkPublicHttpUrl } from "@/lib/safe-url";

/**
 * Manual job input contract (client-safe). Invalid input is rejected with a
 * clear message — never silently corrected (URLs are not auto-prefixed,
 * salaries are not swapped, unknown values stay UNKNOWN).
 */

export const EMPLOYMENT_TYPES = [
  "FULL_TIME",
  "PART_TIME",
  "CONTRACT",
  "TEMPORARY",
  "INTERNSHIP",
  "APPRENTICESHIP",
  "FREELANCE",
  "UNKNOWN",
] as const;
export const REMOTE_STATUSES = ["REMOTE", "HYBRID", "ONSITE", "UNKNOWN"] as const;
export const RELOCATION_OPTIONS = ["YES", "NO", "UNKNOWN"] as const;
export const SALARY_PERIODS = ["YEAR", "MONTH", "WEEK", "HOUR", "UNKNOWN"] as const;

// Control characters except tab/newline are stripped from free text (they are never meaningful).
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const emptyToNull = (v: unknown) => {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") {
    const t = v.replace(CONTROL, "").trim();
    return t === "" ? null : t;
  }
  return v;
};

const reqText = (label: string, max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.replace(CONTROL, "").trim() : v),
    z
      .string({ error: `${label} is required` })
      .min(1, `${label} is required`)
      .max(max, `${label} must be at most ${max.toLocaleString("en")} characters`),
  );

const optText = (label: string, max: number) =>
  z.preprocess(
    emptyToNull,
    z
      .string()
      .max(max, `${label} must be at most ${max.toLocaleString("en")} characters`)
      .nullable(),
  );

const publicUrl = (label: string) =>
  z.string().superRefine((value, ctx) => {
    const check = checkPublicHttpUrl(value);
    if (!check.ok) ctx.addIssue({ code: "custom", message: `${label}: ${check.reason}` });
  });

const reqUrl = (label: string) =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z
      .string({ error: `${label} is required` })
      .min(1, `${label} is required`)
      .pipe(publicUrl(label)),
  );

const optUrl = (label: string) => z.preprocess(emptyToNull, publicUrl(label).nullable());

const optMoney = (label: string) =>
  z.preprocess(
    (v) => {
      const t = emptyToNull(v);
      return typeof t === "string"
        ? /^\d+$/.test(t.replace(/[,\s]/g, ""))
          ? Number(t.replace(/[,\s]/g, ""))
          : t
        : t;
    },
    z
      .number({ error: `${label} must be a whole number (e.g. 55000)` })
      .int(`${label} must be a whole number`)
      .min(0, `${label} cannot be negative`)
      .max(1_000_000_000, `${label} is too large`)
      .nullable(),
  );

const withDefault = <T extends readonly [string, ...string[]]>(
  values: T,
  fallback: T[number],
  label: string,
) =>
  z.preprocess(
    (v) => emptyToNull(v) ?? fallback,
    z.enum(values, { error: `Choose a valid ${label}` }),
  );

const CURRENCIES = new Set(
  typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("currency") : [],
);

export const manualJobInput = z
  .object({
    title: reqText("Job title", 300),
    company: reqText("Company", 200),
    jobUrl: reqUrl("Job URL"),
    applicationUrl: optUrl("Application URL"),
    locationRaw: reqText("Location", 200),
    countryCode: z.preprocess(
      (v) => (typeof v === "string" ? v.trim() : v),
      z.string({ error: "Country is required" }).regex(/^[A-Z]{2}$/, "Select a country"),
    ),
    description: reqText("Description", 50_000),
    salaryMin: optMoney("Salary minimum"),
    salaryMax: optMoney("Salary maximum"),
    salaryCurrency: z.preprocess(
      emptyToNull,
      z
        .string()
        .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code in capitals, e.g. EUR")
        .refine(
          (c) => !/^[A-Z]{3}$/.test(c) || CURRENCIES.size === 0 || CURRENCIES.has(c),
          "Unknown currency code",
        )
        .nullable(),
    ),
    salaryPeriod: z.preprocess(
      emptyToNull,
      z.enum(SALARY_PERIODS, { error: "Choose a valid salary period" }).nullable(),
    ),
    employmentType: withDefault(EMPLOYMENT_TYPES, "UNKNOWN", "employment type"),
    remoteStatus: withDefault(REMOTE_STATUSES, "UNKNOWN", "work mode"),
    relocationAvailable: withDefault(RELOCATION_OPTIONS, "UNKNOWN", "relocation option"),
    visaTextRaw: optText("Visa text", 2000),
    postedAt: z.preprocess(
      emptyToNull,
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date")
        .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), "Use a valid date")
        .refine(
          (d) => Date.parse(`${d}T00:00:00Z`) <= Date.now() + 86_400_000,
          "Posted date cannot be in the future",
        )
        .nullable(),
    ),
    notes: optText("Notes", 5000),
  })
  .superRefine((v, ctx) => {
    if (v.salaryMin != null && v.salaryMax != null && v.salaryMin > v.salaryMax) {
      ctx.addIssue({
        code: "custom",
        path: ["salaryMin"],
        message: "Salary minimum cannot exceed the maximum",
      });
    }
    const hasAmount = v.salaryMin != null || v.salaryMax != null;
    if (hasAmount && !v.salaryCurrency) {
      ctx.addIssue({
        code: "custom",
        path: ["salaryCurrency"],
        message: "Enter the currency for this salary",
      });
    }
    if (!hasAmount && (v.salaryCurrency || (v.salaryPeriod && v.salaryPeriod !== "UNKNOWN"))) {
      ctx.addIssue({
        code: "custom",
        path: ["salaryMin"],
        message: "Enter a salary amount, or clear the currency/period",
      });
    }
  });

export type ManualJobInput = z.output<typeof manualJobInput>;
