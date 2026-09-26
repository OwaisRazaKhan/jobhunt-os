import { Building2, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { inputClass } from "@/components/forms/field-control";
import { buttonClass } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { listCompanies } from "@/modules/research/research.service";
import { day, ResearchStatusBadge } from "@/modules/research/ui/research-parts";
import { requireActorOrRedirect } from "@/server/session";

export const metadata: Metadata = { title: "Companies · JOBHUNT OS" };
export const dynamic = "force-dynamic";

export default async function CompaniesPage({ searchParams }: PageProps<"/companies">) {
  const actor = await requireActorOrRedirect();
  const raw = (await searchParams).q;
  const q = typeof raw === "string" ? raw.slice(0, 100) : "";
  const companies = await listCompanies(actor, { q });
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Research"
        title="Companies"
        description="Companies of the jobs you can see. Research status is yours only; company research is reused across all your jobs at that company."
      />
      <form className="flex max-w-md gap-2" role="search">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search companies"
          className={inputClass}
          aria-label="Search companies"
        />
        <button type="submit" className={buttonClass("secondary", "sm")}>
          <Search className="size-3.5" aria-hidden /> Search
        </button>
      </form>
      <Card>
        {companies.length === 0 ? (
          <EmptyState
            icon={<Building2 className="size-6" />}
            title="No companies"
            description={
              q
                ? "No company matches this search."
                : "Companies appear once jobs are in your catalog."
            }
          />
        ) : (
          <ul className="divide-border divide-y">
            {companies.map((c) => (
              <li
                key={c.id}
                className="flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <Link
                    href={`/companies/${c.id}`}
                    className="text-fg text-sm font-medium hover:underline"
                  >
                    {c.name}
                  </Link>
                  <p className="text-fg-subtle font-mono text-[11px]">
                    {c.jobs} job{c.jobs === 1 ? "" : "s"}
                    {c.officialWebsite ? ` · ${c.officialWebsite.replace(/^https?:\/\//, "")}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {c.research ? (
                    <>
                      <ResearchStatusBadge
                        status={c.research.status}
                        freshness={c.research.freshness}
                      />
                      <span className="text-fg-subtle font-mono text-[11px]">
                        v{c.research.version} · {day(c.research.researchedAt)}
                      </span>
                    </>
                  ) : (
                    <ResearchStatusBadge status="NOT_STARTED" />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
