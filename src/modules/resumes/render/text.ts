/**
 * Text safety for renderers. The PDF standard fonts support the WinAnsi (Latin-1 + a few
 * typographic) character set only; other characters are transliterated when possible and
 * otherwise replaced with "?" — the Resume Check reports such characters before export.
 */

const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
const REPLACEMENTS: Record<string, string> = {
  "‐": "-", // hyphen
  "‑": "-", // non-breaking hyphen
  "‒": "-", // figure dash
  "−": "-", // minus sign
  "′": "'", // prime
  "″": '"', // double prime
  " ": " ", // no-break space
  " ": " ", // thin space
  "​": "", // zero-width space
  "→": "->",
  "←": "<-",
  "✓": "+",
  "✔": "+",
  "₹": "INR ", // rupee sign
};

export function isWinAnsiChar(ch: string): boolean {
  const code = ch.codePointAt(0)!;
  return (
    (code >= 0x20 && code <= 0x7e) ||
    (code >= 0xa0 && code <= 0xff) ||
    WIN_ANSI_EXTRA.has(ch) ||
    ch === "\n" ||
    ch === "\t"
  );
}

export function toWinAnsi(input: string): string {
  let out = "";
  for (const ch of input) {
    if (isWinAnsiChar(ch)) out += ch;
    else if (ch in REPLACEMENTS) out += REPLACEMENTS[ch];
    else {
      const folded = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
      out += [...folded].every(isWinAnsiChar) && folded ? folded : "?";
    }
  }
  return out;
}

/** Characters the PDF fonts cannot print even after transliteration. */
export function unsupportedCharacters(input: string): string[] {
  const bad = new Set<string>();
  for (const ch of input) {
    if (isWinAnsiChar(ch) || ch in REPLACEMENTS) continue;
    const folded = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
    if (!folded || ![...folded].every(isWinAnsiChar)) bad.add(ch);
  }
  return [...bad];
}
