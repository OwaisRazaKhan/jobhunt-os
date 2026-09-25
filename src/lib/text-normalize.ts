/**
 * Deterministic text normalisation shared by modules (client-safe).
 */

// Legal-form suffixes, removed only at the END of a name ("Acme GmbH" -> "Acme").
// Words like "Company" are kept: "The Coffee Company" must not merge with "The Coffee".
const TRAILING_LEGAL_SUFFIX =
  /[\s,]+(ltd|limited|llc|l\.l\.c|inc|incorporated|gmbh|ag|kg|ug|bv|b\.v|nv|pvt|plc|co|corp|corporation|sa|s\.a|sarl|srl|spa|oy|ab|as|aps|pty|llp|lp)\.?$/i;

/** "Lead Zing" == "LeadZing" == "leadzing"; keeps # and + so C#, C++ stay distinct. */
export function normalizeKey(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9#+]/g, "");
}

/** Organisation identity: trailing legal suffixes removed, then normalizeKey. "Acme GmbH" == "ACME". */
export function normalizeOrganization(value: string | null | undefined): string {
  if (!value) return "";
  let name = value.trim();
  // Strip stacked suffixes too ("Acme Pvt. Ltd.").
  for (let i = 0; i < 3 && TRAILING_LEGAL_SUFFIX.test(name); i++) {
    name = name.replace(TRAILING_LEGAL_SUFFIX, "");
  }
  const stripped = normalizeKey(name);
  // A name that is only a legal suffix ("Co.") keeps its raw key rather than becoming empty.
  return stripped || normalizeKey(value);
}

/** Human-readable normalised title: collapsed whitespace, lower case, gender markers removed. */
export function normalizeTitle(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\((?:m|w|f|d|x|h)(?:\s*\/\s*(?:m|w|f|d|x|h))+\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
