import { redirect } from "next/navigation";
import { getActor } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const actor = await getActor().catch(() => null);
  redirect(actor ? "/candidate" : "/sign-in");
}
