import type { Metadata } from "next";
import { getServerEnv } from "@/config/env";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Create account · JOBHUNT OS" };
export const dynamic = "force-dynamic";

export default function SignUpPage() {
  const env = getServerEnv();
  return (
    <AuthForm
      mode="sign-up"
      googleEnabled={Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)}
    />
  );
}
