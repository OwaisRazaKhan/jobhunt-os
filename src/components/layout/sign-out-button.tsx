"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await authClient.signOut();
        router.push("/sign-in");
        router.refresh();
      }}
      className="text-fg-muted hover:bg-surface-2 hover:text-fg flex h-7 items-center gap-1.5 rounded-md px-2 text-xs"
    >
      <LogOut className="size-3.5" aria-hidden /> {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
