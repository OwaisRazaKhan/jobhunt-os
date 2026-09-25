import { defineConfig } from "prisma/config";

// Prisma 7 does not auto-load .env. Node >= 21 can, so no dotenv dependency is needed.
// In CI/production the variables come from the environment and no .env file exists.
try {
  process.loadEnvFile(".env");
} catch {
  // No .env file — rely on the process environment.
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
