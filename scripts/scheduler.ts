/**
 * Free local scheduler for Search Profile discovery (no paid queue, no hosted cron).
 * Calls the app's internal cron endpoint every SCHEDULER_INTERVAL_MINUTES while it runs.
 *
 *   npm run scheduler            # loop (keep it running next to `npm run dev` / `npm start`)
 *   npm run scheduler -- --once  # single tick, e.g. from Windows Task Scheduler or cron
 *
 * Needs CRON_SECRET in .env (the same value the app reads). The secret is never printed.
 */
try {
  process.loadEnvFile(".env");
} catch {
  // rely on the process environment
}

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const secret = process.env.CRON_SECRET;
const minutes = Math.max(1, Number(process.env.SCHEDULER_INTERVAL_MINUTES) || 15);
const once = process.argv.includes("--once");

async function tick() {
  const started = new Date().toISOString();
  try {
    const res = await fetch(new URL("/api/internal/cron/discovery", appUrl), {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await res.json().catch(() => null)) as {
      data?: { claimed: number };
      error?: { message: string };
    } | null;
    if (res.ok) console.warn(`${started} due profiles started: ${body?.data?.claimed ?? 0}`);
    else console.error(`${started} scheduler call failed (${res.status}): ${body?.error?.message}`);
    return res.ok;
  } catch (error) {
    console.error(`${started} app not reachable at ${appUrl}: ${(error as Error).message}`);
    return false;
  }
}

async function main() {
  if (!secret || secret.length < 32) {
    console.error("CRON_SECRET (32+ characters) must be set in .env. See docs/job-discovery.md.");
    process.exit(1);
  }
  if (once) process.exit((await tick()) ? 0 : 1);
  console.warn(`Scheduler: checking for due search profiles every ${minutes} min at ${appUrl}`);
  await tick();
  setInterval(() => void tick(), minutes * 60_000);
}

void main();

export {};
