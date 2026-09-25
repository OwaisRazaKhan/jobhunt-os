import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { getServerEnv } from "@/config/env";
import { uuidv7 } from "@/lib/ids";
import { purgeUserFiles } from "@/modules/candidate/account.service";
import { getDb } from "./db";

export const AUTH_COOKIE_PREFIX = "jhos";

function createAuth() {
  const env = getServerEnv();
  if (env.APP_ENV === "production" && !env.BETTER_AUTH_SECRET) {
    throw new Error("BETTER_AUTH_SECRET is required in production");
  }
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            // Login only: no Gmail scopes in Phase 1.
            scope: ["openid", "email", "profile"],
          },
        }
      : {};

  return betterAuth({
    appName: "JOBHUNT OS",
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL ?? env.NEXT_PUBLIC_APP_URL,
    database: prismaAdapter(getDb(), { provider: "postgresql", transaction: true }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      autoSignIn: true,
    },
    socialProviders: google,
    user: {
      deleteUser: {
        enabled: true,
        // Remove stored files first; deleting the user row then cascades all user-owned tables.
        beforeDelete: async (user) => {
          await purgeUserFiles(user.id);
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: env.APP_ENV !== "development" || env.NODE_ENV === "production",
      window: 60,
      max: 30,
    },
    advanced: {
      cookiePrefix: AUTH_COOKIE_PREFIX,
      useSecureCookies: env.NEXT_PUBLIC_APP_URL.startsWith("https://"),
      database: { generateId: () => uuidv7() },
    },
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { jobhuntAuth?: Auth };

/** Lazily constructed so builds do not require database configuration. */
export function getAuth(): Auth {
  globalForAuth.jobhuntAuth ??= createAuth();
  return globalForAuth.jobhuntAuth;
}

/** Tests: drop the cached instance after swapping the database client. */
export function resetAuthForTests(): void {
  globalForAuth.jobhuntAuth = undefined;
}
