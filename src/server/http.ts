import "server-only";
import { NextResponse } from "next/server";
import { toAppError, toErrorResponseBody } from "./errors";
import { logger, type Logger } from "./logger";

export const REQUEST_ID_HEADER = "x-request-id";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/** Reuse a well-formed inbound request id (e.g. from a proxy), otherwise mint one. */
export function resolveRequestId(request: Request): string {
  const inbound = request.headers.get(REQUEST_ID_HEADER);
  return inbound && REQUEST_ID_PATTERN.test(inbound) ? inbound : crypto.randomUUID();
}

export interface RouteContext<TParams> {
  requestId: string;
  log: Logger;
  params: TParams;
}

/**
 * Wraps every Route Handler: request id propagation, uniform error envelope,
 * and a single log line for failures. Handlers stay thin and call services.
 */
export function route<TParams = Record<string, never>>(
  handler: (request: Request, context: RouteContext<TParams>) => Promise<Response>,
) {
  return async (request: Request, segment: { params: Promise<TParams> }): Promise<Response> => {
    const requestId = resolveRequestId(request);
    const log = logger.child({
      requestId,
      method: request.method,
      path: new URL(request.url).pathname,
    });

    try {
      const response = await handler(request, { requestId, log, params: await segment.params });
      response.headers.set(REQUEST_ID_HEADER, requestId);
      return response;
    } catch (thrown) {
      const error = toAppError(thrown);
      const level = error.status >= 500 ? "error" : "warn";
      // Client errors are expected: log code only. Server errors include the (redacted) error.
      log[level]("request failed", {
        code: error.code,
        status: error.status,
        ...(error.status >= 500 ? { error: thrown } : {}),
      });
      return NextResponse.json(toErrorResponseBody(error, requestId), {
        status: error.status,
        headers: { [REQUEST_ID_HEADER]: requestId },
      });
    }
  };
}
