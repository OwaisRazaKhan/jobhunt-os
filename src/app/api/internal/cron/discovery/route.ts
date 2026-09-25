import { createHash, timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { getServerEnv } from "@/config/env";
import { claimDueProfiles, runClaimedProfiles } from "@/modules/jobs/discovery/scheduler.service";
import { AppError } from "@/server/errors";
import { route } from "@/server/http";

export const dynamic = "force-dynamic";
/** Claimed runs execute after the response; allow them time where the platform honours this. */
export const maxDuration = 300;

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

/** Bearer CRON_SECRET, compared in constant time. The endpoint is off when the secret is unset. */
function authorize(request: Request) {
  const secret = getServerEnv().CRON_SECRET;
  if (!secret) throw new AppError("NOT_FOUND");
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !timingSafeEqual(digest(token), digest(secret))) throw new AppError("AUTH_ERROR");
}

/**
 * Internal scheduler tick: claims due Search Profiles (next_run_at <= now) and runs them
 * sequentially in the background. Called by `npm run scheduler`, GitHub Actions or
 * Supabase pg_cron + pg_net (see docs/job-discovery.md). Never exposes user data.
 */
async function tick(request: Request) {
  authorize(request);
  const claimed = await claimDueProfiles(new Date(), getServerEnv().CRON_MAX_PROFILES);
  if (claimed.length) after(() => runClaimedProfiles(claimed).then(() => undefined));
  return NextResponse.json(
    { data: { claimed: claimed.length } },
    { status: 202, headers: { "Cache-Control": "no-store" } },
  );
}

export const POST = route(tick);
// Some free cron services (e.g. Vercel Cron) only send GET with the same bearer header.
export const GET = route(tick);
