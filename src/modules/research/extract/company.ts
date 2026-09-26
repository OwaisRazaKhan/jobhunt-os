import { foldText } from "@/modules/search-profiles/criteria";
import {
  RELIABILITY_RANK,
  type DraftClaim,
  type EvidenceRef,
  type Reliability,
  type SourceType,
} from "../types";
import type { ParsedPage } from "./page";

/**
 * Company research extraction (pure, deterministic). Only what the fetched sources say:
 *  - self-description (meta / JSON-LD), products listed on official pages, structured facts
 *    (founding year, headquarters, employee count) ONLY when a source states them;
 *  - dated announcements from newsroom / blog listings (CURRENT within 12 months, else HISTORICAL);
 *  - signals are INTERPRETATIONS built from quoted headings/headlines.
 * Same fact with different values across sources → every version kept and marked CONFLICTING.
 */

export interface SourcePage {
  key: string;
  url: string;
  sourceType: SourceType;
  reliability: Reliability;
  page: ParsedPage;
}

const clip = (s: string, n = 600) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function fact(
  section: string,
  claim: string,
  evidence: EvidenceRef[],
  extra: Partial<DraftClaim> = {},
): DraftClaim {
  return {
    section,
    claim: clip(claim, 1000),
    claimType: "FACT",
    verification: "VERIFIED_FROM_SOURCE",
    method: "RULE",
    temporal: "CURRENT",
    evidence,
    ...extra,
  };
}

const PRODUCT_PATH = /\/(products?|solutions?|services?|platform|features?|offerings?)(\/|$)/i;

