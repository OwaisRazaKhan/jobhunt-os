import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = ["/candidate", "/jobs", "/settings", "/welcome"];
const AUTH_PAGES = ["/sign-in", "/sign-up"];
const REQUEST_ID_HEADER = "x-request-id";

/**
 * Optimistic gate only: checks for the presence of a session cookie so
 * unauthenticated users are redirected early. Real authorization happens in
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
  if (hasSession && AUTH_PAGES.includes(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/candidate";
    return NextResponse.redirect(url);
  }

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
