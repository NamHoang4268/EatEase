# Local development setup

Hướng dẫn này mô tả foundation hiện có của EatEase trên Windows, gồm M2.1 restaurant/location/table/menu catalog schema.

## Prerequisites

- Node.js `24.22.1` (pin trong `.node-version` và `.nvmrc`).
- pnpm `12.15.0` (pin trong root `package.json`).
- Docker Desktop với Linux containers và Docker Compose.
- Git.

Kiểm tra version:

```powershell
node --version
pnpm --version
docker version
docker compose version
```

Nếu Corepack trên máy Windows không activate đúng pnpm đã pin, có thể dùng `npx --yes pnpm@12.15.0 <command>` cho cùng một command. Không cài global version khác để bỏ qua project pin.

## First setup

Từ repository root:

```powershell
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/web/.env.example apps/web/.env
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:up
pnpm db:migrate:deploy
pnpm --filter @eatease/api db:check
pnpm dev
```

Các URL mặc định:

- Web: `http://localhost:3000`
- Web health: `http://localhost:3000/health`
- API liveness: `http://localhost:3001/api/v1/health`
- API readiness: `http://localhost:3001/api/v1/health/ready`
- API qua web rewrite: `http://localhost:3000/api/v1/health`

`apps/web` chỉ gọi relative `/api/...`; `API_INTERNAL_URL` là server-only target cho Next.js rewrite. Không đưa internal API URL vào browser bundle.

## Environment files

- `apps/api/.env`: `NODE_ENV`, `API_PORT`, `DATABASE_URL`, `DIRECT_DATABASE_URL`, `DATABASE_POOL_MAX`, `TRUSTED_WEB_ORIGINS`, guest/activation timeout variables, `JOIN_CODE_HASH_SECRET` và `API_PROXY_SHARED_SECRET`.
- `apps/web/.env`: `API_INTERNAL_URL` và matching `API_PROXY_SHARED_SECRET`.
- `infrastructure/local/.env`: optional override cho PostgreSQL Compose.

Chỉ `.env.example` được commit. `.env` và `.env.*` bị ignore; không đặt production secrets trong repository.

`JOIN_CODE_HASH_SECRET` cần tối thiểu 32 random characters. Local development có thể dùng placeholder chỉ dành cho local từ `.env.example`; production reject placeholder và phải dùng stable CSPRNG secret cấu hình trực tiếp trên hosting platform. Thay secret làm các Join Code đang còn hạn không thể verify. `API_PROXY_SHARED_SECRET` cũng cần 32+ random characters và cùng một value trên Vercel/Render, nhưng phải độc lập với Join Code/database/session secrets. Fixed Join Code TTL 30 phút và join recovery TTL 120 giây không có environment override.

API và web validate environment bằng Zod và fail fast khi giá trị không hợp lệ. Giá trị trong example chỉ dành cho local development.

## Common commands

```powershell
pnpm dev
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build

pnpm db:up
pnpm db:logs
pnpm db:validate
pnpm db:generate
pnpm db:seed:catalog
pnpm db:bootstrap:staff
pnpm db:migrate:status
pnpm db:migrate:deploy
pnpm --filter @eatease/api db:check
pnpm db:down
```

`pnpm db:down` dừng container nhưng giữ named volume `eatease-local_postgres-data` để dữ liệu local không bị xóa ngoài ý muốn.

## Migration workflow

1. Thay đổi `apps/api/prisma/schema.prisma` trong task đã được phê duyệt.
2. Tạo migration bằng Prisma migrate development workflow trên local database.
3. Review toàn bộ generated SQL; thêm custom SQL khi invariant cần database constraint mà Prisma không biểu diễn đủ.
4. Chạy migration trên database sạch và database có state phù hợp.
5. Commit schema và migration đã review cùng nhau.
6. Dùng `db:migrate:deploy` cho CI/deployment.

Không dùng `prisma db push` cho managed environment. Migration M2.1 tạo catalog/table schema và chứa reviewed custom SQL cho `CHECK` constraints cùng MVP-only partial unique active-location index.

