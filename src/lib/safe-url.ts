/**
 * Public-URL safety checks (client-safe, synchronous).
 *
 * Accepts only absolute http(s) URLs pointing at a public-looking hostname.
 * Rejects: other protocols (javascript:, file:, ftp:, data:…), embedded
 * credentials, localhost / *.local / *.internal names, IP-literal hosts
 * (private, loopback, link-local, cloud metadata — all IP literals are refused),
 * single-label hostnames and oversized values.
 *
 * Fetchers (later checkpoints) must ALSO resolve DNS and re-check the resolved
 * address before connecting; this function does not touch the network.
 */

export const MAX_URL_LENGTH = 2048;

const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".lan",
  ".home",
  ".corp",
  ".localdomain",
];
const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal", "metadata"]);

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

export function checkPublicHttpUrl(input: string): UrlCheck {
  const value = input.trim();
  if (!value) return { ok: false, reason: "Enter a URL" };
  if (value.length > MAX_URL_LENGTH)
    return { ok: false, reason: `URL is longer than ${MAX_URL_LENGTH} characters` };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "Enter a full URL starting with https:// or http://" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "Only http:// and https:// links are allowed" };
  }
  if (url.username || url.password)
    return { ok: false, reason: "Links must not contain a username or password" };
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return { ok: false, reason: "The link has no host name" };
  // IPv6 literals appear bracketed; IPv4 literals are four numeric labels.
  if (
    host.startsWith("[") ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
    /^\d+$/.test(host) ||
    /^0x[0-9a-f]+$/i.test(host)
  ) {
    return {
      ok: false,
      reason: "Links to IP addresses are not allowed — use the site's domain name",
    };
  }
  if (BLOCKED_HOSTS.has(host) || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, reason: "Links to local or internal hosts are not allowed" };
  }
  if (!host.includes("."))
    return { ok: false, reason: "Enter a public web address (e.g. company.com)" };
  return { ok: true, url };
}

export function isPublicHttpUrl(input: string): boolean {
  return checkPublicHttpUrl(input).ok;
}
