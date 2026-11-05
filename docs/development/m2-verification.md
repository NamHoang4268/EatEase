# M2 verification and closure

Status: **DONE** — M2.12 and M2 closed after final owner validation and review of all approved Phase 1 acceptance criteria. M3 is the next milestone, not started and not authorized by this closure. Production migration/deployment/public smoke remain pending separately.

## Final owner validation — 2026-11-05

| Check                                | Final verified result     |
| ------------------------------------ | ------------------------- |
| API unit tests                       | `138/138 PASS`            |
| Web component tests                  | `73/73 PASS`              |
| PostgreSQL integration tests         | `109/109 PASS`            |
| Playwright browser E2E               | `5/5 PASS`                |
| Total                                | `325/325 PASS`            |
| API/Web lint and typecheck           | PASS                      |
| API/Web production builds            | PASS                      |
| Prisma schema validation             | PASS                      |
| Isolated local PostgreSQL migrations | `9/9` applied, up to date |

These results are owner-confirmed, not rerun during the documentation closure task. The complete browser suite confirms login/session restoration, ordering, authorization boundaries, Guest recovery, retry and reconnect behavior. It supersedes the earlier split browser results below. The approved M2 acceptance checklist is fully satisfied by this evidence and the coverage mapping; no unresolved M2 implementation acceptance blocker remains. A new M2.12 GitHub CI result has not been supplied and is not inferred from local results.

## Evidence boundaries

- Owner-confirmed M2.11 baseline: API `131/131`, Web `72/72`, PostgreSQL `108/108` (`311/311`) PASS; API/Web lint, typecheck, builds, Prisma validation/generation and all nine local migrations PASS. Owner also confirmed M2.11 CI/merge. This baseline predates M2.12 changes.
- M2.12 targeted checks: API target-guard/publisher unit tests `10/10` and Web Join/recovery component tests `7/7` PASS; API/Web typecheck and changed-file API/Web lint PASS. Initial Playwright discovery was not executed browser evidence; actual follow-up results are recorded below.
- Earlier owner-confirmed M2.12 regression: `319/319` tests PASS, API/Web lint/typecheck/builds PASS; local PostgreSQL healthy with nine migrations applied. This baseline predates the explicit StaffSession DI fix and is superseded by the final `325/325` owner validation above.
- Browser startup follow-up: reproduced API `tsx watch` stalling before Nest bootstrap in a Windows piped child process. The E2E-only command now uses `pnpm exec tsx src/main.ts`; the same local readiness endpoint returned HTTP `200` in the non-watch startup probe with publisher disabled. API/Web startup stdout/stderr are piped with service names. No timeout increase, database write or browser scenario execution was used for this diagnosis.
- M2.11 managed migration, API/Web deployment and public realtime smoke test: **pending**. Earlier [M2.7 production evidence](m2-7-production-verification.md) does not establish M2.11 production behavior.

## Browser follow-up — 2026-11-05

- No HTTP redirect loop was reproduced in the focused probe: one initial document request produced two frame navigation events. Proxy runs only for API paths; Staff UI has no redirect/reload loop in the inspected flow. Historical continuous navigation remains unconfirmed, not attributed to Vercel or CSRF.
- The real blocker reproduced was `POST /staff/auth/login → 500`. Under TSX, Nest did not inject `PrismaService` into `StaffSessionService` because that constructor lacked an explicit token. Add `@Inject(PrismaService)`, consistent with the existing development convention; do not change auth/Origin/CSRF contracts. The focused Nest DI regression passes `1/1`.
- Real login/refresh smoke: `1/1 PASS` on verified isolated local `eatease_m2_test`; login and POST CSRF recovery both return `200`, with no unsolicited document navigation.
- One full four-scenario run: `3 PASS, 1 FAIL`; all passed Staff login. The remaining case timed out selecting the Waiter table. DOM-only reproduction confirmed exact label matching included nested option text, so `getByLabel('Phiên bàn', { exact: true })` matched nothing. Use the correctly named `combobox` role instead, preserving the actual selection/assertions.
- Reran only that failed Guest/member/Waiter scenario after the selector fix: `1/1 PASS` (13.7 seconds). At that stage, all four ordering cases had passing evidence across separate runs, not a combined green run; no full regression or production build was rerun by Codex. The subsequent owner-confirmed `5/5` browser suite and `325/325` final validation above close that evidence gap. New CI is still unreported; production verification remains pending.

