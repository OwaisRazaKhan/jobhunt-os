/**
 * Minimal robots.txt support (pure). Groups for our user agent or "*"; longest matching rule wins,
 * Allow wins ties; "*" wildcards and "$" anchors supported.
 * Fetch policy (see guard.ts): 404/410 or other 4xx → no restrictions; 5xx / network → disallow all
 * (conservative, as recommended by RFC 9309).
 */

export interface RobotsRules {
  allow: string[];
  disallow: string[];
}

export const ALLOW_ALL: RobotsRules = { allow: [], disallow: [] };
export const DISALLOW_ALL: RobotsRules = { allow: [], disallow: ["/"] };

export function parseRobots(text: string, agent = "jobhunt-os-research"): RobotsRules {
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/).slice(0, 5000)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow" && value) current.allow.push(value);
    if (key === "disallow" && value) current.disallow.push(value);
  }
  const ours = groups.filter((g) =>
    g.agents.some((a) => a !== "*" && agent.toLowerCase().includes(a)),
  );
  const chosen = ours.length ? ours : groups.filter((g) => g.agents.includes("*"));
  return {
    allow: chosen.flatMap((g) => g.allow),
    disallow: chosen.flatMap((g) => g.disallow),
  };
}

function ruleRegex(rule: string): RegExp {
  const anchored = rule.endsWith("$");
  const body = (anchored ? rule.slice(0, -1) : rule)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** Is this path (with query) allowed? */
export function isAllowed(rules: RobotsRules, pathWithQuery: string): boolean {
  let best: { len: number; allow: boolean } | null = null;
  for (const [list, allow] of [
    [rules.disallow, false],
    [rules.allow, true],
  ] as const) {
    for (const rule of list) {
      if (!ruleRegex(rule).test(pathWithQuery)) continue;
      const len = rule.length;
      if (!best || len > best.len || (len === best.len && allow)) best = { len, allow };
    }
  }
  return best ? best.allow : true;
}
