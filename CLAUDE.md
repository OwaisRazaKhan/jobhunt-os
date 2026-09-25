@AGENTS.md

# JOBHUNT OS — project rules for agents

- `docs/` is the technical source of truth. Read the relevant doc before changing a domain; update it in the same change.
- Work phase by phase (`docs/roadmap.md`). Do not build features from a later phase or pre-create empty modules.
- Architecture: modular monolith. Routes in `src/app` stay thin; business logic lives in `src/modules/<domain>/service.ts`; DB access only in repositories, always scoped by `userId`.
- Never let AI output become `VERIFIED` candidate data; never add an outbound action (email, submission) that bypasses a recorded human approval.
- Job sources: only legitimate access (public APIs, official feeds, structured data permitted by robots.txt, user-provided). Never bypass CAPTCHA, auth, anti-bot or rate limits.
- Secrets: read config via `src/config/env.ts`; never use `NEXT_PUBLIC_` for secrets; guard server code with `import "server-only"`.
- Errors: throw `AppError` (`src/server/errors.ts`); wrap Route Handlers with `route()` (`src/server/http.ts`).
- Before finishing: `npm run check` and `npm run build` must pass.