## Acceptance coverage

The authoritative checklist remains [Phase 1](../planning/phase-01.md#acceptance-criteria). All listed coverage is included in the final owner-confirmed validation above; historical focused-run descriptions below explain how gaps were resolved. All approved M2 criteria are checked complete; this does not attest to unexecuted production or infrastructure checks.

| Acceptance area                                                                                | Focused evidence                                                                                                                                                                                                                                                                                                  | M2.12 gap / boundary                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staff/Guest lifecycle, scope, Origin/CSRF and revocation                                       | [Staff auth PostgreSQL](../../apps/api/src/staff-auth/staff-auth.database.integration.test.ts), [Guest PostgreSQL](../../apps/api/src/guest-session/guest-session.database.integration.test.ts), [ordering API PostgreSQL](../../apps/api/src/ordering/ordering.database.integration.test.ts)                     | Multi-role test is included in owner-confirmed regression. New DI unit and real login/refresh smoke PASS.                                                                           |
| Browse-only QR, activation race, explicit requester claim, no automatic Order                  | [Approval PostgreSQL](../../apps/api/src/activation-request/activation-decision.database.integration.test.ts), [claim PostgreSQL](../../apps/api/src/activation-request/activation-claim.database.integration.test.ts), [menu component](../../apps/web/src/features/public-menu/public-menu-experience.test.tsx) | Local browser activation/claim/cart-to-explicit-submit PASS; no automatic Order.                                                                                                    |
| Join lifecycle, member isolation, rate limits, fixed recovery                                  | [Join PostgreSQL](../../apps/api/src/join-code/join-code.database.integration.test.ts), [Join component](../../apps/web/src/features/public-menu/join-code-experience.test.tsx)                                                                                                                                   | Component regression and both expired/revoked browser recovery scenarios PASS locally.                                                                                              |
| Shared Guest/Waiter submission, one Bill, server prices/snapshots, concurrency and idempotency | [Order persistence PostgreSQL](../../apps/api/src/ordering/order-persistence.database.integration.test.ts), [ordering API PostgreSQL](../../apps/api/src/ordering/ordering.database.integration.test.ts)                                                                                                          | Guest/member/Waiter consolidation and lost-response retry PASS in the focused rerun after the selector fix.                                                                         |
| Rollback leaves no orphan financial/domain state                                               | Same order persistence suite: final-write failure, deferred graph/foreign-key checks; approval suite: transactional rollback                                                                                                                                                                                      | Existing PostgreSQL evidence; do not replace real constraints with mocks.                                                                                                           |
| Committed-only read-only Kitchen Queue, stable cursor/scope                                    | [Fulfillment PostgreSQL](../../apps/api/src/fulfillment/fulfillment.database.integration.test.ts)                                                                                                                                                                                                                 | Browser queue follows committed submissions; uncommitted/rollback/pagination remain PostgreSQL assertions, not duplicated browser cases.                                            |
| Authorized single-use tickets, expiry, Origin/audience and no cross-scope fanout               | [Realtime PostgreSQL/Socket.IO](../../apps/api/src/realtime/realtime.database.integration.test.ts)                                                                                                                                                                                                                | Existing real handshakes include concurrent consumption, revoked actors and two-table isolation. Browser tests exercise normal tickets, not production proxy signing.               |
| Outbox lease/fencing/retry and no duplicate business writes                                    | Same realtime PostgreSQL suite; [publisher unit](../../apps/api/src/realtime/outbox-publisher.service.test.ts)                                                                                                                                                                                                    | Existing transport-failure test snapshots Orders/Items/Bill; browser interruption validates committed state plus reconnect REST recovery. No exactly-once/client-receipt claim.     |
| Reconnect/missed hints preserve authoritative state/drafts                                     | [Realtime hook](../../apps/web/src/features/realtime/use-realtime.test.tsx), [view integration](../../apps/web/src/features/realtime/realtime-views.test.tsx)                                                                                                                                                     | Local focused browser rerun PASS: missed hints, reconnect and REST Bill catch-up.                                                                                                   |
| Safe failure/configuration and no raw credential logging                                       | [API environment unit](../../apps/api/src/config/environment.test.ts), publisher unit above, hash-only session/join/ticket persistence assertions                                                                                                                                                                 | New sentinel test confirms publisher logs only a safe code, not transport error contents. This is targeted evidence, not a claim that arbitrary infrastructure logs were inspected. |

## Minimal browser suite

[Playwright configuration](../../apps/api/playwright.config.ts), [synthetic fixture](../../apps/api/e2e/fixture.ts) and [four scenarios](../../apps/api/e2e/ordering.e2e.ts) use the real local Next.js rewrite, NestJS routes, PostgreSQL and direct Socket.IO connection. Approved tooling comes from [ADR-0006](../architecture/adr/0006-m1-technical-foundation.md).

1. Cart → request → physical-presence-attested approval → explicit claim, still zero Orders → explicit submit. Simulate losing the real committed response and retry with the same key; verify one Order. Add a second member and a Waiter Order to the same Bill, observe Kitchen hints, interrupt Bill notifications, reconnect and verify REST catch-up.
2. Copied QR cannot submit; replaced Join Code fails; unauthenticated Kitchen and another table's browse-only Bill read are denied.
3. Expire only this run's member immediately before submission, preserving database timeline constraints. Recover browse without reload, retain draft, explicitly join and explicitly submit.
4. Repeat the recovery scenario with a revoked member.

A separate [Staff login/refresh smoke](../../apps/api/e2e/staff-login.smoke.e2e.ts) asserts real login and POST CSRF recovery return `200`, authorized UI survives refresh, and document requests occur only for initial navigation and explicit reload. Default `pnpm test:e2e` now includes this smoke plus the four ordering scenarios.

Safety: refuse non-loopback or unnamed test database targets before servers/fixtures start; only exact `eatease_m2_test` locally, or ephemeral local `eatease` with `CI=true`. Fixture checks `current_database()` before writes. Each run creates its own random restaurant/location/staff/table/menu scope; no catalog seed, bootstrap or database reset. Submitted financial history is retained; teardown removes only its own ephemeral RBAC links/roles and unreferenced permissions it created. Failed runs may leave synthetic rows for diagnosis. Publisher may process pre-existing pending events in this **isolated test database**, never a shared database.

Ports `3100/3101` must be free: servers cannot be reused. Explicit local URLs and synthetic-only secrets override inherited server settings; API dotenv is directed to a unique nonexistent temporary path. Next.js uses normal development loading, but relevant API/realtime targets are pinned locally. Browser HTTP requests to other origins are blocked. Traces/screenshots/video are disabled so credentials/tickets/one-time Join Codes are not retained in browser artifacts. Do not attach browser state, passwords or code values to reports.

This suite runs development servers, not production builds. Separate API/Web production builds passed in final owner validation; actual production deployment/public smoke remain pending. Linux CI is configured to install Chromium/system dependencies and use its migrated ephemeral PostgreSQL service; this is not evidence of a new CI run, and no managed credentials are needed.

## Owner validation — PowerShell

Retained for reproducibility. The owner has completed the final validation recorded above; closure does not require rerunning these commands during this documentation-only task.

Run from the repository root in a dedicated PowerShell session. Stop on any nonzero exit code; do not proceed past a database identity/migration failure. Docker Desktop/local PostgreSQL must already be running; use [local setup](local-setup.md) if needed. Never substitute Neon/shared credentials. No real environment file is needed.

### 1. Pin and verify the existing isolated database

```powershell
Set-Location D:\NamHoang\Workspace\Dev\EatEase
$env:NODE_ENV = 'test'
Remove-Item Env:CI -ErrorAction SilentlyContinue
$env:DOTENV_CONFIG_PATH = Join-Path $env:TEMP ('eatease-validation-' + [guid]::NewGuid() + '.missing')
$env:DATABASE_URL = 'postgresql://eatease:eatease_dev@127.0.0.1:5432/eatease_m2_test?schema=public'
$env:DIRECT_DATABASE_URL = $env:DATABASE_URL
docker version
pnpm --filter @eatease/api exec node --input-type=module -e 'import pg from "pg"; const c = new pg.Client({connectionString:process.env.DATABASE_URL}); try { await c.connect(); const {rows} = await c.query("SELECT current_database() AS name, current_user AS role"); if (rows[0].name !== "eatease_m2_test") throw Error("Wrong database"); console.log(rows[0]); } finally { await c.end(); }'
pnpm db:migrate:status
```

PASS: Docker Engine available, connection target explicitly loopback and result `name: eatease_m2_test`, expected local role, migrations up to date (nine at this baseline). These checks do not apply migrations. If credentials/port differ, first verify the local instance with its owner; do not guess or reset it. Stop if any migration is missing, failed or divergent and resolve separately before writing tests. Use only an instance already confirmed isolated, not a port-forward to a remote database.

### 2. Generate/validate and exercise changed persistence test

```powershell
pnpm install --frozen-lockfile
pnpm db:validate
pnpm db:generate
pnpm --filter @eatease/api exec vitest run --config vitest.integration.config.ts src/staff-auth/staff-auth.database.integration.test.ts
```

PASS: frozen dependency graph/schema/client generation succeed; all Staff auth cases including the new permission union pass. This integration command writes synthetic fixtures only to the verified local database.

### 3. Final regression and build

```powershell
pnpm test
pnpm test:integration
pnpm lint
pnpm typecheck
pnpm build
```

PASS: every suite/test and both builds pass, no lint/type errors. Record actual counts; do not reuse the pre-change `311/311` as current results. Full integration repeats the focused Staff auth file deliberately as part of final regression; it is not needed repeatedly while fixing an unrelated failure.

### 4. Real browser verification

```powershell
pnpm --filter @eatease/api exec playwright install chromium
pnpm test:e2e staff-login.smoke.e2e.ts
pnpm test:e2e ordering.e2e.ts
```

PASS: the **one** login/refresh smoke and **four** ordering scenarios pass using the guarded local database. Playwright starts/stops Web/API automatically with realtime/publisher explicitly enabled. Do not run another dev server on these ports. Chromium install requires network/disk access; no Docker build or managed service is involved. If a case fails, send only the sanitized failing assertion/stack, not credentials or captured browser state. Do not rerun full regression solely to diagnose a browser locator failure.

### 5. Last checks, after all edits

```powershell
pnpm format:check
git diff --check
```

PASS: Prettier reports all matched files conform; diff check exits zero. Any later documentation/status edit requires both checks again. Close the dedicated PowerShell session afterward to discard temporary process environment settings.

## Production-only follow-up and closure gate

Follow the existing [M2.11 deployment procedure](deployment.md#m211-realtime-and-publisher-setup); do not apply a migration or toggle services as part of local test execution.

- Owner verifies pending managed migration and applies only reviewed forward migrations, configures one Render instance, explicitly enables realtime/publisher and rebuilds Web with realtime enabled.
- Public smoke: health/readiness, activation/explicit claim with cart intact, explicit Guest + Waiter submissions into one Bill, committed Kitchen Queue update, Bill invalidation/refetch, disconnect/reconnect REST catch-up and denied/revoked access. Use synthetic data and distinct browser contexts without exposing credentials.
- Verify direct Browser → Render Origin/network behavior and free-tier cold-start/reconnect handling. Local browser PASS does not prove public transport configuration or delivery.
- Record actual migration/deployment identifiers and owner-observed outcomes separately. Leave unexecuted production checks **pending**, never infer them from CI/builds.
- M2.12 and M2 are `DONE` for the approved implementation/local acceptance scope after final owner validation. Production migration/deployment/public smoke remain explicitly **pending**, not waived or claimed complete. M3 is next (`TODO`); do not begin implementation without separate owner authorization.
