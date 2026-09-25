/**
 * HTML -> plain text for job descriptions (pure, dependency-free).
 * The result is stored and rendered as TEXT (React escapes it), so no HTML
 * from a provider is ever executed. Raw HTML is kept in the posting's raw payload.
 */

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  bull: "•",
  middot: "·",
  euro: "€",
  pound: "£",
  copy: "©",
  reg: "®",
  trade: "™",
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1]?.toLowerCase() === "x"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED[entity.toLowerCase()] ?? match;
  });
}

export function htmlToText(html: string, maxLength = 50_000): string {
  let s = html;
  // Greenhouse returns HTML-escaped HTML: decode once first if it looks escaped.
  if (/&lt;\/?[a-z]/i.test(s) && !/<[a-z]/i.test(s)) s = decodeEntities(s);
  s = s
    .replace(/<(script|style|noscript|iframe|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/li>/gi, "")
    .replace(/<\/(p|div|h[1-6]|ul|ol|section|article|tr|table|blockquote)>/gi, "\n")
    .replace(/<(p|div|h[1-6]|ul|ol|section|article|tr|table|blockquote)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  s = decodeEntities(s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s.length > maxLength ? `${s.slice(0, maxLength - 1)}…` : s;
}
