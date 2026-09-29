/**
 * Application channel detection (pure). Evidence order, strongest first:
 *   1. the job came from an ATS's own public API (source key) → that ATS, verified
 *   2. an apply URL on a recognised ATS host → that ATS (medium confidence)
 *   3. an application email actually written in the official posting / official page, with an
 *      explicit "apply / send your CV" instruction around it → EMAIL (verified from that source)
 *   4. a generic apply URL → APPLICATION_FORM / EXTERNAL_PORTAL (unverified)
 *   5. nothing usable → MANUAL_APPLICATION
 * Emails are never guessed from naming patterns (hr@, jobs@ …) — only addresses found in text.
 */
import type { AtsProvider, ChannelType } from "./types";

export function providerFromUrl(url: string | null | undefined): AtsProvider {
  if (!url) return "NONE";
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "NONE";
  }
  if (
    host === "boards.greenhouse.io" ||
    host === "job-boards.greenhouse.io" ||
    host.endsWith(".greenhouse.io")
  )
    return "GREENHOUSE";
  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") return "LEVER";
  if (host === "jobs.ashbyhq.com") return "ASHBY";
  return "OTHER";
}

export function providerFromSourceKey(sourceKey: string | null | undefined): AtsProvider {
  return sourceKey === "GREENHOUSE" || sourceKey === "LEVER" || sourceKey === "ASHBY"
    ? sourceKey
    : "NONE";
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** Explicit application instructions around an address. */
const APPLY_CONTEXT =
  /\b(to apply|apply (by|via|through|at|to)|applications? (should be )?(sent |submitted |emailed )?(to|at)|send (your |us |in )?(a |an |your )?(cv|resume|résumé|application|portfolio|cover letter)|submit (your )?(cv|resume|résumé|application)|email (your |us )?(cv|resume|résumé|application|portfolio)|e-?mail (it|them) to)\b/i;
/** Addresses that are clearly not an application route even if nearby text says "apply". */
const NOT_APPLICATION =
  /\b(privacy|data protection|gdpr|accommodation|accessibility|unsubscribe|fraud|scam|security|press|media|support|billing|legal)\b/i;
const NON_ROUTING_LOCAL = /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster)$/i;

export interface FoundEmail {
  email: string;
  kind: "APPLICATION" | "OTHER";
  excerpt: string;
}

/** Sentences of a text (keeps short surrounding context for evidence). */
function sentencesAround(text: string, index: number): string {
  const start = Math.max(
    0,
    text.lastIndexOf("\n", index - 1) + 1,
    Math.max(text.lastIndexOf(". ", index - 1) + 2, index - 220),
  );
  const endCandidates = [text.indexOf("\n", index), text.indexOf(". ", index)].filter(
    (i) => i >= 0,
  );
  const end = endCandidates.length
    ? Math.min(...endCandidates, index + 220)
    : Math.min(text.length, index + 220);
  return text
    .slice(start, end + 1)
    .replace(/\s+/g, " ")
    .trim();
}

export function extractEmails(text: string | null | undefined): FoundEmail[] {
  if (!text) return [];
  const plain = text
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#64;|&commat;/g, "@");
  const out = new Map<string, FoundEmail>();
  for (const m of plain.matchAll(EMAIL)) {
    const email = m[0].replace(/\.+$/, "").toLowerCase();
    const local = email.split("@")[0]!;
    if (NON_ROUTING_LOCAL.test(local) || /\.(png|jpe?g|gif|svg|webp)$/i.test(email)) continue;
    const excerpt = sentencesAround(plain, m.index ?? 0).slice(0, 400);
    const kind: FoundEmail["kind"] =
      APPLY_CONTEXT.test(excerpt) && !NOT_APPLICATION.test(excerpt) ? "APPLICATION" : "OTHER";
    const prev = out.get(email);
    if (!prev || (prev.kind === "OTHER" && kind === "APPLICATION"))
      out.set(email, { email, kind, excerpt });
  }
  return [...out.values()];
}

export interface ChannelCandidate {
  channelType: ChannelType;
  provider: AtsProvider;
  url: string | null;
  email: string | null;
  source:
    | "JOB_RECORD"
    | "JOB_POST"
    | "ATS_API"
    | "OFFICIAL_CAREERS_PAGE"
    | "OFFICIAL_COMPANY_PAGE"
    | "USER_PROVIDED"
    | "UNKNOWN";
  sourceUrl: string | null;
  verificationStatus: "SOURCE_VERIFIED" | "UNVERIFIED" | "INFERRED";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  evidenceExcerpt: string | null;
  /** Lower = preferred as primary */
  rank: number;
}

export interface JobChannelInput {
  sourceKey: string | null;
  jobUrl: string | null;
  applicationUrl: string | null;
  description: string | null;
  officialPages: { url: string; sourceType: string; text: string | null }[];
  userProvided?: { url?: string | null; email?: string | null } | null;
}

