import type { Metadata } from "next";
import { getServerEnv } from "@/config/env";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Sign in · JOBHUNT OS" };
export const dynamic = "force-dynamic";

export default function SignInPage() {
  const env = getServerEnv();
  return (
    <AuthForm
      mode="sign-in"
      googleEnabled={Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)}
    />
  );
}
