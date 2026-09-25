import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  CircleDot,
  ExternalLink,
  Info,
  MapPin,
} from "lucide-react";
import Link from "next/link";
import type { FieldContext } from "@/components/forms/field-control";
import { Badge, Card, CardHeader, EmptyState, ProgressBar } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import type { CandidateOverview } from "../knowledge.service";
import {
  PREFERENCE_FIELDS,
  PROFILE_BASIC_FIELDS,
  PROFILE_GOAL_FIELDS,
  ROLE_FIELDS,
} from "../form-fields";
import { countryName } from "../labels";
import { optionLabel } from "../options";
import { VerificationBadge } from "./badges";
import { EditDialogButton, TargetLocationsButton, VerifyProfileButton } from "./profile-editors";

type Overview = CandidateOverview;

const READINESS = {
  READY: { tone: "success", label: "Ready" },
  NEEDS_REVIEW: { tone: "warning", label: "Needs review" },
  INCOMPLETE: { tone: "neutral", label: "Incomplete" },
} as const;

export function CandidateHeader({
  overview,
  context,
}: {
  overview: Overview;
  context: FieldContext;
}) {
  const p = overview.profile;
  const location = [
    p?.currentCity,
    p?.currentCountryCode ? countryName(p.currentCountryCode) : null,
  ]
    .filter(Boolean)
    .join(", ");
  const readiness = READINESS[overview.readiness.status];
  const links = [
    ["LinkedIn", p?.linkedinUrl],
    ["GitHub", p?.githubUrl],
    ["Website", p?.websiteUrl],
    ["Portfolio", p?.portfolioUrl],
  ].filter((l): l is [string, string] => Boolean(l[1]));
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <p className="text-fg-subtle font-mono text-[11px] tracking-wide uppercase">Candidate</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">
          {p?.fullName || <span className="text-fg-muted">Name not set</span>}
        </h1>
        <p className="text-fg-muted mt-0.5 text-sm">
          {p?.headline || "No professional headline yet"}
        </p>
        <div className="text-fg-muted mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {location && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3" aria-hidden /> {location}
            </span>
          )}
          {links.map(([label, href]) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-info inline-flex items-center gap-1 hover:underline"
            >
              {label} <ExternalLink className="size-3" aria-hidden />
            </a>
          ))}
          {p && <VerificationBadge status={p.verificationStatus} />}
        </div>
      </div>
      <div className="border-border bg-surface-1 flex w-full flex-col gap-2 rounded-lg border p-3 lg:w-72">
        <div className="flex items-center justify-between text-xs">
          <span className="text-fg-muted">Profile completeness</span>
          <span className="text-fg font-mono text-sm font-semibold">
            {overview.completeness.percent}%
          </span>
        </div>
        <ProgressBar
          value={overview.completeness.percent}
          label="Profile completeness"
          tone={overview.completeness.percent >= 80 ? "success" : "accent"}
        />
        <div className="flex items-center justify-between text-xs">
          <span className="text-fg-muted">Readiness</span>
          <Badge tone={readiness.tone}>{readiness.label}</Badge>
        </div>
        <div className="flex flex-wrap gap-1.5 pt-1">
          <EditDialogButton
            title="Basic information"
            target="profile"
            fields={PROFILE_BASIC_FIELDS}
            values={p ?? {}}
            context={context}
            label="Edit profile"
            variant="secondary"
          />
          {p && p.verificationStatus !== "VERIFIED" && <VerifyProfileButton />}
        </div>
      </div>
    </div>
  );
}

