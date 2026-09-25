import { describe, expect, it } from "vitest";
import { redact } from "./logger";

describe("redact", () => {
  it("masks sensitive keys at any depth", () => {
    const output = redact({
      userId: "u1",
      headers: { authorization: "Bearer abc", cookie: "sid=1" },
      provider: { apiKey: "sk-123", accessToken: "t" },
      items: [{ password: "p" }],
    });
    expect(output).toEqual({
      userId: "u1",
      headers: { authorization: "[REDACTED]", cookie: "[REDACTED]" },
      provider: { apiKey: "[REDACTED]", accessToken: "[REDACTED]" },
      items: [{ password: "[REDACTED]" }],
    });
  });
});
