/** Join location parts and cut at a part boundary so names are never split mid-word. */
export function joinLocations(parts: (string | null | undefined)[], max = 200): string {
  const clean = parts.map((p) => p?.trim()).filter((p): p is string => Boolean(p));
  let out = "";
  for (const part of clean) {
    const next = out ? `${out}; ${part}` : part;
    if (next.length > max - 3) return out ? `${out}; …` : part.slice(0, max);
    out = next;
  }
  return out;
}
