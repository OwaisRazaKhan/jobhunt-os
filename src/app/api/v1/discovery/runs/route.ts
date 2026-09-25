import { after, NextResponse } from "next/server";
import { z } from "zod";
import { executeDiscoveryRun, startDiscovery } from "@/modules/jobs/discovery/run.service";
import { toDiscoveryRunView } from "@/modules/jobs/discovery/run-view";
import { AppError } from "@/server/errors";
import { route } from "@/server/http";
import { requireActor } from "@/server/session";

export const dynamic = "force-dynamic";
/** The run continues after the response (after()); allow it time on platforms that honour this. */
export const maxDuration = 300;

const body = z.object({ profileId: z.uuid() });

/** Start a discovery run for one of the caller's profiles; it executes in the background. */
export const POST = route(async (request) => {
  const actor = await requireActor();
  // JSON only: a cross-site form post cannot send this content type without a CORS preflight.
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new AppError("VALIDATION_ERROR", { publicMessage: "Send JSON." });
  const { profileId } = body.parse(await request.json().catch(() => ({})));
  const run = await startDiscovery(actor, profileId, "MANUAL");
  after(() => executeDiscoveryRun({ userId: actor.userId }, run.id));
  return NextResponse.json({ data: toDiscoveryRunView(run) }, { status: 202 });
});
