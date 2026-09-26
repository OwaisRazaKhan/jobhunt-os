import type { Metadata } from "next";
import { requireActorOrRedirect } from "@/server/session";
import { JobsWorkspace } from "../workspace";

export const metadata: Metadata = { title: "Hidden jobs · JOBHUNT OS" };
export const dynamic = "force-dynamic";

export default async function HiddenJobsPage({ searchParams }: PageProps<"/jobs/hidden">) {
  const actor = await requireActorOrRedirect();
  return <JobsWorkspace actor={actor} view="hidden" raw={await searchParams} />;
}