export function AboutCard({ overview }: { overview: Overview }) {
  const p = overview.profile;
  return (
    <Card id="about">
      <CardHeader
        title="About"
        actions={
          <EditDialogButton
            title="About & career goals"
            target="profile"
            fields={[
              PROFILE_BASIC_FIELDS.find((f) => f.name === "summary")!,
              ...PROFILE_GOAL_FIELDS,
            ]}
            values={p ?? {}}
          />
        }
      />
      <div className="grid gap-4 px-4 py-3 md:grid-cols-2">
        <div>
          <p className="text-fg-muted text-xs font-medium">Summary</p>
          <p className="text-fg mt-1 text-sm whitespace-pre-line">
            {p?.summary || <span className="text-fg-subtle">No summary yet.</span>}
          </p>
        </div>
        <div>
          <p className="text-fg-muted text-xs font-medium">Career goal</p>
          <p className="text-fg mt-1 text-sm whitespace-pre-line">
            {p?.careerGoal || <span className="text-fg-subtle">No career goal yet.</span>}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <dt className="text-fg-muted">Availability</dt>
            <dd className="text-fg">
              {p?.availability ? optionLabel(p.availability) : "—"}
              {p?.availableFrom ? ` · ${p.availableFrom.toISOString().slice(0, 10)}` : ""}
            </dd>
            <dt className="text-fg-muted">Notice period</dt>
            <dd className="text-fg">
              {p?.noticePeriodWeeks != null ? `${p.noticePeriodWeeks} weeks` : "—"}
            </dd>
            <dt className="text-fg-muted">Years of experience</dt>
            <dd className="text-fg">
              {p?.yearsOfExperience != null ? `${p.yearsOfExperience} (stated)` : "—"}
            </dd>
          </dl>
        </div>
      </div>
    </Card>
  );
}

function ValueList({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <dt className="text-fg-muted text-xs font-medium">{label}</dt>
      <dd className="mt-1 flex flex-wrap gap-1">
        {values.length ? (
          values.map((v) => <Badge key={v}>{v}</Badge>)
        ) : (
          <span className="text-fg-subtle text-xs">Not set</span>
        )}
      </dd>
    </div>
  );
}

export function PreferencesCard({
  overview,
  countries,
}: {
  overview: Overview;
  countries: { value: string; label: string }[];
}) {
  const pr = overview.preferences;
  const salary =
    pr?.salaryMin != null || pr?.salaryMax != null
      ? `${[pr?.salaryMin, pr?.salaryMax]
          .filter((v) => v != null)
          .map((v) => v!.toLocaleString("en"))
          .join(" – ")} ${pr?.salaryCurrency ?? ""} ${optionLabel(pr?.salaryPeriod)}`.trim()
      : null;
  return (
    <Card id="preferences">
      <CardHeader
        title="Career preferences"
        description="Change these any time."
        actions={
          <>
            <EditDialogButton
              title="Target roles & industries"
              target="preferences"
              fields={ROLE_FIELDS}
              values={pr ?? {}}
              label="Roles"
            />
            <EditDialogButton
              title="Work preferences"
              target="preferences"
              fields={PREFERENCE_FIELDS}
              values={pr ?? {}}
              label="Preferences"
            />
          </>
        }
      />
      <dl className="grid gap-4 px-4 py-3 sm:grid-cols-2">
        <ValueList label="Target roles" values={pr?.targetRoles ?? []} />
        <ValueList label="Industries" values={pr?.targetIndustries ?? []} />
        <div className="sm:col-span-2">
          <dt className="text-fg-muted flex items-center justify-between text-xs font-medium">
            Target countries & cities
            <TargetLocationsButton initial={overview.targetLocations} countries={countries} />
          </dt>
          <dd className="mt-1 flex flex-wrap gap-1">
            {overview.targetLocations.length ? (
              overview.targetLocations.map((l) => (
                <Badge key={l.id} tone="info">
                  {countryName(l.countryCode)}
                  {l.city ? ` · ${l.city}` : ""}
                </Badge>
              ))
            ) : (
              <span className="text-fg-subtle text-xs">Not set</span>
            )}
          </dd>
        </div>
        <ValueList label="Work mode" values={(pr?.workModes ?? []).map(optionLabel)} />
        <ValueList label="Employment type" values={(pr?.employmentTypes ?? []).map(optionLabel)} />
        <ValueList label="Level" values={(pr?.seniorityLevels ?? []).map(optionLabel)} />
        <ValueList
          label="Company"
          values={[...(pr?.companySizes ?? []), ...(pr?.companyTypes ?? [])].map(optionLabel)}
        />
        <div>
          <dt className="text-fg-muted text-xs font-medium">Salary expectation</dt>
          <dd className="text-fg mt-1 font-mono text-xs">
            {salary ?? <span className="text-fg-subtle font-sans">Not set</span>}
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted text-xs font-medium">Relocation · Sponsorship</dt>
          <dd className="text-fg mt-1 text-xs">
            {pr?.relocation ? optionLabel(pr.relocation) : "—"} ·{" "}
            {pr?.needsSponsorship ? optionLabel(pr.needsSponsorship) : "—"}
          </dd>
        </div>
      </dl>
    </Card>
  );
}

