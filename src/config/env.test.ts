import { describe, expect, it } from "vitest";
import { parseServerEnv } from "./env";

describe("parseServerEnv", () => {
  it("applies safe, free-first defaults for an empty environment", () => {
    const env = parseServerEnv({});
    expect(env.APP_ENV).toBe("development");
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.OLLAMA_BASE_URL).toBe("http://127.0.0.1:11434");
    expect(env.AI_ENABLED).toBe(true);
    expect(env.SUPABASE_STORAGE_BUCKET).toBe("candidate-documents");
  });

  it("treats empty strings as unset", () => {
    expect(
      parseServerEnv({ SUPABASE_SERVICE_ROLE_KEY: "" }).SUPABASE_SERVICE_ROLE_KEY,
    ).toBeUndefined();
  });

  it("reports invalid keys without echoing their values", () => {
    expect(() => parseServerEnv({ NEXT_PUBLIC_APP_URL: "not-a-url-secret-value" })).toThrow(
      /NEXT_PUBLIC_APP_URL/,
    );
    expect(() => parseServerEnv({ NEXT_PUBLIC_APP_URL: "not-a-url-secret-value" })).not.toThrow(
      /secret-value/,
    );
  });

  it("rejects a short BETTER_AUTH_SECRET", () => {
    expect(() => parseServerEnv({ BETTER_AUTH_SECRET: "short" })).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("parses AI_ENABLED as a boolean", () => {
    expect(parseServerEnv({ AI_ENABLED: "false" }).AI_ENABLED).toBe(false);
  });
});
