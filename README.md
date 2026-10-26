# EatEase

EatEase là hệ thống gọi món và vận hành nhà hàng dine-in, tập trung vào luồng nghiệp vụ:

`QR / Waiter → TableSession → Order → Fulfillment → Bill → Payment → Settlement → Table reset`

Dự án này là codebase mới, độc lập với repository EatEase legacy. Legacy chỉ được dùng làm tài liệu tham khảo và không được sao chép kiến trúc hoặc source một cách mặc định.

## Mục tiêu MVP

- Hỗ trợ QR self-ordering và staff-assisted ordering trong cùng một dining session.
- Cho phép nhiều lượt gọi món và nhiều thiết bị tại một bàn.
- Theo dõi từng món qua Kitchen, Bar hoặc Direct fulfillment.
- Hợp nhất các order vào một bill, thanh toán tiền mặt và settlement cuối bữa.
- Tách settlement, đóng TableSession và trạng thái sẵn sàng vật lý của bàn.
- Bảo đảm authorization, idempotency, transaction safety và auditability từ đầu.

## Technical baseline

- TypeScript monorepo.
- Next.js App Router.
- NestJS với Express adapter.
- PostgreSQL và Prisma; cho phép custom SQL migration khi cần.
- Modular Monolith.
- REST là authoritative interface.
- Socket.IO cho realtime notification.
- Transactional outbox cho reliable event publication.

Đây mới là architecture baseline. Application chưa được scaffold và chưa có dependency nào được cài đặt.

## Trạng thái

Milestone hiện tại: **M0 — Repository and documentation bootstrap**.

- Planning/documentation baseline: hoàn thành trong M0.
- Application implementation: chưa bắt đầu.
- M1 chỉ được bắt đầu sau khi có phê duyệt rõ ràng.

## Documentation

- [Documentation index](docs/README.md)
- [MVP requirements](docs/product/requirements.md)
- [Business rules](docs/product/business-rules.md)
- [Architecture overview](docs/architecture/overview.md)
- [Data model](docs/architecture/data-model.md)
- [State machines](docs/architecture/state-machines.md)
- [API contracts](docs/architecture/api-contracts.md)
- [Permissions](docs/architecture/permissions.md)
- [Security](docs/architecture/security.md)
- [Roadmap](docs/planning/roadmap.md)
- [Implementation plan](docs/planning/implementation-plan.md)
- [Phase 1 plan](docs/planning/phase-01.md)
- [Decision log](docs/planning/decision-log.md)

## Repository boundaries

- `apps/`: future web and API applications.
- `packages/`: future shared contracts and repository tooling.
- `infrastructure/`: future local and cloud infrastructure definitions.
- `docs/`: current source of truth cho product, architecture và planning.

Đọc [AGENTS.md](AGENTS.md) trước khi thực hiện thay đổi trong repository.
