/**
 * Deterministic location normalisation. Uses the job's own location text and
 * any explicit country/region supplied by the source. Never guesses from a
 * company's headquarters; ambiguous input stays unknown.
 */

export interface LocationHints {
  /** Explicit ISO country code from the source (e.g. Lever `country`). */
  countryCode?: string | null;
  /** Explicit country name from the source (e.g. Ashby addressCountry). */
  countryName?: string | null;
  region?: string | null;
  city?: string | null;
}

export interface NormalizedLocation {
  city: string | null;
  region: string | null;
  countryCode: string | null;
  /** Location text literally says remote / hybrid (explicit wording only). */
  remoteWord: "REMOTE" | "HYBRID" | null;
}

const US_STATES: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  DC: "District of Columbia",
};
const CA_PROVINCES: Record<string, string> = {
  AB: "Alberta",
  BC: "British Columbia",
  MB: "Manitoba",
  NB: "New Brunswick",
  NL: "Newfoundland and Labrador",
  NS: "Nova Scotia",
  NT: "Northwest Territories",
  NU: "Nunavut",
  ON: "Ontario",
  PE: "Prince Edward Island",
  QC: "Quebec",
  SK: "Saskatchewan",
  YT: "Yukon",
};

const ALIASES: Record<string, string> = {
  usa: "US",
  "u.s.": "US",
  "u.s.a.": "US",
  "united states of america": "US",
  america: "US",
  uk: "GB",
  "u.k.": "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  "great britain": "GB",
  britain: "GB",
  uae: "AE",
  "u.a.e.": "AE",
  emirates: "AE",
  "united arab emirates": "AE",
  ksa: "SA",
  "saudi arabia": "SA",
  "kingdom of saudi arabia": "SA",
  deutschland: "DE",
  holland: "NL",
  "the netherlands": "NL",
  czechia: "CZ",
  "czech republic": "CZ",
  türkiye: "TR",
  turkey: "TR",
  "south korea": "KR",
  korea: "KR",
  "hong kong": "HK",
};

/** Well-known cities that unambiguously identify a country (only used when the text has no country). */
const CITY_COUNTRY: Record<string, string> = {
  dubai: "AE",
  "abu dhabi": "AE",
  doha: "QA",
  riyadh: "SA",
  jeddah: "SA",
  berlin: "DE",
  munich: "DE",
  hamburg: "DE",
  amsterdam: "NL",
  rotterdam: "NL",
  paris: "FR",
  dublin: "IE",
  stockholm: "SE",
  copenhagen: "DK",
  helsinki: "FI",
  brussels: "BE",
  vienna: "AT",
  lisbon: "PT",
  madrid: "ES",
  barcelona: "ES",
  warsaw: "PL",
  prague: "CZ",
  tallinn: "EE",
  toronto: "CA",
  vancouver: "CA",
  montreal: "CA",
  "new york city": "US",
  "san francisco": "US",
  "new york": "US",
  london: "GB",
  zurich: "CH",
  singapore: "SG",
};

const SPECIAL_CODES = new Set([
  "EU",
  "EZ",
  "UN",
  "QO",
  "XA",
  "XB",
  "ZZ",
  "AC",
  "CP",
  "DG",
  "EA",
  "IC",
  "TA",
  "XK",
  "AN",
  "BU",
  "CS",
  "DD",
  "FX",
  "SU",
  "TP",
  "UK",
  "YD",
  "YU",
  "ZR",
  "DY",
  "HV",
  "NH",
  "VD",
  "RH",
  "NT",
  "QU",
]);

let nameIndex: Map<string, string> | undefined;
let isoCodes: Set<string> | undefined;

function countryIndex(): { names: Map<string, string>; codes: Set<string> } {
  if (!nameIndex || !isoCodes) {
    nameIndex = new Map();
    isoCodes = new Set();
    const dn = new Intl.DisplayNames(["en"], { type: "region" });
    for (let a = 65; a < 91; a++) {
      for (let b = 65; b < 91; b++) {
        const code = String.fromCharCode(a, b);
        if (SPECIAL_CODES.has(code)) continue;
        let name: string | undefined;
        try {
          name = dn.of(code);
        } catch {
          continue;
        }
        if (!name || name === code || /^unknown/i.test(name)) continue;
        isoCodes.add(code);
        nameIndex.set(name.toLowerCase(), code);
        nameIndex.set(name.toLowerCase().replace(/&/g, "and"), code);
      }
    }
    for (const [alias, code] of Object.entries(ALIASES)) nameIndex.set(alias, code);
  }
  return { names: nameIndex, codes: isoCodes };
}

