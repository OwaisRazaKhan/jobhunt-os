import Link from "next/link";
import { optionLabel } from "@/modules/candidate/options";
import { formatAge, formatLocation, formatSalary } from "../format";
import type { JobListItem } from "../types";
import { JobStatusBadge, RemoteBadge } from "./job-badges";

const Unknown = () => (
  <span className="text-fg-subtle" title="Not provided by the source">
    —
  </span>
);

/** Dense jobs table (desktop) that collapses to cards on small screens. */
export function JobsTable({ jobs }: { jobs: JobListItem[] }) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[860px] text-left text-xs">
          <thead className="border-border text-fg-subtle border-b font-mono text-[10px] tracking-wide uppercase">
            <tr>
              <th scope="col" className="px-4 py-2 font-normal">
                Role
              </th>
              <th scope="col" className="px-2 py-2 font-normal">
                Location
              </th>
              <th scope="col" className="px-2 py-2 font-normal">
                Work mode
              </th>
              <th scope="col" className="px-2 py-2 font-normal">
                Type
              </th>
              <th scope="col" className="px-2 py-2 font-normal">
                Salary
              </th>
              <th scope="col" className="px-2 py-2 font-normal">
                Source
              </th>
              <th scope="col" className="px-2 py-2 font-normal">
                Posted
              </th>
              <th scope="col" className="px-4 py-2 font-normal">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {jobs.map((job) => (
              <tr key={job.id} className="hover:bg-surface-2/60">
                <td className="max-w-72 px-4 py-2.5">
                  <Link
                    href={`/jobs/${job.id}`}
                    className="text-fg block truncate font-medium hover:underline"
                  >
                    {job.title}
                  </Link>
                  <span className="text-fg-muted block truncate">
                    {job.companyName ?? "Unknown company"}
                  </span>
                </td>
                <td className="text-fg-muted max-w-48 truncate px-2 py-2.5">
                  {formatLocation(job) ?? <Unknown />}
                </td>
                <td className="px-2 py-2.5">
                  <RemoteBadge status={job.remoteStatus} />
                </td>
                <td className="text-fg-muted px-2 py-2.5">
                  {job.employmentType ? optionLabel(job.employmentType) : <Unknown />}
                </td>
                <td className="text-fg px-2 py-2.5 font-mono whitespace-nowrap">
                  {formatSalary(job) ?? <Unknown />}
                </td>
                <td className="text-fg-muted px-2 py-2.5">{job.sourceName}</td>
                <td className="text-fg-muted px-2 py-2.5 font-mono whitespace-nowrap">
                  {formatAge(job.postedAt) ?? <Unknown />}
                </td>
                <td className="px-4 py-2.5">
                  <JobStatusBadge status={job.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-border divide-y md:hidden">
        {jobs.map((job) => (
          <li key={job.id}>
            <Link href={`/jobs/${job.id}`} className="hover:bg-surface-2/60 block px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <span className="text-fg text-sm font-medium">{job.title}</span>
                <JobStatusBadge status={job.status} />
              </div>
              <p className="text-fg-muted mt-0.5 text-xs">
                {[job.companyName, formatLocation(job)].filter(Boolean).join(" · ") ||
                  "Details not provided"}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                <RemoteBadge status={job.remoteStatus} />
                {formatSalary(job) && (
                  <span className="text-fg font-mono">{formatSalary(job)}</span>
                )}
                <span className="text-fg-subtle">{job.sourceName}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
