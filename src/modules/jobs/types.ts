/**
 * Job discovery display types (client-safe). The canonical job table arrives in a
 * later Phase 2 checkpoint; these types describe what the UI renders.
 * Unknown values are `null` — never guessed.
 */

export const JOB_STATUSES = ["OPEN", "CLOSED", "STALE", "UNKNOWN"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const REMOTE_STATUSES = ["REMOTE", "HYBRID", "ONSITE", "UNKNOWN"] as const;
export type RemoteStatus = (typeof REMOTE_STATUSES)[number];

export const SALARY_PERIODS = ["YEAR", "MONTH", "WEEK", "HOUR", "UNKNOWN"] as const;
export type SalaryPeriod = (typeof SALARY_PERIODS)[number];

export interface JobListItem {
  id: string;
  title: string;
  companyName: string | null;
  locationRaw: string | null;
  city: string | null;
  countryCode: string | null;
  remoteStatus: RemoteStatus;
  employmentType: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: SalaryPeriod | null;
  salaryRaw: string | null;
  sourceName: string;
  postedAt: Date | null;
  lastSeenAt: Date | null;
  status: JobStatus;
}
