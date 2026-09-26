import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardHeader, PageHeader, type Tone } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { isUuid } from "@/lib/ids";
import type { DiffEntry } from "@/modules/resumes/diff";
import {
  SECTION_KEYS,
  sectionTitle,
  type ResumeDocument,
  type SectionKey,
} from "@/modules/resumes/document";
import { compareVersions, getResumeWorkspace } from "@/modules/resumes/resume.service";
import { AppError } from "@/server/errors";
import { requireActorOrRedirect } from "@/server/session";

export const metadata: Metadata = { title: "Compare versions · JOBHUNT OS" };
export const dynamic = "force-dynamic";

const KIND_TONE: Record<string, Tone> = {
  ADDED: "success",
  REMOVED: "danger",
  CHANGED: "warning",
  REORDERED: "info",
};

interface Row {
  id: string;
  label: string;
  lines: string[];
  hidden: boolean;
  children: { id: string; text: string; hidden: boolean }[];
}

function rows(doc: ResumeDocument, key: SectionKey): Row[] {
  const b = (list: { id: string; text: string; hidden: boolean }[]) =>
    list.map((x) => ({ id: x.id, text: x.text, hidden: x.hidden }));
  switch (key) {
    case "summary":
      return doc.summary
        ? [
            {
              id: doc.summary.id,
              label: "Summary",
              lines: [doc.summary.text],
              hidden: doc.summary.hidden,
              children: [],
            },
          ]
        : [];
    case "experience":
      return doc.experience.map((e) => ({
        id: e.id,
        label: `${e.title} — ${e.organization}`,
        lines: [e.description ?? "", e.technologies.join(", ")].filter(Boolean),
        hidden: e.hidden,
        children: b(e.bullets),
      }));
    case "projects":
      return doc.projects.map((p) => ({
        id: p.id,
        label: p.name,
        lines: [p.description ?? "", p.technologies.join(", ")].filter(Boolean),
        hidden: p.hidden,
        children: b(p.bullets),
      }));
    case "education":
      return doc.education.map((e) => ({
        id: e.id,
        label: e.institution,
        lines: [[e.degree, e.fieldOfStudy].filter(Boolean).join(", ")].filter(Boolean),
        hidden: e.hidden,
        children: [],
      }));
    case "skills":
      return doc.skills.map((g) => ({
        id: g.id,
        label: g.label,
        lines: [],
        hidden: g.hidden,
        children: g.skills.map((s) => ({ id: s.id, text: s.name, hidden: s.hidden })),
      }));
    case "certifications":
      return doc.certifications.map((c) => ({
        id: c.id,
        label: c.name,
        lines: [c.issuer ?? ""].filter(Boolean),
        hidden: c.hidden,
        children: [],
      }));
    case "languages":
      return doc.languages.map((l) => ({
        id: l.id,
        label: l.language,
        lines: [l.proficiency ?? ""].filter(Boolean),
        hidden: l.hidden,
        children: [],
      }));
    case "links":
      return doc.links.map((l) => ({
        id: l.id,
        label: l.label,
        lines: [l.url],
        hidden: l.hidden,
        children: [],
      }));
    case "additional":
      return doc.additional.map((a) => ({
        id: a.id,
        label: a.title,
        lines: [],
        hidden: a.hidden,
        children: b(a.bullets),
      }));
  }
}

