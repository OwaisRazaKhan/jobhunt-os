/**
 * Application worker (Phase 8): claims queued application attempts and drives an isolated browser.
 *
 *   npm run worker:applications            # loop (keep it running next to `npm run dev`)
 *   npm run worker:applications -- --once  # process at most one attempt, then exit
 *
 * Requires APPLICATION_AUTOMATION_ENABLED=true. Uses the INSTALLED browser selected by
 * APPLICATION_BROWSER_CHANNEL (msedge by default) — nothing is downloaded. Set
 * APPLICATION_BROWSER_HEADLESS=false to watch (and take over) the browser window.
 * The worker never solves CAPTCHAs, signs in, or submits without the approval recorded in the app.
 */
import { hostname } from "node:os";

try {
  process.loadEnvFile(".env");
} catch {
  // rely on the process environment
}

const { getServerEnv } = await import("@/config/env");
const { BrowserSession } = await import("@/server/browser/session");
const { claimNextAttempt, recoverExpiredAttempts, runAttempt } =
  await import("@/modules/applications/execution.service");
const { getDb } = await import("@/server/db");

const env = getServerEnv();
const once = process.argv.includes("--once");
const workerId = `${hostname()}:${process.pid}`;
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
  console.warn("Stopping after the current attempt…");
});

if (!env.APPLICATION_AUTOMATION_ENABLED) {
  console.error(
    "APPLICATION_AUTOMATION_ENABLED is not true — the worker will not run browser automation.",
  );
  process.exit(1);
}
console.warn(
  `Application worker ${workerId} · browser ${env.APPLICATION_BROWSER_CHANNEL} · ${env.APPLICATION_BROWSER_HEADLESS ? "headless" : "visible window"}`,
);

while (!stopping) {
  try {
    const recovered = await recoverExpiredAttempts();
    if (recovered) console.warn(`Recovered ${recovered} attempt(s) whose worker stopped.`);
    const claim = await claimNextAttempt(workerId);
    if (claim) {
      console.warn(`${new Date().toISOString()} running attempt ${claim.attemptId}`);
      await runAttempt(claim, { createSession: (options) => new BrowserSession(options) });
      console.warn(`${new Date().toISOString()} attempt ${claim.attemptId} finished`);
    }
    if (once) break;
    if (!claim) await new Promise((r) => setTimeout(r, 3000));
  } catch (error) {
    console.error("worker tick failed:", error instanceof Error ? error.message : error);
    if (once) process.exitCode = 1;
    await new Promise((r) => setTimeout(r, 5000));
    if (once) break;
  }
}
await getDb().$disconnect();
