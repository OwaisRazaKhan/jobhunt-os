import { z } from "zod";

/**
 * Job source definitions and configuration contracts (client-safe).
 *
 * Statuses are INTERNAL product states:
 *   PENDING_VERIFICATION  connector exists, but no successful live test of YOUR configured boards yet
 *   READY                 last live test of your boards succeeded (Manual Entry is always READY)
 *   ERROR                 the last live test or sync failed (see last_error)
 * Terms status VERIFIED means we reviewed the provider's official public documentation
 * (recorded below with date + URL). It is never a claim of a legal agreement with the provider.
 */

export const SOURCE_KEYS = ["ASHBY", "LEVER", "GREENHOUSE", "MANUAL"] as const;
export type SourceKey = (typeof SOURCE_KEYS)[number];
export type AtsSourceKey = Exclude<SourceKey, "MANUAL">;

export const SOURCE_STATUSES = ["PENDING_VERIFICATION", "READY", "MANUAL_ONLY", "ERROR"] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

export const TERMS_STATUSES = ["NOT_REVIEWED", "VERIFIED", "RESTRICTED", "NOT_APPLICABLE"] as const;
export type TermsStatus = (typeof TERMS_STATUSES)[number];

export interface AccessVerification {
  /** Date the official documentation was reviewed (YYYY-MM-DD). */
  reviewedOn: string;
  docsUrl: string;
  endpoint: string;
  summary: string;
}

export interface SourceDefinition {
  key: SourceKey;
  name: string;
  sourceType: "ATS_PUBLIC_API" | "MANUAL";
  accessMethod: "PUBLIC_POSTINGS_API" | "USER_ENTERED";
  initialStatus: SourceStatus;
  initialTerms: TermsStatus;
  enabledByDefault: boolean;
  description: string;
  /** Where the identifier comes from, shown in the configuration form. */
  identifierHelp?: string;
  verification?: AccessVerification;
}

export const SOURCE_DEFINITIONS: Record<SourceKey, SourceDefinition> = {
  ASHBY: {
    key: "ASHBY",
    name: "Ashby",
    sourceType: "ATS_PUBLIC_API",
    accessMethod: "PUBLIC_POSTINGS_API",
    initialStatus: "PENDING_VERIFICATION",
    initialTerms: "VERIFIED",
    enabledByDefault: false,
    description: "Public job boards hosted on Ashby.",
    identifierHelp: "Board name from the job board link, e.g. “acme” from jobs.ashbyhq.com/acme",
    verification: {
      reviewedOn: "2026-09-26",
      docsUrl: "https://developers.ashbyhq.com/docs/public-job-posting-api",
      endpoint:
        "GET https://api.ashbyhq.com/posting-api/job-board/{board}?includeCompensation=true",
      summary:
        "Official public Job Posting API; unauthenticated GET of published postings. No rate limits published — conservative self-imposed limits apply.",
    },
  },
  LEVER: {
    key: "LEVER",
    name: "Lever",
    sourceType: "ATS_PUBLIC_API",
    accessMethod: "PUBLIC_POSTINGS_API",
    initialStatus: "PENDING_VERIFICATION",
    initialTerms: "VERIFIED",
    enabledByDefault: false,
    description: "Public job postings hosted on Lever.",
    identifierHelp:
      "Company site name, e.g. “acme” from jobs.lever.co/acme (or jobs.eu.lever.co/acme)",
    verification: {
      reviewedOn: "2026-09-26",
      docsUrl: "https://github.com/lever/postings-api",
      endpoint: "GET https://api.lever.co/v0/postings/{site}?mode=json (EU: api.eu.lever.co)",
      summary:
        "Official Postings API; published postings are public and GET requires no authentication. Only the published-postings GET is used.",
    },
  },
  GREENHOUSE: {
    key: "GREENHOUSE",
    name: "Greenhouse",
    sourceType: "ATS_PUBLIC_API",
    accessMethod: "PUBLIC_POSTINGS_API",
    initialStatus: "PENDING_VERIFICATION",
    initialTerms: "VERIFIED",
    enabledByDefault: false,
    description: "Public job boards hosted on Greenhouse.",
    identifierHelp:
      "Board token, e.g. “acme” from boards.greenhouse.io/acme or job-boards.greenhouse.io/acme",
    verification: {
      reviewedOn: "2026-09-26",
      docsUrl: "https://docs.greenhouse.io/job-board.html",
      endpoint:
        "GET https://boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true&pay_transparency=true",
      summary:
        "Official Job Board API; docs state job board data is public and GET endpoints need no authentication.",
    },
  },
  MANUAL: {
    key: "MANUAL",
    name: "Manual Entry",
    sourceType: "MANUAL",
    accessMethod: "USER_ENTERED",
    initialStatus: "READY",
    initialTerms: "NOT_APPLICABLE",
    enabledByDefault: true,
    description: "Jobs you add yourself. No external access.",
  },
};

export function isSourceKey(value: unknown): value is SourceKey {
  return typeof value === "string" && (SOURCE_KEYS as readonly string[]).includes(value);
}

export function isAtsSourceKey(value: unknown): value is AtsSourceKey {
  return isSourceKey(value) && value !== "MANUAL";
}

// --- Configuration --------------------------------------------------------------

/** One board per line: "acme" or "acme = Acme Inc" (optional company display name). */
const BOARD_ENTRY = /^([A-Za-z0-9][A-Za-z0-9._-]{0,99})(?:\s*=\s*(.{1,120}))?$/;