function Column({
  doc,
  section,
  marks,
  side,
}: {
  doc: ResumeDocument;
  section: SectionKey;
  marks: Map<string, DiffEntry>;
  side: "from" | "to";
}) {
  const list = rows(doc, section);
  const visibleSection = doc.sections.find((s) => s.key === section)?.visible ?? true;
  const show = (id: string) => {
    const m = marks.get(id);
    if (!m) return null;
    if (side === "from" && (m.kind === "ADDED" || m.kind === "REORDERED")) return null;
    if (side === "to" && m.kind === "REMOVED") return null;
    return <Badge tone={KIND_TONE[m.kind]}>{m.kind.toLowerCase()}</Badge>;
  };
  if (!list.length) return <p className="text-fg-subtle text-xs">—</p>;
  return (
    <div className={cn("flex flex-col gap-2 text-xs", !visibleSection && "opacity-50")}>
      {!visibleSection && <p className="text-fg-muted">Section hidden</p>}
      {list.map((r) => (
        <div
          key={r.id}
          className={cn("border-border rounded-md border p-2", r.hidden && "opacity-50")}
        >
          <p className="text-fg flex flex-wrap items-center gap-1.5 font-medium">
            {r.label} {show(r.id)} {r.hidden && <Badge>hidden</Badge>}
          </p>
          {r.lines.map((l, i) => (
            <p key={i} className="text-fg-muted">
              {l}
            </p>
          ))}
          {r.children.length > 0 && (
            <ul className="mt-1 flex flex-col gap-0.5">
              {r.children.map((c) => (
                <li key={c.id} className={cn("flex items-start gap-1.5", c.hidden && "opacity-50")}>
                  <span className="text-fg-subtle">•</span>
                  <span
                    className={cn(
                      marks.get(c.id)?.kind === "CHANGED" &&
                        (side === "from" ? "bg-danger/10" : "bg-success/10"),
                    )}
                  >
                    {c.text}
                  </span>
                  {show(c.id)}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

export default async function ComparePage({
  params,
  searchParams,
}: PageProps<"/resumes/[id]/compare">) {
  const actor = await requireActorOrRedirect();
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  let ws;
  try {
    ws = await getResumeWorkspace(actor, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const to = typeof sp.to === "string" && isUuid(sp.to) ? sp.to : ws.resume.currentVersionId;
  const toVersion = ws.resume.versions.find((v) => v.id === to);
  // Default "from": the parent (for tailored resumes this is the source resume version).
  const fromRaw =
    typeof sp.from === "string" && isUuid(sp.from) ? sp.from : (toVersion?.parentVersionId ?? null);
  if (!to || !fromRaw) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Compare versions"
          description="This version has no earlier version to compare with."
        />
        <Link href={`/resumes/${id}`} className="text-accent text-sm underline">
          Back to resume
        </Link>
      </div>
    );
  }
  let cmp;
  try {
    cmp = await compareVersions(actor, fromRaw, to);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const marks = new Map(cmp.entries.filter((e) => e.itemId).map((e) => [e.itemId!, e]));
  const header = cmp.entries.filter((e) => e.section === "header" || e.section === "layout");
  const order: SectionKey[] = [
    ...new Set([...cmp.toDoc.sections.map((s) => s.key), ...SECTION_KEYS]),
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Compare"
        title={ws.resume.name}
        description={`${cmp.from.resumeId === cmp.to.resumeId ? "" : "Source resume "}v${cmp.from.versionNumber} → v${cmp.to.versionNumber}: ${cmp.summary.changed} changed · ${cmp.summary.added} added · ${cmp.summary.removed} removed · ${cmp.summary.reordered} reordered`}
        actions={
          <Link href={`/resumes/${id}`} className="text-accent text-sm underline">
            Back to resume
          </Link>
        }
      />
      <div className="flex flex-wrap gap-1.5 text-xs">
        <Badge tone="success">added</Badge>
        <Badge tone="danger">removed</Badge>
        <Badge tone="warning">changed</Badge>
        <Badge tone="info">reordered</Badge>
      </div>
      {header.length > 0 && (
        <Card>
          <CardHeader title="Header & layout" />
          <ul className="flex flex-col gap-1 px-4 py-3 text-xs">
            {header.map((h, i) => (
              <li key={i}>
                <span className="text-fg font-medium">{h.label}:</span>{" "}
                <span className="text-fg-muted line-through">{h.before ?? "—"}</span> →{" "}
                <span className="text-fg">{h.after ?? "—"}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {order.map((key) => {
        const a = rows(cmp.fromDoc, key);
        const b = rows(cmp.toDoc, key);
        if (!a.length && !b.length) return null;
        return (
          <Card key={key}>
            <CardHeader title={sectionTitle(cmp.toDoc, key)} />
            <div className="grid gap-4 px-4 py-3 md:grid-cols-2">
              <div>
                <p className="text-fg-subtle mb-1 font-mono text-[10px] uppercase">
                  Original · v{cmp.from.versionNumber}
                </p>
                <Column doc={cmp.fromDoc} section={key} marks={marks} side="from" />
              </div>
              <div>
                <p className="text-fg-subtle mb-1 font-mono text-[10px] uppercase">
                  Updated · v{cmp.to.versionNumber}
                </p>
                <Column doc={cmp.toDoc} section={key} marks={marks} side="to" />
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
