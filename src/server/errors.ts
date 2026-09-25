import { ZodError } from "zod";

/**
 * Standard error taxonomy (docs/architecture.md#error-architecture).
 * `publicMessage` is safe to show users; internal detail goes to logs only.
 */
export const ERROR_DEFINITIONS = {
  VALIDATION_ERROR: { status: 400, publicMessage: "Some of the submitted data is invalid." },
  AUTH_ERROR: { status: 401, publicMessage: "You need to sign in to continue." },
  PERMISSION_ERROR: { status: 403, publicMessage: "You don't have access to this resource." },
  NOT_FOUND: { status: 404, publicMessage: "The requested resource was not found." },
  CONFLICT: { status: 409, publicMessage: "This change conflicts with the current state." },
  RATE_LIMIT_ERROR: { status: 429, publicMessage: "Too many requests. Please try again shortly." },
  DATABASE_ERROR: { status: 500, publicMessage: "A storage error occurred. Please try again." },
  AI_ERROR: { status: 502, publicMessage: "The AI service could not complete this request." },
  INTEGRATION_ERROR: { status: 502, publicMessage: "A connected service returned an error." },
  EXTERNAL_SERVICE_ERROR: { status: 503, publicMessage: "An external service is unavailable." },
  WORKFLOW_ERROR: { status: 500, publicMessage: "The workflow could not be completed." },
  UNKNOWN_ERROR: { status: 500, publicMessage: "Something went wrong. Please try again." },
} as const satisfies Record<string, { status: number; publicMessage: string }>;

export type ErrorCode = keyof typeof ERROR_DEFINITIONS;

export interface ErrorDetail {
  path?: string;
  message: string;
}

interface AppErrorOptions {
  /** Internal message for logs. Defaults to the public message. */
  message?: string;
  /** Override the default user-facing message. Must not contain internals. */
  publicMessage?: string;
  /** Field-level details safe to return to the client. */
  details?: ErrorDetail[];
  /** Whether a retry may succeed (used by workflow and AI retry policies). */
  retryable?: boolean;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly publicMessage: string;
  readonly details: ErrorDetail[] | undefined;
  readonly retryable: boolean;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    const definition = ERROR_DEFINITIONS[code];
    super(options.message ?? definition.publicMessage, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = definition.status;
    this.publicMessage = options.publicMessage ?? definition.publicMessage;
    this.details = options.details;
    this.retryable = options.retryable ?? false;
  }
}

/** Normalise anything thrown into an AppError without leaking internals. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ZodError) {
    return new AppError("VALIDATION_ERROR", {
      cause: error,
      details: error.issues.map((issue) => ({
        path: issue.path.join(".") || undefined,
        message: issue.message,
      })),
    });
  }
  return new AppError("UNKNOWN_ERROR", {
    message: error instanceof Error ? error.message : String(error),
    cause: error,
  });
}

export interface ErrorResponseBody {
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
    details?: ErrorDetail[];
  };
}

export function toErrorResponseBody(error: AppError, requestId: string): ErrorResponseBody {
  return {
    error: {
      code: error.code,
      message: error.publicMessage,
      requestId,
      ...(error.details ? { details: error.details } : {}),
    },
  };
}
