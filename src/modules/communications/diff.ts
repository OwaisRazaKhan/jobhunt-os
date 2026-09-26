/**
 * Side-by-side comparison of two communication versions: fields (subject, greeting, closing,
 * signature, cover-letter header/recipient) and body paragraphs (added / removed / changed /
 * reordered, with a word-level diff for changed paragraphs). History is only read.
 */
import { paragraphsOf, type CommunicationDocument } from "./document";

export type DiffKind = "ADDED" | "REMOVED" | "CHANGED" | "REORDERED" | "UNCHANGED";

export interface WordPart {
  kind: "same" | "added" | "removed";
  text: string;
}

export interface CommunicationDiffEntry {
  area: "field" | "paragraph";
  label: string;
  kind: DiffKind;
  before: string | null;
  after: string | null;
  words?: WordPart[];
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

function fields(doc: CommunicationDocument): [string, string][] {
  const out: [string, string][] = [];
  if (doc.kind === "EMAIL") out.push(["Subject", doc.subject]);
  else {
    out.push(
      [
        "Header",
        [
          doc.header.name,
          doc.header.email,
          doc.header.phone,
          doc.header.location,
          ...doc.header.links,
        ]
          .filter(Boolean)
          .join(" | "),
      ],
      ["Date", doc.date ?? ""],
      [
        "Recipient",
        [doc.recipient.name, doc.recipient.title, doc.recipient.company].filter(Boolean).join(", "),
      ],
    );
  }
  out.push(["Greeting", doc.greeting], ["Closing", doc.closing], ["Signature", doc.signature]);
  return out;
}

/** Word-level LCS diff (bounded; long texts fall back to whole replacement). */
export function diffWords(before: string, after: string): WordPart[] {
  const a = before.split(/(\s+)/).filter(Boolean);
  const b = after.split(/(\s+)/).filter(Boolean);
  if (a.length * b.length > 250_000)
    return [
      { kind: "removed", text: before },
      { kind: "added", text: after },
    ];
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: WordPart[] = [];
  const push = (kind: WordPart["kind"], text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("same", a[i]!);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) push("removed", a[i++]!);
    else push("added", b[j++]!);
  }
  while (i < a.length) push("removed", a[i++]!);
  while (j < b.length) push("added", b[j++]!);
  return out;
}

function similarity(a: string, b: string): number {
  const wa = new Set(
    a
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 2),
  );
  const wb = new Set(
    b
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 2),
  );
  if (!wa.size || !wb.size) return 0;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common / Math.max(wa.size, wb.size);
}

export function diffCommunications(
  before: CommunicationDocument,
  after: CommunicationDocument,
): CommunicationDiffEntry[] {
  const out: CommunicationDiffEntry[] = [];
  const fa = new Map(fields(before));
  for (const [label, value] of fields(after)) {
    const prev = fa.get(label) ?? "";
    if (norm(prev) === norm(value))
      out.push({ area: "field", label, kind: "UNCHANGED", before: prev, after: value });
    else if (!prev) out.push({ area: "field", label, kind: "ADDED", before: null, after: value });
    else if (!value) out.push({ area: "field", label, kind: "REMOVED", before: prev, after: null });
    else
      out.push({
        area: "field",
        label,
        kind: "CHANGED",
        before: prev,
        after: value,
        words: diffWords(prev, value),
      });
  }

  const pa = paragraphsOf(before);
  const pb = paragraphsOf(after);
  const usedBefore = new Set<number>();
  const matches: (number | null)[] = pb.map((p) => {
    const exact = pa.findIndex((q, i) => !usedBefore.has(i) && norm(q) === norm(p));
    if (exact >= 0) {
      usedBefore.add(exact);
      return exact;
    }
    return null;
  });
  // Second pass: similar paragraphs are "changed".
  pb.forEach((p, j) => {
    if (matches[j] !== null) return;
    let best = -1;
    let bestScore = 0.35;
    pa.forEach((q, i) => {
      if (usedBefore.has(i)) return;
      const s = similarity(p, q);
      if (s > bestScore) {
        best = i;
        bestScore = s;
      }
    });
    if (best >= 0) {
      usedBefore.add(best);
      matches[j] = best;
    }
  });
  // Relative order of matched paragraphs (reordered when out of sequence).
  const matchedOrder = matches.filter((m): m is number => m !== null);
  pb.forEach((p, j) => {
    const i = matches[j];
    const label = `Paragraph ${j + 1}`;
    if (i === null || i === undefined) {
      out.push({ area: "paragraph", label, kind: "ADDED", before: null, after: p });
      return;
    }
    const q = pa[i]!;
    const rank = matchedOrder.indexOf(i);
    const expected = [...matchedOrder].sort((x, y) => x - y)[rank];
    if (norm(q) !== norm(p))
      out.push({
        area: "paragraph",
        label,
        kind: "CHANGED",
        before: q,
        after: p,
        words: diffWords(q, p),
      });
    else if (expected !== i)
      out.push({
        area: "paragraph",
        label: `${label} (was ${i + 1})`,
        kind: "REORDERED",
        before: q,
        after: p,
      });
    else out.push({ area: "paragraph", label, kind: "UNCHANGED", before: q, after: p });
  });
  pa.forEach((q, i) => {
    if (!usedBefore.has(i))
      out.push({
        area: "paragraph",
        label: `Removed paragraph (was ${i + 1})`,
        kind: "REMOVED",
        before: q,
        after: null,
      });
  });
  return out;
}

export function summarizeCommunicationDiff(entries: CommunicationDiffEntry[]) {
  const s = { added: 0, removed: 0, changed: 0, reordered: 0 };
  for (const e of entries) {
    if (e.kind === "ADDED") s.added++;
    if (e.kind === "REMOVED") s.removed++;
    if (e.kind === "CHANGED") s.changed++;
    if (e.kind === "REORDERED") s.reordered++;
  }
  return s;
}
