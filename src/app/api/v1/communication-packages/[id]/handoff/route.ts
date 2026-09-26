import { NextResponse } from "next/server";
import { z } from "zod";
import { getCommunicationPackageForApplication } from "@/modules/communications/package.service";
import { route } from "@/server/http";
import { requireActor } from "@/server/session";

export const dynamic = "force-dynamic";

/**
 * Phase 7 → Phase 8 boundary (read-only). Returns the exact approved asset versions of a
 * READY_FOR_APPLICATION package after re-validating it; anything else is rejected (4xx).
 * Owner only. `submitted: false` — this endpoint never submits or sends anything.
 */
export const GET = route<{ id: string }>(async (_request, { params }) => {
  const actor = await requireActor();
  const handoff = await getCommunicationPackageForApplication(actor, z.uuid().parse(params.id));
  return NextResponse.json(
    { data: handoff },
    { headers: { "Cache-Control": "private, no-store" } },
  );
});
