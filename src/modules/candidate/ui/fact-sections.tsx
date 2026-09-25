import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import type { FieldContext } from "@/components/forms/field-control";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import type { CandidateOverview } from "../knowledge.service";
import { SECTION_META } from "../form-fields";
import { countryName } from "../labels";
import { formatDateRange, formatPartialDate, optionLabel, SKILL_CATEGORIES } from "../options";
import type { SectionKind } from "../schemas";
import { FactSourceBadge, VerificationBadge } from "./badges";
import { AddFactButton, FactItemActions } from "./fact-controls";

type Row = Record<string, unknown> & {
  id: string;
  verificationStatus: "VERIFIED" | "USER_PROVIDED" | "NEEDS_REVIEW" | "AI_INFERRED";
  sourceType: string;
  sourceExcerpt: string | null;
};

function Chips({ items, max = 12 }: { items: string[]; max?: number }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {items.slice(0, max).map((item) => (
        <span
          key={item}
          className="bg-surface-3 text-fg-muted rounded-sm px-1.5 py-0.5 text-[11px]"
        >
          {item}
        </span>
      ))}
      {items.length > max && (
        <span className="text-fg-subtle text-[11px]">+{items.length - max}</span>
      )}
    </div>
  );
}

function LinkOut({ href, label }: { href: unknown; label: string }) {
  if (typeof href !== "string" || !href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-info inline-flex items-center gap-1 text-xs hover:underline"
    >
      {label} <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const arr = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);

function RowShell({
  row,
  kind,
  context,
  title,
  subtitle,
  meta,
  children,
}: {
  row: Row;
  kind: SectionKind;
  context: FieldContext;
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className="group flex gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <p className="text-fg text-sm font-medium">{title}</p>
          {meta && <p className="text-fg-subtle font-mono text-[11px]">{meta}</p>}
        </div>
        {subtitle && <p className="text-fg-muted mt-0.5 text-xs">{subtitle}</p>}
        {children}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <VerificationBadge status={row.verificationStatus} />
          <FactSourceBadge sourceType={row.sourceType} excerpt={row.sourceExcerpt} />
        </div>
      </div>
      <div className="shrink-0 opacity-100 transition-opacity sm:opacity-60 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
        <FactItemActions
          kind={kind}
          record={row}
          context={context}
          verified={row.verificationStatus === "VERIFIED"}
        />
      </div>
    </li>
  );
}

function renderRow(kind: SectionKind, row: Row, context: FieldContext, achievements: Row[]) {
  const shell = (props: Omit<Parameters<typeof RowShell>[0], "row" | "kind" | "context">) => (
    <RowShell key={row.id} row={row} kind={kind} context={context} {...props} />
  );
  switch (kind) {
    case "education":
      return shell({
        title:
          [str(row.degree), str(row.fieldOfStudy)].filter(Boolean).join(" in ") ||
          str(row.institution),
        subtitle: [str(row.degree) ? str(row.institution) : "", str(row.location)]
          .filter(Boolean)
          .join(" · "),
        meta: formatDateRange(str(row.startDate), str(row.endDate), row.isCurrent === true),
        children: row.description ? (
          <p className="text-fg-muted mt-1 line-clamp-2 text-xs">{str(row.description)}</p>
        ) : null,
      });
    case "experience": {
      const own = achievements.filter((a) => a.experienceId === row.id);
      return shell({
        title: str(row.title),
        subtitle: [str(row.organization), optionLabel(str(row.employmentType)), str(row.location)]
          .filter(Boolean)
          .join(" · "),
        meta: formatDateRange(str(row.startDate), str(row.endDate), row.isCurrent === true),
        children: (
          <>
            {row.description ? (
              <p className="text-fg-muted mt-1 line-clamp-2 text-xs">{str(row.description)}</p>
            ) : null}
            {arr(row.responsibilities).length > 0 && (
              <ul className="text-fg-muted mt-1 list-disc space-y-0.5 pl-4 text-xs">
                {arr(row.responsibilities)
                  .slice(0, 4)
                  .map((r) => (
                    <li key={r}>{r}</li>
                  ))}
              </ul>
            )}
            <Chips items={arr(row.skillsUsed)} />
            {own.length > 0 && (
              <ul className="border-border-strong mt-2 space-y-1 border-l pl-3">
                {own.map((a) => (
                  <li key={a.id} className="text-fg text-xs">
                    {str(a.statement)}{" "}
                    {a.metric ? (
                      <span className="text-success font-mono">· {str(a.metric)}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </>
        ),
      });
    }
    case "project":
      return shell({
        title: str(row.name),
        subtitle: [
          str(row.role),
          optionLabel(str(row.projectType)),
          row.teamSize ? `Team of ${String(row.teamSize)}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
        meta: formatDateRange(str(row.startDate), str(row.endDate), row.isCurrent === true),
        children: (
          <>
            {row.description ? (
              <p className="text-fg-muted mt-1 line-clamp-3 text-xs">{str(row.description)}</p>
            ) : (
              <p className="text-warning mt-1 text-xs">No description yet.</p>
            )}
            <Chips items={[...arr(row.technologies), ...arr(row.skills)]} />
            <div className="mt-1.5 flex flex-wrap gap-3">
              <LinkOut href={row.liveUrl} label="Live" />
              <LinkOut href={row.repositoryUrl} label="Repository" />
              <LinkOut href={row.portfolioUrl} label="Case study" />
            </div>
          </>
        ),
      });
    case "certification":
      return shell({
        title: str(row.name),
        subtitle: [str(row.issuer), row.credentialId ? `ID ${str(row.credentialId)}` : ""]
          .filter(Boolean)
          .join(" · "),
        meta: [
          formatPartialDate(str(row.issueDate)),
          row.expiryDate ? `expires ${formatPartialDate(str(row.expiryDate))}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
        children: (
          <div className="mt-1">
            <LinkOut href={row.credentialUrl} label="Credential" />
          </div>
        ),
      });
    case "portfolio":
      return shell({
        title: str(row.title),
        subtitle: optionLabel(str(row.type)),
        children: (
          <>
            {row.description ? (
              <p className="text-fg-muted mt-1 line-clamp-2 text-xs">{str(row.description)}</p>
            ) : null}
            <div className="mt-1">
              <LinkOut
                href={row.url}
                label={str(row.url)
                  .replace(/^https?:\/\//, "")
                  .slice(0, 60)}
              />
            </div>
            <Chips items={arr(row.skills)} />
          </>
        ),
      });
    case "language":
      return shell({
        title: str(row.language),
        subtitle: [
          row.reading ? `Reading ${str(row.reading)}` : "",
          row.writing ? `Writing ${str(row.writing)}` : "",
          row.speaking ? `Speaking ${str(row.speaking)}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
        meta: row.proficiency ? optionLabel(str(row.proficiency)) : "Level not set",
      });
    case "authorization":
      return shell({
        title: countryName(str(row.countryCode)),
        subtitle: [
          str(row.permitType),
          row.validUntil instanceof Date
            ? `valid until ${row.validUntil.toISOString().slice(0, 10)}`
            : "",
        ]
          .filter(Boolean)
          .join(" · "),
        meta: optionLabel(str(row.status)),
        children: row.notes ? <p className="text-fg-muted mt-1 text-xs">{str(row.notes)}</p> : null,
      });
    case "achievement":
      return shell({
        title: str(row.statement),
        meta: row.metric ? str(row.metric) : undefined,
      });
    case "skill":
      return shell({ title: str(row.name) });
  }
}

export function FactSection({
  kind,
  rows,
  context,
  achievements = [],
  addDefaults,
}: {
  kind: SectionKind;
  rows: Row[];
  context: FieldContext;
  achievements?: Row[];
  addDefaults?: Record<string, unknown>;
}) {
  const meta = SECTION_META[kind];
  return (
    <Card id={meta.anchor}>
      <CardHeader
        title={meta.title}
        count={rows.length}
        description={meta.description}
        actions={<AddFactButton kind={kind} context={context} defaults={addDefaults} />}
      />
      {rows.length === 0 ? (
        <EmptyState
          title={meta.empty}
          action={
            <AddFactButton
              kind={kind}
              context={context}
              variant="secondary"
              defaults={addDefaults}
            />
          }
        />
      ) : (
        <ul className="divide-border divide-y">
          {rows.map((row) => renderRow(kind, row, context, achievements))}
        </ul>
      )}
    </Card>
  );
}

/** Skills are dense: grouped chips with per-skill actions in a compact list. */
export function SkillsSection({
  skills,
  context,
}: {
  skills: CandidateOverview["skills"];
  context: FieldContext;
}) {
  const byCategory = SKILL_CATEGORIES.map((category) => ({
    category,
    items: skills.filter((s) => s.category === category),
  })).filter((g) => g.items.length > 0);
  return (
    <Card id="skills">
      <CardHeader
        title="Skills"
        count={skills.length}
        description="Proficiency is your own assessment — never inferred."
        actions={<AddFactButton kind="skill" context={context} />}
      />
      {skills.length === 0 ? (
        <EmptyState
          title={SECTION_META.skill.empty}
          action={<AddFactButton kind="skill" context={context} variant="secondary" />}
        />
      ) : (
        <div className="divide-border divide-y">
          {byCategory.map((group) => (
            <div key={group.category} className="px-4 py-3">
              <p className="text-fg-subtle mb-2 font-mono text-[11px] tracking-wide uppercase">
                {optionLabel(group.category)}
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {group.items.map((skill) => (
                  <li
                    key={skill.id}
                    className="group border-border-strong bg-surface-2 flex items-center gap-1 rounded-md border py-0.5 pr-0.5 pl-2"
                  >
                    <span className="text-fg text-xs">{skill.name}</span>
                    {skill.proficiency ? (
                      <span
                        className="text-fg-subtle font-mono text-[10px]"
                        title="Self-assessed proficiency"
                      >
                        {skill.proficiency}/5
                      </span>
                    ) : null}
                    {skill.verificationStatus === "VERIFIED" ? (
                      <Badge tone="success" className="h-4 px-1" title="Verified">
                        ✓
                      </Badge>
                    ) : (
                      <Badge
                        tone="neutral"
                        className="h-4 px-1"
                        title={
                          skill.sourceType === "MANUAL_ENTRY"
                            ? "User provided"
                            : `User provided · ${optionLabel(skill.sourceType)}`
                        }
                      >
                        •
                      </Badge>
                    )}
                    <FactItemActions
                      kind="skill"
                      record={skill}
                      context={context}
                      verified={skill.verificationStatus === "VERIFIED"}
                      compact
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
