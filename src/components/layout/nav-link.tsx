"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function NavLink({
  href,
  children,
  exact,
  badge,
  exclude = [],
}: {
  href: string;
  children: ReactNode;
  exact?: boolean;
  badge?: number;
  /** Sub-paths that have their own nav entry */
  exclude?: string[];
}) {
  const pathname = usePathname();
  const within = (base: string) => pathname === base || pathname.startsWith(`${base}/`);
  const active = exact ? pathname === href : within(href) && !exclude.some((path) => within(path));
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 items-center gap-2 rounded-md px-2 text-[13px] transition-colors",
        active ? "bg-surface-3 text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
      )}
    >
      {children}
      {badge ? (
        <span className="bg-warning/15 text-warning ml-auto rounded-sm px-1.5 font-mono text-[10px]">
          {badge}
        </span>
      ) : null}
    </Link>
  );
}
