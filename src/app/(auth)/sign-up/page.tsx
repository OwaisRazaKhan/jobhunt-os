import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerEnv } from "@/config/env";
import { getActor } from "@/server/session";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Create account · JOBHUNT OS" };
export const dynamic = "force-dynamic";

export default async function SignUpPage() {
  // Only a session that validates redirects; a stale cookie shows the form instead of looping.
  if (await getActor().catch(() => null)) redirect("/candidate");
  const env = getServerEnv();
  return (
    <AuthForm
      mode="sign-up"
      googleEnabled={Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)}
    />
  );
}
