import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Synthetic, test-only configuration. No real secrets.
    env: {
      APP_ENV: "development",
      NODE_ENV: "test",
      LOG_LEVEL: "error",
      AI_ENABLED: "false",
      ENCRYPTION_KEY: "dGVzdC1vbmx5LWtleS0zMi1ieXRlcy1sb25nLTEyMzQ=",
      BETTER_AUTH_SECRET: "test-only-secret-not-used-outside-tests-000",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    },
  },
});
