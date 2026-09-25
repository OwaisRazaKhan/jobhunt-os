import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = ["/candidate", "/jobs", "/settings", "/welcome"];
const REQUEST_ID_HEADER = "x-request-id";

/**
 * Optimistic gate only: a missing session cookie redirects to sign-in early. Real authorization happens in
 * services (every call is scoped to the verified session's user).
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(getSessionCookie(request, { cookiePrefix: "jhos" }));

  if (!hasSession && PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = "";
    return NextResponse.redirect(url);
  }
  // Signed-in users are sent away from /sign-in and /sign-up by those pages themselves, after
  // validating the session. Doing it here on cookie presence alone loops forever when the
  // cookie is stale (expired session, rotated secret, different database).

  const requestHeaders = new Headers(request.headers);
  const requestId = requestHeaders.get(REQUEST_ID_HEADER) ?? crypto.randomUUID();
  requestHeaders.set(REQUEST_ID_HEADER, requestId);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export const config = {
  // API routes authenticate themselves (and uploads must not be buffered by the proxy).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
