import { NextResponse } from "next/server";
import { getServerEnv } from "@/config/env";
import { route } from "@/server/http";

export const dynamic = "force-dynamic";

/** Liveness probe. Database readiness is added when the database lands in Phase 1. */
export const GET = route(async () => {
  const env = getServerEnv();
  return NextResponse.json({ status: "ok", environment: env.APP_ENV });
});
