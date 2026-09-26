import { decodeEntities, htmlToText } from "@/modules/jobs/normalize/html";

/**
 * Pure HTML → structured page facts. External HTML is untrusted: it is only READ here
 * (regex extraction of text and metadata); nothing is rendered or executed, and the stored
 * output is plain text. Scripts, styles, iframes and SVG are dropped (except JSON-LD, which is
 * parsed as data).
 */

export interface PageLink {
  href: string;
  text: string;
}
export interface DatedItem {
  date: string; // ISO date (YYYY-MM-DD)
  title: string;
}
export interface ParsedPage {
  title: string | null;
  description: string | null;
  siteName: string | null;
  canonical: string | null;
  headings: { level: number; text: string }[];
  links: PageLink[];
  jsonLd: Record<string, unknown>[];
  text: string;
  publishedAt: string | null;
  modifiedAt: string | null;
  datedItems: DatedItem[];
}

const MAX_TEXT = 20_000;

const clean = (s: string) =>
  decodeEntities(s.replace(/<[^>]+>/g, " "))
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? "").trim() : null;
}

function meta(html: string, keys: string[]): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (
      attr(tag, "property") ??
      attr(tag, "name") ??
      attr(tag, "itemprop") ??
      ""
    ).toLowerCase();
    if (keys.includes(key)) {
      const content = attr(tag, "content");
      if (content) return clean(content).slice(0, 1000);
    }
  }
  return null;
}

export function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value.trim());
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear();
  if (year < 1800 || year > 2100) return null;
  return d.toISOString().slice(0, 10);
}

function flattenJsonLd(value: unknown, out: Record<string, unknown>[], depth = 0) {
  if (depth > 4 || !value) return;
  if (Array.isArray(value)) return value.forEach((v) => flattenJsonLd(v, out, depth + 1));
  if (typeof value !== "object") return;
  const obj = value as Record<string, unknown>;
  if (obj["@graph"]) flattenJsonLd(obj["@graph"], out, depth + 1);
  if (obj["@type"]) out.push(obj);
}

export function parsePage(html: string, baseUrl: string): ParsedPage {
  const input = html.slice(0, 3_000_000);
  const jsonLd: Record<string, unknown>[] = [];
  for (const m of input.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      flattenJsonLd(JSON.parse(m[1]!.trim()), jsonLd);
    } catch {
      // invalid JSON-LD is ignored
    }
  }
  const stripped = input.replace(
    /<(script|style|noscript|iframe|svg|template)\b[\s\S]*?<\/\1>/gi,
    " ",
  );
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(stripped);
  const headings: ParsedPage["headings"] = [];
  for (const m of stripped.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const text = clean(m[2]!);
    if (text && text.length <= 200) headings.push({ level: Number(m[1]), text });
    if (headings.length >= 60) break;
  }
  const links: PageLink[] = [];
  const seen = new Set<string>();
  for (const m of stripped.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(m[1]!, "href");
    if (!href || href.startsWith("#") || /^(javascript|mailto|tel|data):/i.test(href)) continue;
    let abs: string;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    if (!/^https?:/i.test(abs) || seen.has(abs)) continue;
    seen.add(abs);
    links.push({ href: abs, text: clean(m[2]!).slice(0, 150) });
    if (links.length >= 400) break;
  }
  // Dated items: <time datetime> near a heading/link (news & blog listings).
  const datedItems: DatedItem[] = [];
  for (const m of stripped.matchAll(/<(article|li|div)\b[^>]*>([\s\S]{0,3000}?)<\/\1>/gi)) {
    const block = m[2]!;
    const time = /<time\b([^>]*)>([\s\S]*?)<\/time>/i.exec(block);
    if (!time) continue;
    const date = isoDate(attr(time[1]!, "datetime") ?? clean(time[2]!));
    const heading =
      /<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/i.exec(block)?.[1] ??
      /<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(block)?.[1];
    const title = heading ? clean(heading) : "";
    if (date && title && title.length >= 8 && !datedItems.some((d) => d.title === title))
      datedItems.push({ date, title: title.slice(0, 200) });
    if (datedItems.length >= 30) break;
  }
  for (const item of jsonLd) {
    const type = String(item["@type"] ?? "");
    if (/Article|BlogPosting|NewsArticle|PressRelease/i.test(type)) {
      const date = isoDate(item.datePublished);
      const title = typeof item.headline === "string" ? clean(item.headline) : "";
      if (date && title && !datedItems.some((d) => d.title === title))
        datedItems.push({ date, title });
    }
  }
  const canonicalTag = (stripped.match(/<link\b[^>]*>/gi) ?? []).find((t) =>
    /rel\s*=\s*["']?canonical/i.test(t),
  );
  const article = jsonLd.find((j) => /Article|BlogPosting|NewsArticle/i.test(String(j["@type"])));
  return {
    title: titleMatch ? clean(titleMatch[1]!).slice(0, 300) || null : null,
    description:
      meta(stripped, ["description"]) ?? meta(stripped, ["og:description", "twitter:description"]),
    siteName: meta(stripped, ["og:site_name", "application-name"]),
    canonical: canonicalTag ? attr(canonicalTag, "href") : null,
    headings,
    links,
    jsonLd,
    text: htmlToText(stripped.replace(/<(nav|footer|header)\b[\s\S]*?<\/\1>/gi, " "), MAX_TEXT),
    publishedAt:
      isoDate(meta(stripped, ["article:published_time", "datepublished", "date"])) ??
      isoDate(article?.datePublished),
    modifiedAt:
      isoDate(meta(stripped, ["article:modified_time", "datemodified"])) ??
      isoDate(article?.dateModified),
    datedItems: datedItems.sort((a, b) => b.date.localeCompare(a.date)),
  };
}

/** Normalize a URL for deduplication: lower-case host, no fragment, no tracking params, no trailing slash. */
export function normalizeUrl(input: string): string {
  const url = new URL(input);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  for (const key of [...url.searchParams.keys()])
    if (/^(utm_|gclid|fbclid|mc_|ref$|source$)/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  let s = url.toString();
  if (url.pathname !== "/" && s.endsWith("/")) s = s.slice(0, -1);
  return s.replace(/^http:\/\//, "https://");
}

/** Registrable-ish domain ("www.acme.co.uk" → "acme.co.uk") for same-site checks. */
export function siteDomain(host: string): string {
  const parts = host
    .toLowerCase()
    .replace(/^www\./, "")
    .split(".");
  const twoLevel =
    /^(co|com|org|net|gov|ac|edu)$/.test(parts[parts.length - 2] ?? "") && parts.length > 2;
  return parts.slice(twoLevel ? -3 : -2).join(".");
}
