# M1 portfolio deployment: Vercel, Render and Neon

Guide này ghi lại và hướng dẫn tái tạo public portfolio/demo deployment `$0/month`. Nó không phải production SLA architecture và không thay thế AWS/M5 direction. Quyết định authoritative nằm trong [ADR-0007](../architecture/adr/0007-portfolio-deployment.md).

## Current M1 deployment

Initial cloud deployment đã được verify ngày `2026-10-27`.

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

| Variable              | Secret | Value/source                                                                       |
| --------------------- | :----: | ---------------------------------------------------------------------------------- |
| `NODE_ENV`            |   No   | `production`                                                                       |
| `NODE_VERSION`        |   No   | `24.22.1`                                                                          |
| `DATABASE_POOL_MAX`   |   No   | `5` cho single Free instance                                                       |
| `TRUSTED_WEB_ORIGINS` |   No   | Comma-separated exact origins; staff deployment dùng `https://eat-ease.vercel.app` |
| `TRUST_PROXY_HOPS`    |   No   | `0` cho tới khi exact trusted proxy-hop topology được verify                       |
| `DATABASE_URL`        |  Yes   | Neon pooled URL; hostname thường có `-pooler`                                      |
| `DIRECT_DATABASE_URL` |  Yes   | Neon direct/unpooled URL cho Prisma migrations                                     |
| `PORT`                |   No   | Render tự cấp; API ưu tiên `PORT` và fallback về `API_PORT` cho local development  |

Không đặt `DATABASE_URL` hoặc `DIRECT_DATABASE_URL` ở Vercel.

Staff authenticated browser requests cần credentials và exact Origin allowlist. Production API set host-only `SameSite=None; Secure; HttpOnly` staff cookie; một số browser/privacy modes vẫn có thể block third-party cookies. Không tăng `TRUST_PROXY_HOPS` theo header do client gửi; chỉ thay sau khi verify Render proxy chain. Các biến này phải được owner cấu hình/review riêng trong Render dashboard trước khi coi staff login cloud deployment là verified.

### Vercel web

| Variable           | Secret | Value/source                                       |
| ------------------ | :----: | -------------------------------------------------- |
| `API_INTERNAL_URL` |   No   | Render origin, ví dụ `https://<name>.onrender.com` |

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
5. Giữ build/start/health settings từ `render.yaml`.
6. Chỉ deploy commit đã có GitHub Actions checks xanh.
7. Sau deploy, kiểm tra:

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
6. Nếu bật Preview deployments, phải cung cấp Preview `API_INTERNAL_URL`. Chỉ dùng production API tạm thời khi foundation còn read-only; trước M2 mutations phải dùng isolated preview backend/database hoặc tắt preview deployment.
7. Deploy và kiểm tra:

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

## Actionable free-tier limitations

- **Render cold start:** Free web service spin down sau 15 phút không có inbound HTTP hoặc WebSocket message và có thể cần khoảng một phút để wake. UI/demo phải chấp nhận request đầu chậm; không dùng synthetic keep-alive để lách giới hạn.
- **Neon wake and connections:** Free compute có thể scale to zero. Dùng pooled URL cho API và giới hạn process pool ở `5`; dùng direct URL chỉ cho migration/admin workflow.
- **Combined latency:** Render và Neon cùng ngủ có thể làm readiness/request đầu tiên chậm hơn bình thường. Đây là demo limitation, không phải API performance baseline.
- **Socket.IO later:** Render web service nhận được inbound WebSocket và active messages có thể ngăn spin-down. Tuy nhiên Vercel REST rewrite hiện chưa chứng minh WebSocket upgrade/cookie behavior; không triển khai Socket.IO qua topology này trước security/origin review.
- **Ephemeral API filesystem:** Render Free filesystem mất dữ liệu khi restart/redeploy; mọi durable state phải ở Neon hoặc external object storage được phê duyệt sau này.
- **Vercel Hobby usage:** Hobby chỉ cho personal, non-commercial use và có included usage limits. Khi vượt giới hạn, feature có thể bị unavailable cho tới khi usage window reset; không bật paid upgrade cho task này.
- **Migration gate:** Render Free không có paid pre-deploy command. Chạy `pnpm db:migrate:deploy` thủ công với direct Neon URL trước deploy; không dùng `prisma db push`.

Free-tier terms và quotas có thể thay đổi. Trước mỗi public demo/release, kiểm tra lại [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Render Free](https://render.com/docs/free), [Render WebSockets](https://render.com/docs/websocket) và [Neon connection pooling](https://neon.com/docs/manage/endpoints/).

## Rollback and troubleshooting

- Nếu GitHub Actions fail: sửa validation failure trên task branch; không bypass check hoặc deploy commit lỗi trực tiếp từ dashboard.
- Nếu Render build fail: kiểm tra Node/pnpm pins, frozen lockfile, Prisma generation và build logs; không sửa production secret trong source.
- Nếu Render start fail: xác nhận start command, platform `PORT`, required environment variables và Neon URLs đã được đặt trong dashboard.
- Nếu migration fail: dừng release, không deploy code phụ thuộc schema mới.
- Nếu Render liveness pass nhưng readiness fail: kiểm tra Neon state và Render secret values; không log/paste connection strings.
- Nếu Vercel `/health` pass nhưng proxied `/api` fail: kiểm tra `API_INTERNAL_URL`, Render cold start và public API endpoints.
- Nếu frontend hiển thị `API: unavailable` nhưng direct Render health pass: kiểm tra Vercel Production environment, redeploy sau khi đổi environment variable và kiểm tra rewrite path không có duplicated `/api`.
- Nếu request đầu mất gần một phút nhưng request sau bình thường: đây thường là Render Free cold start; không dùng keep-alive traffic để lách free-tier policy.
- Rollback application deploy không tự rollback database. Domain migration tương lai phải có forward-compatible rollout/rollback plan trong task tương ứng.
