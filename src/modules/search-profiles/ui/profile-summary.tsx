import type { ReactNode } from "react";
import { SCHEDULE_OPTIONS } from "../schemas";
import {
  EXPERIENCE_LABELS,
  JOB_TYPE_LABELS,
  VISA_LABELS,
  WORK_MODE_LABELS,
  type ExperienceLevel,
  type JobType,
  type VisaPreference,
  type WorkMode,
} from "../types";

/** Plain-data view of a profile's configuration (server-renderable). */
export interface ProfileSummaryData {
  countryCodes: string[];
  locations: { location: { name: string; countryCode: string } }[];
  categories: { category: { name: string } }[];
  searchTerms: string[];
  workModes: string[];
  employmentTypes: string[];
  experienceLevels: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
  visaPreference: string;
  sourceKeys: string[];
  scheduleIntervalHours: number | null;
}

const any = <span className="text-fg-subtle">Any</span>;

function list(values: string[], label?: (v: string) => string): ReactNode {
  if (values.length === 0) return any;
  return values.map((v) => (label ? label(v) : v)).join(", ");
}

export function salaryText(p: ProfileSummaryData): string | null {
  if (p.salaryMin == null && p.salaryMax == null) return null;
  const fmt = (n: number) => n.toLocaleString("en-US");
  const range =
    p.salaryMin != null && p.salaryMax != null
      ? `${fmt(p.salaryMin)}–${fmt(p.salaryMax)}`
      : p.salaryMin != null
        ? `≥ ${fmt(p.salaryMin)}`
        : `≤ ${fmt(p.salaryMax!)}`;
  return `${p.salaryCurrency ?? ""} ${range}${p.salaryPeriod ? ` / ${p.salaryPeriod.toLowerCase()}` : ""}`.trim();
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-fg-subtle font-mono text-[10px] tracking-wide uppercase">{label}</dt>
      <dd className="text-fg mt-0.5 text-xs break-words">{children}</dd>
    </div>
  );
}

export function ProfileSummary({
  profile,
  countryNames,
  full = false,
}: {
  profile: ProfileSummaryData;
  countryNames: Map<string, string>;
  /** Show every criterion (discovery page) instead of the compact list view */
  full?: boolean;
}) {
  const schedule =
    SCHEDULE_OPTIONS.find((o) => o.value === String(profile.scheduleIntervalHours ?? ""))?.label ??
    `Every ${profile.scheduleIntervalHours} h`;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
      <Row label="Countries">{list(profile.countryCodes, (c) => countryNames.get(c) ?? c)}</Row>
      <Row label="Locations">{list(profile.locations.map((l) => l.location.name))}</Row>
      <Row label="Categories">{list(profile.categories.map((c) => c.category.name))}</Row>
      <Row label="Work mode">
        {list(profile.workModes, (m) => WORK_MODE_LABELS[m as WorkMode] ?? m)}
      </Row>
      {(full || profile.searchTerms.length > 0) && (
        <Row label="Extra terms">
          {profile.searchTerms.length ? (
            <span className="font-mono">{profile.searchTerms.join(", ")}</span>
          ) : (
            <span className="text-fg-subtle">None</span>
          )}
        </Row>
      )}
      <Row label="Job type">
        {list(profile.employmentTypes, (t) => JOB_TYPE_LABELS[t as JobType] ?? t)}
      </Row>
      <Row label="Experience">
        {list(profile.experienceLevels, (l) => EXPERIENCE_LABELS[l as ExperienceLevel] ?? l)}
      </Row>
      {(full || salaryText(profile)) && <Row label="Salary">{salaryText(profile) ?? any}</Row>}
      {(full || profile.visaPreference !== "UNKNOWN") && (
        <Row label="Visa (info only)">
          {VISA_LABELS[profile.visaPreference as VisaPreference] ?? profile.visaPreference}
        </Row>
      )}
      <Row label="Sources">
        {profile.sourceKeys.length ? profile.sourceKeys.join(", ") : "All enabled"}
      </Row>
      <Row label="Schedule">{schedule}</Row>
    </dl>
  );
}
