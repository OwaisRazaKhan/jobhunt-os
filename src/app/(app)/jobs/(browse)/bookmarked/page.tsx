import type { Metadata } from "next";
import { requireActorOrRedirect } from "@/server/session";
import { JobsWorkspace } from "../workspace";

export const metadata: Metadata = { title: "Bookmarked jobs · JOBHUNT OS" };
export const dynamic = "force-dynamic";

export default async function BookmarkedJobsPage({ searchParams }: PageProps<"/jobs/bookmarked">) {
  const actor = await requireActorOrRedirect();
  return <JobsWorkspace actor={actor} view="bookmarked" raw={await searchParams} />;
}
