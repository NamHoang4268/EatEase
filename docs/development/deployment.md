# Portfolio deployment: Vercel, Render and Neon

Guide này chuẩn bị public portfolio/demo deployment `$0/month`. Nó không phải production SLA architecture và không thay thế AWS/M5 direction. Quyết định authoritative nằm trong [ADR-0007](../architecture/adr/0007-portfolio-deployment.md).

## Topology

```text
Browser
  └─ https://<vercel-project>.vercel.app
       ├─ / and /health        → Next.js on Vercel
       └─ /api/*               → server-side rewrite
                                  └─ https://<render-service>.onrender.com/api/*
                                       └─ pooled PostgreSQL connection → Neon
```

Browser chỉ thấy same-origin `/api/...`. `API_INTERNAL_URL` không có prefix `NEXT_PUBLIC_` và không phải browser variable. API/database secrets chỉ nằm ở Render/Neon.

## Required environment variables

### Render API

| Variable              | Secret | Value/source                                                                      |
| --------------------- | :----: | --------------------------------------------------------------------------------- |
| `NODE_ENV`            |   No   | `production`                                                                      |
| `NODE_VERSION`        |   No   | `24.22.1`                                                                         |
| `DATABASE_POOL_MAX`   |   No   | `5` cho single Free instance                                                      |
| `DATABASE_URL`        |  Yes   | Neon pooled URL; hostname thường có `-pooler`                                     |
| `DIRECT_DATABASE_URL` |  Yes   | Neon direct/unpooled URL cho Prisma migrations                                    |
| `PORT`                |   No   | Render tự cấp; API ưu tiên `PORT` và fallback về `API_PORT` cho local development |

Không đặt `DATABASE_URL` hoặc `DIRECT_DATABASE_URL` ở Vercel.

### Vercel web

| Variable           | Secret | Value/source                                       |
| ------------------ | :----: | -------------------------------------------------- |
| `API_INTERNAL_URL` |   No   | Render origin, ví dụ `https://<name>.onrender.com` |

Không thêm trailing `/api`; rewrite hiện tự giữ `/api/:path*`. Production build fail fast nếu thiếu biến này.

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

Foundation hiện chưa có domain migration nên command hợp lệ sẽ báo không có pending migration.

### 2. Render Free API

1. Đăng nhập Render và chọn **New → Blueprint**.
2. Connect GitHub repository và chọn root `render.yaml`.
3. Xác nhận service `eatease-api` dùng **Free** plan; không upgrade hoặc thêm paid resource.
4. Nhập `DATABASE_URL` và `DIRECT_DATABASE_URL` khi Blueprint yêu cầu secret values.
5. Giữ build/start/health settings từ `render.yaml`.
6. Chỉ deploy commit đã có GitHub Actions checks xanh.
7. Sau deploy, kiểm tra:

```text
https://<render-service>.onrender.com/api/v1/health
https://<render-service>.onrender.com/api/v1/health/ready
```

Liveness phải trả `200` với `status: ok`; readiness phải trả `200` với `database: reachable`.

### 3. Vercel Hobby web

1. Chỉ dùng Hobby nếu đây vẫn là personal, non-commercial portfolio/demo.
2. Import GitHub repository vào Vercel.
3. Chọn Root Directory `apps/web` và bật **Include source files outside of the Root Directory** để workspace config/lockfile ở repository root khả dụng.
4. Giữ Framework Preset `Next.js`, default pnpm install và default `.next` output.
5. Đặt `API_INTERNAL_URL` bằng verified Render origin cho Production.
6. Nếu bật Preview deployments, phải cung cấp Preview `API_INTERNAL_URL`. Chỉ dùng production API tạm thời khi foundation còn read-only; trước M2 mutations phải dùng isolated preview backend/database hoặc tắt preview deployment.
7. Deploy và kiểm tra:

```text
https://<vercel-project>.vercel.app/
https://<vercel-project>.vercel.app/health
https://<vercel-project>.vercel.app/api/v1/health
https://<vercel-project>.vercel.app/api/v1/health/ready
```

Public deployment chỉ được ghi nhận `VERIFIED` khi bốn URL trên trả kết quả đúng. Repository preparation hoặc dashboard báo deploy thành công chưa đủ.

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

- Nếu migration fail: dừng release, không deploy code phụ thuộc schema mới.
- Nếu Render liveness pass nhưng readiness fail: kiểm tra Neon state và Render secret values; không log/paste connection strings.
- Nếu Vercel `/health` pass nhưng proxied `/api` fail: kiểm tra `API_INTERNAL_URL`, Render cold start và public API endpoints.
- Rollback application deploy không tự rollback database. Domain migration tương lai phải có forward-compatible rollout/rollback plan trong task tương ứng.
