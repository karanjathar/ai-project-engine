# 7. Security Audit — Pre-Deployment

**Date:** 2026-11-06 · **Scope:** `src/api`, `src/web`, dependencies, configuration · **Result:** ✅ PASSED (no open high/critical findings)

## 7.1 Automated checks
| Check | Command / method | Result |
|---|---|---|
| Type safety | `npm run typecheck` (strict TS, `noUncheckedIndexedAccess`) | ✅ 0 errors |
| `any` / suppressions | grep `any`, `as any`, `@ts-ignore`, `eslint-disable` + ESLint `no-explicit-any: error` | ✅ none |
| Hard-coded secrets | grep for password/secret/token/key literals in `src/` (non-test) | ✅ none. The only key in tests is Azurite's public, documented dev key |
| Dangerous sinks | grep `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`, `child_process` | ✅ none |
| SQL injection | Reviewed every interpolated query | ✅ All values are `$n` parameters. Interpolated fragments are static constants or whitelisted column maps |
| Dependencies (prod) | `npm audit --omit=dev` | ✅ 0 vulnerabilities |
| Dependencies (dev) | `npm audit` | ✅ 0 after fix F-01 |
| Test suite | `npm test` | ✅ 99 API (real PostgreSQL) + 14 web tests |
| Browser E2E | Playwright against the production build | ✅ 0 console/CSP errors |

## 7.2 Controls verified
| Area | Control | Evidence |
|---|---|---|
| Secrets | All secrets come from env (Key Vault in Azure). `.env` is git-ignored and `.env.example` holds dummies. `JWT_SECRET` must be ≥ 32 chars or startup fails | `config/env.ts`, `env.test.ts` |
| AuthN | bcrypt (12 rounds) and HS256 JWT with pinned algorithm. Unknown emails take the same time as wrong passwords. Users are re-checked on every request, so deleted users lose access immediately | `services/auth.ts`, `auth.test.ts` |
| AuthZ | viewer < staff < admin RBAC on every mutating route. Admins cannot delete themselves | `middleware/auth.ts`, route tests (403 cases) |
| Input validation | zod on every body, query and route param. Malformed UUIDs → 404, constraint violations → 4xx | `http/validate.ts`, `params.ts`, `errors.ts` |
| Business integrity | Stock can never go negative (conditional UPDATE + CHECK constraint), ledger is append-only, consistent lock ordering prevents deadlocks | `services/stock.ts`, 25-way race test |
| Webhooks | Meta: timing-safe HMAC-SHA256 (`X-Hub-Signature-256`) over the raw body. Telegram: secret-token header. Both fail closed (503) when unconfigured and are idempotent on retries | `routes/webhooks.ts`, `webhooks.test.ts` |
| Chat privacy | The `status` command only reveals the sender's own orders. Inbox and live chat events are staff-only | `bot.test.ts`, `security.test.ts` |
| Rate limiting | API 600/min/IP, login 20/15 min, public orders 10/15 min, webhooks 1200/min | `app.ts`, `routes/*.ts` |
| HTTP hardening | helmet (CSP `default-src 'self'`, HSTS, nosniff, frameguard), `x-powered-by` off, 1 MB body limit, CORS allowlist (empty = same-origin only), `trust proxy` = 1 for Azure ingress | `http/app.ts`, `http.test.ts` |
| Error handling | Central handler. 500s return a generic message (no stack/internals). Unhandled rejections are logged | `errors.ts`, `http.test.ts` |
| Uploads | Browser uploads straight to Azure Blob with a 10-minute **write-only** SAS for a random blob name. Image MIME allowlist (no SVG, which blocks stored XSS) | `storage/blob.ts`, `public.test.ts` |
| Outbound calls | Fixed provider hosts only (no user-controlled URLs, so no SSRF), 10s timeouts, provider errors never echo tokens | `channels/*.ts`, `channels.test.ts` |
| Logging | Structured pino JSON. Request log records method, path, status, duration and user id only (no query strings, headers or bodies) | `middleware/requestLog.ts`, `security.test.ts` |
| Transport/DB | TLS to Azure PostgreSQL with certificate verification (`DATABASE_SSL=true`) | `db/pool.ts` |
| Container | Non-root user, multi-stage build, prod dependencies only (see Dockerfile) | Prompt 5 |

## 7.3 Findings & patches
| ID | Severity | Finding | Fix |
|---|---|---|---|
| F-01 | Moderate (dev only) | `minimatch` ReDoS advisory (GHSA-g3hv-75wg-m249) via `@typescript-eslint/typescript-estree` | npm `overrides` pins the patched `minimatch@^11.0.5`. Audit is clean and lint still passes |
| F-02 | Medium | No request/access logging (spec requires explicit logging) | Added `requestLog` middleware with a test proving tokens and query strings are not logged |
| F-03 | Medium | Viewers could read customer chat content (`GET /api/messages`, `message.received` SSE events) — personal data | Restricted to staff/admin on API, SSE and UI routes. Test added |
| F-04 | Medium | Bootstrap admin had no way to rotate its own password | Added `POST /api/auth/password` (current password required, rate-limited) and a "My account" page. Test added |
| F-05 | Low | Blank optional form fields were sent as `null` to NOT NULL columns. Postgres not-null violations returned 500 | Fixed in the UI. `23502` → 400 in the error handler (T21) |
| F-06 | Low | A missing static asset returned 500 | serve-static 404s now map to JSON 404 (T18) |

## 7.4 Accepted risks / recommendations
1. **JWT in `localStorage`.** This is readable by XSS. It's mitigated by a strict CSP (no inline scripts, no third-party scripts) and React output escaping. Move to httpOnly cookies + CSRF tokens if the threat model requires it.
2. **Single replica for realtime.** The SSE event bus is in-process. Scale out with Azure Web PubSub before raising `maxReplicas`.
3. **WhatsApp 24-hour window.** Free-form messages (alerts, order updates) only reach users who messaged the business in the last 24h. For guaranteed delivery, register Meta message templates. Staff can keep the window open by messaging the bot.
4. **Public stock counts.** `/api/public/catalog` shows exact availability. Cap or bucket the numbers if that's commercially sensitive.
5. **Viewers can see customer contact details** on the Customers page (an internal role, by design).
6. Rotate the `ADMIN_PASSWORD` bootstrap value after first login, and keep Key Vault soft-delete and purge protection enabled (set in Bicep).
