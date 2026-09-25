import { createHash } from "node:crypto";
import { z } from "zod";
import { checkPublicHttpUrl } from "@/lib/safe-url";
import { normalizeOrganization, normalizeTitle } from "@/lib/text-normalize";

/**
 * Canonical (normalised) job produced by every adapter and validated before
 * anything is written. Unknown values are null / "UNKNOWN" — never guessed.
 */

const url = z
  .string()
  .max(2048)
  .refine((v) => checkPublicHttpUrl(v).ok, "Unsafe or invalid URL");
const optUrl = url.nullable();
const text = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) => z.string().trim().max(max).nullable();

export const canonicalJobSchema = z
  .object({
    sourceKey: z.enum(["ASHBY", "LEVER", "GREENHOUSE"]),
    board: z.string().min(1).max(100),
    externalJobId: text(200),
    title: text(300),
    companyName: text(200),
    description: text(50_000),
    locationRaw: text(200),
    city: optText(120),
    region: optText(120),
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable(),
    employmentType: z.enum([
      "FULL_TIME",
      "PART_TIME",
      "CONTRACT",
      "TEMPORARY",
      "INTERNSHIP",
      "APPRENTICESHIP",
      "FREELANCE",
      "UNKNOWN",
    ]),
    employmentTypeRaw: optText(100),
    remoteStatus: z.enum(["REMOTE", "HYBRID", "ONSITE", "UNKNOWN"]),
    remoteStatusRaw: optText(100),
    salaryMin: z.number().int().min(0).max(1_000_000_000).nullable(),
    salaryMax: z.number().int().min(0).max(1_000_000_000).nullable(),
    salaryCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    salaryPeriod: z.enum(["YEAR", "MONTH", "WEEK", "HOUR"]).nullable(),
    salaryRaw: optText(500),
    postedAt: z.date().nullable(),
    sourceUpdatedAt: z.date().nullable(),
    jobUrl: url,
    applicationUrl: optUrl,
    sourceUrl: optUrl,
    department: optText(200),
    team: optText(200),
    visaTextRaw: optText(2000),
    raw: z.record(z.string(), z.unknown()),
  })
  .refine((j) => j.salaryMin == null || j.salaryMax == null || j.salaryMin <= j.salaryMax, {
    message: "salary min > max",
    path: ["salaryMin"],
  })
  .refine((j) => (j.salaryMin == null && j.salaryMax == null) || j.salaryCurrency !== null, {
    message: "salary without currency",
    path: ["salaryCurrency"],
  });

export type CanonicalJob = z.output<typeof canonicalJobSchema>;
export type CanonicalJobInput = z.input<typeof canonicalJobSchema>;

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Changes whenever user-visible content changes (drives "updated" vs "unchanged"). */
export function canonicalContentHash(job: CanonicalJob): string {
  return sha256(
    JSON.stringify([
      job.title,
      job.companyName,
      job.description,
      job.locationRaw,
      job.countryCode,
      job.employmentType,
      job.remoteStatus,
      job.salaryMin,
      job.salaryMax,
      job.salaryCurrency,
      job.salaryPeriod,
      job.salaryRaw,
      job.jobUrl,
      job.applicationUrl,
      job.visaTextRaw,
      job.postedAt?.toISOString() ?? null,
    ]),
  );
}

export function normalizeLocationKey(
  job: Pick<CanonicalJob, "city" | "countryCode" | "locationRaw" | "remoteStatus">,
): string {
  if (job.city || job.countryCode)
    return `${(job.city ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")}|${job.countryCode ?? ""}`;
  return job.locationRaw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Layer-2 identity: normalised company + title + location. */
export function dedupeFingerprint(
  job: Pick<
    CanonicalJob,
    "companyName" | "title" | "city" | "countryCode" | "locationRaw" | "remoteStatus"
  >,
): string {
  return sha256(
    [
      normalizeOrganization(job.companyName),
      normalizeTitle(job.title),
      normalizeLocationKey(job),
    ].join("|"),
  );
}
