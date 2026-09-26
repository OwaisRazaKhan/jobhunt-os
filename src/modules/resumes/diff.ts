/**
 * Structural diff between two ResumeDocuments (pure). Items are matched by their stable id,
 * so rewording shows as CHANGED, moving as REORDERED, and new/removed items as ADDED/REMOVED.
 */
import { SECTION_KEYS, type ResumeDocument, type SectionKey } from "./document";

export type DiffKind = "ADDED" | "REMOVED" | "CHANGED" | "REORDERED" | "UNCHANGED";

export interface DiffEntry {
  section: SectionKey | "header" | "layout";
  itemId: string | null;
  label: string;
  kind: DiffKind;
  before: string | null;
  after: string | null;
}

export interface ChangeSummary {
  added: number;
  removed: number;
  changed: number;
  reordered: number;
  sections: Partial<
    Record<
      DiffEntry["section"],
      { added: number; removed: number; changed: number; reordered: number }
    >
  >;
  lines: string[];
}

interface Flat {
  id: string;
  parent: string | null;
  label: string;
  text: string;
  hidden: boolean;
}

function flatten(doc: ResumeDocument, key: SectionKey): Flat[] {
  const out: Flat[] = [];
  const add = (id: string, parent: string | null, label: string, text: string, hidden: boolean) =>
    out.push({ id, parent, label, text, hidden });
  switch (key) {
    case "summary":
      if (doc.summary) add(doc.summary.id, null, "Summary", doc.summary.text, doc.summary.hidden);
      break;
    case "experience":
      for (const e of doc.experience) {
        add(
          e.id,
          null,
          `${e.title} — ${e.organization}`,
          [
            e.title,
            e.organization,
            e.location,
            e.startDate,
            e.endDate,
            e.isCurrent,
            e.description,
            e.technologies.join(", "),
          ].join("|"),
          e.hidden,
        );
        for (const b of e.bullets) add(b.id, e.id, `Bullet (${e.title})`, b.text, b.hidden);
      }
      break;
    case "projects":
      for (const p of doc.projects) {
        add(
          p.id,
          null,
          p.name,
          [p.name, p.role, p.description, p.url, p.technologies.join(", ")].join("|"),
          p.hidden,
        );
        for (const b of p.bullets) add(b.id, p.id, `Bullet (${p.name})`, b.text, b.hidden);
      }
      break;
    case "education":
      for (const e of doc.education)
        add(
          e.id,
          null,
          e.institution,
          [
            e.institution,
            e.degree,
            e.fieldOfStudy,
            e.startDate,
            e.endDate,
            e.grade,
            e.details,
          ].join("|"),
          e.hidden,
        );
      break;
    case "skills":
      for (const g of doc.skills) {
        add(g.id, null, `Skill group ${g.label}`, g.label, g.hidden);
        for (const sk of g.skills) add(sk.id, g.id, `Skill ${sk.name}`, sk.name, sk.hidden);
      }
      break;
    case "certifications":
      for (const c of doc.certifications)
        add(
          c.id,
          null,
          c.name,
          [c.name, c.issuer, c.issueDate, c.expiryDate, c.url].join("|"),
          c.hidden,
        );
      break;
    case "languages":
      for (const l of doc.languages)
        add(l.id, null, l.language, [l.language, l.proficiency].join("|"), l.hidden);
      break;
    case "links":
      for (const l of doc.links) add(l.id, null, l.label, `${l.label}|${l.url}`, l.hidden);
      break;
    case "additional":
      for (const a of doc.additional) {
        add(a.id, null, a.title, a.title, a.hidden);
        for (const b of a.bullets) add(b.id, a.id, `Bullet (${a.title})`, b.text, b.hidden);
      }
      break;
  }
  return out;
}

const display = (f: Flat) => (f.text.includes("|") ? f.label : f.text);

export function diffDocuments(before: ResumeDocument, after: ResumeDocument): DiffEntry[] {
  const entries: DiffEntry[] = [];
  const header = (["name", "headline", "email", "phone", "location"] as const).filter(
    (k) => (before.header[k] ?? null) !== (after.header[k] ?? null),
  );
  for (const k of header)
    entries.push({
      section: "header",
      itemId: null,
      label: `Header ${k}`,
      kind: "CHANGED",
      before: before.header[k] ?? null,
      after: after.header[k] ?? null,
    });

  const order = (d: ResumeDocument) =>
    d.sections
      .filter((s) => s.visible)
      .map((s) => s.key)
      .join(",");
  if (order(before) !== order(after)) {
    entries.push({
      section: "layout",
      itemId: null,
      label: "Section order / visibility",
      kind: "REORDERED",
      before: order(before),
      after: order(after),
    });
  }

  for (const key of SECTION_KEYS) {
    const a = flatten(before, key);
    const b = flatten(after, key);
    const aById = new Map(a.map((x) => [x.id, x]));
    const bById = new Map(b.map((x) => [x.id, x]));
    for (const x of b) {
      const prev = aById.get(x.id);
      if (!prev || (prev.hidden && !x.hidden))
        entries.push({
          section: key,
          itemId: x.id,
          label: x.label,
          kind: "ADDED",
          before: null,
          after: display(x),
        });
      else if (!prev.hidden && x.hidden)
        entries.push({
          section: key,
          itemId: x.id,
          label: x.label,
          kind: "REMOVED",
          before: display(prev),
          after: null,
        });
      else if (prev.text !== x.text)
        entries.push({
          section: key,
          itemId: x.id,
          label: x.label,
          kind: "CHANGED",
          before: display(prev),
          after: display(x),
        });
    }
    for (const x of a)
      if (!bById.has(x.id))
        entries.push({
          section: key,
          itemId: x.id,
          label: x.label,
          kind: "REMOVED",
          before: display(x),
          after: null,
        });
    // Reordering among items present (and visible) in both, per parent.
    const parents = new Set([...a, ...b].map((x) => x.parent ?? ""));
    for (const p of parents) {
      const common = (list: Flat[]) =>
        list
          .filter(
            (x) =>
              (x.parent ?? "") === p &&
              !x.hidden &&
              aById.has(x.id) &&
              bById.has(x.id) &&
              !aById.get(x.id)!.hidden &&
              !bById.get(x.id)!.hidden,
          )
          .map((x) => x.id);
      const oa = common(a);
      const ob = common(b);
      ob.forEach((id, i) => {
        if (oa[i] !== id) {
          const x = bById.get(id)!;
          entries.push({
            section: key,
            itemId: id,
            label: x.label,
            kind: "REORDERED",
            before: String(oa.indexOf(id) + 1),
            after: String(i + 1),
          });
        }
      });
    }
  }
  return entries;
}

export function summarizeDiff(entries: DiffEntry[]): ChangeSummary {
  const summary: ChangeSummary = {
    added: 0,
    removed: 0,
    changed: 0,
    reordered: 0,
    sections: {},
    lines: [],
  };
  for (const e of entries) {
    const key = e.kind.toLowerCase() as "added" | "removed" | "changed" | "reordered";
    if (e.kind === "UNCHANGED") continue;
    summary[key]++;
    const s = (summary.sections[e.section] ??= { added: 0, removed: 0, changed: 0, reordered: 0 });
    s[key]++;
  }
  for (const [section, c] of Object.entries(summary.sections)) {
    const parts = [
      c.changed && `${c.changed} changed`,
      c.added && `${c.added} added`,
      c.removed && `${c.removed} removed`,
      c.reordered && `${c.reordered} reordered`,
    ].filter(Boolean);
    if (parts.length) summary.lines.push(`${section}: ${parts.join(", ")}`);
  }
  return summary;
}
