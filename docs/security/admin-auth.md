# QueryVanta â€” Administrator Authentication

How administrator sign-in works, and why it is built this way.

## Threat model

The previous implementation had **no authentication at all**.
`/admin/questions` rendered the full question CRUD for any visitor,
and questions were stored in `localStorage`
(`src/lib/adminQuestions.ts`). The only thing standing between a
visitor and the question catalog was knowing a URL â€” which is not an
access control. This is recorded as finding **F-01** (critical) in
`docs/qa/baseline-browser-audit.md`.

Requirements for the replacement:

- Authorization must be enforced **on the server**. A client-only
  gate is a user-interface hint, not a control.
- Identity must be an **immutable** identifier. A GitHub username can
  be renamed or reclaimed; a numeric user id cannot.
- The browser must never hold a credential it could replay.
- Secrets must never reach the browser bundle.
- The system must **fail closed** when it is not configured.

## Explicitly rejected approaches

| Rejected | Why |
| --- | --- |
| Username/password in the frontend | The "password" would ship in the JS bundle and be readable by every visitor. |
| GitHub username/password | Never store a third party's GitHub password. OAuth exists for this. |
| A password in a `VITE_`-prefixed env var | Vite inlines `VITE_*` into the client bundle. It is a public channel. |
| Client-side password comparison | Trivially bypassed; the comparison logic is public. |
| Bearer token in `localStorage` | Readable by any XSS payload and never auto-expiring. |
| Bearer token in `sessionStorage` | Same exposure, marginally narrower blast radius. Not a fix. |
| "Security through a hidden URL" | Obscurity, not authentication. The previous state of this app. |
| Repository / org OAuth scopes | Unnecessary. QueryVanta only needs the account identity. |
| GitHub credentials for QueryVanta auth | Disallowed, and unnecessary. |

## Flow

```
Browser                     Worker (same origin)            GitHub
   |                              |                            |
   | GET /api/auth/session        |                            |
   |----------------------------->| lookup hashed cookie        |
   |<-----------------------------| { authenticated: false }    |
   |                              |                            |
   | GET /api/auth/github         |                            |
   |----------------------------->| state = 256-bit random      |
   |                              | verifier = 256-bit random   |
   |                              | challenge = S256(verifier)  |
   |                              | store HASH(state) + verifier|
   |                              | TTL 10 min, single use      |
   |<-----------------------------| 302 â†’ github.com/authorize  |
   |                                                           |
   |                              |<---------------------------|
   |                              | 302 â†’ /api/auth/github/     |
   |                              |       callback?code&state  |
   |                              |                            |
   |                              | verify state (hash lookup,  |
   |                              |   consume atomically)      |
   |                              | PKCE S256 verify            |
   |                              | exchange code (server-side)|
   |                              |---------------------------->|
   |                              |<----------------------------|
   |                              | GET /user (Bearer token)    |
   |                              |---------------------------->|
   |                              |<----------------------------|
   |                              | immutable numeric id        |
   |                              | id âˆˆ ADMIN_GITHUB_IDS ?     |
   |                              | no  â†’ redirect "not-authorized"
   |                              | yes â†’ create session        |
   |                              | store HASH(token) only      |
   |<-----------------------------| 302 + Set-Cookie (HttpOnly) |
   |
   | GET /api/auth/session â†’ { authenticated: true, csrfToken }
```

## Identity and authorization

Authorization uses the **immutable GitHub numeric user id**
(`GET /user` â†’ `id`), never the login name.

`ADMIN_GITHUB_IDS` is a comma-separated allow-list:

```
ADMIN_GITHUB_IDS=424242,987654
```

`parseAdminGitHubIds` (`server/env.ts`) keeps only entries matching
`^\d+$`. An **empty or absent list denies every login** â€” the system
fails closed, so a missing configuration cannot accidentally open the
admin area.

Find your numeric id at `https://api.github.com/users/<your-login>`.

## Scope

The authorization request uses exactly one scope:

```
scope=read:user
```

That is the minimum that can read the authenticated user's identity.
QueryVanta never reads repositories, email addresses, organisations,
gists or issues, and the test suite asserts that no `repo`, `write:`
or `admin:` scope is ever requested.

## OAuth transaction hardening

- `state` â€” 256 bits from `crypto.getRandomValues`. Only its SHA-256
  hash is stored, so a database dump cannot forge a live callback.
- **PKCE (S256)** â€” the verifier never leaves the Worker. A
  stolen authorization code cannot be exchanged without it.
- **Single use** â€” consumption is a conditional `UPDATE ... WHERE
  consumed_at IS NULL AND expires_at > now`. A replayed callback
  updates zero rows and is rejected. Verified by test
  "rejects a replayed OAuth callback".
- **Short TTL** â€” 10 minutes.
- **Redirect allow-list** â€” `safeRedirectPath` accepts only
  `/admin/questions` and `/admin`. Protocol-relative URLs
  (`//evil.example`), absolute URLs, backslashes and anything else
  collapse to the default. There is no open redirect.

## Sessions

Opaque, server-managed (`server/session.ts`).

