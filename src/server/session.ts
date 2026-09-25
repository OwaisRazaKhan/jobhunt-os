import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getAuth } from "./auth";
import { AppError } from "./errors";

/** The authenticated caller. Services receive this, never a client-supplied user id. */
export interface Actor {
  userId: string;
  email: string;
  name: string;
}

/** Resolve the session once per request. */
export const getActor = cache(async (): Promise<Actor | null> => {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  return { userId: session.user.id, email: session.user.email, name: session.user.name };
});

/** For pages: redirect to sign-in when unauthenticated. */
export async function requireActorOrRedirect(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/sign-in");
  return actor;
}

/** For actions and route handlers: throw AUTH_ERROR when unauthenticated. */
export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new AppError("AUTH_ERROR");
  return actor;
}
