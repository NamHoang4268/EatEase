# Portfolio deployment: Vercel, Render and Neon

Guide này ghi lại và hướng dẫn tái tạo public portfolio/demo deployment `$0/month`. Nó không phải production SLA architecture và không thay thế AWS/M5 direction. Quyết định authoritative nằm trong [ADR-0007](../architecture/adr/0007-portfolio-deployment.md).

## Current portfolio deployment

Initial M1 cloud deployment đã được verify ngày `2026-10-27`. M2.7 production evidence ngày `2026-10-31` và `2026-11-04` được ghi riêng để giữ nguyên lịch sử M1 và phân biệt functional, security, automated-test và cleanup evidence.

| Component  | Provider/plan | Public endpoint                         | Region/configuration                                  |
| ---------- | ------------- | --------------------------------------- | ----------------------------------------------------- |
| Web        | Vercel Hobby  | `https://eat-ease.vercel.app`           | Vercel-managed; repository không pin execution region |
| API        | Render Free   | `https://eatease-api-rbgu.onrender.com` | Singapore                                             |
| PostgreSQL | Neon Free     | Không public trong tài liệu             | Singapore; database `neondb`                          |

Các URL trên là operational deployment record, không phải production domain hoặc SLA commitment.

## Topology

```text
Browser
  └─ https://eat-ease.vercel.app
       ├─ / and /health        → Next.js on Vercel
       └─ /api/*               → server-side rewrite
                                  └─ https://eatease-api-rbgu.onrender.com/api/*
                                       └─ pooled PostgreSQL connection → Neon Singapore
```

Browser chỉ thấy same-origin `/api/...`. `API_INTERNAL_URL` không có prefix `NEXT_PUBLIC_` và không phải browser variable. API/database secrets chỉ nằm ở Render/Neon.

## Required environment variables

### Render API

| Variable                  | Secret | Value/source                                                                                      |
| ------------------------- | :----: | ------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                |   No   | `production`                                                                                      |
| `NODE_VERSION`            |   No   | `24.22.1`                                                                                         |
| `DATABASE_POOL_MAX`       |   No   | `5` cho single Free instance                                                                      |
| `TRUSTED_WEB_ORIGINS`     |   No   | Comma-separated exact origins; staff deployment dùng `https://eat-ease.vercel.app`                |
| `JOIN_CODE_HASH_SECRET`   |  Yes   | Stable CSPRNG secret, minimum 32 characters, used only for Join Code/IP fingerprints              |
| `API_PROXY_SHARED_SECRET` |  Yes   | Independent 32+ character CSPRNG value; exact same value on Vercel and Render for signed IP proof |
| `DATABASE_URL`            |  Yes   | Neon pooled URL; hostname thường có `-pooler`                                                     |
| `DIRECT_DATABASE_URL`     |  Yes   | Neon direct/unpooled URL cho Prisma migrations                                                    |
| `PORT`                    |   No   | Render tự cấp; API ưu tiên `PORT` và fallback về `API_PORT` cho local development                 |

Không đặt `DATABASE_URL` hoặc `DIRECT_DATABASE_URL` ở Vercel.

`JOIN_CODE_HASH_SECRET` phải được owner tạo và cấu hình trực tiếp trong Render trước khi deploy code M2.7. Không commit, paste vào PR/log hoặc dùng chung với database/session credentials. API production fail fast nếu thiếu hoặc dùng known placeholder; thay đổi secret sẽ làm các Join Code đang còn hạn không thể verify, nên chỉ rotate theo một operational plan có chủ đích.

`API_PROXY_SHARED_SECRET` là secret riêng, không tái sử dụng `JOIN_CODE_HASH_SECRET`. Next.js Proxy đọc `x-vercel-forwarded-for` do Vercel ghi đè, xóa caller-supplied internal proof, rồi ký client IP + timestamp + method + path. API chỉ dùng client IP đã verify trong 60 giây và không trust arbitrary `X-Forwarded-For` hoặc numeric proxy-hop guesses. Direct Render calls to the production join mutation fail closed. Hai platform phải có cùng value; mismatch chỉ làm Join Code join trả `403 TRUSTED_PROXY_REQUIRED`, không được fallback sang untrusted headers.

