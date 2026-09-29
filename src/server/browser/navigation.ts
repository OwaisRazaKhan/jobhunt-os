import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isPrivateAddress } from "@/modules/research/fetch/ip";

/**
 * Navigation safety for the application browser (SSRF / browser-pivot protection).
 * Allowed: public http(s) URLs on default ports whose host resolves only to public addresses.
 * Refused: localhost, private/reserved IPs (literal or via DNS), file:, data:, javascript:, other
 * schemes and non-default ports — except explicitly trusted origins (the local test fixture).
 */

export interface NavigationPolicy {
  /** Exact origins allowed even if private (e.g. the controlled fixture "http://127.0.0.1:4010") */
  trustedOrigins?: string[];
}

export type NavigationCheck = { ok: true; url: URL } | { ok: false; reason: string };

const PRIVATE_HOSTNAMES =
  /^(localhost|localhost\.localdomain|ip6-localhost|.*\.local|.*\.internal|.*\.localhost)$/i;

export function checkUrlSyntax(input: string, policy: NavigationPolicy = {}): NavigationCheck {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: "Not a valid URL." };
  }
  if (policy.trustedOrigins?.includes(url.origin)) return { ok: true, url };
  if (url.protocol !== "https:" && url.protocol !== "http:")
    return { ok: false, reason: `The ${url.protocol} scheme is not allowed.` };
  if (url.username || url.password)
    return { ok: false, reason: "URLs with embedded credentials are not allowed." };
  if (url.port && !["80", "443"].includes(url.port))
    return { ok: false, reason: "Only default web ports are allowed." };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (PRIVATE_HOSTNAMES.test(host))
    return { ok: false, reason: "Local and internal hosts are not allowed." };
  if (isIP(host) && isPrivateAddress(host))
    return { ok: false, reason: "Private and reserved addresses are not allowed." };
  return { ok: true, url };
}

/** Full check including DNS: every resolved address must be public. */
export async function checkNavigationTarget(
  input: string,
  policy: NavigationPolicy = {},
): Promise<NavigationCheck> {
  const syntax = checkUrlSyntax(input, policy);
  if (!syntax.ok) return syntax;
  if (policy.trustedOrigins?.includes(syntax.url.origin)) return syntax;
  const host = syntax.url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return syntax;
  try {
    const addresses = await lookup(host, { all: true });
    if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address)))
      return { ok: false, reason: `${host} resolves to a private or reserved address.` };
  } catch {
    return { ok: false, reason: `${host} could not be resolved.` };
  }
  return syntax;
}