| Property | Value |
| --- | --- |
| Token | 256 bits from `crypto.getRandomValues` |
| Stored | `sha256(SESSION_SECRET + "." + token)` â€” **never the raw token** |
| Uniqueness | `token_hash` is `UNIQUE` |
| Columns | `id`, `admin_github_id`, `token_hash`, `csrf_token`, `created_at`, `updated_at`, `last_seen_at`, `expires_at`, `revoked_at` |
| Absolute TTL | 8 hours |
| Idle TTL | 2 hours since `last_seen_at` |
| Expiry enforcement | Server-side on **every** request |
| Logout | Sets `revoked_at`; the old token is rejected immediately |

The `SESSION_SECRET` salt means a stolen database dump cannot be
replayed even if an attacker also learns the raw token values from
some other channel.

### Cookie

```
qv_admin_session=<64 hex>; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800; Expires=â€¦
```

- `HttpOnly` â€” unreadable by JavaScript, so XSS cannot steal it.
- `Secure` â€” HTTPS only.
- `SameSite=Lax` â€” not sent on cross-site POSTs.
- `Path=/` â€” required so the session works on every app route.
- **No `Domain` attribute** â€” the cookie stays host-only and is never
  sent to sibling subdomains.

There is **no** token in `localStorage` or `sessionStorage`. The only
client-held value is the CSRF token, held in a module variable and
never persisted.

## CSRF and origin defence

Defence in depth, three layers:

1. **`SameSite=Lax`** cookie stops the cookie on cross-site POSTs.
2. **Strict origin check** â€” `assertSameOrigin` requires `Origin` to
   equal `APP_ORIGIN` exactly. No wildcards, no registrable-domain
   matching. A request with neither `Origin` nor a same-origin
   `Referer` is rejected.
3. **Double-submit CSRF token** â€” each session gets a random
   `csrf_token`. The client reads it from `/api/auth/session` and
   echoes it in `X-CSRF-Token` on every mutation. `assertCsrf`
   compares with a constant-time comparison.

GET/HEAD/OPTIONS skip layers 2 and 3, since they must be
side-effect-free.

## Other protections

| Threat | Mitigation |
| --- | --- |
| Malformed JSON | `readJsonObject` enforces `application/json`, a 512 KiB cap, and object-only bodies. |
| Oversized payloads | `MAX_BODY_BYTES` checked against both `Content-Length` and the decoded body. |
| Input injection | Every statement is parameterised. No value is concatenated into SQL. |
| IDOR | `:id` is validated against `^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$`; a non-existent id is a clean 404. |
| Stale overwrite | `version` column + optimistic concurrency; a stale write returns 409. |
| Destroying history | Delete is a **soft delete** (`deleted_at`); the audit log keeps referencing it. |
| Privilege escalation | Authorization is re-checked against the allow-list on every request, not only at login. |
| Secret leakage in errors | `toError` returns a generic message; no stack traces, SQL, or env values reach the client. The specific OAuth failure reason goes to the audit log only. |
| Clickjacking | `X-Frame-Options: DENY`. |
| MIME sniffing | `X-Content-Type-Options: nosniff`. |
| Referrer leakage | `Referrer-Policy: strict-origin-when-cross-origin`. |
| Session fixation | A fresh token is minted per login; the old row is never reused. |
| Replay of an expired OAuth transaction | 10-minute TTL, single use, verified by test. |

## Secrets

| Name | Kind | Where |
| --- | --- | --- |
| `GITHUB_CLIENT_ID` | public | `wrangler.jsonc` `vars` |
| `GITHUB_CLIENT_SECRET` | **secret** | `npx wrangler secret put` |
| `SESSION_SECRET` | **secret** | `npx wrangler secret put` |
| `ADMIN_GITHUB_IDS` | protected config | `wrangler.jsonc` `vars` |
| `APP_ORIGIN` | public | `wrangler.jsonc` `vars` |
| `ENVIRONMENT` | public | `wrangler.jsonc` `vars` |

`.dev.vars` (gitignored) holds local values. `.dev.vars.example`
documents the shape with placeholders only.

`server/tests/secrets.test.ts` reads the **actual `dist/` output** and
fails if any secret-shaped value, a `VITE_`-prefixed secret read, a
web-storage token write, or a client-side password check appears.

## Authorisation is not the gate

`src/components/AdminGate.tsx` hides the admin UI when no session
exists. That is **user experience only**. If the component were
removed entirely, every admin API endpoint would still refuse the
request, because `requireAdmin` in `server/index.ts` verifies the
session on each call. This is asserted by the security suite, which
calls the API directly with no UI involved.

## GitHub Pages limitation

The GitHub Pages deployment has no backend, so `/api/auth/session`
returns HTML. The app detects this and shows:

> The QueryVanta API is not available on this deployment, so
> administrator features cannot be enabled here.

Rather than faking an admin experience with a client-only password
check, the Pages build **disables** question management and says why.
Server-enforced administration requires the Cloudflare Worker
deployment. The GitHub Pages workflow is preserved unchanged as a
fallback until the Worker deployment is proven.
