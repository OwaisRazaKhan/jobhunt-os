import { Send } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { inputClass } from "@/components/forms/field-control";
import { buttonClass } from "@/components/ui/button";
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  type Tone,
} from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { listApplications } from "@/modules/applications/application.service";
import {
  APPLICATION_FILTERS,
  STATUS_LABELS,
  type ApplicationFilter,
  type ApplicationStatus,
} from "@/modules/applications/types";
import { ago } from "@/modules/communications/ui/labels";
import { requireActorOrRedirect } from "@/server/session";

export const metadata: Metadata = { title: "Applications · JOBHUNT OS" };
export const dynamic = "force-dynamic";

const TONES: Partial<Record<ApplicationStatus, Tone>> = {
  READY: "info",
  READY_TO_SUBMIT: "info",
  NEEDS_HUMAN_INPUT: "warning",
  SUBMISSION_UNCERTAIN: "warning",
  SUBMITTED: "success",
  SUBMISSION_CONFIRMED: "success",
  FAILED: "danger",
  BLOCKED: "danger",
};

export default async function ApplicationsPage({ searchParams }: PageProps<"/applications">) {
  const actor = await requireActorOrRedirect();
  const sp = await searchParams;
  const filter =
    (Object.keys(APPLICATION_FILTERS) as ApplicationFilter[]).find((f) => f === sp.filter) ?? "all";
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const applications = await listApplications(actor, { filter, q });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Apply"
        title="Applications"
        description="Each application is one attempt at one job, built from a communication package that is ready for application. Nothing is submitted without your approval, and a submission is only recorded when there is real evidence of it."
        actions={
          <Link
            href="/communication-packages?status=READY_FOR_APPLICATION"
            className={buttonClass("secondary", "sm")}
          >
            Ready packages
          </Link>
        }
      />
      <Alert tone="info" title="Human approval by default">
        Applications stop for your review before anything is submitted. CAPTCHAs, sign-ins and
        two-factor steps are always left to you — they are never bypassed.
      </Alert>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Filter applications" className="flex flex-wrap gap-1.5">
          {(Object.keys(APPLICATION_FILTERS) as ApplicationFilter[]).map((f) => (
            <Link
              key={f}
              href={`/applications${f === "all" ? "" : `?filter=${f}`}${q ? `${f === "all" ? "?" : "&"}q=${encodeURIComponent(q)}` : ""}`}
              aria-current={f === filter ? "page" : undefined}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs",
                f === filter
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-border text-fg-muted hover:text-fg",
              )}
            >
              {APPLICATION_FILTERS[f].label}
            </Link>
          ))}
        </nav>
        <form className="flex gap-1" action="/applications">
          {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
          <input
            name="q"
            defaultValue={q}
            placeholder="Company, role or ATS"
            aria-label="Search applications"
            className={cn(inputClass, "w-56")}
          />
          <button type="submit" className={buttonClass("secondary", "sm")}>
            Search
          </button>
        </form>
      </div>
      <Card>
        <CardHeader
          title={APPLICATION_FILTERS[filter].label}
          description={`${applications.length} application${applications.length === 1 ? "" : "s"}`}
        />
        {applications.length === 0 ? (
          <EmptyState
            icon={<Send className="size-6" aria-hidden />}
            title={filter === "all" && !q ? "No applications yet" : "Nothing matches"}
            description={
              filter === "all" && !q
                ? "Applications start from a communication package that is ready for application."
                : "Try another filter or search."
            }
          />
        ) : (
          <ul className="divide-border divide-y">
            {applications.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0 text-sm">
                  <Link
                    href={`/applications/${a.id}`}
                    className="text-fg font-medium hover:underline"
                  >
                    {a.job.title}
                    {a.company ? ` — ${a.company.name}` : ""}
                  </Link>
                  <p className="text-fg-muted text-xs">
                    {a.channel
                      ? `${a.channel.channelType.toLowerCase().replace(/_/g, " ")}${a.channel.provider !== "NONE" ? ` · ${a.channel.provider.toLowerCase()}` : ""}`
                      : "channel not resolved"}{" "}
                    ·{" "}
                    {a.submittedAt
                      ? `submitted ${ago(a.submittedAt)}`
                      : `updated ${ago(a.updatedAt)}`}
                  </p>
                </div>
                <Badge tone={TONES[a.status as ApplicationStatus] ?? "neutral"}>
                  {STATUS_LABELS[a.status as ApplicationStatus]}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
