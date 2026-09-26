import Link from "next/link";
import { Badge } from "@/components/ui/primitives";
import type { SalaryComparison } from "@/modules/search-profiles/criteria";
import {
  EXPERIENCE_LABELS,
  JOB_TYPE_LABELS,
  type ExperienceLevel,
  type JobType,
} from "@/modules/search-profiles/types";
import { formatAge, formatSalary } from "../format";
import type { JobView } from "../search/params";
import type { JobSearchItem } from "../search/search.service";
import { JobStatusBadge, RemoteBadge } from "./job-badges";
import { JobStateButton } from "./job-state-button";

const dash = (
  <span className="text-fg-subtle" title="Not provided by the source">
    —
  </span>
);

let regionNames: Intl.DisplayNames | undefined;
function country(code: string | null) {
  if (!code) return null;
  try {
    regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/** City/region as parsed, else the source's own wording. Never invented. */
function place(job: JobSearchItem) {
  return [job.city, job.region].filter(Boolean).join(", ") || job.locationRaw || null;
}

const known = <T extends string>(value: string, labels: Record<T, string>) =>
  value && value !== "UNKNOWN" ? (labels[value as T] ?? value) : null;

const SALARY_NOTE: Partial<Record<SalaryComparison, string>> = {
  CURRENCY_NOT_COMPARABLE: "Currency not comparable",
  PERIOD_NOT_COMPARABLE: "Period not comparable",
  NOT_STATED: "Salary not stated",
};

function Salary({ job }: { job: JobSearchItem }) {
  const text = formatSalary(job);
  const note = job.salaryComparison ? SALARY_NOTE[job.salaryComparison] : undefined;
  return (
    <>
      {text ? <span className="text-fg font-mono whitespace-nowrap">{text}</span> : dash}
      {note && job.salaryComparison !== "NOT_STATED" && (
        <Badge
          tone="warning"
          className="mt-0.5 block w-fit"
          title="Never converted between currencies"
        >
          {note}
        </Badge>
      )}
    </>
  );
}

function Actions({ job, view }: { job: JobSearchItem; view: JobView }) {
  return (
    <div className="flex items-center justify-end">
      {!job.hidden && (
        <JobStateButton
          jobId={job.id}
          title={job.title}
          change={job.bookmarked ? "unbookmark" : "bookmark"}
        />
      )}
      <JobStateButton
        jobId={job.id}
        title={job.title}
        change={job.hidden ? "restore" : "hide"}
        showLabel={view === "hidden"}
      />
    </div>
  );
}

/** Results: dense table on desktop, cards on small screens. Unknown values show "—". */
export function JobResults({ jobs, view }: { jobs: JobSearchItem[]; view: JobView }) {
  return (
    <>
      <div className="hidden overflow-x-auto xl:block">
        <table className="w-full min-w-[680px] text-left text-xs">
          <thead className="border-border text-fg-subtle border-b font-mono text-[10px] tracking-wide uppercase">
            <tr>
              <th scope="col" className="px-4 py-2 font-normal">
                Role
              </th>
              <th scope="col" className="px-2 py-2 font-normal">
                Location · Country
              </th>
              <th scope="col" className="px-2 py-2 font-normal">
                Mode
              </th>
              <th scope="col" className="px-2 py-2 font-normal">
                Type · Level
              </th>
              <th scope="col" className="px-2 py-2 font-normal">
                Salary
              </th>
              <th scope="col" className="px-2 py-2 font-normal">
                Source
              </th>
              <th scope="col" className="px-2 py-2 font-normal">
                Posted · Status
              </th>
              <th scope="col" className="px-4 py-2 text-right font-normal">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {jobs.map((job) => (
              <tr key={job.id} className="hover:bg-surface-2/60 align-top">
                <td className="max-w-64 px-4 py-2.5">
                  <Link
                    href={`/jobs/${job.id}`}
                    className="text-fg block font-medium break-words hover:underline"
                  >
                    {job.title}
                  </Link>
                  <span className="text-fg-muted block truncate">{job.companyName}</span>
                  {job.categories.length > 0 && (
                    <span
                      className="text-fg-subtle mt-0.5 block truncate text-[11px]"
                      title="Catalog categories (rule-based)"
                    >
                      {job.categories.map((c) => c.name).join(" · ")}
                    </span>
                  )}
                </td>
                <td className="text-fg-muted max-w-40 px-2 py-2.5 break-words">
                  {place(job) ?? dash}
                  <span className="text-fg block">{country(job.countryCode) ?? dash}</span>
                </td>
                <td className="px-2 py-2.5" title={job.remoteStatusRaw ?? undefined}>
                  <RemoteBadge status={job.remoteStatus} />
                </td>
                <td className="text-fg-muted px-2 py-2.5">
                  <span className="block">
                    {known(job.employmentType, JOB_TYPE_LABELS as Record<JobType, string>) ?? dash}
                  </span>
                  <span className="block">
                    {known(
                      job.experienceLevel,
                      EXPERIENCE_LABELS as Record<ExperienceLevel, string>,
                    ) ?? dash}
                  </span>
                </td>
                <td className="px-2 py-2.5">
                  <Salary job={job} />
                </td>
                <td className="text-fg-muted px-2 py-2.5">{job.sourceName}</td>
                <td className="text-fg-muted px-2 py-2.5 font-mono whitespace-nowrap">
                  <span className="mb-1 block">{formatAge(job.postedAt) ?? dash}</span>
                  <JobStatusBadge status={job.status} />
                </td>
                <td className="px-3 py-1.5">
                  <Actions job={job} view={view} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-border divide-y xl:hidden">
        {jobs.map((job) => (
          <li key={job.id} className="px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link
                  href={`/jobs/${job.id}`}
                  className="text-fg text-sm font-medium break-words hover:underline"
                >
                  {job.title}
                </Link>
                <p className="text-fg-muted mt-0.5 text-xs break-words">
                  {[job.companyName, place(job), country(job.countryCode)]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <Actions job={job} view={view} />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
              <JobStatusBadge status={job.status} />
              <RemoteBadge status={job.remoteStatus} />
              {known(job.employmentType, JOB_TYPE_LABELS as Record<JobType, string>) && (
                <Badge>
                  {known(job.employmentType, JOB_TYPE_LABELS as Record<JobType, string>)}
                </Badge>
              )}
              {known(job.experienceLevel, EXPERIENCE_LABELS as Record<ExperienceLevel, string>) && (
                <Badge>
                  {known(job.experienceLevel, EXPERIENCE_LABELS as Record<ExperienceLevel, string>)}
                </Badge>
              )}
            </div>
            <div className="text-fg-muted mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span>
                <Salary job={job} />
              </span>
              <span>{job.sourceName}</span>
              {formatAge(job.postedAt) && (
                <span className="font-mono">posted {formatAge(job.postedAt)}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
