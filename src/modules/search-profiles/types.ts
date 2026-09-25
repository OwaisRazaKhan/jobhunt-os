/**
 * Search Profiles — "WHAT I WANT TO FIND" (client-safe constants).
 * A search profile is a discovery/filter preference. It is never a claim about the
 * candidate (that is the Candidate Profile) and never a fit judgement (that is Matching).
 */

export const WORK_MODES = ["REMOTE", "HYBRID", "ONSITE", "UNKNOWN"] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export const JOB_TYPES = [
  "FULL_TIME",
  "PART_TIME",
  "INTERNSHIP",
  "CONTRACT",
  "TEMPORARY",
  "APPRENTICESHIP",
  "FREELANCE",
  "UNKNOWN",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const EXPERIENCE_LEVELS = [
  "INTERNSHIP",
  "ENTRY_LEVEL",
  "GRADUATE",
  "JUNIOR",
  "MID_LEVEL",
  "SENIOR",
  "LEAD",
  "UNKNOWN",
] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

export const VISA_PREFERENCES = [
  "SPONSORSHIP_REQUIRED",
  "SPONSORSHIP_PREFERRED",
  "SPONSORSHIP_NOT_REQUIRED",
  "UNKNOWN",
] as const;
export type VisaPreference = (typeof VISA_PREFERENCES)[number];

export const PROFILE_SALARY_PERIODS = ["YEAR", "MONTH", "WEEK", "HOUR"] as const;
export const PROFILE_SOURCE_KEYS = ["ASHBY", "LEVER", "GREENHOUSE"] as const;
export const LOCATION_KINDS = ["CITY", "REGION", "METRO", "REMOTE_COUNTRY"] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  REMOTE: "Remote",
  HYBRID: "Hybrid",
  ONSITE: "Onsite",
  UNKNOWN: "Unknown / not stated",
};

export const JOB_TYPE_LABELS: Record<JobType, string> = {
  FULL_TIME: "Full time",
  PART_TIME: "Part time",
  INTERNSHIP: "Internship",
  CONTRACT: "Contract",
  TEMPORARY: "Temporary",
  APPRENTICESHIP: "Apprenticeship",
  FREELANCE: "Freelance",
  UNKNOWN: "Unknown / not stated",
};

export const EXPERIENCE_LABELS: Record<ExperienceLevel, string> = {
  INTERNSHIP: "Internship",
  ENTRY_LEVEL: "Entry level",
  GRADUATE: "Graduate",
  JUNIOR: "Junior",
  MID_LEVEL: "Mid level",
  SENIOR: "Senior",
  LEAD: "Lead",
  UNKNOWN: "Unknown / not stated",
};

export const VISA_LABELS: Record<VisaPreference, string> = {
  SPONSORSHIP_REQUIRED: "Sponsorship required",
  SPONSORSHIP_PREFERRED: "Sponsorship preferred",
  SPONSORSHIP_NOT_REQUIRED: "Sponsorship not required",
  UNKNOWN: "Not specified",
};

export const LOCATION_KIND_LABELS: Record<LocationKind, string> = {
  CITY: "City",
  REGION: "Region",
  METRO: "Metro area",
  REMOTE_COUNTRY: "Remote in country",
};
