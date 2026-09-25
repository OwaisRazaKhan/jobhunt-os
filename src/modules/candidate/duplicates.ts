/**
 * Deterministic duplicate detection for candidate records. Pure functions.
 * Nothing is merged automatically — results are shown to the user as flags.
 */

import { normalizeKey, normalizeOrganization } from "@/lib/text-normalize";

export { normalizeKey, normalizeOrganization };

function bigrams(value: string): Map<string, number> {
  const grams = new Map<string, number>();
  for (let i = 0; i < value.length - 1; i++) {
    const gram = value.slice(i, i + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

/** Sørensen–Dice coefficient on character bigrams (0..1). */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const ga = bigrams(a);
  const gb = bigrams(b);
  let overlap = 0;
  for (const [gram, count] of ga) overlap += Math.min(count, gb.get(gram) ?? 0);
  return (2 * overlap) / (a.length - 1 + (b.length - 1));
}

export type DuplicateKind =
  "education" | "experience" | "skill" | "project" | "portfolio" | "certification" | "language";

export interface Comparable {
  id: string;
  kind: DuplicateKind;
  label: string;
  /** Primary identity (org, institution, skill name, project name, url…) */
  primary: string;
  /** Secondary identity (title, degree, issuer…) — optional */
  secondary?: string;
}

export interface DuplicateMatch {
  id: string;
  kind: DuplicateKind;
  label: string;
  score: number;
}

const THRESHOLD = 0.85;

/** Score two comparables of the same kind. 0 when unrelated. */
export function duplicateScore(a: Comparable, b: Comparable): number {
  if (a.kind !== b.kind) return 0;
  const normalize =
    a.kind === "experience" || a.kind === "education" ? normalizeOrganization : normalizeKey;
  const primary = similarity(normalize(a.primary), normalize(b.primary));
  if (primary < THRESHOLD) return 0;
  // When both sides carry a secondary identity (e.g. job title), require it to agree too.
  if (a.secondary && b.secondary) {
    const secondary = similarity(normalizeKey(a.secondary), normalizeKey(b.secondary));
    if (secondary < 0.6) return 0;
    return Math.round(((primary + secondary) / 2) * 100) / 100;
  }
  return Math.round(primary * 100) / 100;
}

export function findBestDuplicate(
  candidate: Comparable,
  existing: Comparable[],
): DuplicateMatch | null {
  let best: DuplicateMatch | null = null;
  for (const item of existing) {
    if (item.id === candidate.id) continue;
    const score = duplicateScore(candidate, item);
    if (score > 0 && (!best || score > best.score)) {
      best = { id: item.id, kind: item.kind, label: item.label, score };
    }
  }
  return best;
}

export interface DuplicatePair {
  kind: DuplicateKind;
  a: { id: string; label: string };
  b: { id: string; label: string };
  score: number;
}

/** Pairs of likely duplicates within the user's existing records. */
export function findDuplicatePairs(items: Comparable[]): DuplicatePair[] {
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!;
      const b = items[j]!;
      const score = duplicateScore(a, b);
      if (score > 0)
        pairs.push({
          kind: a.kind,
          a: { id: a.id, label: a.label },
          b: { id: b.id, label: b.label },
          score,
        });
    }
  }
  return pairs;
}