const STATUS_ICON = {
  complete: <CheckCircle2 className="text-success size-3.5" aria-label="Complete" />,
  partial: <CircleDot className="text-warning size-3.5" aria-label="Partial" />,
  missing: <Circle className="text-fg-subtle size-3.5" aria-label="Missing" />,
};

export function CompletenessCard({ overview }: { overview: Overview }) {
  return (
    <Card>
      <CardHeader
        title="Profile completeness"
        description="Deterministic — calculated from your data, never by AI."
        actions={
          <span className="font-mono text-sm font-semibold">{overview.completeness.percent}%</span>
        }
      />
      <ul className="px-2 py-2">
        {overview.completeness.items.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href}
              className="hover:bg-surface-2 flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs"
              title={item.hint}
            >
              <span className="flex items-center gap-2">
                {STATUS_ICON[item.status]}
                <span className={cn(item.status === "missing" ? "text-fg-muted" : "text-fg")}>
                  {item.label}
                </span>
              </span>
              <span className="text-fg-subtle font-mono text-[11px]">
                {item.earned}/{item.weight}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ReadinessCard({ overview }: { overview: Overview }) {
  const r = overview.readiness;
  const meta = READINESS[r.status];
  return (
    <Card>
      <CardHeader
        title="Profile readiness"
        description="Whether this profile can be trusted for applications."
        actions={<Badge tone={meta.tone}>{meta.label}</Badge>}
      />
      <div className="px-4 py-3 text-xs">
        <p className="text-fg-muted">
          <span className="text-fg font-mono">{r.verifiedFacts}</span> of{" "}
          <span className="text-fg font-mono">{r.totalFacts}</span> facts verified by you.
        </p>
        {r.reasons.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {r.reasons.map((reason) => (
              <li key={reason} className="text-fg flex gap-1.5">
                <span aria-hidden className="text-warning">
                  •
                </span>{" "}
                {reason}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-success mt-2">No blocking issues.</p>
        )}
        {overview.pendingReview > 0 && (
          <Link href="/candidate/review" className="text-accent mt-3 inline-flex hover:underline">
            Review {overview.pendingReview} pending fact{overview.pendingReview === 1 ? "" : "s"} →
          </Link>
        )}
      </div>
    </Card>
  );
}

export function WarningsCard({ overview }: { overview: Overview }) {
  const warnings = overview.warnings;
  return (
    <Card>
      <CardHeader title="Profile quality" count={warnings.length} />
      {warnings.length === 0 ? (
        <EmptyState
          title="No issues found"
          description="Your profile passes every quality check."
        />
      ) : (
        <ul className="max-h-96 overflow-y-auto px-2 py-2">
          {warnings.map((w, i) => {
            const Icon = w.severity === "warning" ? AlertTriangle : Info;
            const content = (
              <span className="flex gap-2">
                <Icon
                  className={cn(
                    "mt-0.5 size-3.5 shrink-0",
                    w.severity === "warning" ? "text-warning" : "text-info",
                  )}
                  aria-hidden
                />
                <span className="text-fg">{w.message}</span>
              </span>
            );
            return (
              <li key={`${w.code}-${i}`}>
                {w.href ? (
                  <Link
                    href={w.href}
                    className="hover:bg-surface-2 block rounded-md px-2 py-1.5 text-xs"
                  >
                    {content}
                  </Link>
                ) : (
                  <div className="px-2 py-1.5 text-xs">{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
