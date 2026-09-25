import {
  Activity,
  Briefcase,
  FileSearch,
  FileText,
  ListChecks,
  Plug,
  Radar,
  Settings,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { NavLink } from "@/components/layout/nav-link";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { countPendingCandidates } from "@/modules/candidate";
import { requireActorOrRedirect } from "@/server/session";

/** Every page in the app shell is per-user; never prerender. */
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const actor = await requireActorOrRedirect();
  const pending = await countPendingCandidates(actor).catch(() => 0);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <a
        href="#main"
        className="focus:bg-surface-3 sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <aside className="border-border bg-surface-1 flex shrink-0 flex-col border-b md:sticky md:top-0 md:h-screen md:w-56 md:border-r md:border-b-0">
        <div className="flex h-12 items-center gap-2 px-4">
          <span className="bg-accent size-2 rounded-full" aria-hidden />
          <Link href="/candidate" className="font-mono text-xs font-semibold tracking-wider">
            JOBHUNT OS
          </Link>
        </div>
        <nav
          aria-label="Main"
          className="flex gap-0.5 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible"
        >
          <p className="text-fg-subtle hidden px-2 pt-2 pb-1 font-mono text-[10px] tracking-wider uppercase md:block">
            Candidate
          </p>
          <NavLink href="/candidate" exact>
            <UserRound className="size-4" aria-hidden /> Profile
          </NavLink>
          <NavLink href="/candidate/onboarding">
            <ListChecks className="size-4" aria-hidden /> Onboarding
          </NavLink>
          <NavLink href="/candidate/review" badge={pending}>
            <FileSearch className="size-4" aria-hidden /> Fact review
          </NavLink>
          <NavLink href="/candidate/documents">
            <FileText className="size-4" aria-hidden /> Documents
          </NavLink>
          <NavLink href="/candidate/activity">
            <Activity className="size-4" aria-hidden /> Activity
          </NavLink>
          <p className="text-fg-subtle hidden px-2 pt-4 pb-1 font-mono text-[10px] tracking-wider uppercase md:block">
            Discovery
          </p>
          <NavLink href="/jobs" exclude={["/jobs/profiles", "/jobs/sources"]}>
            <Briefcase className="size-4" aria-hidden /> Jobs
          </NavLink>
          <NavLink href="/jobs/profiles">
            <Radar className="size-4" aria-hidden /> Search profiles
          </NavLink>
          <NavLink href="/jobs/sources">
            <Plug className="size-4" aria-hidden /> Sources
          </NavLink>
          <p className="text-fg-subtle hidden px-2 pt-4 pb-1 font-mono text-[10px] tracking-wider uppercase md:block">
            System
          </p>
          <NavLink href="/settings">
            <Settings className="size-4" aria-hidden /> Settings
          </NavLink>
        </nav>
        <div className="border-border mt-auto hidden border-t p-3 md:block">
          <p className="text-fg truncate text-xs" title={actor.email}>
            {actor.name}
          </p>
          <p className="text-fg-subtle truncate font-mono text-[11px]">{actor.email}</p>
          <div className="mt-2">
            <SignOutButton />
          </div>
        </div>
      </aside>
      <main id="main" className="min-w-0 flex-1 px-4 py-5 md:px-8 md:py-6">
        <div className="mx-auto max-w-6xl">{children}</div>
        <div className="border-border mt-8 border-t pt-3 md:hidden">
          <SignOutButton />
        </div>
      </main>
    </div>
  );
}