export interface BoardEntry {
  id: string;
  /** Company display name given by the user, if any. Never guessed. */
  name: string | null;
}

export function parseBoardEntry(value: string): BoardEntry | null {
  const m = value.trim().match(BOARD_ENTRY);
  if (!m) return null;
  const name = m[2]?.trim().replace(/[\u0000-\u001f]/g, "") || null;
  return { id: m[1]!, name };
}

const identifierList = (label: string) =>
  z.preprocess(
    (value) => {
      const raw = Array.isArray(value)
        ? value
        : typeof value === "string"
          ? value.split(/\r?\n/)
          : [];
      const seen = new Set<string>();
      const out: string[] = [];
      for (const item of raw.map((v) => String(v).trim()).filter(Boolean)) {
        const id = parseBoardEntry(item)?.id.toLowerCase() ?? item;
        if (!seen.has(id)) {
          seen.add(id);
          out.push(item);
        }
      }
      return out;
    },
    z
      .array(
        z
          .string()
          .refine(
            (v) => parseBoardEntry(v) !== null,
            `Enter the ${label} only (optionally “${label} = Company name”) — not a full URL`,
          ),
      )
      .max(50, "Up to 50 entries"),
  );

export const RATE_LIMIT_DEFAULTS = {
  requestsPerMinute: 30,
  maxPagesPerSync: 10,
  maxJobsPerSync: 1000,
  timeoutMs: 15000,
} as const;

const intIn = (min: number, max: number, fallback: number) =>
  z.preprocess(
    (v) =>
      v === undefined || v === null || v === "" ? fallback : typeof v === "string" ? Number(v) : v,
    z
      .number({ error: "Enter a number" })
      .int("Whole number")
      .min(min, `Min ${min}`)
      .max(max, `Max ${max}`),
  );

/** Hard bounds every adapter must respect; users can only tighten within them. */
export const rateLimitSchema = z.object({
  requestsPerMinute: intIn(1, 60, RATE_LIMIT_DEFAULTS.requestsPerMinute),
  maxPagesPerSync: intIn(1, 50, RATE_LIMIT_DEFAULTS.maxPagesPerSync),
  maxJobsPerSync: intIn(1, 5000, RATE_LIMIT_DEFAULTS.maxJobsPerSync),
  timeoutMs: intIn(1000, 30000, RATE_LIMIT_DEFAULTS.timeoutMs),
});
export type RateLimitSettings = z.output<typeof rateLimitSchema>;

export const CONFIG_SCHEMAS = {
  ASHBY: z.object({ boards: identifierList("board name") }),
  LEVER: z.object({
    sites: identifierList("site name"),
    region: z.preprocess((v) => (v === "" || v == null ? "GLOBAL" : v), z.enum(["GLOBAL", "EU"])),
  }),
  GREENHOUSE: z.object({ boardTokens: identifierList("board token") }),
  MANUAL: z.object({}),
} as const;

const notes = z.preprocess(
  (v) =>
    typeof v === "string" && v.trim() === ""
      ? null
      : typeof v === "string"
        ? v.trim()
        : (v ?? null),
  z.string().max(1000, "Max 1000 characters").nullable(),
);

/** Full configuration form: source-specific fields + rate limits + notes. */
export function sourceConfigInput(key: SourceKey) {
  const base = CONFIG_SCHEMAS[key] as z.ZodObject<z.ZodRawShape>;
  return base.extend({ ...(key === "MANUAL" ? {} : rateLimitSchema.shape), notes });
}

function rawEntries(key: SourceKey, configuration: unknown): string[] {
  const c = (configuration ?? {}) as Record<string, unknown>;
  const list =
    key === "ASHBY"
      ? c.boards
      : key === "LEVER"
        ? c.sites
        : key === "GREENHOUSE"
          ? c.boardTokens
          : [];
  return Array.isArray(list) ? list.map(String) : [];
}

/** Boards configured for an ATS source (empty when not configured). */
export function configuredBoards(key: SourceKey, configuration: unknown): BoardEntry[] {
  return rawEntries(key, configuration)
    .map(parseBoardEntry)
    .filter((b): b is BoardEntry => b !== null);
}

/** Board identifiers only. */
export function configuredIdentifiers(key: SourceKey, configuration: unknown): string[] {
  return configuredBoards(key, configuration).map((b) => b.id);
}

export function rateLimitsFrom(settings: unknown): RateLimitSettings {
  const parsed = rateLimitSchema.safeParse(settings ?? {});
  return parsed.success ? parsed.data : { ...RATE_LIMIT_DEFAULTS };
}

export const STATUS_LABELS: Record<SourceStatus, string> = {
  PENDING_VERIFICATION: "Pending verification",
  READY: "Ready",
  MANUAL_ONLY: "Manual only",
  ERROR: "Error",
};

export const TERMS_LABELS: Record<TermsStatus, string> = {
  NOT_REVIEWED: "Not reviewed",
  VERIFIED: "Public access documented",
  RESTRICTED: "Restricted",
  NOT_APPLICABLE: "Not applicable",
};

export const ACCESS_LABELS: Record<string, string> = {
  PUBLIC_POSTINGS_API: "Public postings API",
  USER_ENTERED: "User entered",
};

export const TYPE_LABELS: Record<string, string> = {
  ATS_PUBLIC_API: "ATS (public)",
  MANUAL: "Manual",
};