const ACTIVITY_KINDS: [string, RegExp][] = [
  [
    "Product launch",
    /\b(launch(es|ed)?|introduc(es|ing|ed)|unveil(s|ed)?|now available|release[sd]?|announc(es|ing|ed) new)\b/i,
  ],
  ["Partnership", /\b(partner(s|ship|ed)?|teams up|collaborat(es|ion))\b/i],
  ["Funding", /\b(raises?|raised|funding|series [a-e]|seed round|investment)\b/i],
  ["Acquisition", /\b(acquires?|acquired|acquisition|merg(es|er))\b/i],
  ["Expansion", /\b(expand(s|ing)?|expansion|new office|opens?|opened|enters?)\b/i],
  ["Hiring", /\b(hiring|we('re| are) growing|join our team|careers)\b/i],
  ["Recognition", /\b(award|recogni[sz]ed|named (a|as)|ranked)\b/i],
];

const SIGNALS: { section: string; label: string; re: RegExp }[] = [
  {
    section: "TECHNOLOGY_SIGNAL",
    label: "AI / automation",
    re: /\b(ai|artificial intelligence|machine learning|automation|llm|generative)\b/i,
  },
  {
    section: "TECHNOLOGY_SIGNAL",
    label: "platform / API / integrations",
    re: /\b(api|platform|integrations?|developer|sdk|cloud)\b/i,
  },
  {
    section: "MARKETING_SIGNAL",
    label: "marketing & content",
    re: /\b(marketing|campaign|content|brand|social media|newsletter|webinar)\b/i,
  },
  {
    section: "GROWTH_SIGNAL",
    label: "growth & expansion",
    re: /\b(expan(d|sion)|new market|new office|growth|customers|scale|raised|funding)\b/i,
  },
];

const MARKETS_RE =
  /\bfor ((small|medium|mid-sized|large|growing|global)?\s*(businesses|companies|enterprises|startups|teams|developers|marketers|agencies|retailers|brands|creators|freelancers|healthcare|banks|schools|nonprofits|smbs?|smes?)[^.,;]{0,40})/i;

function jsonLdOrg(page: ParsedPage) {
  return page.jsonLd.find((j) =>
    /Organization|Corporation|LocalBusiness/i.test(String(j["@type"])),
  );
}

function yearOf(value: unknown): string | null {
  const m = /\b(1[89]\d{2}|20\d{2})\b/.exec(String(value ?? ""));
  return m ? m[1]! : null;
}

export function extractCompanyClaims(
  companyName: string,
  sources: SourcePage[],
  now = new Date(),
): { claims: DraftClaim[]; unknowns: string[]; activityChecked: boolean; activityFound: number } {
  const claims: DraftClaim[] = [];
  const unknowns: string[] = [];
  const official = sources.filter(
    (s) => s.sourceType.startsWith("OFFICIAL_") && s.sourceType !== "OFFICIAL_JOB",
  );
  const ordered = [...sources].sort(
    (a, b) => RELIABILITY_RANK[b.reliability] - RELIABILITY_RANK[a.reliability],
  );

  // What they do: self-descriptions (deduplicated).
  const seenDesc = new Set<string>();
  for (const s of ordered.filter((x) =>
    ["OFFICIAL_COMPANY", "MANUAL", "PUBLIC_DATABASE"].includes(x.sourceType),
  )) {
    const org = jsonLdOrg(s.page);
    for (const desc of [
      s.page.description,
      typeof org?.description === "string" ? org.description : null,
    ]) {
      if (!desc || desc.length < 20) continue;
      const k = foldText(desc);
      if (seenDesc.has(k)) continue;
      seenDesc.add(k);
      const self = s.sourceType === "OFFICIAL_COMPANY";
      claims.push(
        fact(
          "WHAT_THEY_DO",
          self
            ? `The company describes itself: “${clip(desc, 500)}”`
            : `${s.url} describes the company: “${clip(desc, 500)}”`,
          [
            {
              sourceKey: s.key,
              excerpt: clip(desc, 1000),
              reference:
                org?.description === desc ? "JSON-LD Organization.description" : "meta description",
            },
          ],
        ),
      );
      const market = MARKETS_RE.exec(desc);
      if (market && self)
        claims.push(
          fact("MARKETS", `Official positioning mentions serving: “${market[1]!.trim()}”`, [
            { sourceKey: s.key, excerpt: clip(desc, 1000), reference: "meta description" },
          ]),
        );
      if (seenDesc.size >= 3) break;
    }
  }

  // Products / services listed on official pages.
  const products = new Map<string, EvidenceRef>();
  for (const s of official) {
    if (s.sourceType === "OFFICIAL_PRODUCT") {
      const h1 = s.page.headings.find((h) => h.level === 1)?.text;
      if (h1 && h1.length <= 100)
        products.set(foldText(h1), {
          sourceKey: s.key,
          excerpt: h1,
          reference: "page heading (h1)",
        });
    }
    for (const j of s.page.jsonLd)
      if (
        /Product|Service|SoftwareApplication/i.test(String(j["@type"])) &&
        typeof j.name === "string"
      )
        products.set(foldText(j.name), {
          sourceKey: s.key,
          excerpt: j.name,
          reference: `JSON-LD ${String(j["@type"])}`,
        });
    if (s.sourceType === "OFFICIAL_COMPANY")
      for (const l of s.page.links) {
        try {
          if (!PRODUCT_PATH.test(new URL(l.href).pathname)) continue;
        } catch {
          continue;
        }
        const text = l.text.trim();
        if (
          text.length >= 3 &&
          text.length <= 60 &&
          !/^(products?|solutions?|services?|features?|platform|learn more|see all|view all)$/i.test(
            text,
          )
        )
          products.set(foldText(text), {
            sourceKey: s.key,
            excerpt: `${text} (${l.href})`,
            reference: "site navigation link",
          });
      }
  }
  for (const [, ev] of [...products].slice(0, 10))
    claims.push(
      fact("PRODUCTS", `The official site lists: ${ev.excerpt.replace(/ \(https?:[^)]*\)$/, "")}`, [
        ev,
      ]),
    );

  // Structured facts (only when a source states them).
  for (const s of ordered) {
    const org = jsonLdOrg(s.page);
    const ev = (excerpt: string, reference: string): EvidenceRef[] => [
      { sourceKey: s.key, excerpt: clip(excerpt, 1000), reference },
    ];
    const founded = yearOf(org?.foundingDate);
    if (founded)
      claims.push(
        fact(
          "FACTS",
          `Founded in ${founded}.`,
          ev(String(org?.foundingDate), "JSON-LD Organization.foundingDate"),
          { valueKey: "founded_year", value: founded, temporal: "UNDATED" },
        ),
      );
    const textFound = /\b(?:founded|established|started)\s+(?:in\s+)?((?:1[89]|20)\d{2})\b/i.exec(
      s.page.text,
    );
    if (textFound && textFound[1] !== founded) {
      const start = Math.max(0, textFound.index - 80);
      claims.push(
        fact(
          "FACTS",
          `Founded in ${textFound[1]}.`,
          ev(s.page.text.slice(start, textFound.index + 80), "page text"),
          { valueKey: "founded_year", value: textFound[1]!, temporal: "UNDATED" },
        ),
      );
    }
    const address = org?.address as Record<string, unknown> | undefined;
    const hq =
      address && typeof address === "object"
        ? [address.addressLocality, address.addressCountry]
            .filter((x) => typeof x === "string")
            .join(", ")
        : "";
    if (hq)
      claims.push(
        fact("FACTS", `Headquarters: ${hq}.`, ev(hq, "JSON-LD Organization.address"), {
          valueKey: "headquarters",
          value: hq,
        }),
      );
    const employees = org?.numberOfEmployees as Record<string, unknown> | number | undefined;
    const emp =
      typeof employees === "object" && employees
        ? (employees.value ?? employees.minValue)
        : employees;
    if (emp !== undefined && emp !== null && String(emp).trim())
      claims.push(
        fact(
          "FACTS",
          `Number of employees stated: ${String(emp)}.`,
          ev(String(emp), "JSON-LD Organization.numberOfEmployees"),
          { valueKey: "employee_count", value: String(emp) },
        ),
      );
    const industry = typeof org?.industry === "string" ? org.industry : null;
    if (industry)
      claims.push(
        fact(
          "INDUSTRY",
          `Industry stated: ${industry}.`,
          ev(industry, "JSON-LD Organization.industry"),
          { valueKey: "industry", value: industry },
        ),
      );
  }

  // Recent relevant activity: dated items from newsroom / blog / relevant news.
  const activitySources = sources.filter((s) =>
    ["OFFICIAL_NEWS", "OFFICIAL_BLOG", "PUBLIC_NEWS", "MANUAL"].includes(s.sourceType),
  );
  let activityFound = 0;
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  for (const s of activitySources) {
    const items = s.page.datedItems.length
      ? s.page.datedItems
      : s.page.publishedAt && s.page.title
        ? [{ date: s.page.publishedAt, title: s.page.title }]
        : [];
    for (const item of items.slice(0, 6)) {
      const kind = ACTIVITY_KINDS.find(([, re]) => re.test(item.title))?.[0] ?? "Announcement";
      const current = new Date(item.date) >= cutoff;
      activityFound++;
      claims.push(
        fact(
          "ACTIVITY",
          `${kind} (${item.date}): “${item.title}”${current ? "" : " — older than 12 months"}`,
          [
            {
              sourceKey: s.key,
              excerpt: `${item.date} — ${item.title}`,
              reference: "dated listing item",
            },
          ],
          { temporal: current ? "CURRENT" : "HISTORICAL", value: item.date },
        ),
      );
    }
  }
  const activityChecked = activitySources.length > 0;
  if (activityChecked && activityFound === 0)
    unknowns.push("No relevant recent public activity was found in the available sources.");
  if (!activityChecked) unknowns.push("Newsroom / blog were not checked in this research run.");

  // Signals (INTERPRETATION): themes mentioned in official headings / headlines.
  for (const sig of SIGNALS) {
    const hits: EvidenceRef[] = [];
    for (const s of official) {
      const texts = [
        ...s.page.headings.map((h) => h.text),
        ...s.page.datedItems.map((d) => d.title),
        s.page.description ?? "",
      ];
      for (const t of texts)
        if (t && sig.re.test(t) && hits.length < 3 && !hits.some((h) => h.excerpt === t))
          hits.push({ sourceKey: s.key, excerpt: clip(t, 1000), reference: "heading / headline" });
    }
    if (hits.length >= 2)
      claims.push({
        section: sig.section,
        claim: `Official pages mention ${sig.label} (${hits.length} places shown as evidence).`,
        claimType: "INTERPRETATION",
        verification: "VERIFIED_FROM_SOURCE",
        method: "RULE",
        temporal: "CURRENT",
        evidence: hits,
      });
  }

  if (!claims.some((c) => c.section === "INDUSTRY"))
    unknowns.push("Industry is not stated in the sources.");
  if (!claims.some((c) => c.valueKey === "founded_year"))
    unknowns.push("Founding year was not found in the sources.");
  if (!claims.some((c) => c.section === "PRODUCTS"))
    unknowns.push("No products or services were listed on the fetched official pages.");
  if (!claims.some((c) => c.section === "WHAT_THEY_DO"))
    unknowns.push(`What ${companyName} does could not be confirmed from the available sources.`);
  return { claims: markConflicts(claims), unknowns, activityChecked, activityFound };
}

/**
 * Same valueKey with different values → all versions CONFLICTING (none is deleted or chosen).
 * Identical values from several sources are merged into one claim with all the evidence.
 */
export function markConflicts(claims: DraftClaim[]): DraftClaim[] {
  const byKey = new Map<string, DraftClaim[]>();
  const out: DraftClaim[] = [];
  for (const c of claims) {
    if (!c.valueKey) {
      out.push(c);
      continue;
    }
    byKey.set(c.valueKey, [...(byKey.get(c.valueKey) ?? []), c]);
  }
  for (const group of byKey.values()) {
    const byValue = new Map<string, DraftClaim>();
    for (const c of group) {
      const v = foldText(c.value ?? "");
      const existing = byValue.get(v);
      if (existing) {
        for (const e of c.evidence)
          if (!existing.evidence.some((x) => x.sourceKey === e.sourceKey))
            existing.evidence.push(e);
      } else byValue.set(v, { ...c, evidence: [...c.evidence] });
    }
    const versions = [...byValue.values()];
    if (versions.length > 1)
      for (const v of versions) {
        v.claimType = "CONFLICTING";
        v.verification = "CONFLICTING";
        v.claim = `${v.claim} (sources disagree — ${versions.length} different values)`;
      }
    out.push(...versions);
  }
  return out;
}