## Synthetic catalog fixtures

Sau khi review đúng database target và apply migrations, load fictional catalog fixtures bằng explicit command:

```powershell
pnpm db:seed:catalog
```

Command có thể chạy lại mà không tạo duplicate và không chạy trong migration hoặc application startup. Script mặc định từ chối managed database; public portfolio seed chỉ được thực hiện bằng một owner-approved operation riêng. Fixtures không chứa staff/guest credentials, tokens, secrets hoặc personal information.

## Explicit local staff bootstrap

M2.3 không tạo privileged account trong migration hoặc application startup. Sau khi review đúng local database target, owner có thể tạo initial Manager bằng process-scoped inputs. Command từ chối non-local database và existing email; nó không print password/session secret.

```powershell
$env:DATABASE_URL='postgresql://eatease:eatease_dev@localhost:5432/eatease?schema=public'
$env:STAFF_BOOTSTRAP_EMAIL='owner@example.test'
$env:STAFF_BOOTSTRAP_NAME='Local Owner'
$env:STAFF_BOOTSTRAP_LOCATION_ID='<active-location-uuid>'
$staffBootstrapPassword = Read-Host 'Staff password (minimum 12 characters)' -AsSecureString
$env:STAFF_BOOTSTRAP_PASSWORD = [Net.NetworkCredential]::new('', $staffBootstrapPassword).Password
pnpm db:bootstrap:staff
Remove-Item Env:STAFF_BOOTSTRAP_EMAIL,Env:STAFF_BOOTSTRAP_NAME,Env:STAFF_BOOTSTRAP_LOCATION_ID,Env:STAFF_BOOTSTRAP_PASSWORD
```

Không đặt bootstrap password trong `.env`, shell script committed hoặc command argument. Managed/public portfolio bootstrap cần owner authorization riêng và không dùng command local-only này.

## Current compatibility notes

- Approved pins đã được build/test bằng Node.js `24.22.1`.
- NestJS chạy ESM-first với explicit injection token ở runtime development; không phụ thuộc implicit decorator metadata của `tsx`.
- ESLint `9.39.5` được dùng vì plugins đi kèm `eslint-config-next@16.4.3` chưa khai báo tương thích ESLint 10. Không force hoặc ignore peer dependency.
- pnpm 12 dùng `allowBuilds` tối thiểu cho Prisma, esbuild và native resolver scripts.
- pnpm có thể phát hiện optional agent skill do package dependency cung cấp. EatEase không approve skill đó vì không cần cho runtime hoặc build.
- API ưu tiên platform-provided `PORT`, giữ `API_PORT=3001` làm local fallback và bind `0.0.0.0` để chạy được trong managed web service.
- `DATABASE_URL` dùng cho application traffic; `DIRECT_DATABASE_URL` được Prisma CLI ưu tiên cho migration. Local Docker có thể dùng cùng một URL cho cả hai.

Real-database integration tests dùng database local cô lập tên chính xác `eatease_m2_test`. Tạo database một lần, apply migrations rồi chạy tests:

```powershell
pnpm db:up
docker compose -f infrastructure/local/compose.yaml exec postgres createdb -U eatease eatease_m2_test
$env:DATABASE_URL='postgresql://eatease:eatease_dev@localhost:5432/eatease_m2_test?schema=public'
$env:DIRECT_DATABASE_URL=$env:DATABASE_URL
pnpm db:migrate:deploy
pnpm test:integration
pnpm db:down
```

Nếu database đã tồn tại, bỏ qua lệnh `createdb`. Catalog integration suite từ chối non-local URL và từ chối database local không đúng tên; GitHub Actions dùng PostgreSQL service tạm thời riêng cho từng job.

Staff auth và guest session integration suites dùng cùng isolated database guard. M2.3 và M2.4 migrations phải được apply trước khi chạy và các test suites xóa chỉ các synthetic IDs riêng của chúng. Không trỏ `DATABASE_URL` vào Neon/shared database.
