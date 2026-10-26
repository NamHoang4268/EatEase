# ADR-0007: Portfolio deployment topology

- Status: **ACCEPTED**
- Date: 2026-10-27
- Related: [ADR-0002](0002-typescript-web-api-stack.md), [ADR-0003](0003-postgresql-prisma.md), [ADR-0006](0006-m1-technical-foundation.md)

## Context

EatEase cần một public portfolio/demo deployment sớm với chi phí mục tiêu `$0/month`, trước khi M5 thiết kế production AWS topology. Deployment này phải giữ web, API và database thành các deployable riêng, không làm sai local Docker workflow hoặc biến free-tier limitations thành production assumptions.

## Decision

- Deploy `apps/web` lên Vercel Hobby.
- Deploy `apps/api` thành Render Free web service.
- Dùng Neon Free PostgreSQL.
- Browser tiếp tục gọi relative `/api/...`; Next.js server rewrite tới Render thông qua server-only `API_INTERNAL_URL`.
- Không bật wildcard CORS. Direct cross-origin browser calls không thuộc topology hiện tại.
- API dùng Neon pooled URL cho application traffic với pool nhỏ; Prisma CLI dùng direct URL cho reviewed migrations.
- Render readiness health check phải truy vấn database thật.
- GitHub Actions là validation gate; cloud dashboard provisioning và production migration vẫn là explicit owner action.
- Không lưu cloud credential hoặc database URL trong repository.

Topology này chỉ dành cho personal, non-commercial portfolio/demo. Nó không supersede AWS direction hoặc production-readiness work của M5.

## Consequences

- Có thể demo public với chi phí bằng không trong giới hạn free tier.
- Render và Neon cold start có thể cộng dồn vào request đầu tiên.
- Render Free không cung cấp paid pre-deploy command; owner phải chạy reviewed migration như một explicit release gate.
- Vercel Hobby chỉ phù hợp personal, non-commercial use.
- Render hỗ trợ inbound WebSocket, nhưng Socket.IO qua Vercel same-origin rewrite chưa được phê duyệt hoặc verify. Mốc realtime phải review origin, cookie và proxy topology trước khi triển khai.
- Public deployment chỉ được gọi là verified sau khi kiểm tra public web, API liveness, readiness và proxied API endpoints.

## Alternatives considered

- Deploy tất cả lên một provider: đơn giản hơn về origin nhưng không đáp ứng target platform và free-tier direction được giao.
- Thêm Docker/Kubernetes/AWS ngay: vượt phạm vi portfolio M1 và tạo chi phí/complexity sớm.
- Chạy migration trong Render build: có thể dùng với Free plan nhưng mutation database trước khi build/deploy được chứng minh thành công là release coupling không mong muốn.
- Browser gọi Render trực tiếp: yêu cầu CORS/cookie cross-origin sớm và đi ngược same-origin REST direction hiện tại.

## Operational guide

Xem [deployment guide](../../development/deployment.md).
