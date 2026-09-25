"use client";

import { createAuthClient } from "better-auth/react";

/** Browser auth client. Talks to /api/auth/* on the same origin; holds no secrets. */
export const authClient = createAuthClient();
