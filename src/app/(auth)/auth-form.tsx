"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { inputClass } from "@/components/forms/field-control";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function AuthForm({
  mode,
  googleEnabled,
}: {
  mode: "sign-in" | "sign-up";
  googleEnabled: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const result =
      mode === "sign-up"
        ? await authClient.signUp.email({
            email,
            password,
            name: String(form.get("name") ?? "").trim() || email.split("@")[0]!,
          })
        : await authClient.signIn.email({ email, password });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Authentication failed. Please try again.");
      return;
    }
    router.push(mode === "sign-up" ? "/welcome" : "/candidate");
    router.refresh();
  }

  return (
    <div className="w-full max-w-sm">
      <div className="text-fg-subtle flex items-center gap-2 font-mono text-xs">
        <span className="bg-accent size-2 rounded-full" aria-hidden /> JOBHUNT OS
      </div>
      <h1 className="mt-3 text-lg font-semibold tracking-tight">
        {mode === "sign-up" ? "Create your account" : "Sign in"}
      </h1>
      <p className="text-fg-muted mt-1 text-sm">
        {mode === "sign-up"
          ? "Your candidate data stays private to your account."
          : "Welcome back."}
      </p>
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3" noValidate>
        {mode === "sign-up" && (
          <div>
            <label htmlFor="name" className="text-fg-muted mb-1 block text-xs font-medium">
              Name
            </label>
            <input id="name" name="name" autoComplete="name" className={inputClass} />
          </div>
        )}
        <div>
          <label htmlFor="email" className="text-fg-muted mb-1 block text-xs font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="password" className="text-fg-muted mb-1 block text-xs font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={10}
            autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
            aria-describedby={mode === "sign-up" ? "password-help" : undefined}
            className={inputClass}
          />
          {mode === "sign-up" && (
            <p id="password-help" className="text-fg-subtle mt-1 text-xs">
              At least 10 characters.
            </p>
          )}
        </div>
        {error && (
          <p
            role="alert"
            className="border-danger/30 bg-danger/5 text-danger rounded-md border px-3 py-2 text-sm"
          >
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={pending} className="mt-1 w-full">
          {pending ? "Please wait…" : mode === "sign-up" ? "Create account" : "Sign in"}
        </Button>
        {googleEnabled && (
          <Button
            variant="secondary"
            className="w-full"
            onClick={() =>
              authClient.signIn.social({ provider: "google", callbackURL: "/candidate" })
            }
          >
            Continue with Google
          </Button>
        )}
      </form>
      <p className="text-fg-muted mt-6 text-sm">
        {mode === "sign-up" ? (
          <>
            Already have an account?{" "}
            <Link href="/sign-in" className="text-accent hover:underline">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link href="/sign-up" className="text-accent hover:underline">
              Create an account
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