Policy này dựa trên [Vercel request-header contract](https://vercel.com/docs/headers/request-headers), [Next.js upstream request headers](https://nextjs.org/docs/app/api-reference/functions/next-response) và [Render public edge behavior](https://render.com/articles/how-render-handles-ddos-attacks). Repository tests verify signing, tamper rejection và database bucket separation; header propagation trên deployment thật vẫn phải được owner verify sau rollout vì task không truy cập Vercel/Render.

Staff authenticated browser requests cần credentials và exact Origin allowlist. Production API set host-only `SameSite=None; Secure; HttpOnly` staff cookie; một số browser/privacy modes vẫn có thể block third-party cookies. Các biến này phải được owner cấu hình/review riêng trong hosting dashboards trước khi coi staff login/cloud Join Code deployment là verified.

### Vercel web

| Variable                  | Secret | Value/source                                                                 |
| ------------------------- | :----: | ---------------------------------------------------------------------------- |
| `API_INTERNAL_URL`        |   No   | Render origin, ví dụ `https://<name>.onrender.com`                           |
| `API_PROXY_SHARED_SECRET` |  Yes   | Exact same independent CSPRNG value configured on Render; never browser-side |

Không thêm trailing `/api`; rewrite hiện tự giữ `/api/:path*`. Production build fail fast nếu thiếu biến này.

## Deployment configuration

### Render

`render.yaml` là source-controlled configuration cho API service:

- Runtime/plan: Node.js web service trên Free plan.
- Region hiện tại: Singapore, được chọn trong Render dashboard.
- Build command: `pnpm install --frozen-lockfile && pnpm db:generate && pnpm --filter @eatease/api build`.
- Start command: `pnpm --filter @eatease/api start`.
- Health check path: `/api/v1/health/ready` để kiểm tra cả process và Neon connectivity.
- Auto-deploy: `checksPass`; commit trên linked `main` chỉ deploy sau khi GitHub checks pass.

API bind vào `0.0.0.0` và ưu tiên platform-provided `PORT`; không hardcode Render hostname hoặc port vào application code.

### Vercel

- Git repository root directory: `apps/web`.
- Framework Preset: Next.js; `apps/web/vercel.json` cũng khai báo `framework: nextjs`.
- Bật **Include source files outside of the Root Directory** để Vercel có thể đọc workspace manifest và lockfile ở repository root.
- Production environment cần `API_INTERNAL_URL=https://eatease-api-rbgu.onrender.com`.
- Production environment cần `API_PROXY_SHARED_SECRET` matching Render. Biến server-only này không có prefix `NEXT_PUBLIC_` và không được đưa vào browser bundle.
- Output dùng `.next` mặc định; không cần custom build output directory.
- Git integration tự tạo deployment khi `main` được cập nhật. Preview deployment cần environment variable riêng và không được mặc định dùng production data khi M2 bắt đầu có mutations.

### GitHub Actions and deployment flow

`.github/workflows/ci.yml` chạy trên Pull Request và push vào `main`: frozen install, Prisma Client generation, formatting, lint, typecheck, unit/component tests, Prisma validation/migration deploy trên PostgreSQL service, database checks, integration tests và production builds.

```text
Pull Request → GitHub Actions validation → review/merge to main
                                           ├─ Vercel automatic web deployment
                                           └─ Render checksPass API deployment
                                                        └─ Neon pooled runtime connection
```

GitHub Actions không provision Neon, không lưu production database secrets và không thay thế explicit production migration gate.

## One-time owner setup

### 1. Neon Free

1. Đăng nhập Neon và tạo Free project/branch cho EatEase.
2. Chọn region gần Render service nhất có thể.
3. Trong Connection Details, lấy cả:
   - pooled connection URL → `DATABASE_URL`;
   - direct/unpooled connection URL → `DIRECT_DATABASE_URL`.
4. Không paste hai URL vào source, issue, PR hoặc terminal output được chia sẻ.
5. Trước deploy API, chạy reviewed migrations từ trusted local shell:

```powershell
$env:DATABASE_URL='<NEON_POOLED_URL>'
$env:DIRECT_DATABASE_URL='<NEON_DIRECT_URL>'
pnpm db:migrate:deploy
```

Command chỉ apply committed pending migrations; luôn review `pnpm db:migrate:status` trước và sau khi chạy.

### One-time managed demo Manager provisioning

Chỉ thực hiện sau khi migrations đã up to date và deterministic synthetic catalog đã được seed. Managed provisioning dùng command riêng; `pnpm db:bootstrap:staff` vẫn local-only và không được dùng cho Neon.

Xác minh synthetic scope bằng read-only query trong Neon SQL Editor:

```sql
SELECT l.id, l.restaurant_id, l.code, l.is_active, r.status
FROM location AS l
JOIN restaurant AS r ON r.id = l.restaurant_id
WHERE l.id = '20000000-0000-4000-8000-000000000001';
```

Expected: location code `HCM-DEMO`, active location, active restaurant `10000000-0000-4000-8000-000000000001`. Nếu không khớp, dừng; không thay location UUID hoặc target checks để tiếp tục.

Từ trusted PowerShell tại repository root, nhập direct URL và password bằng secure prompt. `STAFF_BOOTSTRAP_EXPECTED_HOST` phải được copy riêng từ exact Neon direct endpoint trong dashboard, không lấy tự động từ URL đang được kiểm tra:

```powershell
$neonDirectSecure = Read-Host 'Neon DIRECT connection string' -AsSecureString
$managerPasswordSecure = Read-Host 'Demo Manager password (12-256 characters)' -AsSecureString

$env:DIRECT_DATABASE_URL = [Net.NetworkCredential]::new('', $neonDirectSecure).Password
$env:STAFF_BOOTSTRAP_PASSWORD = [Net.NetworkCredential]::new('', $managerPasswordSecure).Password
$env:STAFF_BOOTSTRAP_EXPECTED_HOST = '<exact-neon-direct-hostname>'
$env:STAFF_BOOTSTRAP_EXPECTED_DATABASE = 'neondb'
$env:STAFF_BOOTSTRAP_LOCATION_ID = '20000000-0000-4000-8000-000000000001'
$env:STAFF_BOOTSTRAP_EMAIL = 'manager@demo.eatease.invalid'
$env:STAFF_BOOTSTRAP_NAME = 'EatEase Demo Manager'

try {
    pnpm db:bootstrap:staff:managed -- --allow-managed
    if ($LASTEXITCODE -ne 0) { throw 'Managed staff provisioning failed.' }
} finally {
    Remove-Item Env:DIRECT_DATABASE_URL,Env:STAFF_BOOTSTRAP_PASSWORD,Env:STAFF_BOOTSTRAP_EXPECTED_HOST,Env:STAFF_BOOTSTRAP_EXPECTED_DATABASE,Env:STAFF_BOOTSTRAP_LOCATION_ID,Env:STAFF_BOOTSTRAP_EMAIL,Env:STAFF_BOOTSTRAP_NAME -ErrorAction SilentlyContinue
    Remove-Variable neonDirectSecure,managerPasswordSecure -ErrorAction SilentlyContinue
}
```

Safety behavior:

- Requires explicit `--allow-managed`, exact direct hostname, exact `neondb` database and deterministic synthetic location/restaurant scope.
- Rejects localhost, loopback and hostname containing `pooler`; never falls back to `DATABASE_URL`.
- Creates an active Manager atomically with the complete approved permission set. Exact retry with the same identity/password/scope is a no-op; any mismatch fails without password reset.
- Output never includes password, hash or connection string. Do not put these values in `.env`, source, shell scripts, issues or PRs.

Sau provisioning, login through `/staff/login`, confirm the expected synthetic location and confirm effective permissions include `table.activation.read`, `table.activation.approve`, `table.session.read` và `table.join_code.manage`. Không copy cookie/CSRF values vào logs. Sau public testing, revoke active sessions and set the demo user or membership inactive through a separately reviewed owner-authorized operation. Bootstrap không phải password-rotation command; never rerun it with a new password.

### 2. Render Free API

1. Đăng nhập Render và chọn **New → Blueprint**.
2. Connect GitHub repository và chọn root `render.yaml`.
3. Xác nhận service `eatease-api` dùng **Free** plan; không upgrade hoặc thêm paid resource.
4. Nhập `DATABASE_URL` và `DIRECT_DATABASE_URL` khi Blueprint yêu cầu secret values.
5. Trước M2.7 deployment, thêm stable `JOIN_CODE_HASH_SECRET` có tối thiểu 32 random characters; không lưu giá trị vào repository hoặc tài liệu.
6. Thêm independent `API_PROXY_SHARED_SECRET` 32+ random characters; cùng value sẽ được nhập trực tiếp vào Vercel Production environment.
7. Giữ build/start/health settings từ `render.yaml`.
8. Chỉ deploy commit đã có GitHub Actions checks xanh.
9. Sau deploy, kiểm tra:

```text
https://eatease-api-rbgu.onrender.com/api/v1/health
https://eatease-api-rbgu.onrender.com/api/v1/health/ready
```

Liveness phải trả `200` với `status: ok`; readiness phải trả `200` với `database: reachable`.

### 3. Vercel Hobby web

1. Chỉ dùng Hobby nếu đây vẫn là personal, non-commercial portfolio/demo.
2. Import GitHub repository vào Vercel.
3. Chọn Root Directory `apps/web` và bật **Include source files outside of the Root Directory** để workspace config/lockfile ở repository root khả dụng.
4. Giữ Framework Preset `Next.js`, default pnpm install và default `.next` output.
5. Đặt `API_INTERNAL_URL=https://eatease-api-rbgu.onrender.com` cho Production.
6. Đặt `API_PROXY_SHARED_SECRET` bằng exact value đã chuẩn bị cho Render; không prefix `NEXT_PUBLIC_` và không paste vào logs/PR.
7. Nếu bật Preview deployments, phải cung cấp Preview `API_INTERNAL_URL` và một isolated matching proxy secret/backend. Không trỏ mutation preview vào production API/database.
8. Khi rollout lần đầu, deploy Vercel signer trước (current API sẽ ignore internal proof), rồi deploy Render verifier để tránh khoảng thời gian web cũ gọi API mới mà thiếu signature. Sau khi cả hai healthy, xóa deployment cũ theo normal provider retention policy nếu cần; không rotate secret trong cùng rollout.
9. Deploy và kiểm tra:

```text
https://eat-ease.vercel.app/
https://eat-ease.vercel.app/health
https://eat-ease.vercel.app/api/v1/health
https://eat-ease.vercel.app/api/v1/health/ready
```

Public deployment chỉ được ghi nhận `VERIFIED` khi bốn URL trên trả kết quả đúng. Repository preparation hoặc dashboard báo deploy thành công chưa đủ.

## M1 verification record

Verified ngày `2026-10-27`:

| Check                         | Expected result                                       | Status     |
| ----------------------------- | ----------------------------------------------------- | ---------- |
| Vercel `/`                    | HTTP `200`; foundation page hiển thị `API: available` | `VERIFIED` |
| Vercel `/health`              | HTTP `200`                                            | `VERIFIED` |
| Render `/api/v1/health`       | `{"status":"ok","service":"api"}`                     | `VERIFIED` |
| Render `/api/v1/health/ready` | `{"status":"ready","database":"reachable"}`           | `VERIFIED` |
| Vercel `/api/v1/health`       | Same-origin rewrite trả API liveness response         | `VERIFIED` |
| Vercel `/api/v1/health/ready` | Same-origin rewrite trả database readiness response   | `VERIFIED` |

Kiểm tra lại bằng browser hoặc HTTP client; cold start có thể làm request đầu chậm:

```powershell
Invoke-RestMethod https://eatease-api-rbgu.onrender.com/api/v1/health
Invoke-RestMethod https://eatease-api-rbgu.onrender.com/api/v1/health/ready
Invoke-RestMethod https://eat-ease.vercel.app/api/v1/health
Invoke-RestMethod https://eat-ease.vercel.app/api/v1/health/ready
```

## M2.7 production verification status

M2.7 was deployed at commit `bb179bd` and its core browser flow was observed successfully on `2026-10-31`: managed Manager login, public A01 catalog, activation request/approval/claim, one-time six-digit Join Code creation, and a second independent GuestSession joining the same active TableSession. Read-only Neon evidence showed one active A01 TableSession and two non-revoked `ORDER_ENABLED` GuestSessions linked to it. Staff Session restoration was subsequently fixed in PR #22 at `3c4ffb1`; Render and Vercel deployed the same fix and browser refresh recovery returned HTTP `200` from the POST CSRF endpoint.

The initial staff login failed because Render lacked `TRUSTED_WEB_ORIGINS`; adding the exact Vercel origin and redeploying Render resolved the configuration issue without a code or database change.

M2.7 scoped production verification is **COMPLETE**. Follow-up observations on `2026-11-04` confirmed direct unsigned Render rejection, rotation, revocation, natural 30-minute expiration, existing Guest access preservation, Staff Session restoration, focused IP-spoof regression coverage and distinct Wi-Fi/4G `IP_TABLE` fingerprints. Production threshold load testing was intentionally omitted; IPv6 canonicalization remains non-blocking. Full observations, evidence boundaries, cleanup recommendation and non-claims are in [M2.7 production verification](m2-7-production-verification.md).

## M2.11 realtime and publisher setup

Implementation remains pending owner validation; this section is a release procedure, not production evidence. The approved [ADR-0007 topology](../architecture/adr/0007-portfolio-deployment.md) keeps REST on Vercel, obtains short-lived tickets through that proxy, then connects Socket.IO directly to Render. No Vercel WebSocket rewrite, third-party API cookie, Redis or separate paid worker is required. Client tickets are passed only in Socket.IO auth, never URLs or logs. [Socket.IO emission does not guarantee client receipt](https://socket.io/docs/v4/delivery-guarantees/); reconnect refetches authoritative REST.

### Release sequence and configuration

1. Owner reviews and applies additive migration `20261105120000_m2_11_realtime_outbox` through the existing direct-URL migration gate before enabling new code. Do not run db push/reset. The migration adds an ephemeral ticket table and nullable outbox lease/quarantine fields plus indexes; existing events and financial records are preserved. ALTER TABLE/index creation briefly locks/scans outbox; review backlog size and schedule a quiet window. It needs no seed/backfill and remains compatible with the prior API.
2. Configure Render `REALTIME_ENABLED=true`, `REALTIME_PUBLIC_URL` equal to the exact public Render HTTPS origin (no trailing slash), `OUTBOX_PUBLISHER_ENABLED=true`, and the existing exact Vercel `TRUSTED_WEB_ORIGINS`. Keep one API instance. Existing database/Join Code/proxy secrets remain server-only; no new shared secret is needed for tickets.
3. Optional Render limits: `REALTIME_MAX_CONNECTIONS=100` (max 200), `OUTBOX_BATCH_SIZE=10` (max 50), `OUTBOX_POLL_MS=1000`, `OUTBOX_LEASE_SECONDS=60`, `OUTBOX_MAX_ATTEMPTS=8`. Defaults are safe and bounded. Publisher cannot be enabled without realtime. API validates public HTTPS Origin configuration on production startup.
4. Configure Vercel `NEXT_PUBLIC_REALTIME_ENABLED=true` and rebuild/redeploy Web; it is a public build-time feature flag, never a secret. The authenticated ticket response provides the Socket.IO URL, so do not add production URLs to source. Keep existing REST proxy environment unchanged.
5. Owner verifies public health/readiness, trusted-Origin ticket POST, direct Socket.IO handshake, authorized queue/Bill invalidation, revocation and reconnect/refetch using separate authorized browser sessions. No production verification is implied by CI or local tests. Never paste tickets/cookies/CSRF tokens into evidence.

Both API flags and the Web feature flag default false. Local development uses `REALTIME_PUBLIC_URL=http://localhost:3001` and trusted `http://localhost:3000`; owner explicitly enables flags in the respective terminal processes or authorized local configuration. Existing Docker PostgreSQL workflow remains unchanged. No worker starts in `NODE_ENV=test`; integration tests invoke one tick explicitly.

### Worker lifecycle and diagnostics

- Main attaches Socket.IO to the API HTTP server; an explicitly enabled publisher starts at application bootstrap. It schedules the next bounded batch after the previous batch completes, with no overlapping timer ticks. Shutdown cancels timers, awaits active processing and closes sockets; an interrupted claim recovers after its lease expires.
- Events are claimed only after commit. Errors back off `min(300, 2^attemptCount)` seconds. After the configured maximum, including crashed attempts, quarantine stops automatic retries. Invalid/unsupported events quarantine immediately. Older pending activation/ordering events are also eligible; clients safely refetch current state.
- Logs contain safe error codes (`OUTBOX_DELIVERY_FAILED`, `OUTBOX_TICK_FAILED`, `REALTIME_CLEANUP_FAILED`), never payloads/credentials. Liveness/readiness endpoints retain their API/database meanings; they do not prove worker delivery or browser receipt. Diagnose backlog with the read-only SQL below.
- Realtime failure leaves manual refresh and all authoritative REST commands available. Client retries are bounded (six reconnect retries, exponential delay up to 30 seconds), then offers explicit retry. Every reconnect obtains a new ticket and refetches; no durable replay/ordering guarantee and no financial side effects. Ticket rejection never converts an HTTP-authenticated session to anonymous.
- Restart/lease expiry may duplicate invalidations. Successful local emission with no connected audience can mark publication successful; a disconnected client recovers through REST when reconnecting. No multi-instance Socket.IO fanout exists, even though database claims support multiple publisher contenders.
- During idle periods Render may suspend the API and stop publisher timers; Neon/Render cold starts delay delivery. Publisher queries can consume free-tier database compute while the API is running; disable demo realtime/publisher when not needed and monitor included quotas. Do not add synthetic keep-alive or paid services.

Read-only operational query (no payloads, ticket hashes or credentials):

```sql
SELECT count(*) FILTER (WHERE published_at IS NULL AND failed_at IS NULL) AS pending,
       count(*) FILTER (WHERE published_at IS NULL AND lease_until > now()) AS leased,
       count(*) FILTER (WHERE failed_at IS NOT NULL) AS quarantined,
       min(occurred_at) FILTER (WHERE published_at IS NULL AND failed_at IS NULL) AS oldest_pending
FROM outbox_event;

SELECT id, event_type, attempt_count, next_attempt_at, lease_until, failed_at, last_error
FROM outbox_event
WHERE published_at IS NULL
ORDER BY occurred_at, id
LIMIT 50;
```

If backlog grows, check enabled flags, startup logs, database schema/availability and quarantine codes. Diagnose the root cause before any explicitly authorized, ID-scoped requeue; never reset financial records or bulk-reset the outbox. If sockets fail, check exact Origin allowlist, direct Render reachability, enabled flags, ticket age (30 seconds)/single use and current permissions. Never debug by logging ticket auth or session material.

## Actionable free-tier limitations

- **Render cold start:** Free web service spin down sau 15 phút không có inbound HTTP hoặc WebSocket message và có thể cần khoảng một phút để wake. UI/demo phải chấp nhận request đầu chậm; không dùng synthetic keep-alive để lách giới hạn.
- **Neon wake and connections:** Free compute có thể scale to zero. Dùng pooled URL cho API và giới hạn process pool ở `5`; dùng direct URL chỉ cho migration/admin workflow.
- **Combined latency:** Render và Neon cùng ngủ có thể làm readiness/request đầu tiên chậm hơn bình thường. Đây là demo limitation, không phải API performance baseline.
- **Socket.IO:** M2.11 uses direct Render WebSocket with REST-issued tickets, not a Vercel upgrade proxy. Reconnect/refetch handles sleep, restart and missed events. Keep one API instance until cross-instance fanout is separately approved.
- **Ephemeral API filesystem:** Render Free filesystem mất dữ liệu khi restart/redeploy; mọi durable state phải ở Neon hoặc external object storage được phê duyệt sau này.
- **Vercel Hobby usage:** Hobby chỉ cho personal, non-commercial use và có included usage limits. Khi vượt giới hạn, feature có thể bị unavailable cho tới khi usage window reset; không bật paid upgrade cho task này.
- **Migration gate:** Render Free không có paid pre-deploy command. Chạy `pnpm db:migrate:deploy` thủ công với direct Neon URL trước deploy; không dùng `prisma db push`.

Free-tier terms và quotas có thể thay đổi. Trước mỗi public demo/release, kiểm tra lại [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Render Free](https://render.com/docs/free), [Render WebSockets](https://render.com/docs/websocket) và [Neon connection pooling](https://neon.com/docs/manage/endpoints/).

## Rollback and troubleshooting

- Nếu GitHub Actions fail: sửa validation failure trên task branch; không bypass check hoặc deploy commit lỗi trực tiếp từ dashboard.
- Nếu Render build fail: kiểm tra Node/pnpm pins, frozen lockfile, Prisma generation và build logs; không sửa production secret trong source.
- Nếu Render start fail: xác nhận start command, platform `PORT`, required environment variables và Neon URLs đã được đặt trong dashboard.
- Nếu Render start fail sau M2.7: xác nhận `JOIN_CODE_HASH_SECRET` tồn tại, dài tối thiểu 32 characters và không bị trim; không print giá trị vào log hoặc support artifact.
- Nếu `/table-sessions/join` qua Vercel trả `TRUSTED_PROXY_REQUIRED`: xác nhận `API_PROXY_SHARED_SECRET` có cùng exact value trên Vercel Production và Render, redeploy cả hai sau thay đổi, và kiểm tra system clocks/provider status. Không bật `trust proxy` hoặc fallback sang `X-Forwarded-For` để chữa tạm.
- Sau rollout, verify Join Code qua public Vercel URL từ hai client networks/devices và xác nhận request hợp lệ đi tới API; automated request/integration tests phải chứng minh two signed client IPs tạo distinct `IP_TABLE` buckets và spoofed forwarded headers vẫn dùng signed identity. Không log hoặc query raw IP vì persistence chỉ giữ HMAC fingerprint.
- Nếu migration fail: dừng release, không deploy code phụ thuộc schema mới.
- Nếu Render liveness pass nhưng readiness fail: kiểm tra Neon state và Render secret values; không log/paste connection strings.
- Nếu Vercel `/health` pass nhưng proxied `/api` fail: kiểm tra `API_INTERNAL_URL`, Render cold start và public API endpoints.
- Nếu frontend hiển thị `API: unavailable` nhưng direct Render health pass: kiểm tra Vercel Production environment, redeploy sau khi đổi environment variable và kiểm tra rewrite path không có duplicated `/api`.
- Nếu request đầu mất gần một phút nhưng request sau bình thường: đây thường là Render Free cold start; không dùng keep-alive traffic để lách free-tier policy.
- Rollback application deploy không tự rollback database. Domain migration tương lai phải có forward-compatible rollout/rollback plan trong task tương ứng.
