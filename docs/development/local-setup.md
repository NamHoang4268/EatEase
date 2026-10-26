# Local development setup

Hướng dẫn này mô tả foundation hiện có của EatEase trên Windows. Chưa có business module hoặc domain migration trong M1 foundation.

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

- `apps/api/.env`: `NODE_ENV`, `API_PORT`, `DATABASE_URL`, `DIRECT_DATABASE_URL`, `DATABASE_POOL_MAX`.
- `apps/web/.env`: `API_INTERNAL_URL`.
- `infrastructure/local/.env`: optional override cho PostgreSQL Compose.

Chỉ `.env.example` được commit. `.env` và `.env.*` bị ignore; không đặt production secrets trong repository.

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

Không dùng `prisma db push` cho managed environment. Foundation hiện chưa có business model nên `prisma/migrations` chưa tồn tại và deploy sạch báo không có pending migration.

## Current compatibility notes

- Approved pins đã được build/test bằng Node.js `24.22.1`.
- NestJS chạy ESM-first với explicit injection token ở runtime development; không phụ thuộc implicit decorator metadata của `tsx`.
- ESLint `9.39.5` được dùng vì plugins đi kèm `eslint-config-next@16.4.3` chưa khai báo tương thích ESLint 10. Không force hoặc ignore peer dependency.
- pnpm 12 dùng `allowBuilds` tối thiểu cho Prisma, esbuild và native resolver scripts.
- pnpm có thể phát hiện optional agent skill do package dependency cung cấp. EatEase không approve skill đó vì không cần cho runtime hoặc build.
- API ưu tiên platform-provided `PORT`, giữ `API_PORT=3001` làm local fallback và bind `0.0.0.0` để chạy được trong managed web service.
- `DATABASE_URL` dùng cho application traffic; `DIRECT_DATABASE_URL` được Prisma CLI ưu tiên cho migration. Local Docker có thể dùng cùng một URL cho cả hai.

Real-database integration test yêu cầu PostgreSQL đang chạy và API env đã được load:

```powershell
pnpm db:up
$env:DATABASE_URL='postgresql://eatease:eatease_dev@localhost:5432/eatease?schema=public'
$env:DIRECT_DATABASE_URL=$env:DATABASE_URL
pnpm test:integration
pnpm db:down
```
