import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError, toAppError, toErrorResponseBody } from "./errors";

describe("AppError", () => {
  it("maps codes to HTTP status and safe public messages", () => {
    const error = new AppError("PERMISSION_ERROR", { message: "user 42 lacks job 7" });
    expect(error.status).toBe(403);
    expect(error.publicMessage).not.toContain("42");
    expect(error.message).toBe("user 42 lacks job 7");
  });
});

describe("toAppError", () => {
  it("converts Zod errors into VALIDATION_ERROR with field details", () => {
    const result = z.object({ email: z.email() }).safeParse({ email: "nope" });
    expect(result.success).toBe(false);
    const error = toAppError(result.error);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.details?.[0]?.path).toBe("email");
  });

  it("hides unknown error internals behind UNKNOWN_ERROR", () => {
    const error = toAppError(new Error("connection string postgres://secret@host"));
    expect(error.code).toBe("UNKNOWN_ERROR");
    const body = toErrorResponseBody(error, "req_12345678");
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(body.error.requestId).toBe("req_12345678");
  });

  it("passes AppError through unchanged", () => {
    const original = new AppError("CONFLICT");
    expect(toAppError(original)).toBe(original);
  });
});