export function countryCodeForName(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.]$/, "");
  if (!v) return null;
  const { names, codes } = countryIndex();
  if (names.has(v)) return names.get(v)!;
  const upper = value.trim().toUpperCase();
  return upper.length === 2 && codes.has(upper) ? upper : null;
}

function remoteWordOf(text: string): "REMOTE" | "HYBRID" | null {
  if (/\bhybrid\b/i.test(text)) return "HYBRID";
  if (/\b(remote|anywhere|work from home|wfh)\b/i.test(text)) return "REMOTE";
  return null;
}

export function normalizeLocation(
  raw: string | null | undefined,
  hints: LocationHints = {},
): NormalizedLocation {
  const text = (raw ?? "").trim();
  const remoteWord = remoteWordOf(text);
  const { codes } = countryIndex();
  let countryCode =
    hints.countryCode && codes.has(hints.countryCode.toUpperCase())
      ? hints.countryCode.toUpperCase()
      : null;
  countryCode ??= countryCodeForName(hints.countryName);
  let region = hints.region?.trim() || null;
  let city = hints.city?.trim() || null;

  // Use only the primary location when several are listed.
  const primary = text.split(/\s*(?:;|\/|\||\bor\b|\n)\s*/i)[0] ?? "";
  const cleaned = primary
    .replace(/\((?:[^)]*)\)/g, " ")
    .replace(/\b(remote|hybrid|on[- ]?site|anywhere|work from home|wfh|office)\b/gi, " ")
    .replace(/^[\s,–—-]+|[\s,–—-]+$/g, "")
    .trim();
  const parts = cleaned
    .split(/\s*[,–—]\s*|\s+-\s+/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length > 0) {
    const last = parts[parts.length - 1]!;
    const lastUpper = last.toUpperCase();
    const named = countryCodeForName(last);
    if (named && !(last.length === 2 && (US_STATES[lastUpper] || CA_PROVINCES[lastUpper]))) {
      countryCode ??= named;
      parts.pop();
    } else if (last.length === 2 && US_STATES[lastUpper] && !codes.has(lastUpper)) {
      countryCode ??= "US";
      region ??= US_STATES[lastUpper]!;
      parts.pop();
    } else if (last.length === 2 && CA_PROVINCES[lastUpper] && !codes.has(lastUpper)) {
      countryCode ??= "CA";
      region ??= CA_PROVINCES[lastUpper]!;
      parts.pop();
    } else if (
      last.length === 2 &&
      (US_STATES[lastUpper] || CA_PROVINCES[lastUpper]) &&
      parts.length >= 2
    ) {
      // Ambiguous two-letter token (e.g. "IN" = Indiana or India). Only trust it with a matching explicit hint.
      if (countryCode === "US" && US_STATES[lastUpper]) region ??= US_STATES[lastUpper]!;
      else if (countryCode === "CA" && CA_PROVINCES[lastUpper]) region ??= CA_PROVINCES[lastUpper]!;
      parts.pop();
    }
    const lowerFirst = parts[0]?.toLowerCase();
    if (!countryCode && lowerFirst && CITY_COUNTRY[lowerFirst] && parts.length === 1)
      countryCode = CITY_COUNTRY[lowerFirst]!;
    if (!city && parts.length >= 1 && !countryCodeForName(parts[0])) city = parts[0]!;
    if (!region && parts.length >= 2) region = parts[1]!;
  }
  // A "city" that is really a region/continent word is not a city.
  if (
    city &&
    /^(europe|emea|apac|latam|americas|north america|european union|worldwide|global|international)$/i.test(
      city,
    )
  )
    city = null;
  return { city, region, countryCode, remoteWord };
}