const isHttp = (u: string | null | undefined): u is string => {
  if (!u) return false;
  try {
    return /^https?:$/.test(new URL(u).protocol);
  } catch {
    return false;
  }
};

/** All plausible channels with provenance, ranked (the company's stated mechanism first). */
export function detectChannels(input: JobChannelInput): ChannelCandidate[] {
  const out: ChannelCandidate[] = [];
  const apiProvider = providerFromSourceKey(input.sourceKey);
  const applyUrl = isHttp(input.applicationUrl) ? input.applicationUrl : null;
  const jobUrl = isHttp(input.jobUrl) ? input.jobUrl : null;

  if (apiProvider !== "NONE") {
    // The posting came from this ATS's public API; the apply URL (or the hosted posting, which carries
    // the form for Greenhouse) is the company's own application mechanism.
    const url = applyUrl ?? jobUrl;
    if (url)
      out.push({
        channelType: "ATS",
        provider: apiProvider,
        url,
        email: null,
        source: "ATS_API",
        sourceUrl: jobUrl ?? url,
        verificationStatus: "SOURCE_VERIFIED",
        confidence: "HIGH",
        evidenceExcerpt: `Listed through the ${apiProvider.toLowerCase()} public job board API.`,
        rank: 0,
      });
  } else if (applyUrl || jobUrl) {
    const url = applyUrl ?? jobUrl!;
    const provider = providerFromUrl(url);
    out.push(
      provider === "OTHER" || provider === "NONE"
        ? {
            channelType: applyUrl ? "APPLICATION_FORM" : "EXTERNAL_PORTAL",
            provider: "OTHER",
            url,
            email: null,
            source: "JOB_RECORD",
            sourceUrl: jobUrl ?? url,
            verificationStatus: "UNVERIFIED",
            confidence: "LOW",
            evidenceExcerpt:
              "Application link from the job record; the form type is confirmed on inspection.",
            rank: 3,
          }
        : {
            channelType: "ATS",
            provider,
            url,
            email: null,
            source: "JOB_RECORD",
            sourceUrl: jobUrl ?? url,
            verificationStatus: "UNVERIFIED",
            confidence: "MEDIUM",
            evidenceExcerpt: `Link on a ${provider.toLowerCase()} host (recognised from the URL).`,
            rank: 1,
          },
    );
  }

  for (const found of extractEmails(input.description))
    if (found.kind === "APPLICATION")
      out.push({
        channelType: "EMAIL_APPLICATION",
        provider: "NONE",
        url: null,
        email: found.email,
        source: "JOB_POST",
        sourceUrl: jobUrl,
        verificationStatus: jobUrl ? "SOURCE_VERIFIED" : "UNVERIFIED",
        confidence: "HIGH",
        evidenceExcerpt: found.excerpt,
        rank: 2,
      });

  for (const page of input.officialPages)
    for (const found of extractEmails(page.text))
      if (found.kind === "APPLICATION" && !out.some((c) => c.email === found.email))
        out.push({
          channelType: "EMAIL_APPLICATION",
          provider: "NONE",
          url: null,
          email: found.email,
          source:
            page.sourceType === "OFFICIAL_CAREERS"
              ? "OFFICIAL_CAREERS_PAGE"
              : "OFFICIAL_COMPANY_PAGE",
          sourceUrl: page.url,
          verificationStatus: "SOURCE_VERIFIED",
          confidence: "MEDIUM",
          evidenceExcerpt: found.excerpt,
          rank: 4,
        });

  if (input.userProvided?.url && isHttp(input.userProvided.url)) {
    const provider = providerFromUrl(input.userProvided.url);
    out.push({
      channelType: provider === "OTHER" ? "APPLICATION_FORM" : "ATS",
      provider,
      url: input.userProvided.url,
      email: null,
      source: "USER_PROVIDED",
      sourceUrl: null,
      verificationStatus: "UNVERIFIED",
      confidence: "MEDIUM",
      evidenceExcerpt: "Provided by you.",
      rank: 1,
    });
  }
  if (input.userProvided?.email)
    out.push({
      channelType: "EMAIL_APPLICATION",
      provider: "NONE",
      url: null,
      email: input.userProvided.email.toLowerCase(),
      source: "USER_PROVIDED",
      sourceUrl: null,
      verificationStatus: "UNVERIFIED",
      confidence: "MEDIUM",
      evidenceExcerpt: "Provided by you.",
      rank: 2,
    });

  if (!out.length)
    out.push({
      channelType: "MANUAL_APPLICATION",
      provider: "NONE",
      url: null,
      email: null,
      source: "UNKNOWN",
      sourceUrl: null,
      verificationStatus: "UNVERIFIED",
      confidence: "LOW",
      evidenceExcerpt: "No application link or published application email was found.",
      rank: 9,
    });
  return out.sort((a, b) => a.rank - b.rank);
}
